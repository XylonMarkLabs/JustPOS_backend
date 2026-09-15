import express from 'express';
import { addDiscount, editDiscount, updateStatus, getAllDiscounts, getDiscountById, deleteDiscount } from '../controllers/discountController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const discountRouter = express.Router();

discountRouter.post('/add', requireAuth, requireRole('Admin', 'Manager'), addDiscount);
discountRouter.put('/edit', requireAuth, requireRole('Admin', 'Manager'), editDiscount);
discountRouter.post('/update-status', requireAuth, requireRole('Admin', 'Manager'), updateStatus);
discountRouter.get('/get-all', requireAuth, requireRole('Admin', 'Manager'), getAllDiscounts);
discountRouter.post('/get', requireAuth, requireRole('Admin', 'Manager'), getDiscountById);
discountRouter.post('/delete', requireAuth, requireRole('Admin', 'Manager'), deleteDiscount);

export default discountRouter;