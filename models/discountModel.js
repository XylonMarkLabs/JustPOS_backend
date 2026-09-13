import mongoose from 'mongoose'

const discountSchema = new mongoose.Schema({
    discountId: { type: String, required: true, unique: true },
    productId: { type: String, required: true },
    stockItemId: { type: String, default: null },
    discountType: { type: String, required: true },
    discountValue: { type: Number, required: true },
    quantity: { type: Number, required: true },
    remainingQuantity: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, { minimize: false })

const discountModel = mongoose.models.discounts || mongoose.model("discounts", discountSchema);

export default discountModel;