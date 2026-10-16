import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import userModel from '../models/userModel.js';
import { usernameValidator } from '../middleware/inputValidator.js';
import { isRateLimited, logFailedAttempt, resetFailedAttempts } from '../middleware/authMiddleware.js';
import { logger, maskText, shouldLogOnce } from '../utils/logger.js';

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
};

const createToken = (id, username) => {
    return jwt.sign({ id: id, username: username }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

// login user
const loginUser = async (req, res) => {
    const { username, password } = req.body;

    try {
        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            logger.warn({ event: 'LOGIN_FAILED', reason: 'INVALID_INPUT' }, 'Login rejected: invalid input');
            return res.json({
                success: false,
                message: usernameValidationError
            });
        }
        
        // Check rate limit before attempting authentication
        if (isRateLimited(username, req.ip)) {
            // Once per 5 minutes per username+ip, so an attack doesn't flood the logs.
            if (shouldLogOnce(`login-rate-limit:${username}:${req.ip}`, 5 * 60 * 1000)) {
                logger.warn(
                    { event: 'LOGIN_RATE_LIMITED', usernameHint: maskText(username), ip: req.ip },
                    'Too many login attempts'
                );
            }
            return res.status(429).json({
                success: false,
                message: "Too many login attempts. Please try again later."
            });
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            // Log failed attempt
            logFailedAttempt(username, req.ip);

            // The response is identical for unknown users and wrong passwords; only the
            // server-side log distinguishes them, so operators can spot account probing.
            logger.warn(
                { event: 'LOGIN_FAILED', reason: 'UNKNOWN_ACCOUNT', usernameHint: maskText(username), ip: req.ip },
                'Authentication failed'
            );

            return res.json({
                success: false,
                message: "Invalid username or password"
            });
        }

        if (!user.status) {
            logger.warn(
                { event: 'LOGIN_FAILED', reason: 'ACCOUNT_DEACTIVATED', userId: String(user._id), ip: req.ip },
                'Deactivated account tried to log in'
            );
            return res.json({
                success: false,
                message: "User is deactivated"
            });
        }

        const isMatch = await bycrypt.compare(password, user.password);

        if (!isMatch) {
            // Log failed attempt
            logFailedAttempt(username, req.ip);

            logger.warn(
                { event: 'LOGIN_FAILED', reason: 'INVALID_PASSWORD', userId: String(user._id), ip: req.ip },
                'Authentication failed'
            );

            return res.json({
                success: false,
                message: "Invalid username or password"
            });
        }

        // Successful login → clear failed attempts
        resetFailedAttempts(username, req.ip);

        const token = createToken(user._id, user.username);

        const date = new Date();
        const localTime = date.toLocaleString();

        user.lastLogin = localTime;
        await user.save();

        res.cookie("token", token, COOKIE_OPTIONS);

        logger.info(
            { event: 'LOGIN_SUCCESS', userId: String(user._id), role: user.role },
            'User logged in'
        );

        res.json({
            success: true,
            user: {
                username: user.username,
                role: user.role
            }
        });

    } catch (error) {
        logger.error({ event: 'LOGIN_ERROR', err: error }, 'Unexpected error during login');
        res.json({
            success: false,
            message: "Error"
        });
    }
};

const logoutUser = async (req, res) => {
    // This route has no auth middleware, so work out who is logging out from the cookie.
    // The token is verified (not just decoded), so the id is trustworthy.
    let userId = null;
    try {
        const decoded = jwt.verify(req.cookies?.token, process.env.JWT_SECRET);
        userId = String(decoded.id);
    } catch {
        // no cookie, expired or invalid: treat as an anonymous logout
    }

    res.clearCookie('token', COOKIE_OPTIONS);

    if (userId) {
        logger.info({ event: 'LOGOUT', userId }, 'User logged out');
    } else {
        logger.debug({ event: 'LOGOUT', userId: null }, 'Logout without a valid session');
    }

    res.json({ success: true, message: "Logged out" });
}

const getMe = async (req, res) => {
    res.json({ success: true, user: req.user });
}

export { loginUser, logoutUser, getMe };