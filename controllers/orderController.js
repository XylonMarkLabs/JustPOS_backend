import mongoose from "mongoose";
import cartModel from "../models/cartModel.js";
import discountModel from "../models/discountModel.js";
import orderModel from "../models/orderModel.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";
import { usernameValidator } from "../middleware/inputValidator.js";
import { logger } from "../utils/logger.js";

const checkoutError = (reason, message, extra = {}) =>
  Object.assign(new Error(message), { isCheckoutError: true, reason, ...extra });

// Reasons that mean "the stock was not there" (reported as a stock validation failure).
const STOCK_VALIDATION_REASONS = new Set(['INSUFFICIENT_STOCK', 'INSUFFICIENT_PRODUCT_QUANTITY']);

const logInvalidRequest = (req, reason) =>
  logger.warn(
    { event: 'ORDER_REQUEST_INVALID', reason, actorUserId: String(req.user._id) },
    'Invalid checkout request'
  );

const checkoutCart = async (req, res) => {
  const session = await mongoose.startSession();

  let stage = 'validation';   // validation -> transaction -> committed
  let newOrder;
  const lowStockHits = [];    // collected inside the transaction, reported only after it commits

  try {
    const username = req.user.username;
    const { paymentMethod, cashReceived } = req.body;

    if (!['cash', 'card'].includes(paymentMethod)) {
      logInvalidRequest(req, 'INVALID_PAYMENT_METHOD');
      return res.status(400).json({ success: false, message: 'A valid paymentMethod is required' });
    }

    const usernameValidationError = usernameValidator(username);

    if (usernameValidationError) {
      logInvalidRequest(req, 'INVALID_USERNAME');
      return res.json({ success: false, message: usernameValidationError });
    }

    const cart = await cartModel.findOne({ username });
    if (!cart || cart.items.length === 0) {
      logInvalidRequest(req, 'EMPTY_CART');
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    stage = 'transaction';

    await session.withTransaction(async () => {
      // withTransaction can run this callback again after a transient error,
      // so start from a clean slate each time.
      lowStockHits.length = 0;

      const orderItems = [];
      let totalAmount = 0;
      let totalDiscount = 0;

      for (const cartItem of cart.items) {
        let unitCost;
        let discountValue = 0;

        if (cartItem.productType === 'NON_INVENTORY') {
          const product = await productModel.findOne({ _id: cartItem.productId }).session(session);

          if (!product || product.status !== 1) {
            throw checkoutError(
              'PRODUCT_UNAVAILABLE',
              `"${cartItem.name}" is no longer available — please remove it from the cart`,
              { productId: String(cartItem.productId) }
            );
          }

          unitCost = product.costPrice || 0;

          if (cartItem.discountId) {
            const now = new Date();
            const discountUpdate = await discountModel.findOneAndUpdate(
              {
                discountId: cartItem.discountId,
                productId: String(cartItem.productId),
                stockItemId: null,
                status: 'active',
                startDate: { $lte: now },
                endDate: { $gte: now },
                remainingQuantity: { $gte: cartItem.quantity },
              },
              { $inc: { remainingQuantity: -cartItem.quantity } },
              { session, new: true }
            );

            if (!discountUpdate) {
              throw checkoutError(
                'DISCOUNT_UNAVAILABLE',
                `The discount on "${cartItem.name}" is no longer available — please refresh the cart`,
                { productId: String(cartItem.productId) }
              );
            }

            discountValue = cartItem.originalPrice - cartItem.unitPrice;
          }
        } else {
          const stockUpdate = await stockItemModel.findOneAndUpdate(
            { _id: cartItem.stockItemId, quantityRemaining: { $gte: cartItem.quantity } },
            { $inc: { quantityRemaining: -cartItem.quantity } },
            { session, new: true }
          );

          if (!stockUpdate) {
            throw checkoutError(
              'INSUFFICIENT_STOCK',
              `Not enough stock left for "${cartItem.name}" — please review the cart`,
              { productId: String(cartItem.productId) }
            );
          }

          const productUpdate = await productModel.findOneAndUpdate(
            { _id: cartItem.productId, quantityInStock: { $gte: cartItem.quantity }, },
            { $inc: { quantityInStock: -cartItem.quantity, }, },
            { session, new: true, }
          );

          if (!productUpdate) {
            // The batch HAD enough stock but the product-level counter did not:
            // the two counters disagree (see `suspectedDrift` in the log).
            throw checkoutError(
              'INSUFFICIENT_PRODUCT_QUANTITY',
              `Not enough product quantity available for "${cartItem.name}"`,
              { productId: String(cartItem.productId) }
            );
          }

          // Did this sale push the product down to / below its minimum?
          const resulting = productUpdate.quantityInStock;
          const minStock = productUpdate.minStock || 0;
          if (resulting + cartItem.quantity > minStock && resulting <= minStock) {
            lowStockHits.push({
              productId: String(productUpdate._id),
              productCode: productUpdate.productCode,
              resultingQuantity: resulting,
              minStock,
            });
          }

          unitCost = stockUpdate.unitCost;

          if (cartItem.discountId) {
            const now = new Date();
            const discountUpdate = await discountModel.findOneAndUpdate(
              {
                discountId: cartItem.discountId,
                stockItemId: String(cartItem.stockItemId),
                status: 'active',
                startDate: { $lte: now },
                endDate: { $gte: now },
                remainingQuantity: { $gte: cartItem.quantity },
              },
              { $inc: { remainingQuantity: -cartItem.quantity } },
              { session, new: true }
            );

            if (!discountUpdate) {
              throw checkoutError(
                'DISCOUNT_UNAVAILABLE',
                `The discount on "${cartItem.name}" is no longer available — please refresh the cart`,
                { productId: String(cartItem.productId) }
              );
            }

            discountValue = cartItem.originalPrice - cartItem.unitPrice;
          }
        }

        const lineSubtotal = cartItem.unitPrice * cartItem.quantity;
        totalAmount += lineSubtotal;
        totalDiscount += discountValue * cartItem.quantity;

        orderItems.push({
          productId: cartItem.productId,
          stockItemId: cartItem.stockItemId,
          productType: cartItem.productType,
          productCode: cartItem.productCode,
          name: cartItem.name,
          quantity: cartItem.quantity,
          originalPrice: cartItem.originalPrice,
          unitPrice: cartItem.unitPrice,
          unitCost,
          discountId: cartItem.discountId,
          discountType: cartItem.discountType,
          discountValue: cartItem.discountValue,
          subtotal: lineSubtotal,
        });
      }

      let cashReceivedFinal = null;
      let changeGivenFinal = null;
      if (paymentMethod === 'cash') {
        const received = Number(cashReceived);
        if (isNaN(received) || received < totalAmount) {
          throw checkoutError('CASH_INSUFFICIENT', 'Cash received must cover the total amount');
        }
        cashReceivedFinal = received;
        changeGivenFinal = received - totalAmount;
      }

      const [order] = await orderModel.create(
        [{
          username,
          items: orderItems,
          totalAmount,
          discount: totalDiscount,
          paymentMethod,
          cashReceived: cashReceivedFinal,
          changeGiven: changeGivenFinal,
        }],
        { session }
      );

      newOrder = order;

      await cartModel.deleteOne({ username }, { session });
    });

    stage = 'committed';

    // Only counts and ids: never item names, cart contents or payment amounts received.
    logger.info(
      {
        event: 'ORDER_CREATED',
        actorUserId: String(req.user._id),
        orderId: newOrder.orderId,
        orderObjectId: String(newOrder._id),
        itemCount: newOrder.items.length,
        paymentMethod,
        totalAmount: newOrder.totalAmount,
        discount: newOrder.discount,
      },
      'Order created'
    );

    // Reported only after the commit, so a rolled-back order never raises an alert.
    for (const hit of lowStockHits) {
      logger.warn(
        { event: 'LOW_STOCK_DETECTED', source: 'order', orderId: newOrder.orderId, outOfStock: hit.resultingQuantity === 0, ...hit },
        'Product stock fell to or below its minimum'
      );
    }

    res.status(200).json({ success: true, message: 'Order placed successfully', order: newOrder });
  } catch (error) {
    const actorUserId = req.user ? String(req.user._id) : null;
    // Anything thrown while stage === 'transaction' aborts the transaction, so nothing was saved.
    const rolledBack = stage === 'transaction';

    if (error?.isCheckoutError) {
      // Expected business failure (out of stock, discount expired, not enough cash...).
      const isStockProblem = STOCK_VALIDATION_REASONS.has(error.reason);
      logger.warn(
        {
          event: isStockProblem ? 'ORDER_STOCK_VALIDATION_FAILED' : 'ORDER_CREATION_FAILED',
          reason: error.reason,
          productId: error.productId ?? null,
          actorUserId,
          rolledBack,
          ...(error.reason === 'INSUFFICIENT_PRODUCT_QUANTITY' ? { suspectedDrift: true } : {}),
        },
        isStockProblem ? 'Order rejected: not enough stock' : 'Order could not be created'
      );
    } else {
      logger.error(
        {
          event: 'ORDER_CREATION_ERROR',
          actorUserId,
          stage,
          rolledBack,
          // true means the order WAS saved but something failed afterwards (e.g. sending the response)
          orderCommitted: stage === 'committed',
          orderId: newOrder?.orderId ?? null,
          err: error,
        },
        'Unexpected error during checkout'
      );
    }

    res.status(400).json({ success: false, message: 'Server error during checkout' });
  } finally {
    session.endSession();
  }
};

const getAllOrders = async (req, res) => {
  try {
    const orders = await orderModel.find().sort({ createdAt: -1 });

    res.status(200).json({ success: true, orders: orders });
  } catch (error) {
    logger.error({ event: 'ORDER_QUERY_ERROR', operation: 'getAllOrders', err: error }, 'Error fetching all orders');
    res.status(500).json({ success: false, message: 'Server error while fetching orders' });
  }
};


export { checkoutCart, getAllOrders };