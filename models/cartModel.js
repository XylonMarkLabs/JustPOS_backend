import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
  productCode: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    default: 1
  },
  unitPrice: {
    type: Number,
    required: true
  },
  name: { type: String, required: true }
});

const cartSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  items: [cartItemSchema]
}, { timestamps: true });

const cartModel = mongoose.models.cart || mongoose.model("cart", cartSchema);

export default cartModel;

