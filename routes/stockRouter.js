import express from 'express';
import { addStock, editStock, getStocks } from '../controllers/stockController.js';

const stockRouter = express.Router();

stockRouter.post('/add', addStock);
stockRouter.put('/edit', editStock);
stockRouter.get('/get-all', getStocks);

export default stockRouter;