import express from 'express';
import { addStock, editStock, getStockByProduct, getStocks } from '../controllers/stockController.js';

const stockRouter = express.Router();

stockRouter.post('/add', addStock);
stockRouter.put('/edit', editStock);
stockRouter.get('/get-all', getStocks);
stockRouter.post('/get-by-product', getStockByProduct);

export default stockRouter;