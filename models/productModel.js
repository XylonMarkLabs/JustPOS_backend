import mongoose from 'mongoose'

const productSchema = new mongoose.Schema({
    productName: { type: String, required: true },
    productCode: { type: String, unique: true, required: true },
    category: { type: String, required: true },
    brand: { type: String },
    description: { type: String },

    costPrice: { type: Number },
    sellingPrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },

    quantityInStock: { type: Number, default: 0 },
    minStockLevel: { type: Number, default: 0 },

    imageURL: { type: String },
    status: { type: Number, default: 1 },
}, { timestamps: true });

const productModel = mongoose.models.products || mongoose.model("products", productSchema);

export default productModel;
