import express from 'express';
import { addDiscount, editDiscount, updateStatus, getAllDiscounts, getDiscountById, deleteDiscount } from '../controllers/discountController.js';

const discountRouter = express.Router();

discountRouter.post('/add', addDiscount);
discountRouter.put('/edit', editDiscount);
discountRouter.post('/update-status', updateStatus);
discountRouter.get('/get-all', getAllDiscounts);
discountRouter.post('/get', getDiscountById);
discountRouter.post('/delete', deleteDiscount);

export default discountRouter;