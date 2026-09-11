import express from 'express';
import { addSupplier, editSupplier, getSuppliers, updateSupplierStatus } from '../controllers/supplierController.js';

const supplierRouter = express.Router();

supplierRouter.post('/add', addSupplier);
supplierRouter.put('/edit', editSupplier);
supplierRouter.get('/get-all', getSuppliers);
supplierRouter.post('/update-status', updateSupplierStatus);

export default supplierRouter;