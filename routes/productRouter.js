import express from 'express';
import { addProduct, deleteImageFromCloudinary, deleteProduct, editProduct, getProducts, getProductscashier, updateProductStatus, updateStockLevel } from '../controllers/productController.js';

const productRouter = express.Router();

productRouter.post('/add', addProduct);
productRouter.put('/edit', editProduct);
productRouter.post('/update-status', updateProductStatus);
productRouter.get('/get-all', getProducts);
productRouter.post('/update-stock', updateStockLevel);
productRouter.post('/delete', deleteProduct);
productRouter.post('/deleteImage', deleteImageFromCloudinary);
productRouter.get('/get-all-cashier', getProductscashier);

export default productRouter;