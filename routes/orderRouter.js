import express from 'express';
import { checkoutCartCash, getAllOrders } from '../controllers/orderController.js';

const orderRouter = express.Router();

orderRouter.post('/checkoutCash', checkoutCartCash);
orderRouter.get('/getAll', getAllOrders);

export default orderRouter;