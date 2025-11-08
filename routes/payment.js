const express = require('express');
const router = express.Router();
const { 
  createPaymentOrder,
  createCashPayment,
  handlePaymentSuccess, 
  handlePaymentFailure, 
  getPaymentStatus 
} = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

// Create payment order (requires authentication)
router.post('/create-order', authenticateToken, createPaymentOrder);

// Create cash payment (requires authentication)
router.post('/cash', authenticateToken, createCashPayment);

// PayU webhook endpoints (no authentication required)
router.post('/success', handlePaymentSuccess);
router.post('/failure', handlePaymentFailure);

// Get payment status (requires authentication)
router.get('/status/:transactionId', authenticateToken, getPaymentStatus);

module.exports = router;
