import express from 'express';
import { getSalesReport, getInventoryReport } from '../controllers/reportController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const reportRouter = express.Router();

reportRouter.get('/sales', requireAuth, requireRole('Admin', 'Manager'), getSalesReport);
reportRouter.get('/inventory', requireAuth, requireRole('Admin', 'Manager'), getInventoryReport);

export default reportRouter;