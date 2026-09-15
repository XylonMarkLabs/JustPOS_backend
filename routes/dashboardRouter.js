import express from 'express';
import { getDashboardOverview } from '../controllers/dashboardController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const dashboardRouter = express.Router();

dashboardRouter.get('/overview', requireAuth, requireRole('Admin', 'Manager'), getDashboardOverview);

export default dashboardRouter;