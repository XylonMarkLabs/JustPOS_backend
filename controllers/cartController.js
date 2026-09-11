import cartModel from "../models/cartModel.js";
import discountModel from "../models/discountModel.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js ";

const addToCart = async (req, res) => {
  try {
    const { username, product } = req.body;

    if (!username || !product) {
      return res.status(400).json({ success: false, message: 'username and product are required' });
    }

    // --- Re-derive everything from the database. Nothing about price or
    // discount is trusted from the client payload — it's only used to
    // identify *which* records to look up (productId/stockItemId/discountId)
    // and, at the end, to detect a stale cart on the cashier's screen.

    const productExists = await productModel.findOne({
      $or: [{ _id: product.productId }, { productCode: product.productCode }],
    });
    if (!productExists) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (productExists.status !== 1) {
      return res.status(400).json({ success: false, message: 'This product is not currently active' });
    }

    // The chosen batch: first entry in the stockItems array the cashier
    // endpoint returned for this price row (see note above re: FIFO
    // assumption). A row always has at least one stock item — reject if not.
    const chosenStockItemId = product.stockItems?.[0]?.stockItemId;
    if (!chosenStockItemId) {
      return res.status(400).json({ success: false, message: 'No stock batch specified for this product' });
    }

    const stockItem = await stockItemModel.findOne({ _id: chosenStockItemId });
    if (!stockItem) {
      return res.status(404).json({ success: false, message: 'Stock item not found' });
    }
    if (stockItem.quantityRemaining <= 0) {
      return res.status(400).json({ success: false, message: 'This batch is out of stock' });
    }

    // Server-side truth for the original (undiscounted) unit price — never
    // taken from the client.
    const originalPrice = Number(stockItem.sellingPrice);

    // Re-validate the discount, if the client says one applies. A discount
    // is only honoured if it's still active, in-date, tied to this exact
    // stock item, and has quantity left — not just because the client sent
    // a discountId.
    let discount = null;
    let unitPrice = originalPrice;
    let availableQty = stockItem.quantityRemaining;

    if (product.discountId) {
      const now = new Date();
      discount = await discountModel.findOne({
        discountId: product.discountId,
        stockItemId: String(stockItem._id),
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
        remainingQuantity: { $gt: 0 },
      });

      if (discount) {
        unitPrice = discount.discountType === 'percentage'
          ? originalPrice - (originalPrice * discount.discountValue) / 100
          : originalPrice - discount.discountValue;
        unitPrice = Math.max(unitPrice, 0);

        // Can't sell more of this batch at the discounted price than the
        // discount has left, even if the batch itself has more stock.
        availableQty = Math.min(availableQty, discount.remainingQuantity);
      }
      // If the discount no longer validates (expired, exhausted, edited
      // since the cashier's screen loaded), silently fall back to full
      // price rather than failing the add — the response below tells the
      // cashier the price changed.
    }

    if (availableQty <= 0) {
      return res.status(400).json({ success: false, message: 'This product is no longer available' });
    }

    const requestedIncrement = Number(product.quantity) > 0 ? Number(product.quantity) : 1;

    let cart = await cartModel.findOne({ username });

    const buildLineItem = (qty) => ({
      productId: productExists._id,
      stockItemId: stockItem._id,
      productCode: productExists.productCode,
      name: productExists.productName,
      quantity: qty,
      originalPrice,
      sellingPrice: unitPrice,
      discountId: discount ? discount.discountId : null,
      discountType: discount ? discount.discountType : null,
      discountValue: discount ? discount.discountValue : 0,
      subtotal: unitPrice * qty,
    });

    if (!cart) {
      cart = new cartModel({
        username,
        items: [buildLineItem(Math.min(requestedIncrement, availableQty))],
      });
    } else {
      // A cart line is identified by productId + stockItemId — the same
      // batch at the same (server-computed) price is one line; a
      // discounted line and a full-price line for the same product are
      // different batches (or the same batch only partially discounted),
      // so they never collapse into each other.
      const itemIndex = cart.items.findIndex(
        (item) => String(item.productId) === String(productExists._id) &&
                  String(item.stockItemId) === String(stockItem._id)
      );

      if (itemIndex > -1) {
        const newQuantity = cart.items[itemIndex].quantity + requestedIncrement;
        if (newQuantity > availableQty) {
          return res.status(400).json({
            success: false,
            message: `Only ${availableQty} unit(s) available at this price`,
          });
        }
        cart.items[itemIndex].quantity = newQuantity;
        cart.items[itemIndex].sellingPrice = unitPrice;
        cart.items[itemIndex].originalPrice = originalPrice;
        cart.items[itemIndex].discountId = discount ? discount.discountId : null;
        cart.items[itemIndex].discountType = discount ? discount.discountType : null;
        cart.items[itemIndex].discountValue = discount ? discount.discountValue : 0;
        cart.items[itemIndex].subtotal = unitPrice * newQuantity;
      } else {
        if (requestedIncrement > availableQty) {
          return res.status(400).json({
            success: false,
            message: `Only ${availableQty} unit(s) available at this price`,
          });
        }
        cart.items.push(buildLineItem(requestedIncrement));
      }
    }

    await cart.save();

    // Let the cashier UI know if what actually got added differs from what
    // was requested/displayed (price moved, discount expired between page
    // load and click, etc.) so it can refresh instead of silently trusting
    // its own stale state.
    const priceChanged = Number(product.sellingPrice) !== unitPrice;

    res.status(200).json({
      success: true,
      message: priceChanged
        ? 'Product added to cart — price has changed since this was loaded'
        : 'Product added to cart',
      priceChanged,
      cart,
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ success: false, message: 'Server error while adding to cart' });
  }
};

const removeFromCart = async (req, res) => {
  try {
    const { username, productCode, unitPrice } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    const price = Number(unitPrice);
    const newItems = cart.items.filter(
      item => !(item.productCode === productCode && item.unitPrice === price)
    );

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

    // Populate item.productId with the live product doc so we can pull
    // supplementary display data (currently just the image) — pricing
    // itself comes entirely from what's already stored on the cart item.
    const cart = await cartModel
      .findOne({ username })
      .populate('items.productId');

    if (!cart || cart.items.length === 0) {
      return res.status(200).json({ success: true, message: 'Cart is empty', items: [], totalPrice: 0 });
    }

    let totalPrice = 0;

    const detailedItems = cart.items.map((item) => {
      // item.productId is either the populated product document, or null
      // if that product has since been deleted — either way this is only
      // used for the image and an "available" flag, never for pricing.
      const product = item.productId;

      totalPrice += item.subtotal;

      return {
        product: {
          productId: product?._id || item.productId,
          stockItemId: item.stockItemId,
          productCode: item.productCode,
          name: item.name,
          image: product?.imageURL || null,
          quantity: item.quantity,
          originalPrice: item.originalPrice,
          unitPrice: item.unitPrice,
          discountId: item.discountId,
          discountType: item.discountType,
          discountValue: item.discountValue,
          available: Boolean(product),
        },
        subtotal: item.subtotal,
      };
    });

    res.status(200).json({
      success: true,
      items: detailedItems,
      totalPrice,
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
    const { username, productCode, unitPrice, quantity } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    const price = Number(unitPrice);
    const itemIndex = cart.items.findIndex(
      item => item.productCode === productCode && item.unitPrice === price
    );
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