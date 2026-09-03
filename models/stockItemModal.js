import mongoose from 'mongoose'

const stockItemSchema = new mongoose.Schema({
    stockId: { type: String, required: true },
    productId: { type: String, required: true },
    quantityReceived: { type: Number, required: true },
    quantityRemaining: { type: Number, required: true },
    unitCost: { type: Number, required: true },
    sellingPrice: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
}, { minimize: false })

const stockItemModel = mongoose.models.stockItems || mongoose.model("stockItems", stockItemSchema);

export default stockItemModel;