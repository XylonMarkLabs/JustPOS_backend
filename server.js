import express from 'express';
import cors from 'cors'
import { connectDB } from './config/db.js';
import 'dotenv/config'
import userRouter from './routes/userRouter.js';
import productRouter from './routes/productRouter.js';
import cartRouter from './routes/cartRouter.js';
import orderRouter from './routes/orderRouter.js';
import categoryRouter from './routes/categoryRouter.js';
import businessRouter from './routes/businessRouter.js';
import supplierRouter from './routes/supplierRouter.js';
import stockRouter from './routes/stockRouter.js';

// app config
const app = express();
const port = 4000

// middleware
app.use(express.json())
app.use(cors())

// db connection
connectDB();

// api endpoints
app.use("/api/user", userRouter);
app.use("/api/product", productRouter);
app.use("/api/cart", cartRouter);
app.use("/api/order", orderRouter);
app.use("/api/category", categoryRouter);
app.use("/api/business", businessRouter);
app.use("/api/supplier", supplierRouter);
app.use("/api/stock", stockRouter);

app.get("/", (req,res)=>{
    res.send("API Working")
})

app.listen(port, ()=>{
    console.log(`Server Started on http://localhost:${port}`)
})

