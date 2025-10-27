const express = require('express');
const router = express.Router();
const emailVerificationService = require('../utils/emailVerificationService');
const { successResponse, errorResponse } = require('../utils/helpers');
const { body, validationResult } = require('express-validator');

/**
 * POST /api/email-verification/send-otp
 * Send OTP to email for verification
 */
router.post('/send-otp', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('verification_type').optional().isIn(['registration', 'password_reset', 'email_change']).withMessage('Invalid verification type'),
  body('user_role').optional().isIn(['client', 'psychologist', 'admin']).withMessage('Invalid user role')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        errorResponse('Validation failed', errors.array())
      );
    }

    const { email, verification_type = 'registration', user_role = 'client' } = req.body;

    // Send OTP
    const result = await emailVerificationService.sendOTP(email, verification_type, user_role);

    if (!result.success) {
      return res.status(400).json(
        errorResponse(result.message, result.error)
      );
    }

    res.json(
      successResponse(result.data, result.message)
    );

  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json(
      errorResponse('Internal server error while sending OTP')
    );
  }
});

/**
 * POST /api/email-verification/verify-otp
 * Verify OTP code
 */
router.post('/verify-otp', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Valid 6-digit OTP is required'),
  body('verification_type').optional().isIn(['registration', 'password_reset', 'email_change']).withMessage('Invalid verification type')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        errorResponse('Validation failed', errors.array())
      );
    }

    const { email, otp, verification_type = 'registration' } = req.body;

    // Verify OTP
    const result = await emailVerificationService.verifyOTP(email, otp, verification_type);

    if (!result.success) {
      return res.status(400).json(
        errorResponse(result.message, result.error, result.attemptsLeft ? { attemptsLeft: result.attemptsLeft } : undefined)
      );
    }

    res.json(
      successResponse(result.data, result.message)
    );

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json(
      errorResponse('Internal server error while verifying OTP')
    );
  }
});

/**
 * GET /api/email-verification/check-status/:email
 * Check if email is verified
 */
router.get('/check-status/:email', [
  body('verification_type').optional().isIn(['registration', 'password_reset', 'email_change']).withMessage('Invalid verification type')
], async (req, res) => {
  try {
    const { email } = req.params;
    const { verification_type = 'registration' } = req.query;

    // Validate email format
    if (!email || !email.includes('@')) {
      return res.status(400).json(
        errorResponse('Valid email parameter is required')
      );
    }

    // Check verification status
    const isVerified = await emailVerificationService.isEmailVerified(email, verification_type);

    res.json(
      successResponse({ 
        email, 
        isVerified, 
        verificationType: verification_type 
      }, isVerified ? 'Email is verified' : 'Email is not verified')
    );

  } catch (error) {
    console.error('Error checking verification status:', error);
    res.status(500).json(
      errorResponse('Internal server error while checking verification status')
    );
  }
});

/**
 * POST /api/email-verification/resend-otp
 * Resend OTP to email
 */
router.post('/resend-otp', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('verification_type').optional().isIn(['registration', 'password_reset', 'email_change']).withMessage('Invalid verification type'),
  body('user_role').optional().isIn(['client', 'psychologist', 'admin']).withMessage('Invalid user role')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        errorResponse('Validation failed', errors.array())
      );
    }

    const { email, verification_type = 'registration', user_role = 'client' } = req.body;

    // Check if email is already verified
    const isVerified = await emailVerificationService.isEmailVerified(email, verification_type);
    if (isVerified) {
      return res.status(400).json(
        errorResponse('Email is already verified')
      );
    }

    // Send new OTP
    const result = await emailVerificationService.sendOTP(email, verification_type, user_role);

    if (!result.success) {
      return res.status(400).json(
        errorResponse(result.message, result.error)
      );
    }

    res.json(
      successResponse(result.data, 'OTP resent successfully')
    );

  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json(
      errorResponse('Internal server error while resending OTP')
    );
  }
});

/**
 * DELETE /api/email-verification/cleanup
 * Clean up expired verifications (admin only)
 */
router.delete('/cleanup', async (req, res) => {
  try {
    const cleanedCount = await emailVerificationService.cleanupExpiredVerifications();

    res.json(
      successResponse({ cleanedCount }, `Cleaned up ${cleanedCount} expired verification records`)
    );

  } catch (error) {
    console.error('Error cleaning up verifications:', error);
    res.status(500).json(
      errorResponse('Internal server error while cleaning up verifications')
    );
  }
});

module.exports = router;
