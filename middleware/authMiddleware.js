import jwt from 'jsonwebtoken';
import Business from '../models/businessModel.js';

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
                return res.status(401).json({
                    success: false,
                    message: 'Not authorized, business not found'
                });
            }

            // Check if business is active
            if (req.business.status !== 'active') {
                return res.status(403).json({
                    success: false,
                    message: 'Business account is not active'
                });
            }

            next();
        } catch (error) {
            console.error('Auth middleware error:', error);
            res.status(401).json({
                success: false,
                message: 'Not authorized, token failed'
            });
        }
    }

    if (!token) {
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
            console.error('Optional auth middleware error:', error);
            req.business = null;
        }
    }

    next();
};

// Admin only middleware
const adminOnly = async (req, res, next) => {
    if (!req.business || req.business.type !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied: Admin privileges required'
        });
    }
    next();
};

// Rate limiting middleware
const rateLimiter = {
    attempts: new Map(),
    resetTime: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 5
};

const isRateLimited = async (identifier, ip) => {
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

const logFailedAttempt = async (identifier, ip) => {
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

export {
    protect,
    optionalAuth,
    adminOnly,
    isRateLimited,
    logFailedAttempt
};
