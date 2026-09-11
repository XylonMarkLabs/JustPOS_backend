import mongoose from 'mongoose'

const supplierSchema = new mongoose.Schema({
    supplierId: {type: String, required: true},
    supplierName: {type: String, required: true, unique: true},
    contactPerson: {type: String, required: true},
    contactNo: {type: String, required: true},
    email: {type: String, required: true, unique: true},
    status: {type: Number, default: 1},
    createdAt: {type: String, default: new Date().toLocaleDateString()},
},{minimize: false})

const supplierModel = mongoose.models.suppliers || mongoose.model("suppliers", supplierSchema);

export default supplierModel;