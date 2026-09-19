import express from 'express';
import { addProduct, deleteImageFromCloudinary, deleteProduct, editProduct, getProducts, getProductsCashier, updateProductStatus, updateStockLevel } from '../controllers/productController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const productRouter = express.Router();

// Mutations — Admin and Manager only, per your call
productRouter.post('/add', requireAuth, requireRole('Admin', 'Manager'), addProduct);
productRouter.put('/edit', requireAuth, requireRole('Admin', 'Manager'), editProduct);
productRouter.post('/update-status', requireAuth, requireRole('Admin', 'Manager'), updateProductStatus);
productRouter.post('/update-stock', requireAuth, requireRole('Admin', 'Manager'), updateStockLevel);
productRouter.post('/delete', requireAuth, requireRole('Admin', 'Manager'), deleteProduct);
productRouter.post('/deleteImage', requireAuth, requireRole('Admin', 'Manager'), deleteImageFromCloudinary);

// Reads — any authenticated staff
productRouter.get('/get-all', requireAuth, getProducts);
productRouter.get('/get-all-cashier', requireAuth, getProductsCashier);

export default productRouter;