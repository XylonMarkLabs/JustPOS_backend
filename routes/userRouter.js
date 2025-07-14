import express from 'express';
import { changePassword, deleteUser, editUser, fetchUsers, getUserById, loginUser, registerUser, updateUserStatus } from '../controllers/userController.js';

const userRouter = express.Router();

userRouter.post('/login', loginUser);
userRouter.post('/register', registerUser);
userRouter.post('/update-status', updateUserStatus);
userRouter.post('/edit', editUser);
userRouter.post('/delete', deleteUser);
userRouter.post('/change-password', changePassword);
userRouter.get('/get', fetchUsers);
userRouter.post('/getUserById', getUserById);

export default userRouter;