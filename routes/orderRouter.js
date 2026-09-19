import express from 'express';
import { checkoutCart, getAllOrders } from '../controllers/orderController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const orderRouter = express.Router();

orderRouter.post('/checkout', requireAuth, checkoutCart);
orderRouter.get('/getAll', requireAuth, requireRole('Admin', 'Manager'), getAllOrders);

export default orderRouter;