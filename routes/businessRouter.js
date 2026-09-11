import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { businessLogin, getBusinessProfile, registerBusiness, updateBusinessPassword, updateBusinessProfile, updateBusinessStatus } from '../controllers/businessController.js';

const businessRouter = express.Router();

// Business authentication routes
businessRouter.post('/register', registerBusiness);
businessRouter.post('/login', businessLogin);

// Business management routes (protected)
businessRouter.get('/profile', protect, getBusinessProfile);
businessRouter.put('/profile', protect, updateBusinessProfile);
businessRouter.put('/password', protect, updateBusinessPassword);

// Business status routes (protected)
businessRouter.post('/status', protect, updateBusinessStatus);

export default businessRouter;
