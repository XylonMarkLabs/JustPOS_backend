import mongoose from 'mongoose'

const categorySchema = new mongoose.Schema({
    categoryName: {type: String, required: true},
    description: {type: String},
    status: {type: Number, default: 1},
    productCount: {type: Number, default: 0},
    createdAt: {type: String, default: new Date().toLocaleDateString()},
},{minimize: false})

const categoryModel = mongoose.models.categories || mongoose.model("categories", categorySchema);

export default categoryModel;