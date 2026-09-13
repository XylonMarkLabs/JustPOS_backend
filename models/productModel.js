import mongoose from 'mongoose'

const PRODUCT_TYPES = ['INVENTORY', 'NON_INVENTORY']

const productSchema = new mongoose.Schema({
    productName: { type: String, required: true },
    productCode: { type: String, unique: true, required: true },
    category: { type: String, required: true },

    productType: {
        type: String,
        enum: PRODUCT_TYPES,
        required: true,
        default: 'INVENTORY',
    },

    taxRate: { type: Number, default: 0 },

    quantityInStock: { type: Number, default: 0 },
    minStock: { type: Number, default: 0 },

    sellingPrice: {
        type: Number,
        required: function () { return this.productType === 'NON_INVENTORY' },
    },
    costPrice: { type: Number, default: 0 },

    imageURL: { type: String },
    imagePublicId: { type: String },

    status: { type: Number, default: 1 },
}, { timestamps: true });

productSchema.pre('validate', function (next) {
    if (this.productType === 'NON_INVENTORY') {
        this.quantityInStock = 0
        this.minStock = 0
    } else if (this.productType === 'INVENTORY') {
        this.sellingPrice = undefined
        this.costPrice = 0
    }
    next()
})

const productModel = mongoose.models.products || mongoose.model("products", productSchema);

export default productModel;