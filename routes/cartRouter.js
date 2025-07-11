import express from 'express';
import { addToCart, clearCart, getCart, removeFromCart } from '../controllers/cartController.js';

const cartRouter = express.Router();

cartRouter.post('/add', addToCart);
cartRouter.post('/remove', removeFromCart);
cartRouter.get('/get/:username', getCart);
cartRouter.put('/clear/:username', clearCart);

export default cartRouter;