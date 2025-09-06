import cartModel from "../models/cartModel.js";
import orderModel from "../models/orderModel.js";
import productModel from "../models/productModel.js";

const checkoutCart = async (req, res) => {
  try {
    const { username, totalAmount, discount, paymentMethod, cashReceived, changeGiven } = req.body;

    // Fetch cart items for the user
    const cartItems = await cartModel.find({ username });

    if (cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const items = cartItems.flatMap(cart =>
      cart.items.map(item => ({
        name: item.name,
        productCode: item.productCode,
        quantity: item.quantity,
        price: item.unitPrice,
        subtotal: item.quantity * item.unitPrice
      }))
    );

    // Create a new order
    const newOrder = new orderModel({
      username,
      items,
      totalAmount,
      discount,
      paymentMethod,
      cashReceived: paymentMethod === 'cash' ? cashReceived : null,
      changeGiven: paymentMethod === 'cash' ? changeGiven : null
    });

    await newOrder.save();

    // Update stock for each item in the order
    for (const item of items) {
      const product = await productModel.findOne({ productCode: item.productCode });
      if (product) {
        product.quantityInStock -= item.quantity;
        await product.save();
      } else {
        console.warn(`Product with code ${item.productCode} not found`);
      }
    }

    // Clear the user's cart
    await cartModel.deleteMany({ username });

    res.status(200).json({ success: true, message: 'Order placed successfully', order: newOrder });

  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({ success: false, message: 'Server error during checkout' });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const orders = await orderModel.find().sort({ createdAt: -1 });

    res.status(200).json({ success: true, orders: orders });
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching orders' });
  }
};


export { checkoutCart, getAllOrders };