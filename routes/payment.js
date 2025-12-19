const express = require('express');
const router = express.Router();
const { 
  createPaymentOrder,
  createCashPayment,
  handlePaymentFailure, 
  getPaymentStatus 
} = require('../controllers/paymentController');
const { handleRazorpayWebhook } = require('../controllers/razorpayWebhookController');
const { getBookingStatusByOrderId, verifyPaymentSignature } = require('../controllers/paymentStatusController');
const { simulatePaymentCompletion } = require('../controllers/testPaymentController');
const { authenticateToken } = require('../middleware/auth');

// Create payment order (requires authentication)
router.post('/create-order', authenticateToken, createPaymentOrder);

// Create cash payment (requires authentication)
router.post('/cash', authenticateToken, createCashPayment);

// Razorpay webhook (PRIMARY SOURCE OF TRUTH - no authentication required)
// This is where sessions are created after payment
router.post('/webhook', handleRazorpayWebhook);

// Payment status endpoints (read-only, for frontend polling)
router.get('/booking-status/:orderId', getBookingStatusByOrderId); // Public - used by success page
router.post('/verify-signature', verifyPaymentSignature); // Optional verification (doesn't create session)

// Legacy endpoints (kept for backward compatibility)
router.post('/failure', handlePaymentFailure);

// Get payment status (requires authentication)
router.get('/status/:transactionId', authenticateToken, getPaymentStatus);

// Test endpoint (development only)
if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_TEST_PAYMENTS === 'true') {
  router.post('/test/simulate-payment', simulatePaymentCompletion);
}

module.exports = router;
