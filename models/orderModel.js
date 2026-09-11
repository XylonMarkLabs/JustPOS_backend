import mongoose from 'mongoose';
import mongooseSequence from 'mongoose-sequence';

const AutoIncrement = mongooseSequence(mongoose);

const orderItemSchema = new mongoose.Schema({

  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'products',
    required: true
  },

  stockItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'stockItems',
    required: true
  },

  productCode: {
    type: String,
    required: true
  },

  name: {
    type: String,
    required: true
  },

  quantity: {
    type: Number,
    required: true,
    min: 1
  },

  originalPrice: {
    type: Number,
    required: true
  },

  unitPrice: {
    type: Number,
    required: true
  },

  discountId: {
    type: String,
    default: null
  },

  discountType: {
    type: String,
    enum: ['percentage', 'fixed', null],
    default: null
  },

  discountValue: {
    type: Number,
    default: 0
  },

  unitCost: {
    type: Number,
    required: true
  },

  subtotal: {
    type: Number,
    required: true
  }

});

const orderSchema = new mongoose.Schema({

  orderId: {
    type: Number,
    unique: true
  },

  username: {
    type: String,
    required: true
  },

  items: [orderItemSchema],

  paymentMethod: {
    type: String,
    required: true
  },

  cashReceived: {
    type: Number
  },

  changeGiven: {
    type: Number
  },

  totalAmount: {
    type: Number,
    required: true
  },

  discount: {
    type: Number,
    default: 0
  },

  date: {
    type: Date,
    default: Date.now
  }

});

orderSchema.plugin(AutoIncrement, {
  inc_field: 'orderId'
});

const orderModel =
  mongoose.models.orders ||
  mongoose.model('orders', orderSchema);

export default orderModel;