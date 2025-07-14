import express from 'express';
import { addToCart, clearCart, getCart, removeFromCart, updateCartQuantity } from '../controllers/cartController.js';

const cartRouter = express.Router();

cartRouter.post('/add', addToCart);
cartRouter.post('/remove', removeFromCart);
cartRouter.get('/get/:username', getCart);
cartRouter.put('/clear/:username', clearCart);
cartRouter.put('/update-quantity', updateCartQuantity);

export default cartRouter;