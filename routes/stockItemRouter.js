import express from 'express';
import { getStockByProduct } from '../controllers/stockController';

const stockItemRouter = express.Router();

stockItemRouter.post('/get-stock-by-product', getStockByProduct);

export default stockItemRouter;