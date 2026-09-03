import mongoose from "mongoose";
import stockModel from "../models/stockModal.js";
import stockItemModel from "../models/stockItemModal.js";
import productModel from "../models/productModel.js";

// items[].productId may be a Mongo _id (if the product list API exposes
// it) or a productCode (the identifier the rest of the product routes
// use). Match on whichever one it actually looks like.
const buildProductFilter = (productId) => {
    if (mongoose.Types.ObjectId.isValid(productId)) {
        return { _id: productId };
    }
    return { productCode: productId };
};

// Increments quantityInStock for every line item in a stock receipt.
// Uses $inc so concurrent stock additions can't clobber each other.
const applyStockToProducts = async (items) => {
    await Promise.all(
        items.map((item) =>
            productModel.findOneAndUpdate(
                buildProductFilter(item.productId),
                { $inc: { quantityInStock: item.quantityReceived } }
            )
        )
    );
};

// Aggregates quantityReceived per productId, in case a receipt has more
// than one line for the same product.
const sumQuantitiesByProduct = (items = []) => {
    const totals = new Map();
    items.forEach((item) => {
        const key = String(item.productId);
        const qty = Number(item.quantityReceived) || 0;
        totals.set(key, (totals.get(key) || 0) + qty);
    });
    return totals;
};

// Compares a stock receipt's items before and after an edit, and applies
// only the difference to each affected product's quantityInStock. This
// correctly handles quantity changes, rows being added/removed, and a
// row's product being swapped for a different one.
const applyStockAdjustments = async (previousItems, updatedItems) => {
    const previousTotals = sumQuantitiesByProduct(previousItems);
    const updatedTotals = sumQuantitiesByProduct(updatedItems);

    const productIds = new Set([
        ...previousTotals.keys(),
        ...updatedTotals.keys(),
    ]);

    await Promise.all(
        Array.from(productIds).map((productId) => {
            const delta =
                (updatedTotals.get(productId) || 0) -
                (previousTotals.get(productId) || 0);

            if (delta === 0) return Promise.resolve();

            return productModel.findOneAndUpdate(
                buildProductFilter(productId),
                { $inc: { quantityInStock: delta } }
            );
        })
    );
};

const addStock = async (req, res) => {
    try {
        const {
            stockId,
            supplierId,
            supplierName,
            items,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes,
            addedBy
        } = req.body;

        // Check for existing stockId
        const existingStock = await stockModel.findOne({ stockId });
        if (existingStock) {
            return res.status(400).json({ success: false, message: 'Stock ID already exists' });
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

        // Update each product's current stock level with the quantity received
        await applyStockToProducts(items);

        res.status(201).json({ success: true, message: 'Stock added successfully', stock: newStock });

    } catch (error) {
        console.error('Error adding stock:', error);
        res.status(500).json({ success: false, message: 'Server error while adding stock' });
    }
};

const editStock = async (req, res) => {
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

        const existingStock = await stockModel.findOne({ stockId });
        if (!existingStock) {
            return res.status(404).json({ success: false, message: 'Stock record not found' });
        }

        // Read the record's current line items before replacing them, so
        // we can work out what changed.
        const previousItems = await stockItemModel.find({ stockId });

        await stockModel.findOneAndUpdate({ stockId }, {
            supplierId,
            supplierName,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes
        });

        // Replace the old line items with the updated set.
        // NOTE: this resets quantityRemaining to the new quantityReceived
        // for every item, which is only correct if none of this batch has
        // been sold yet. If quantityRemaining is used for FIFO/COGS
        // tracking once sales start drawing down a batch, editing a stock
        // receipt after that point needs different handling (e.g. only
        // adjusting quantityRemaining by the same delta applied to
        // quantityReceived, rather than a blanket reset) — flag if you
        // want that version instead.
        await stockItemModel.deleteMany({ stockId });
        const stockItemDocs = items.map((item) => ({
            stockId,
            productId: item.productId,
            quantityReceived: item.quantityReceived,
            quantityRemaining: item.quantityReceived,
            unitCost: item.unitCost,
            sellingPrice: item.sellingPrice,
        }));
        await stockItemModel.insertMany(stockItemDocs);

        // Apply only the difference in quantity received to each affected
        // product's stock level (handles quantity changes, added/removed
        // rows, and a row's product being swapped).
        await applyStockAdjustments(previousItems, items);

        res.status(201).json({ success: true, message: 'Stock record edited successfully' });

    } catch (error) {
        console.error('Error editing stock:', error);
        res.status(500).json({ success: false, message: 'Server error while editing stock' });
    }
};

const getStocks = async (req, res) => {
    try {
        const stocks = await stockModel.find({}).lean();

        // The frontend expects each stock record to carry its line items
        // (stock.items), but those now live in a separate collection —
        // attach them here.
        const stockItems = await stockItemModel.find({
            stockId: { $in: stocks.map((stock) => stock.stockId) }
        }).lean();

        // stockItems only stores productId, not productName — look the
        // products up so the frontend still has a name to display.
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

        console.log("Stocks With Items: ", stocksWithItems)

        res.status(200).json({ success: true, stocks: stocksWithItems });
    } catch (error) {
        console.error('Error fetching stock records:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching stock records' });
    }
};

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

export { addStock, editStock, getStocks };