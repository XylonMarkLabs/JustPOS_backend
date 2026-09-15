import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import userModel from '../models/userModel.js';

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 1 day — matches createToken's expiresIn
    path: '/',
};

const createToken = (id, username) => {
    return jwt.sign({ id: id, username: username }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

// login user
const loginUser = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await userModel.findOne({ username });

        // Check existence BEFORE touching any field on `user` — the
        // previous order (`!user.status` first) crashed with a
        // TypeError whenever the username didn't exist at all, since
        // `user` was null at that point.
        if (!user) {
            return res.json({ success: false, message: "Invalid username or password" });
        }

        if (!user.status) {
            return res.json({ success: false, message: "User is deactivated" });
        }

        const isMatch = await bycrypt.compare(password, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: "Invalid username or password" })
        }

        const token = createToken(user._id, user.username);
        const date = new Date();
        const localTime = date.toLocaleString();
        user.lastLogin = localTime;
        await user.save();

        // Token goes in an httpOnly cookie instead of the response body —
        // JS on the frontend can no longer read it (that's the point; it
        // closes the XSS-can-steal-the-token risk of storing it in
        // localStorage). Only non-sensitive display info is returned.
        res.cookie('token', token, COOKIE_OPTIONS);
        res.json({ success: true, user: { username: user.username, role: user.role } });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Error" });
    }
}

// Clears the auth cookie. Options must match what was used to SET it
// (path/sameSite/secure) or the browser won't recognize it as the same
// cookie to remove.
const logoutUser = async (req, res) => {
    res.clearCookie('token', COOKIE_OPTIONS);
    res.json({ success: true, message: "Logged out" });
}

// Identifies the caller from their own verified cookie (requireAuth
// already attached req.user, password excluded) rather than the client
// telling the server who it is — this is what replaces the frontend's old
// "decode the JWT to get my id, then ask for that user" flow, which no
// longer works once the token is httpOnly.
const getMe = async (req, res) => {
    res.json({ success: true, user: req.user });
}

export { loginUser, logoutUser, getMe };