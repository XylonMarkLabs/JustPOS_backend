import express from 'express';
import { addToCart, clearCart, getCart, removeFromCart, updateCartQuantity } from '../controllers/cartController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const cartRouter = express.Router();

cartRouter.post('/add', requireAuth, addToCart);
cartRouter.post('/remove', requireAuth, removeFromCart);
cartRouter.get('/get/:username', requireAuth, getCart);
cartRouter.put('/clear/:username', requireAuth, clearCart);
cartRouter.put('/update-quantity', requireAuth, updateCartQuantity);

export default cartRouter;