import mongoose from 'mongoose'

// const stockItemSchema = new mongoose.Schema({
//     productId: { type: String, required: true },
//     productName: { type: String, required: true },
//     currentStock: { type: Number, default: 0 },
//     quantityReceived: { type: Number, required: true },
//     unitCost: { type: Number, required: true },
//     totalCost: { type: Number, required: true },
// })

const stockSchema = new mongoose.Schema({
    stockId: { type: String, required: true, unique: true },
    supplierId: { type: String, required: true },
    supplierName: { type: String, required: true },
    totalPrice: { type: Number, required: true },
    receivedDate: { type: Date, required: true },
    invoiceNo: { type: String },
    notes: { type: String },
    addedBy: { type: String },
    createdAt: { type: Date, default: Date.now },
}, { minimize: false })

const stockModel = mongoose.models.stocks || mongoose.model("stocks", stockSchema);

export default stockModel;