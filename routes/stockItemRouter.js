import express from 'express';

const stockItemRouter = express.Router();

stockItemRouter.post('/get-stock-by-product', getStockByProduct);

export default stockItemRouter;