import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import businessModel from '../models/businessModel.js';

// Rate limiting configuration
const rateLimiter = {
    attempts: new Map(),
    resetTime: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 5
};

// Check if the request is rate limited
const isRateLimited = (identifier, ip) => {
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

// Log failed login attempts
const logFailedAttempt = (identifier, ip) => {
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

// Business registration endpoint
const registerBusiness = async (req, res) => {
  try {
    const { 
      businessName, 
      password, 
      businessEmail, 
      businessPhone, 
      businessAddress, 
    } = req.body;

    // Check if business already exists
    const existingBusiness = await businessModel.findOne({ businessEmail });

    if (existingBusiness) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Create new business
    const business = new businessModel({
      name: businessName,
      hashedPassword: password,
      email: businessEmail,
      phone: businessPhone,
      address: businessAddress,
    });

    await business.save();

    // Create JWT token
    const businessToken = jwt.sign(
      { businessId: business.id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return success with business data
    return res.status(201).json({
      success: true,
      business: {
        id: business.id,
        businessId: business.businessId,
        name: business.name,
        email: business.email,
        phone: business.phone,
        type: business.type,
        status: business.status
      },
      businessToken
    });

  } catch (error) {
    console.error('Business registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Business verification endpoint
const businessLogin = async (req, res) => {
  const { businessEmail, password } = req.body;
  
  // Rate limiting check
  if (isRateLimited(businessEmail, req.ip)) {
    return res.status(429).json({ 
      success: false, 
      message: 'Too many attempts. Please try again later.' 
    });
  }

  try {
    // Get business from database
    const business = await businessModel.findOne({ email: businessEmail });
    if (!business) {
      console.log("No business found")
      await logFailedAttempt(businessEmail, req.ip);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid business credentials' 
      });
    }

    // Verify password
    const isValid = await bycrypt.compare(password, business.hashedPassword);
    if (!isValid) {
      await logFailedAttempt(businessEmail, req.ip);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid business credentials' 
      });
    }

    // Create business session token
    const businessToken = jwt.sign(
      { businessId: business.businessId },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return success with business data
    return res.json({
      success: true,
      business: {
        id: business.businessId,
        name: business.name,
        // other non-sensitive business data
      },
      businessToken
    });

  } catch (error) {
    console.error('Business verification error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// Get business profile
const getBusinessProfile = async (req, res) => {
  try {
    const business = await businessModel.findById(req.business.id).select('-hashedPassword');
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }
    return res.json({
      success: true,
      business
    });
  } catch (error) {
    console.error('Get business profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update business profile
const updateBusinessProfile = async (req, res) => {
  try {
    const { name, email, phone, address, type } = req.body;
    const business = await Business.findById(req.business.id);
    
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    business.name = name || business.name;
    business.email = email || business.email;
    business.phone = phone || business.phone;
    business.address = address || business.address;
    business.type = type || business.type;
    business.updatedAt = Date.now();

    const updatedBusiness = await business.save();
    return res.json({
      success: true,
      business: updatedBusiness
    });
  } catch (error) {
    console.error('Update business profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update business password
const updateBusinessPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const business = await businessModel.findById(req.business.id);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Verify current password
    const isMatch = await business.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    business.hashedPassword = newPassword;
    business.updatedAt = Date.now();
    await business.save();

    return res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Update business password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update business status
const updateBusinessStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const business = await businessModel.findById(req.business.id);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    business.status = status;
    business.updatedAt = Date.now();
    await business.save();

    return res.json({
      success: true,
      message: 'Business status updated successfully',
      status: business.status
    });
  } catch (error) {
    console.error('Update business status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export {
  registerBusiness,
  businessLogin,
  getBusinessProfile,
  updateBusinessProfile,
  updateBusinessPassword,
  updateBusinessStatus,
  isRateLimited,
  logFailedAttempt
};