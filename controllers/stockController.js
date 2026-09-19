import mongoose from "mongoose";
import stockModel from "../models/stockModal.js";
import stockItemModel from "../models/stockItemModal.js";
import productModel from "../models/productModel.js";

const buildProductFilter = (productId) => {
    if (mongoose.Types.ObjectId.isValid(productId)) {
        return { _id: productId };
    }
    return { productCode: productId };
};

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

const sumQuantitiesByProduct = (items = []) => {
    const totals = new Map();
    items.forEach((item) => {
        const key = String(item.productId);
        const qty = Number(item.quantityReceived) || 0;
        totals.set(key, (totals.get(key) || 0) + qty);
    });
    return totals;
};

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

        const previousItems = await stockItemModel.find({ stockId });

        await stockModel.findOneAndUpdate({ stockId }, {
            supplierId,
            supplierName,
            totalPrice,
            receivedDate,
            invoiceNo,
            notes
        });

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
        console.error('Error fetching stock records:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching stock records' });
    }
};

const getStockByProduct = async (req, res) => {
    try {
        const { productId } = req.body;
        
        const stockItems = await stockItemModel.find({ productId: productId }).lean();

        res.status(200).json({ success: true, items: stockItems });

    } catch (error) {
        console.error('Error fetching stock by product:', error);
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