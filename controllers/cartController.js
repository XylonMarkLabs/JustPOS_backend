import {
  usernameValidator,
  codeValidator,
  mongoIdValidator,
} from "../middleware/inputValidator.js";
import cartModel from "../models/cartModel.js";
import discountModel from "../models/discountModel.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";

const sameStockItem = (a, b) => String(a || '') === String(b || '');

const isNil = (v) => v === undefined || v === null || v === '';

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

const optionalMongoId = (value, label) =>
  isNil(value) ? null : mongoIdValidator(value, label);

const quantityValidator = (value, { allowZero = false } = {}) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return 'Quantity must be a whole number';
  }
  if (allowZero ? value < 0 : value < 1) {
    return allowZero ? 'Quantity cannot be negative' : 'Quantity must be at least 1';
  }
  if (value > 100000) {
    return 'Quantity is too large';
  }
  return null;
};

const addToCart = async (req, res) => {
  try {
    const username = req.user.username;
    const { product } = req.body;

    const usernameValidationError = usernameValidator(username);

    if (usernameValidationError) {
      return badRequest(res, usernameValidationError);
    }

    if (!product || typeof product !== 'object' || Array.isArray(product)) {
      return badRequest(res, 'product is required');
    }

    const lookupConditions = [];

    if (!isNil(product.productId)) {
      const err = mongoIdValidator(product.productId, 'Product ID');
      if (err) return badRequest(res, err);
      lookupConditions.push({ _id: product.productId });
    }

    if (!isNil(product.productCode)) {
      const err = codeValidator(product.productCode, 'Product code');
      if (err) return badRequest(res, err);
      lookupConditions.push({ productCode: product.productCode });
    }

    if (lookupConditions.length === 0) {
      return badRequest(res, 'Product ID or product code is required');
    }

    // Optional discount code
    if (!isNil(product.discountId)) {
      const err = codeValidator(product.discountId, 'Discount ID');
      if (err) return badRequest(res, err);
    }

    // Optional quantity (defaults to 1 when omitted)
    if (!isNil(product.quantity)) {
      const err = quantityValidator(product.quantity);
      if (err) return badRequest(res, err);
    }

    // Stock batch (only relevant for inventory products, validated again below)
    if (!isNil(product.stockItems) && !Array.isArray(product.stockItems)) {
      return badRequest(res, 'stockItems must be an array');
    }
    const rawStockItemId = product.stockItems?.[0]?.stockItemId;
    if (!isNil(rawStockItemId)) {
      const err = mongoIdValidator(rawStockItemId, 'Stock item ID');
      if (err) return badRequest(res, err);
    }


    const productExists = await productModel.findOne({ $or: lookupConditions });
    if (!productExists) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (productExists.status !== 1) {
      return res.status(400).json({ success: false, message: 'This product is not currently active' });
    }

    let stockItem = null;
    let originalPrice;
    let unitPrice;
    let discount = null;
    let availableQty;

    if (productExists.productType === 'NON_INVENTORY') {
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
          availableQty = discount.remainingQuantity;
        }
      }
    } else {
      const chosenStockItemId = rawStockItemId;
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
          availableQty = Math.min(availableQty, discount.remainingQuantity);
        }
      }
    }

    if (availableQty <= 0) {
      return res.status(400).json({ success: false, message: 'This product is no longer available' });
    }

    // quantity was validated above: either omitted (-> 1) or a positive integer
    const requestedIncrement = isNil(product.quantity) ? 1 : product.quantity;
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
    // Identity from session, not from the client — same fix as addToCart.
    const username = req.user.username;
    const { productId, stockItemId } = req.body;

    const usernameValidationError = usernameValidator(username);

    if (usernameValidationError) {
      return badRequest(res, usernameValidationError);
    }

    const productIdError = mongoIdValidator(productId, 'Product ID');
    if (productIdError) return badRequest(res, productIdError);

    const stockItemIdError = optionalMongoId(stockItemId, 'Stock item ID');
    if (stockItemIdError) return badRequest(res, stockItemIdError);

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

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
    const username = req.user.username;

    const usernameValidationError = usernameValidator(username);

    if (usernameValidationError) {
      return badRequest(res, usernameValidationError);
    }

    const cart = await cartModel
      .findOne({ username })
      .populate('items.productId');

    if (!cart || cart.items.length === 0) {
      return res.status(200).json({ success: true, message: 'Cart is empty', items: [], totalPrice: 0 });
    }

    let totalPrice = 0;

    const detailedItems = cart.items.map((item) => {
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
    const username = req.user.username;

    const usernameValidationError = usernameValidator(username);

    if (usernameValidationError) {
      return badRequest(res, usernameValidationError);
    }

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
    const username = req.user.username;
    const { productId, stockItemId, quantity } = req.body;

    const usernameValidationError = usernameValidator(username);

    if (usernameValidationError) {
      return badRequest(res, usernameValidationError);
    }

    const productIdError = mongoIdValidator(productId, 'Product ID');
    if (productIdError) return badRequest(res, productIdError);

    const stockItemIdError = optionalMongoId(stockItemId, 'Stock item ID');
    if (stockItemIdError) return badRequest(res, stockItemIdError);

    // 0 is allowed here: it means "remove this line" (handled below)
    const quantityError = quantityValidator(quantity, { allowZero: true });
    if (quantityError) return badRequest(res, quantityError);

    const cart = await cartModel.findOne({ username });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    const itemIndex = cart.items.findIndex(
      (item) => String(item.productId) === String(productId) && sameStockItem(item.stockItemId, stockItemId)
    );
    if (itemIndex === -1) return res.status(404).json({ success: false, message: 'Product not found in cart' });

    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      cart.items[itemIndex].quantity = quantity;
      cart.items[itemIndex].subtotal = cart.items[itemIndex].unitPrice * quantity;
    }
    await cart.save();
    res.status(200).json({ success: true, message: 'Cart updated successfully', cart });
  } catch (error) {
    console.error('Error updating cart quantity:', error);
    res.status(500).json({ success: false, message: 'Server error while updating cart quantity' });
  }
};

export { addToCart, removeFromCart, getCart, clearCart, updateCartQuantity };