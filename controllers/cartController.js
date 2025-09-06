import cartModel from "../models/cartModel.js";
import productModel from "../models/productModel.js";


const addToCart = async (req, res) => {
  try {
    const { username, productCode } = req.body;

    // Check if product exists
    const product = await productModel.findOne({ productCode });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Check if cart exists for the user
    let cart = await cartModel.findOne({ username });

    if (!cart) {
      // Create new cart
      cart = new cartModel({
        username,
        items: [{ productCode, quantity: 1, unitPrice: product.sellingPrice }]
      });
    } else {
      // Check if product already in cart
      const itemIndex = cart.items.findIndex(item => item.productCode === productCode);

      if (itemIndex > -1) {
        // Increment quantity
        cart.items[itemIndex].quantity += 1;
      } else {
        // Add new product to cart
        cart.items.push({ productCode, quantity: 1, unitPrice: product.sellingPrice });
      }
    }

    await cart.save();
    res.status(200).json({ success: true, message: 'Product added to cart', cart });

  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ success: false, message: 'Server error while adding to cart' });
  }
};

const removeFromCart = async (req, res) => {
  try {
    const { username, productCode } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    const newItems = cart.items.filter(item => item.productCode !== productCode);

    cart.items = newItems;
    await cart.save();

    res.status(200).json({ success: true, message: 'Product removed from cart', cart });
  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ success: false, message: 'Server error while removing from cart' });
  }
};

const getCart = async (req, res) => {
  try {
    const { username } = req.params;

    const cart = await cartModel.findOne({ username });
    if (!cart || cart.items.length === 0) {
      return res.status(200).json({ success: true, message: 'Cart is empty', items: [], totalPrice: 0 });
    }

    let totalPrice = 0;

    const detailedItems = await Promise.all(
      cart.items.map(async item => {
        const products = await productModel.findOne({ productCode: item.productCode });
        const price = products?.sellingPrice || 0;
        const subtotal = price * item.quantity;

        totalPrice += subtotal;

        const product = {productCode: item.productCode,
          name: products?.productName || 'Unknown',
          quantity: item.quantity,
          image: products?.imageURL,
          discount: products?.discount,
          price,
        }

        return {
          product,
          subtotal
        };
      })
    );

    res.status(200).json({
      success: true,
      items: detailedItems,
      totalPrice
    });

  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching cart' });
  }
};

const clearCart = async (req, res) => {
  try {
    const { username } = req.params;

    const cart = await cartModel.findOne({ username });
    if (!cart || cart.items.length === 0) {
      return res.status(200).json({ success: true, message: 'Cart already empty' });
    }

    cart.items = [];
    await cart.save();

    res.status(200).json({ success: true, message: 'Cart cleared successfully' });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ success: false, message: 'Server error while clearing cart' });
  }
};

const updateCartQuantity = async (req, res) => {
  try {
    const { username, productCode, quantity } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });
    const itemIndex = cart.items.findIndex(item => item.productCode === productCode);
    if (itemIndex === -1) return res.status(404).json({ message: 'Product not found in cart' });
    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1); // Remove item if quantity is zero or less
    } else {
      cart.items[itemIndex].quantity = quantity; // Update quantity
    }
    await cart.save();
    res.status(200).json({ success: true, message: 'Cart updated successfully', cart });
  } catch (error) {
    console.error('Error updating cart quantity:', error);
    res.status(500).json({ success: false, message: 'Server error while updating cart quantity' });
  };
}

export { addToCart, removeFromCart, getCart, clearCart, updateCartQuantity };
