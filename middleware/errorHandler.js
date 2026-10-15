import { logger } from '../utils/logger.js';
import { getSafeRoute } from './requestLogger.js';

const clientMessages = {
    400: 'Invalid request',
    413: 'Request body too large',
    415: 'Unsupported content type',
};

export const errorHandler = (err, req, res, next) => {
    // If a response is already streaming, let Express close the connection.
    if (res.headersSent) return next(err);

    const status = Number(err?.status ?? err?.statusCode);
    const isClientError = status >= 400 && status < 500;

    const ctx = req.logContext || {};
    const fields = {
        requestId: req.id ?? ctx.requestId ?? null,
        method: req.method,
        route: getSafeRoute(req),
        userId: ctx.userId ?? null,
        storeId: ctx.storeId ?? null,
    };

    // Log each error object only once, even if several layers see it.
    const alreadyLogged = err?.__logged === true;
    if (!alreadyLogged && err && typeof err === 'object') {
        try { err.__logged = true; } catch { /* frozen error: ignore */ }
    }

    if (isClientError) {
        // e.g. malformed JSON body, payload too large
        if (!alreadyLogged) {
            logger.warn(
                { event: 'REQUEST_REJECTED', ...fields, statusCode: status, reason: err.type || err.code || 'BAD_REQUEST' },
                'Request rejected'
            );
        }
        return res.status(status).json({
            success: false,
            message: clientMessages[status] || clientMessages[400],
        });
    }

    if (!alreadyLogged) {
        logger.error(
            { event: 'UNHANDLED_SERVER_ERROR', ...fields, err },
            'Unhandled server error'
        );
    }

    // Never expose stack traces or internal details to the client.
    return res.status(500).json({ success: false, message: 'Internal server error' });
};