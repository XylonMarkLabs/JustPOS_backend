import express from 'express';
import { changePassword, deleteUser, editUser, fetchUsers, getUserById, registerUser, updateUserStatus } from '../controllers/userController.js';
import { loginUser, logoutUser, getMe } from '../controllers/authController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const userRouter = express.Router();

userRouter.post('/login', loginUser);
userRouter.post('/logout', logoutUser);

userRouter.get('/me', requireAuth, getMe);
userRouter.post('/change-password', requireAuth, changePassword);

userRouter.post('/register', requireAuth, requireRole('Admin'), registerUser);
userRouter.post('/update-status', requireAuth, requireRole('Admin'), updateUserStatus);
userRouter.put('/edit', requireAuth, requireRole('Admin'), editUser);
userRouter.post('/delete', requireAuth, requireRole('Admin'), deleteUser);
userRouter.get('/get', requireAuth, requireRole('Admin'), fetchUsers);
userRouter.post('/getUserById', requireAuth, requireRole('Admin'), getUserById);

export default userRouter;