import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import userModel from '../models/userModel.js';

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
        const user = await userModel.findOne({ username });

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

        res.cookie('token', token, COOKIE_OPTIONS);
        res.json({ success: true, user: { username: user.username, role: user.role } });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Error" });
    }
}

const logoutUser = async (req, res) => {
    res.clearCookie('token', COOKIE_OPTIONS);
    res.json({ success: true, message: "Logged out" });
}

const getMe = async (req, res) => {
    res.json({ success: true, user: req.user });
}

export { loginUser, logoutUser, getMe };