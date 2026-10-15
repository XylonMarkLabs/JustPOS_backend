import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';
import { runWithContext } from '../utils/requestContext.js';

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 1000;
const SKIP_SUCCESS_PATHS = new Set(['/', '/health', '/healthz']); // health checks
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

// Prefer the matched route pattern (e.g. "/api/cart/get/:username") so usernames/ids
// in the URL are not logged. Query strings are never logged.
export const getSafeRoute = (req) => {
    if (req.route?.path) return `${req.baseUrl || ''}${req.route.path}`;
    return (req.originalUrl || req.url || '').split('?')[0].slice(0, 200);
};

// 1) Mount FIRST: request id, timing, and the one-line summary log.
export const requestLogger = (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId = SAFE_REQUEST_ID.test(incoming || '') ? incoming : crypto.randomUUID();

    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);

    // Shared with the async context (see bindRequestContext) so userId/storeId set
    // later by the auth middleware show up in the summary line too.
    req.logContext = { requestId, userId: null, storeId: null };

    const start = process.hrtime.bigint();
    let logged = false;

    const summarize = (aborted) => {
        if (logged) return;
        logged = true;

        const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
        const status = res.statusCode;
        const route = getSafeRoute(req);

        // Skip noisy successful health checks and CORS preflights.
        if (!aborted && status < 400) {
            if (req.method === 'GET' && SKIP_SUCCESS_PATHS.has(route)) return;
        }

        let level = 'info';
        let outcome = 'success';
        if (aborted) { level = 'warn'; outcome = 'aborted'; }
        else if (status >= 500) { level = 'error'; outcome = 'server_error'; }
        else if (status >= 400) { level = 'warn'; outcome = 'client_error'; }
        else if (durationMs >= SLOW_REQUEST_MS) { level = 'warn'; }
        if (req.method === 'OPTIONS' && level === 'info') level = 'debug';

        logger[level](
            {
                event: aborted ? 'API_REQUEST_ABORTED' : 'API_REQUEST_COMPLETED',
                requestId,
                method: req.method,
                route,
                statusCode: status,
                durationMs,
                outcome,
                slow: durationMs >= SLOW_REQUEST_MS,
                userId: req.logContext.userId,
                storeId: req.logContext.storeId,
            },
            aborted ? 'Client closed the connection early' : 'Request completed'
        );
    };

    res.on('finish', () => summarize(false));
    res.on('close', () => { if (!res.writableFinished) summarize(true); });

    next();
};

// 2) Mount AFTER express.json() and cookieParser(): from here on, every logger call
//    in routes/controllers automatically includes requestId, userId and storeId.
export const bindRequestContext = (req, res, next) => runWithContext(req.logContext, next);