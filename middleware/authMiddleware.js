import jwt from 'jsonwebtoken';
import Business from '../models/businessModel.js';
import userModel from '../models/userModel.js';
import { logger } from '../utils/logger.js';
import { setContext } from '../utils/requestContext.js';

// Expected token problems (expired, tampered, malformed) are security warnings.
// Anything else (e.g. the database failing mid-check) is an unexpected system error.
const logAuthFailure = (error, extra = {}) => {
    if (error?.name === 'TokenExpiredError') {
        logger.warn({ event: 'SESSION_EXPIRED', reason: 'TOKEN_EXPIRED', ...extra }, 'Authentication token expired');
    } else if (error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
        logger.warn({ event: 'TOKEN_INVALID', reason: error.message, ...extra }, 'Authentication token rejected');
    } else {
        logger.error({ event: 'AUTH_SYSTEM_ERROR', err: error, ...extra }, 'Unexpected authentication error');
    }
};

// Protect routes middleware
const protect = async (req, res, next) => {
    let token;

    // Check if token exists in headers
    if (req.headers.authorization && 
        req.headers.authorization.startsWith('Bearer')) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Get business from token and exclude password
            req.business = await Business.findById(decoded.businessId).select('-hashedPassword');

            if (!req.business) {
                logger.warn({ event: 'UNAUTHORIZED_ACCESS', reason: 'BUSINESS_NOT_FOUND', scope: 'business' }, 'Token does not match a business');
                return res.status(401).json({
                    success: false,
                    message: 'Not authorized, business not found'
                });
            }

            // Check if business is active
            if (req.business.status !== 'active') {
                logger.warn(
                    { event: 'ACCESS_DENIED', reason: 'BUSINESS_INACTIVE', scope: 'business', businessId: String(req.business._id) },
                    'Inactive business tried to access the API'
                );
                return res.status(403).json({
                    success: false,
                    message: 'Business account is not active'
                });
            }

            next();
        } catch (error) {
            logAuthFailure(error, { scope: 'business' });
            res.status(401).json({
                success: false,
                message: 'Not authorized, token failed'
            });
        }
    }

    // `!res.headersSent` prevents a second response when the catch block above already answered
    // (e.g. an "Authorization: Bearer " header with an empty token).
    if (!token && !res.headersSent) {
        logger.debug({ event: 'UNAUTHORIZED_ACCESS', reason: 'NO_TOKEN', scope: 'business' }, 'No token supplied');
        res.status(401).json({
            success: false,
            message: 'Not authorized, no token'
        });
    }
};

// Optional auth middleware - allows requests to proceed even without valid auth
const optionalAuth = async (req, res, next) => {
    let token;

    if (req.headers.authorization && 
        req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.business = await Business.findById(decoded.businessId).select('-hashedPassword');
        } catch (error) {
            // Optional: a bad token is not an error here, so keep it quiet.
            logger.debug({ event: 'TOKEN_INVALID', reason: error?.message, scope: 'business-optional' }, 'Optional auth ignored a bad token');
            req.business = null;
        }
    }

    next();
};

// Admin only middleware
const adminOnly = async (req, res, next) => {
    if (!req.business || req.business.type !== 'admin') {
        logger.warn(
            { event: 'ACCESS_DENIED', reason: 'ADMIN_REQUIRED', scope: 'business', businessId: req.business ? String(req.business._id) : null },
            'Admin privileges required'
        );
        return res.status(403).json({
            success: false,
            message: 'Access denied: Admin privileges required'
        });
    }
    next();
};

const requireAuth = async (req, res, next) => {
    try {
        const token = req.cookies?.token;

        if (!token) {
            // Usually just a logged-out visitor (e.g. the frontend checking /me), so debug level.
            // The request summary line still records the 401.
            logger.debug({ event: 'UNAUTHORIZED_ACCESS', reason: 'NO_TOKEN' }, 'No session cookie');
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await userModel.findById(decoded.id).select('-password');

        if (!user) {
            // decoded.id comes from a token signed by this server, so it is safe to log.
            logger.warn({ event: 'UNAUTHORIZED_ACCESS', reason: 'USER_NOT_FOUND', userId: String(decoded.id) }, 'Valid token for a user that no longer exists');
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        if (!user.status) {
            logger.warn({ event: 'ACCESS_DENIED', reason: 'ACCOUNT_DEACTIVATED', userId: String(user._id) }, 'Deactivated account tried to access the API');
            return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact an administrator for assistance.' });
        }

        req.user = user;

        // From here on, every log line for this request carries the user id.
        // (When store resolution exists, add `storeId` to this call.)
        setContext({ userId: String(user._id) });

        next();
    } catch (error) {
        logAuthFailure(error);
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
    if (!req.user) {
        logger.warn({ event: 'UNAUTHORIZED_ACCESS', reason: 'NOT_AUTHENTICATED' }, 'requireRole ran without an authenticated user');
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
        logger.warn(
            { event: 'ACCESS_DENIED', reason: 'INSUFFICIENT_ROLE', userId: String(req.user._id), role: req.user.role, requiredRoles: allowedRoles },
            'User lacks the required role'
        );
        return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
    }
    next();
};

// Rate limiting middleware
const rateLimiter = {
    attempts: new Map(),
    resetTime: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 5
};

const isRateLimited = (identifier, ip) => {
    const key = `${identifier}:${ip}`;
    const now = Date.now();
    const attempt = rateLimiter.attempts.get(key);

    if (!attempt) {
        rateLimiter.attempts.set(key, {
            count: 1,
            timestamp: now
        });
        return false;
    }

    if (now - attempt.timestamp > rateLimiter.resetTime) {
        rateLimiter.attempts.set(key, {
            count: 1,
            timestamp: now
        });
        return false;
    }

    if (attempt.count >= rateLimiter.maxAttempts) {
        return true;
    }

    attempt.count++;
    return false;
};

const logFailedAttempt = (identifier, ip) => {
    const key = `${identifier}:${ip}`;
    const now = Date.now();
    const attempt = rateLimiter.attempts.get(key);

    if (!attempt) {
        rateLimiter.attempts.set(key, {
            count: 1,
            timestamp: now
        });
        return;
    }

    if (now - attempt.timestamp > rateLimiter.resetTime) {
        rateLimiter.attempts.set(key, {
            count: 1,
            timestamp: now
        });
        return;
    }

    attempt.count++;
};

const resetFailedAttempts = (identifier, ip) => {
    const key = `${identifier}:${ip}`;
    rateLimiter.attempts.delete(key);
};

export {
    protect,
    optionalAuth,
    adminOnly,
    isRateLimited,
    logFailedAttempt,
    requireAuth,
    requireRole,
    resetFailedAttempts
};