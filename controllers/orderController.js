import mongoose from "mongoose";
import cartModel from "../models/cartModel.js";
import discountModel from "../models/discountModel.js";
import orderModel from "../models/orderModel.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";

const checkoutCart = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const username = req.user.username;
    const { paymentMethod, cashReceived } = req.body;

    if (!['cash', 'card'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'A valid paymentMethod is required' });
    }

    const cart = await cartModel.findOne({ username });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    let newOrder;

    await session.withTransaction(async () => {
      const orderItems = [];
      let totalAmount = 0;
      let totalDiscount = 0;

      for (const cartItem of cart.items) {
        let unitCost;
        let discountValue = 0;

        if (cartItem.productType === 'NON_INVENTORY') {
          const product = await productModel.findOne({ _id: cartItem.productId }).session(session);

          if (!product || product.status !== 1) {
            throw new Error(`"${cartItem.name}" is no longer available — please remove it from the cart`);
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
              throw new Error(
                `The discount on "${cartItem.name}" is no longer available — please refresh the cart`
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
            throw new Error(`Not enough stock left for "${cartItem.name}" — please review the cart`);
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
              throw new Error(
                `The discount on "${cartItem.name}" is no longer available — please refresh the cart`
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
          throw new Error('Cash received must cover the total amount');
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

    res.status(200).json({ success: true, message: 'Order placed successfully', order: newOrder });
  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(400).json({ success: false, message: error.message || 'Server error during checkout' });
  } finally {
    session.endSession();
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