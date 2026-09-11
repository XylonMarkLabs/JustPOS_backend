import express from 'express';
import { getDashboardOverview } from '../controllers/dashboardController.js';

const dashboardRouter = express.Router();

dashboardRouter.get('/overview', getDashboardOverview);

export default dashboardRouter;