import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({

  productId: {type: mongoose.Schema.Types.ObjectId, ref: 'products', required: true},
  stockItemId: {type: mongoose.Schema.Types.ObjectId, ref: 'stockItems', required: true},
  productCode: {type: String, required: true},
  name: {type: String, required: true},
  quantity: {type: Number, required: true, min: 1, default: 1},
  originalPrice: {type: Number, required: true},
  unitPrice: {type: Number, required: true},
  discountId: {type: String, default: null},
  discountType: {type: String, enum: ['percentage', 'fixed', null], default: null},
  discountValue: {type: Number, default: 0},
  subtotal: {type: Number, required: true}

});

const cartSchema = new mongoose.Schema({
  username: {type: String, required: true, unique: true},
  items: [cartItemSchema]

}, { timestamps: true });

const cartModel = mongoose.models.cart || mongoose.model('cart', cartSchema);

export default cartModel;