import cartModel from "../models/cartModel.js";
import discountModel from "../models/discountModel.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";

// Shared by add/remove/update: a cart line is identified by productId +
// stockItemId. NON_INVENTORY lines always have a null stockItemId (no
// batch exists), so null-vs-null counts as a match — there's only ever one
// "no batch" line per product, since its price never varies by batch.
const sameStockItem = (a, b) => String(a || '') === String(b || '');

const addToCart = async (req, res) => {
  try {
    // Identity comes from the verified session (requireAuth), not the
    // client-supplied body. Previously `username` was read straight from
    // req.body — a logged-in user could add items to ANY other user's
    // cart just by naming them in the request.
    const username = req.user.username;
    const { product } = req.body;

    if (!product) {
      return res.status(400).json({ success: false, message: 'product is required' });
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

    // --- Derive price/discount/availability. Two paths depending on
    // productType, converging on the same shape before the shared
    // cart-line logic below.
    let stockItem = null;
    let originalPrice;
    let unitPrice;
    let discount = null;
    let availableQty;

    if (productExists.productType === 'NON_INVENTORY') {
      // Made to order — no stock batch, no stock check. Price comes from
      // the product record; a discount (if any) is scoped to the product
      // itself (stockItemId: null) rather than a batch.
      originalPrice = Number(productExists.sellingPrice);
      unitPrice = originalPrice;
      availableQty = Infinity;

      if (product.discountId) {
        const now = new Date();
        discount = await discountModel.findOne({
          discountId: product.discountId,
          productId: String(productExists._id),
          stockItemId: null,
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

          // Once the discount's allotment runs out, this line can't grow
          // past it — same behavior as an INVENTORY discount running out
          // mid-batch. The cashier would add from the separate full-price
          // row (see getProductsCashier) for anything beyond this.
          availableQty = discount.remainingQuantity;
        }
        // If the discount no longer validates, fall back to full price
        // rather than failing the add — same as the INVENTORY path.
      }
    } else {
      // INVENTORY — unchanged logic from before: resolve the chosen batch,
      // then re-validate any discount against it.
      const chosenStockItemId = product.stockItems?.[0]?.stockItemId;
      if (!chosenStockItemId) {
        return res.status(400).json({ success: false, message: 'No stock batch specified for this product' });
      }

      stockItem = await stockItemModel.findOne({ _id: chosenStockItemId });
      if (!stockItem) {
        return res.status(404).json({ success: false, message: 'Stock item not found' });
      }
      if (stockItem.quantityRemaining <= 0) {
        return res.status(400).json({ success: false, message: 'This batch is out of stock' });
      }

      originalPrice = Number(stockItem.sellingPrice);
      unitPrice = originalPrice;
      availableQty = stockItem.quantityRemaining;

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
    }

    if (availableQty <= 0) {
      return res.status(400).json({ success: false, message: 'This product is no longer available' });
    }

    const requestedIncrement = Number(product.quantity) > 0 ? Number(product.quantity) : 1;
    const chosenStockItemId = stockItem ? stockItem._id : null;

    let cart = await cartModel.findOne({ username });

    const buildLineItem = (qty) => ({
      productId: productExists._id,
      stockItemId: chosenStockItemId,
      productType: productExists.productType,
      productCode: productExists.productCode,
      name: productExists.productName,
      quantity: qty,
      originalPrice,
      unitPrice,
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
      // so they never collapse into each other. NON_INVENTORY lines match
      // on productId alone (stockItemId is null on both sides).
      const itemIndex = cart.items.findIndex(
        (item) => String(item.productId) === String(productExists._id) &&
                  sameStockItem(item.stockItemId, chosenStockItemId)
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
        cart.items[itemIndex].unitPrice = unitPrice;
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

// NOTE: matching changed from (productCode, unitPrice) to (productId,
// stockItemId) — the same identity rule addToCart uses to decide whether
// two adds collapse into one line. Matching on price was fragile (a
// discount changing between page load and this call would silently break
// removal/update), and doesn't work at all for NON_INVENTORY lines, which
// don't have a meaningfully distinct "price per batch" to key off of.
// The frontend needs to send productId (and stockItemId, or omit/null it
// for a NON_INVENTORY line) instead of productCode/unitPrice.
const removeFromCart = async (req, res) => {
  try {
    // Identity from session, not from the client — same fix as addToCart.
    const username = req.user.username;
    const { productId, stockItemId } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    cart.items = cart.items.filter(
      (item) => !(String(item.productId) === String(productId) && sameStockItem(item.stockItemId, stockItemId))
    );

    await cart.save();

    res.status(200).json({ success: true, message: 'Product removed from cart', cart });
  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ success: false, message: 'Server error while removing from cart' });
  }
};

const getCart = async (req, res) => {
  try {
    // Identity from session — req.params.username is intentionally
    // ignored now. The route still accepts /get/:username for now so the
    // frontend doesn't need an immediate change, but whatever's in that
    // param no longer has any effect; only the caller's own cart is ever
    // returned. Worth cleaning the route up to drop the param entirely
    // once the frontend call site is updated to match.
    const username = req.user.username;

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
          productType: item.productType,
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
    // Same as getCart — identity from session, :username param ignored.
    const username = req.user.username;

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
    // Identity from session, not from the client — same fix as addToCart.
    const username = req.user.username;
    const { productId, stockItemId, quantity } = req.body;

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    const itemIndex = cart.items.findIndex(
      (item) => String(item.productId) === String(productId) && sameStockItem(item.stockItemId, stockItemId)
    );
    if (itemIndex === -1) return res.status(404).json({ message: 'Product not found in cart' });

    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1); // Remove item if quantity is zero or less
    } else {
      // NOTE: this does not re-check availableQty (batch/discount
      // remaining) against the new quantity — worth adding the same
      // availability re-derivation addToCart does if you want this path to
      // reject "set quantity to 500" the same way incrementing does.
      cart.items[itemIndex].quantity = quantity;
      cart.items[itemIndex].subtotal = cart.items[itemIndex].unitPrice * quantity;
    }
    await cart.save();
    res.status(200).json({ success: true, message: 'Cart updated successfully', cart });
  } catch (error) {
    console.error('Error updating cart quantity:', error);
    res.status(500).json({ success: false, message: 'Server error while updating cart quantity' });
  };
}

export { addToCart, removeFromCart, getCart, clearCart, updateCartQuantity };