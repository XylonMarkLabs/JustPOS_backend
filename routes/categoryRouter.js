import express from 'express';
import { addCategory, deleteCategory, editCategory, getCategories, updateCategoryStatus } from '../controllers/categoryController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const categoryRouter = express.Router();

// Mutations — Admin/Manager only
categoryRouter.post('/add', requireAuth, requireRole('Admin', 'Manager'), addCategory);
categoryRouter.post('/update-status', requireAuth, requireRole('Admin', 'Manager'), updateCategoryStatus);
categoryRouter.post('/delete', requireAuth, requireRole('Admin', 'Manager'), deleteCategory);
categoryRouter.put('/edit', requireAuth, requireRole('Admin', 'Manager'), editCategory);

categoryRouter.get('/getAll', requireAuth, getCategories);

export default categoryRouter;