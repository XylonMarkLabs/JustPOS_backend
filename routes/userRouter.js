import express from 'express';
import { changePassword, deleteUser, editUser, fetchUsers, getUserById, registerUser, updateUserStatus } from '../controllers/userController.js';
import { loginUser, logoutUser, getMe } from '../controllers/authController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const userRouter = express.Router();

// Public — no session exists yet to check
userRouter.post('/login', loginUser);
// Public — clearing a cookie should always succeed, even if it's already
// stale/invalid; no reason to require a valid session just to log out.
userRouter.post('/logout', logoutUser);

// Any logged-in user
userRouter.get('/me', requireAuth, getMe);
userRouter.post('/change-password', requireAuth, changePassword);

// Admin-only — managing OTHER accounts, matching UserManagement.jsx
// already being an Admin-only route in App.jsx
userRouter.post('/register', requireAuth, requireRole('Admin'), registerUser);
userRouter.post('/update-status', requireAuth, requireRole('Admin'), updateUserStatus);
userRouter.put('/edit', requireAuth, requireRole('Admin'), editUser);
userRouter.post('/delete', requireAuth, requireRole('Admin'), deleteUser);
userRouter.get('/get', requireAuth, requireRole('Admin'), fetchUsers);
userRouter.post('/getUserById', requireAuth, requireRole('Admin'), getUserById);

export default userRouter;