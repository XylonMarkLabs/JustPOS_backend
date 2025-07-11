import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  productCode: { type: String, required: true },
  name: { type: String },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  subtotal: { type: Number, required: true }
});

const orderSchema = new mongoose.Schema({
  username: { type: String, required: true },
  items: [orderItemSchema],
  totalAmount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const orderModel = mongoose.models.orders || mongoose.model("orders", orderSchema);

export default orderModel;
