import express from 'express';
import { addStock, editStock, getStockByProduct, getStocks } from '../controllers/stockController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const stockRouter = express.Router();

stockRouter.post('/add', requireAuth, requireRole('Admin', 'Manager'), addStock);
stockRouter.put('/edit', requireAuth, requireRole('Admin', 'Manager'), editStock);
stockRouter.get('/get-all', requireAuth, requireRole('Admin', 'Manager'), getStocks);
stockRouter.post('/get-by-product', requireAuth, requireRole('Admin', 'Manager'), getStockByProduct);

export default stockRouter;