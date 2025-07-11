import cartModel from "../models/cartModel.js";
import orderModel from "../models/orderModel.js";
import productModel from "../models/productModel.js";

const checkoutCartCash = async (req, res) => {
  try {
    const { username } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    let totalAmount = 0;
    let billItems = [];

    for (let item of cart.items) {
      const product = await productModel.findOne({ productCode: item.productCode });
      const price = product?.sellingPrice || 0;
      const subtotal = price * item.quantity;

      billItems.push({
        productCode: item.productCode,
        name: product?.productName || 'Unknown',
        quantity: item.quantity,
        price,
        subtotal
      });

      totalAmount += subtotal;
    }

    // Save order
    const newOrder = new orderModel({
      username,
      items: billItems,
      totalAmount
    });
    await newOrder.save();

    // Clear the cart
    cart.items = [];
    await cart.save();

    res.status(200).json({
      message: 'Checkout successful. Order saved.',
      orderId: newOrder._id,
      bill: {
        items: billItems,
        total: totalAmount
      }
    });

  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({ message: 'Server error during checkout' });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const orders = await orderModel.find().sort({ createdAt: -1 });

    res.status(200).json({ orders });
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ message: 'Server error while fetching orders' });
  }
};


export { checkoutCartCash, getAllOrders };