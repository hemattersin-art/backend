/**
 * Payment Status Controller
 * 
 * READ-ONLY endpoint for checking payment and session status.
 * 
 * This endpoint:
 * - Does NOT create sessions (webhook does that)
 * - Only returns current status
 * - Used by frontend to poll for session creation
 * - Fully idempotent (read-only)
 */

const { supabaseAdmin } = require('../config/supabase');
const { getSlotLockByOrderId } = require('../services/slotLockService');

/**
 * Get booking status by order ID
 * 
 * Returns:
 * - Slot lock status
 * - Payment status
 * - Session details (if created)
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getBookingStatusByOrderId = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    console.log('🔍 Checking booking status for order:', orderId?.substring(0, 10) + '...');

    // Get payment record first (always check this)
    const { data: paymentRecord } = await supabaseAdmin
      .from('payments')
      .select('id, status, amount, session_id, created_at, completed_at, psychologist_id, client_id, razorpay_params')
      .eq('razorpay_order_id', orderId)
      .maybeSingle();

    if (!paymentRecord) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
        status: 'NOT_FOUND'
      });
    }

    // Try to get slot lock (may not exist if using old flow or migration not run)
    const slotLockResult = await getSlotLockByOrderId(orderId);
    const slotLock = slotLockResult.success ? slotLockResult.data : null;

    // If slot lock exists, use it; otherwise fall back to payment record
    // This provides backward compatibility during transition
    if (!slotLock) {
      console.log('⚠️ Slot lock not found, using payment record (legacy mode)');
      
      // Get session if exists
      let session = null;
      if (paymentRecord.session_id) {
        const { data: sessionData } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time, google_meet_link')
          .eq('id', paymentRecord.session_id)
          .maybeSingle();
        
        session = sessionData;
      }

      // Determine status from payment record
      let overallStatus = paymentRecord.status?.toUpperCase() || 'PENDING';
      let message = '';

      if (paymentRecord.status === 'success' && session) {
        overallStatus = 'COMPLETED';
        message = 'Booking confirmed!';
      } else if (paymentRecord.status === 'success' && !session) {
        overallStatus = 'PAYMENT_SUCCESS';
        message = 'Payment successful, creating session...';
      } else if (paymentRecord.status === 'pending') {
        overallStatus = 'PAYMENT_PENDING';
        message = 'Payment in progress...';
      } else if (paymentRecord.status === 'failed') {
        overallStatus = 'FAILED';
        message = 'Payment failed. Please try again.';
      } else {
        message = 'Processing...';
      }

      return res.status(200).json({
        success: true,
        data: {
          orderId: orderId,
          status: overallStatus,
          slotLockStatus: null, // No slot lock
          message,
          payment: {
            id: paymentRecord.id,
            status: paymentRecord.status,
            amount: paymentRecord.amount
          },
          session: session ? {
            id: session.id,
            status: session.status,
            scheduledDate: session.scheduled_date,
            scheduledTime: session.scheduled_time,
            meetLink: session.google_meet_link || null
          } : null,
          slotDetails: paymentRecord.razorpay_params?.notes ? {
            psychologistId: paymentRecord.psychologist_id,
            scheduledDate: paymentRecord.razorpay_params.notes.scheduledDate,
            scheduledTime: paymentRecord.razorpay_params.notes.scheduledTime
          } : null
        },
        legacy: true // Flag to indicate using legacy mode
      });
    }

    // Slot lock exists - use new flow
    const slotLockData = slotLock;

    // Get session if exists - check both payment record and slot lock status
    let session = null;
    
    // First try to get from payment record
    if (paymentRecord?.session_id) {
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .select('id, status, scheduled_date, scheduled_time, google_meet_link')
        .eq('id', paymentRecord.session_id)
        .maybeSingle();
      
      if (sessionError) {
        console.warn('⚠️ Error fetching session by payment.session_id:', sessionError);
      }
      
      session = sessionData;
    }
    
    // If not found in payment record but slot lock is SESSION_CREATED, try to find by slot details
    if (!session && slotLock.status === 'SESSION_CREATED') {
      console.log('🔍 Session not in payment record, searching by slot details...');
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .select('id, status, scheduled_date, scheduled_time, google_meet_link')
        .eq('psychologist_id', slotLock.psychologist_id)
        .eq('client_id', slotLock.client_id)
        .eq('scheduled_date', slotLock.scheduled_date)
        .eq('scheduled_time', slotLock.scheduled_time)
        .eq('status', 'booked')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (sessionError) {
        console.warn('⚠️ Error fetching session by slot details:', sessionError);
      }
      
      if (sessionData) {
        session = sessionData;
        console.log('✅ Found session by slot details, updating payment record...');
        // Update payment record with session_id for future queries
        await supabaseAdmin
          .from('payments')
          .update({ session_id: sessionData.id })
          .eq('razorpay_order_id', orderId);
      } else {
        console.warn('⚠️ Session not found even though slot lock is SESSION_CREATED');
      }
    }
    
    // If session exists but no meet link, and it was just created, the meet link might still be processing
    // This is expected - meet links are created asynchronously
    const meetLinkStatus = session?.google_meet_link 
      ? 'available' 
      : session 
        ? 'processing' // Session exists but meet link not yet created (async process)
        : 'none';
    
    console.log('📊 Session lookup result:', {
      hasSession: !!session,
      sessionId: session?.id || null,
      paymentSessionId: paymentRecord?.session_id || null,
      slotLockStatus: slotLock?.status || null,
      sessionStatus: session?.status || null,
      meetLinkStatus: meetLinkStatus,
      hasMeetLink: !!session?.google_meet_link,
      meetLink: session?.google_meet_link ? session.google_meet_link.substring(0, 30) + '...' : null
    });

    // CRITICAL: If slot is SLOT_HELD and payment is pending for > 30 seconds,
    // check Razorpay directly (webhook might not have fired in test mode)
    if (slotLock.status === 'SLOT_HELD' && paymentRecord.status === 'pending') {
      const paymentAge = Date.now() - new Date(paymentRecord.created_at).getTime();
      if (paymentAge > 30000) { // 30 seconds
        console.log('🔍 Payment pending for >30s, checking Razorpay status...');
        
        try {
          const { getRazorpayInstance } = require('../config/razorpay');
          const razorpay = getRazorpayInstance();
          
          // Check payment status with Razorpay - fetch payments for this order
          const razorpayPayments = await razorpay.orders.fetchPayments(orderId);
          
          if (razorpayPayments && razorpayPayments.items && razorpayPayments.items.length > 0) {
            const razorpayPayment = razorpayPayments.items[0];
            
            if (razorpayPayment.status === 'captured' || razorpayPayment.status === 'authorized') {
              console.log('✅ Payment successful in Razorpay, processing manually...');
              
              // Process payment directly (bypass webhook signature for manual trigger)
              const { processPaymentCaptured } = require('./razorpayWebhookController');
              await processPaymentCaptured({
                payment: {
                  entity: {
                    id: razorpayPayment.id,
                    order_id: orderId,
                    amount: razorpayPayment.amount,
                    currency: razorpayPayment.currency,
                    status: razorpayPayment.status
                  }
                }
              }, 'manual-' + Date.now(), true); // true = skip signature verification
            }
          }
        } catch (razorpayError) {
          console.warn('⚠️ Could not check Razorpay status:', razorpayError.message);
          // Continue with normal flow
        }
      }
    }

    // Determine overall status
    let overallStatus = slotLock.status;
    let message = '';

    switch (slotLock.status) {
      case 'SLOT_HELD':
        message = 'Slot reserved, waiting for payment...';
        break;
      case 'PAYMENT_PENDING':
        message = 'Payment in progress...';
        break;
      case 'PAYMENT_SUCCESS':
        message = 'Payment successful, creating session...';
        break;
      case 'SESSION_CREATED':
        overallStatus = 'COMPLETED';
        message = 'Booking confirmed!';
        break;
      case 'FAILED':
        message = 'Payment failed. Please try again.';
        break;
      case 'EXPIRED':
        message = 'Slot reservation expired. Please book again.';
        break;
      default:
        message = 'Processing...';
    }

    // If status is COMPLETED but session is null, use slot details as fallback
    const sessionResponse = session ? {
      id: session.id,
      status: session.status,
      scheduledDate: session.scheduled_date,
      scheduledTime: session.scheduled_time,
      meetLink: session.google_meet_link || null
    } : (overallStatus === 'COMPLETED' ? {
      // Fallback: use slot details if session not found but status is COMPLETED
      id: null,
      status: 'booked',
      scheduledDate: slotLock.scheduled_date,
      scheduledTime: slotLock.scheduled_time,
      meetLink: null
    } : null);

    return res.status(200).json({
      success: true,
      data: {
        orderId: slotLock.order_id,
        status: overallStatus,
        slotLockStatus: slotLock.status,
        message,
        payment: paymentRecord ? {
          id: paymentRecord.id,
          status: paymentRecord.status,
          amount: paymentRecord.amount
        } : null,
        session: sessionResponse,
        slotDetails: {
          psychologistId: slotLock.psychologist_id,
          scheduledDate: slotLock.scheduled_date,
          scheduledTime: slotLock.scheduled_time
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting booking status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get booking status'
    });
  }
};

/**
 * Verify payment signature (optional verification from frontend)
 * 
 * This is a lightweight verification that doesn't create sessions.
 * Sessions are created by webhook.
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const verifyPaymentSignature = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification details'
      });
    }

    // Get slot lock to verify order exists
    const slotLockResult = await getSlotLockByOrderId(razorpay_order_id);

    if (!slotLockResult.success || !slotLockResult.data) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify signature (optional - webhook is source of truth)
    const { verifyPaymentSignature } = require('../config/razorpay');
    const { getRazorpayConfig } = require('../config/razorpay');
    const config = getRazorpayConfig();
    const isValid = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      config.keySecret
    );

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Return status (don't create session - webhook does that)
    return res.status(200).json({
      success: true,
      message: 'Payment signature verified',
      orderId: razorpay_order_id,
      // Return current status
      status: slotLockResult.data.status
    });
  } catch (error) {
    console.error('❌ Error verifying payment signature:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment signature'
    });
  }
};

module.exports = {
  getBookingStatusByOrderId,
  verifyPaymentSignature
};


