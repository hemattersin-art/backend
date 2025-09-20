const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { 
  validateClientRegistration, 
  validateUserLogin 
} = require('../utils/validation');

// Public routes
router.post('/register/client', validateClientRegistration, authController.register); // Only clients can register
router.post('/login', validateUserLogin, authController.login);
router.post('/google-login', authController.googleLogin); // Google OAuth login
router.post('/forgot-password', authController.sendPasswordResetOTP); // Send password reset OTP
router.post('/reset-password', authController.resetPassword); // Reset password with OTP

// Protected routes
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/profile-picture', authenticateToken, authController.updateProfilePicture);
router.put('/change-password', authenticateToken, authController.changePassword);
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;
