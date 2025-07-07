import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
    firstname: {type: String, required: true},
    lastname: {type: String, required: true},
    username: {type: String, required: true, unique: true},
    email: {type: String, required: true, unique: true},
    role: {type: String, required: true},
    password: {type: String, required: true},
    status: {type: Number, default: 1},
    createdAt: {type: String, default: new Date().toLocaleDateString()},
    lastLogin: {type: String, default: "Not logged in"}
},{minimize: false})

const userModel = mongoose.models.users || mongoose.model("users", userSchema);

export default userModel;