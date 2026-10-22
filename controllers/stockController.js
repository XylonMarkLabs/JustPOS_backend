import mongoose from "mongoose";
import stockModel from "../models/stockModal.js";
import stockItemModel from "../models/stockItemModal.js";
import productModel from "../models/productModel.js";
import {
    codeValidator,
    usernameValidator,
    productIdentifierValidator,
} from "../middleware/inputValidator.js";
import { logger } from "../utils/logger.js";

const badRequest = (res, message) =>
    res.status(400).json({ success: false, message });

const isNil = (v) => v === undefined || v === null || v === '';

// Return the first non-null error message (or null).
const firstError = (...errors) => errors.find(Boolean) || null;

// The acting user comes from requireAuth (server-side), never from the request body.
const actorOf = (req) => String(req.user._id);

// Only log ids that match the shape the validators allow.
const safeId = (value) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(value) ? value : null;

const LOG_PRODUCT_LIMIT = 50; // cap so one huge stock receipt can't create a giant log line

const invalid = (req, res, operation, message) => {
    logger.warn(
        { event: 'STOCK_VALIDATION_FAILED', operation, detail: message, actorUserId: actorOf(req) },
        'Stock request failed validation'
    );
    return badRequest(res, message);
};

const rejected = (req, res, operation, reason, message, status, extra = {}) => {
    logger.warn(
        { event: 'STOCK_OPERATION_REJECTED', operation, reason, actorUserId: actorOf(req), ...extra },
        'Stock operation rejected'
    );
    return res.status(status).json({ success: false, message });
};

// Numeric fields. Accepts a number OR a numeric string (forms often send
// "10.50"), but never objects/arrays/booleans.
const numberValidator = (value, label, { min = 0, max = 1e9, integer = false } = {}) => {
    const isNumeric =
        typeof value === 'number' ||
        (typeof value === 'string' && value.trim() !== '');
    const num = isNumeric ? Number(value) : NaN;

    if (!Number.isFinite(num)) {
        return `${label} must be a valid number`;
    }
    if (integer && !Number.isInteger(num)) {
        return `${label} must be a whole number`;
    }
    if (num < min || num > max) {
        return `${label} must be between ${min} and ${max}`;
    }
    return null;
};

// Free-text fields (supplier name, invoice number, notes).
const textValidator = (value, label, { maxLength = 100, required = true } = {}) => {
    if (isNil(value)) {
        return required ? `${label} is required` : null;
    }
    if (typeof value !== 'string') {
        return `${label} must be a string`;
    }
    if (value.length > maxLength) {
        return `${label} must be at most ${maxLength} characters`;
    }
    return null;
};

const dateValidator = (value, label) => {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        return `${label} must be a valid date`;
    }
    return null;
};

// Validates the line items array shared by addStock and editStock.
const itemsValidator = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        return 'items must be a non-empty array';
    }
    if (items.length > 500) {
        return 'items contains too many entries';
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const prefix = `Item ${i + 1}`;

        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return `${prefix} is not valid`;
        }

        const err = firstError(
            productIdentifierValidator(item.productId),
            numberValidator(item.quantityReceived, 'Quantity received', { min: 1, integer: true }),
            numberValidator(item.unitCost, 'Unit cost'),
            numberValidator(item.sellingPrice, 'Selling price'),
        );
        if (err) return `${prefix}: ${err}`;
    }
    return null;
};

// Shared header-field checks for addStock / editStock.
const validateStockHeader = ({ stockId, supplierId, supplierName, totalPrice, receivedDate, invoiceNo, notes }) =>
    firstError(
        codeValidator(stockId, 'Stock ID'),
        codeValidator(supplierId, 'Supplier ID'),
        textValidator(supplierName, 'Supplier name'),
        numberValidator(totalPrice, 'Total price'),
        dateValidator(receivedDate, 'Received date'),
        textValidator(invoiceNo, 'Invoice number', { maxLength: 60, required: false }),
        textValidator(notes, 'Notes', { maxLength: 1000, required: false }),
    );

const buildProductFilter = (productId) => {
    if (mongoose.Types.ObjectId.isValid(productId)) {
        return { _id: productId };
    }
    return { productCode: productId };
};

const applyStockToProducts = async (items) =>
    Promise.all(
        items.map(async (item) => {
            const product = await productModel.findOneAndUpdate(
                buildProductFilter(item.productId),
                { $inc: { quantityInStock: item.quantityReceived } },
                { new: true }
            );
            return {
                identifier: String(item.productId),
                quantityChange: Number(item.quantityReceived),
                product,
            };
        })
    );

const applyStockAdjustments = async (previousItems, updatedItems) => {
    const previousTotals = sumQuantitiesByProduct(previousItems);
    const updatedTotals = sumQuantitiesByProduct(updatedItems);

    const productIds = new Set([
        ...previousTotals.keys(),
        ...updatedTotals.keys(),
    ]);

    const results = await Promise.all(
        Array.from(productIds).map(async (productId) => {
            const delta =
                (updatedTotals.get(productId) || 0) -
                (previousTotals.get(productId) || 0);

            if (delta === 0) return null;

            const product = await productModel.findOneAndUpdate(
                buildProductFilter(productId),
                { $inc: { quantityInStock: delta } },
                { new: true }
            );
            return { identifier: String(productId), quantityChange: delta, product };
        })
    );

    return results.filter(Boolean);
};

// Compact, safe description of what happened to each product (ids and numbers only).
const describeUpdates = (results) =>
    results.slice(0, LOG_PRODUCT_LIMIT).map((r) =>
        r.product
            ? {
                productId: String(r.product._id),
                productCode: r.product.productCode,
                quantityChange: r.quantityChange,
                resultingQuantity: r.product.quantityInStock,
            }
            : { identifier: r.identifier, quantityChange: r.quantityChange, resultingQuantity: null }
    );

// Logs problems found while applying quantities to products:
//  - stock lines that point at a product that does not exist (an inconsistency)
//  - products whose quantity just CROSSED down to/below their minimum (an actual state change)
const reportProductUpdates = (results, source, context) => {
    const missing = results.filter((r) => !r.product);
    if (missing.length > 0) {
        logger.warn(
            {
                event: 'STOCK_PRODUCT_NOT_FOUND',
                source,
                ...context,
                missingProducts: missing.slice(0, LOG_PRODUCT_LIMIT).map((m) => m.identifier),
            },
            'Stock lines reference products that do not exist'
        );
    }

    for (const r of results) {
        if (!r.product || r.quantityChange >= 0) continue; // only reductions can cross downward
        const resulting = r.product.quantityInStock;
        const previous = resulting - r.quantityChange;
        const minStock = r.product.minStock || 0;
        if (previous > minStock && resulting <= minStock) {
            logger.warn(
                {
                    event: 'LOW_STOCK_DETECTED',
                    source,
                    ...context,
                    productId: String(r.product._id),
                    productCode: r.product.productCode,
                    resultingQuantity: resulting,
                    minStock,
                    outOfStock: resulting === 0,
                },
                'Product stock fell to or below its minimum'
            );
        }
    }
};

const sumQuantitiesByProduct = (items = []) => {
    const totals = new Map();
    items.forEach((item) => {
        const key = String(item.productId);
        const qty = Number(item.quantityReceived) || 0;
        totals.set(key, (totals.get(key) || 0) + qty);
    });
    return totals;
};

const addStock = async (req, res) => {
    const actorUserId = actorOf(req);
    let stage = 'validation';

    try {
        const {
            stockId,
            supplierId,
            supplierName,
            items,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes
        } = req.body;

        const addedBy = req.user.username;

        const inputError = firstError(
            validateStockHeader({ stockId, supplierId, supplierName, totalPrice, receivedDate, invoiceNo, notes }),
            itemsValidator(items),
        );
        if (inputError) return invalid(req, res, 'add', inputError);

        // Check for existing stockId
        const existingStock = await stockModel.findOne({ stockId });
        if (existingStock) {
            return rejected(req, res, 'add', 'DUPLICATE_STOCK_ID', 'Stock ID already exists', 400, { stockId });
        }

        const newStock = new stockModel({
            stockId,
            supplierId,
            supplierName,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes,
            addedBy
        });

        await newStock.save();
        stage = 'stock_record_saved';

        // Save each line item into the stockItems collection
        const stockItemDocs = items.map((item) => ({
            stockId,
            productId: item.productId,
            quantityReceived: item.quantityReceived,
            quantityRemaining: item.quantityReceived,
            unitCost: item.unitCost,
            sellingPrice: item.sellingPrice,
        }));
        await stockItemModel.insertMany(stockItemDocs);
        stage = 'stock_items_saved';

        // Update each product's current stock level with the quantity received
        const productResults = await applyStockToProducts(items);
        stage = 'products_updated';

        // ONE event for the whole receipt (not one per internal step).
        logger.info(
            {
                event: 'STOCK_ADDED',
                actorUserId,
                stockId,
                supplierId,
                itemCount: items.length,
                totalQuantity: items.reduce((sum, item) => sum + Number(item.quantityReceived), 0),
                products: describeUpdates(productResults),
            },
            'Stock received'
        );
        reportProductUpdates(productResults, 'stock_add', { actorUserId, stockId });

        res.status(201).json({ success: true, message: 'Stock added successfully', stock: newStock });

    } catch (error) {
        logger.error(
            {
                event: 'STOCK_ADD_FAILED',
                actorUserId,
                stockId: safeId(req.body?.stockId),
                stage,
                // stock record / items written but product quantities not updated yet
                possiblyInconsistent: stage === 'stock_record_saved' || stage === 'stock_items_saved',
                err: error,
            },
            'Unexpected error adding stock'
        );
        res.status(500).json({ success: false, message: 'Server error while adding stock' });
    }
};

const editStock = async (req, res) => {
    const actorUserId = actorOf(req);
    let stage = 'validation';

    try {
        const {
            stockId,
            supplierId,
            supplierName,
            items,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes
        } = req.body;

        const inputError = firstError(
            validateStockHeader({ stockId, supplierId, supplierName, totalPrice, receivedDate, invoiceNo, notes }),
            itemsValidator(items),
        );
        if (inputError) return invalid(req, res, 'edit', inputError);

        const existingStock = await stockModel.findOne({ stockId });
        if (!existingStock) {
            return rejected(req, res, 'edit', 'STOCK_NOT_FOUND', 'Stock record not found', 404, { stockId });
        }

        const previousItems = await stockItemModel.find({ stockId });

        await stockModel.findOneAndUpdate({ stockId }, {
            supplierId,
            supplierName,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes
        });
        stage = 'header_updated';

        await stockItemModel.deleteMany({ stockId });
        stage = 'items_deleted';

        const stockItemDocs = items.map((item) => ({
            stockId,
            productId: item.productId,
            quantityReceived: item.quantityReceived,
            quantityRemaining: item.quantityReceived,
            unitCost: item.unitCost,
            sellingPrice: item.sellingPrice,
        }));
        await stockItemModel.insertMany(stockItemDocs);
        stage = 'items_inserted';

        const productResults = await applyStockAdjustments(previousItems, items);
        stage = 'products_adjusted';

        logger.info(
            {
                event: 'STOCK_EDITED',
                actorUserId,
                stockId,
                itemCount: items.length,
                productsAdjusted: productResults.length,
                products: describeUpdates(productResults),
            },
            'Stock record edited'
        );
        reportProductUpdates(productResults, 'stock_edit', { actorUserId, stockId });

        res.status(201).json({ success: true, message: 'Stock record edited successfully' });

    } catch (error) {
        logger.error(
            {
                event: 'STOCK_EDIT_FAILED',
                actorUserId,
                stockId: safeId(req.body?.stockId),
                stage,
                // anything after the first write and before the products were adjusted
                possiblyInconsistent: ['header_updated', 'items_deleted', 'items_inserted'].includes(stage),
                err: error,
            },
            'Unexpected error editing stock'
        );
        res.status(500).json({ success: false, message: 'Server error while editing stock' });
    }
};

const getStocks = async (req, res) => {
    try {
        const stocks = await stockModel.find({}).lean();

        const stockItems = await stockItemModel.find({
            stockId: { $in: stocks.map((stock) => stock.stockId) }
        }).lean();

        const productIds = [...new Set(stockItems.map((item) => item.productId))];
        const objectIdCandidates = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        const codeCandidates = productIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

        const products = await productModel.find({
            $or: [
                { _id: { $in: objectIdCandidates } },
                { productCode: { $in: codeCandidates } }
            ]
        }).lean();

        const productLookup = new Map();
        products.forEach((product) => {
            productLookup.set(String(product._id), product);
            if (product.productCode) productLookup.set(product.productCode, product);
        });

        const itemsByStockId = new Map();
        stockItems.forEach((item) => {
            const matchedProduct = productLookup.get(String(item.productId));
            const enrichedItem = {
                ...item,
                productName: matchedProduct ? matchedProduct.productName : "Unknown product",
                totalCost: item.unitCost * item.quantityReceived,
            };

            if (!itemsByStockId.has(item.stockId)) {
                itemsByStockId.set(item.stockId, []);
            }
            itemsByStockId.get(item.stockId).push(enrichedItem);
        });

        const stocksWithItems = stocks.map((stock) => ({
            ...stock,
            items: itemsByStockId.get(stock.stockId) || []
        }));

        res.status(200).json({ success: true, stocks: stocksWithItems });
    } catch (error) {
        logger.error({ event: 'STOCK_QUERY_ERROR', operation: 'getStocks', err: error }, 'Error fetching stock records');
        res.status(500).json({ success: false, message: 'Server error while fetching stock records' });
    }
};

const getStockByProduct = async (req, res) => {
    try {
        const { productId } = req.body;

        const productIdError = productIdentifierValidator(productId);
        if (productIdError) return badRequest(res, productIdError);

        const stockItems = await stockItemModel.find({ productId: productId }).lean();

        res.status(200).json({ success: true, items: stockItems });

    } catch (error) {
        logger.error({ event: 'STOCK_QUERY_ERROR', operation: 'getStockByProduct', err: error }, 'Error fetching stock by product');
        res.status(500).json({ success: false, message: 'Server error while fetching stock by product' });
    }
}

// const deleteStock = async (req, res) => {
//     try {
//         const { stockId } = req.body;

//         // Find the stock record first
//         const stock = await stockModel.findOne({ stockId });

//         if (!stock) {
//             return res.status(404).json({ success: false, message: 'Stock record not found' });
//         }

//         // Delete the stock record from DB
//         await stockModel.findOneAndDelete({ stockId });

//         res.status(200).json({ success: true, message: 'Stock record deleted successfully' });

//     } catch (error) {
//         console.error('Error deleting stock:', error);
//         res.status(500).json({ success: false, message: 'Server error while deleting stock record' });
//     }
// };

export { addStock, editStock, getStocks, getStockByProduct };