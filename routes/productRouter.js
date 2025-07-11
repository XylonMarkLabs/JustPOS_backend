import express from 'express';
import { addProduct, editProduct, getProducts, updateProductStatus, updateStockLevel } from '../controllers/productController.js';

const productRouter = express.Router();

productRouter.post('/add', addProduct);
productRouter.post('/edit', editProduct);
productRouter.post('/update-status', updateProductStatus);
productRouter.get('/get-all', getProducts);
productRouter.post('/update-stock', updateStockLevel);

export default productRouter;