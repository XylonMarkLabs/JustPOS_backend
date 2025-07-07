import express from 'express';
import { deleteUser, editUser, loginUser, registerUser, updateUserStatus } from '../controllers/userController.js';

const userRouter = express.Router();

userRouter.post('/login', loginUser);
userRouter.post('/register', registerUser);
userRouter.post('/update-status', updateUserStatus);
userRouter.post('/edit', editUser);
userRouter.post('/delete', deleteUser);

export default userRouter;