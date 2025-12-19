/**
 * Test Payment Controller
 * 
 * FOR TESTING ONLY - Simulates payment completion
 * This should only be enabled in development/test environments
 */

const { supabaseAdmin } = require('../config/supabase');
const { processPaymentCaptured } = require('./razorpayWebhookController');
const { getRazorpayInstance } = require('../config/razorpay');

/**
 * Simulate payment completion (TEST ONLY)
 * 
 * This endpoint simulates a successful payment for testing purposes.
 * It creates a fake payment in Razorpay test mode and processes it.
 * 
 * WARNING: Only enable in development/test environments!
 */
const simulatePaymentCompletion = async (req, res) => {
  try {
    // Only allow in development/test mode
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_PAYMENTS !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Test endpoints disabled in production'
      });
    }

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    console.log('🧪 Simulating payment completion for order:', orderId);

    // Get payment record
    const { data: paymentRecord } = await supabaseAdmin
      .from('payments')
      .select('id, amount, razorpay_order_id, status')
      .eq('razorpay_order_id', orderId)
      .maybeSingle();

    if (!paymentRecord) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }

    if (paymentRecord.status === 'success') {
      return res.status(200).json({
        success: true,
        message: 'Payment already completed',
        paymentId: paymentRecord.id
      });
    }

    // Create a mock payment object (simulating Razorpay payment)
    const mockPayment = {
      payment: {
        entity: {
          id: 'pay_test_' + Date.now(),
          order_id: orderId,
          amount: Math.round(paymentRecord.amount * 100), // Convert to paise
          currency: 'INR',
          status: 'captured'
        }
      }
    };

    // Process payment (skip signature check for test)
    const result = await processPaymentCaptured(
      mockPayment,
      'test-' + Date.now(),
      true // skip signature verification
    );

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Payment simulated and processed successfully',
        sessionId: result.sessionId,
        ...result
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to process simulated payment',
        error: result.error || result.message
      });
    }
  } catch (error) {
    console.error('❌ Error simulating payment:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

module.exports = {
  simulatePaymentCompletion
};

