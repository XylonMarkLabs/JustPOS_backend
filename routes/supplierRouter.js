import express from 'express';
import { addSupplier, editSupplier, getSuppliers, updateSupplierStatus } from '../controllers/supplierController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const supplierRouter = express.Router();

supplierRouter.post('/add', requireAuth, requireRole('Admin', 'Manager'), addSupplier);
supplierRouter.put('/edit', requireAuth, requireRole('Admin', 'Manager'), editSupplier);
supplierRouter.get('/get-all', requireAuth, requireRole('Admin', 'Manager'), getSuppliers);
supplierRouter.post('/update-status', requireAuth, requireRole('Admin', 'Manager'), updateSupplierStatus);

export default supplierRouter;