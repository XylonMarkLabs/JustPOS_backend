import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { logger } from './utils/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import { requestLogger, bindRequestContext } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import userRouter from './routes/userRouter.js';
import productRouter from './routes/productRouter.js';
import cartRouter from './routes/cartRouter.js';
import orderRouter from './routes/orderRouter.js';
import categoryRouter from './routes/categoryRouter.js';
import businessRouter from './routes/businessRouter.js';
import supplierRouter from './routes/supplierRouter.js';
import stockRouter from './routes/stockRouter.js';
import discountRouter from './routes/discountRouter.js';
import { startDiscountStatusJob } from './controllers/discountController.js';
import reportRouter from './routes/reportsRouter.js';
import dashboardRouter from './routes/dashboardRouter.js';
import setupRouter from './routes/setupRouter.js';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 4000;

// ---- process-level safety nets: log, then exit (same as Node's default crash) ----
process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.fatal({ event: 'UNHANDLED_REJECTION', err }, 'Unhandled promise rejection');
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    logger.fatal({ event: 'UNCAUGHT_EXCEPTION', err }, 'Uncaught exception');
    process.exit(1);
});

// ---- configuration check (names only, never values) ----
const validateEnv = () => {
    const required = ['MONGO_URI', 'JWT_SECRET'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        logger.fatal({ event: 'CONFIG_ERROR', missing }, 'Missing required environment variables');
        process.exit(1);
    }

    if (isProduction) {
        const recommended = ['FRONTEND_URL', 'CLOUD_NAME', 'CLOUD_API_KEY', 'CLOUD_API_SECRET'];
        const missingRecommended = recommended.filter((key) => !process.env[key]);
        if (missingRecommended.length > 0) {
            logger.warn({ event: 'CONFIG_WARNING', missing: missingRecommended }, 'Recommended environment variables are not set');
        }
    }
};

// ---- app config ----
const app = express();

// middleware
app.use(requestLogger);
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
}));
app.use(express.json());
app.use(cookieParser());
app.use(bindRequestContext);

// api endpoints
app.use("/api/user", userRouter);
app.use("/api/product", productRouter);
app.use("/api/cart", cartRouter);
app.use("/api/order", orderRouter);
app.use("/api/category", categoryRouter);
app.use("/api/business", businessRouter);
app.use("/api/supplier", supplierRouter);
app.use("/api/stock", stockRouter);
app.use("/api/discount", discountRouter);
app.use("/api/report", reportRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/setup", setupRouter);

app.get("/", (req, res) => {
    res.send("API Working");
});

// must be last
app.use(errorHandler);

// ---- startup / shutdown ----
let server;
let shuttingDown = false;

const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'SERVER_SHUTDOWN_STARTED', signal }, 'Shutting down');

    const forceTimer = setTimeout(() => {
        logger.error({ event: 'SERVER_SHUTDOWN_FORCED' }, 'Graceful shutdown timed out, forcing exit');
        process.exit(1);
    }, 10000);
    forceTimer.unref();

    try {
        if (server) await new Promise((resolve) => server.close(resolve)); // lets in-flight requests finish
        await disconnectDB();
        logger.info({ event: 'SERVER_SHUTDOWN_COMPLETE' }, 'Shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error({ event: 'SERVER_SHUTDOWN_FAILED', err }, 'Error during shutdown');
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM')); // Render sends this on deploy/restart
process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C

const start = async () => {
    validateEnv();

    // Fail fast: the HTTP server only starts once MongoDB is reachable.
    await connectDB();

    // background jobs (need the DB)
    startDiscountStatusJob();

    await new Promise((resolve, reject) => {
        server = app.listen(port);
        server.once('listening', resolve);
        server.once('error', reject);
    });

    logger.info(
        {
            event: 'SERVER_STARTED',
            port,
            nodeEnv: process.env.NODE_ENV || 'development',
            logLevel: logger.level,
            nodeVersion: process.version,
        },
        `Server listening on port ${port}`
    );
};

start().catch((err) => {
    if (!err?.__logged) {
        logger.fatal({ event: 'SERVER_STARTUP_FAILED', err }, 'Server failed to start');
    }
    process.exit(1);
});