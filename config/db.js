import mongoose from 'mongoose';
import { logger, shouldLogOnce } from '../utils/logger.js';

let listenersAttached = false;
let hasConnectedOnce = false;
let isDown = false;
let shuttingDown = false;

const connectionInfo = () => ({
    host: mongoose.connection.host,      // cluster host only, never the connection string
    database: mongoose.connection.name,
});

// "connected" and "reconnected" can both fire after an outage; the flags make sure
// we log exactly one DATABASE_CONNECTED (first time) or DATABASE_RECONNECTED (after an outage).
const markUp = () => {
    if (!hasConnectedOnce) {
        hasConnectedOnce = true;
        logger.info({ event: 'DATABASE_CONNECTED', ...connectionInfo() }, 'MongoDB connected');
        return;
    }
    if (isDown) {
        isDown = false;
        logger.info({ event: 'DATABASE_RECONNECTED', ...connectionInfo() }, 'MongoDB reconnected');
    }
};

const attachConnectionListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;

    const conn = mongoose.connection;

    conn.on('connected', markUp);
    conn.on('reconnected', markUp);

    conn.on('disconnected', () => {
        // Ignore the initial attempt and the intentional disconnect during shutdown.
        if (!hasConnectedOnce || shuttingDown || isDown) return;
        isDown = true;
        logger.warn({ event: 'DATABASE_DISCONNECTED', ...connectionInfo() }, 'MongoDB disconnected');
    });

    conn.on('error', (err) => {
        // Initial connection failures are handled by connectDB(); this is for errors
        // after the first successful connection. Throttled so an outage doesn't flood logs.
        if (!hasConnectedOnce) return;
        if (!shouldLogOnce('database-error', 30 * 1000)) return;
        logger.error({ event: 'DATABASE_ERROR', err }, 'MongoDB connection error');
    });
};

export const connectDB = async () => {
    attachConnectionListeners();

    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000, // fail startup within 10s instead of the 30s default
        });
    } catch (err) {
        logger.fatal({ event: 'DATABASE_CONNECTION_FAILED', err }, 'Could not connect to MongoDB');
        err.__logged = true; // so server.js doesn't log the same failure again
        throw err;           // fail fast: server.js decides to exit
    }
};

export const disconnectDB = async () => {
    shuttingDown = true;
    await mongoose.connection.close();
};