import mongoose from 'mongoose';
import mongooseSequence from 'mongoose-sequence';

const AutoIncrement = mongooseSequence(mongoose);

const orderItemSchema = new mongoose.Schema({
  productCode: { type: String, required: true },
  name: { type: String },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  subtotal: { type: Number, required: true }
});

const orderSchema = new mongoose.Schema({
  orderId: { type: Number, unique: true },
  username: { type: String, required: true },
  items: [orderItemSchema],
  payment: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});

// auto-increment plugin to orderId
orderSchema.plugin(AutoIncrement, { inc_field: 'orderId' });

const orderModel = mongoose.models.orders || mongoose.model("orders", orderSchema);

export default orderModel;
