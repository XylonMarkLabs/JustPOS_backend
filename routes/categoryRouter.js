import express from 'express';
import { addCategory, deleteCategory, getCategories, updateCategoryStatus } from '../controllers/categoryController.js';

const categoryRouter = express.Router();

categoryRouter.post('/add', addCategory);
categoryRouter.get('/getAll', getCategories);
categoryRouter.post('/update-status', updateCategoryStatus);
categoryRouter.post('/delete', deleteCategory);

export default categoryRouter;