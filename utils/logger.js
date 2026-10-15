import pino from 'pino';
import { createRequire } from 'node:module';
import { getContext } from './requestContext.js';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Pretty output only in development, and only if pino-pretty is actually installed
// (it is a devDependency, so it may be missing on Render).
const canPrettyPrint = () => {
    if (isProduction || process.env.LOG_PRETTY === 'false') return false;
    try {
        createRequire(import.meta.url).resolve('pino-pretty');
        return true;
    } catch {
        return false;
    }
};

// Make sure a Mongo connection string with credentials can never leak through an error.
const scrub = (value) =>
    typeof value === 'string'
        ? value.replace(/mongodb(\+srv)?:\/\/[^@\s/]+@/gi, 'mongodb$1://***@')
        : value;

const serializeError = (err) => {
    const out = pino.stdSerializers.err(err);
    out.message = scrub(out.message);
    out.stack = scrub(out.stack);
    return out;
};

const baseOptions = {
    level,
    messageKey: 'message',
    base: { service: 'justpos-backend', env: process.env.NODE_ENV || 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: serializeError },
    redact: {
        paths: [
            'password', 'newPassword', 'oldPassword', 'confirmPassword',
            'token', 'hashedPassword', 'secret',
            '*.password', '*.newPassword', '*.oldPassword', '*.confirmPassword',
            '*.token', '*.hashedPassword', '*.secret',
            'authorization', 'cookie',
            'req.headers.authorization', 'req.headers.cookie',
            'headers.authorization', 'headers.cookie',
        ],
        censor: '[REDACTED]',
    },
    // Adds requestId / userId / storeId to every log line written during a request.
    // Values that are not known yet are logged as null.
    mixin() {
        const ctx = getContext();
        if (!ctx) return {};
        return {
            requestId: ctx.requestId ?? null,
            userId: ctx.userId ?? null,
            storeId: ctx.storeId ?? null,
        };
    },
};

const buildLogger = () => {
    if (canPrettyPrint()) {
        return pino({
            ...baseOptions,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    messageKey: 'message',
                    ignore: 'service,env',
                },
            },
        });
    }

    // Production: JSON lines. Below "error" -> stdout, "error" and "fatal" -> stderr.
    // Render shows both streams in the service Logs tab.
    return pino(
        { ...baseOptions, formatters: { level: (label) => ({ level: label }) } },
        pino.multistream(
            [
                { level: 'trace', stream: process.stdout },
                { level: 'error', stream: process.stderr },
            ],
            { dedupe: true }
        )
    );
};

export const logger = buildLogger();
export default logger;

// "jane.doe@example.com" -> "ja***@example.com"
export const maskEmail = (email) => {
    if (typeof email !== 'string' || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
};

// "someusername" -> "so***"  (used when we shouldn't echo a full identifier)
export const maskText = (text) =>
    typeof text === 'string' && text.length > 0 ? `${text.slice(0, 2)}***` : null;

// Lets a repetitive warning (rate limit hits, low stock) log at most once per window per key.
const lastLogged = new Map();
export const shouldLogOnce = (key, windowMs = 5 * 60 * 1000) => {
    const now = Date.now();
    const last = lastLogged.get(key);
    if (last && now - last < windowMs) return false;
    lastLogged.set(key, now);
    return true;
};
setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, time] of lastLogged) if (time < cutoff) lastLogged.delete(key);
}, 10 * 60 * 1000).unref();