import express from 'express';
import { checkUserExists } from '../controllers/setupController.js';


const setupRouter = express.Router();

setupRouter.get('/status', checkUserExists);

export default setupRouter;