import express from 'express';
import { checkoutCart, getAllOrders } from '../controllers/orderController.js';

const orderRouter = express.Router();

orderRouter.post('/checkout', checkoutCart);
orderRouter.get('/getAll', getAllOrders);

export default orderRouter;