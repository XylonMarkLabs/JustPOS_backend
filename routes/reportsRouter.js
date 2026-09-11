import express from 'express';
import { getSalesReport, getInventoryReport } from '../controllers/reportController.js';

const reportRouter = express.Router();

reportRouter.get('/sales', getSalesReport);
reportRouter.get('/inventory', getInventoryReport);

export default reportRouter;