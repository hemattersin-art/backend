/**
 * Test script to verify payment success handler and session creation
 * Usage: node backend/test-payment-success.js <razorpay_order_id>
 * Example: node backend/test-payment-success.js order_Rt0Tb2YN6Rmfrc
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');
const crypto = require('crypto');

// Get Razorpay config
function getRazorpayConfig() {
  const useProduction = process.env.RAZORPAY_USE_PRODUCTION === 'true';
  const keyId = useProduction 
    ? process.env.RAZORPAY_KEY_ID 
    : process.env.RAZORPAY_TEST_KEY_ID;
  const keySecret = useProduction 
    ? process.env.RAZORPAY_KEY_SECRET 
    : process.env.RAZORPAY_TEST_KEY_SECRET;

  return {
    keyId,
    keySecret,
    useProduction
  };
}

// Verify payment signature (simplified for testing)
function verifyPaymentSignature(orderId, paymentId, signature, secret) {
  const text = `${orderId}|${paymentId}`;
  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(text)
    .digest('hex');
  return generatedSignature === signature;
}

async function testPaymentSuccess() {
  const orderId = process.argv[2];
  
  if (!orderId) {
    console.error('❌ Please provide a Razorpay order ID');
    console.log('Usage: node backend/test-payment-success.js <razorpay_order_id>');
    process.exit(1);
  }

  console.log('\n🧪 Testing Payment Success Handler');
  console.log('='.repeat(60));
  console.log(`📦 Order ID: ${orderId}\n`);

  try {
    // Step 1: Find the payment record
    console.log('Step 1: Finding payment record...');
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('razorpay_order_id', orderId)
      .single();

    if (paymentError || !paymentRecord) {
      console.error('❌ Payment record not found:', paymentError?.message);
      console.log('\n💡 Available payment records:');
      const { data: allPayments } = await supabaseAdmin
        .from('payments')
        .select('razorpay_order_id, transaction_id, status, amount, created_at')
        .order('created_at', { ascending: false })
        .limit(5);
      if (allPayments) {
        allPayments.forEach(p => {
          console.log(`   - ${p.razorpay_order_id} (${p.status}) - ₹${p.amount} - ${p.created_at}`);
        });
      }
      process.exit(1);
    }

    console.log('✅ Payment record found:');
    console.log(`   Transaction ID: ${paymentRecord.transaction_id}`);
    console.log(`   Status: ${paymentRecord.status}`);
    console.log(`   Amount: ₹${paymentRecord.amount}`);
    console.log(`   Client ID: ${paymentRecord.client_id}`);
    console.log(`   Psychologist ID: ${paymentRecord.psychologist_id}`);
    console.log(`   Package ID: ${paymentRecord.package_id || 'Individual'}`);
    console.log(`   Scheduled Date: ${paymentRecord.razorpay_params?.notes?.scheduledDate || 'N/A'}`);
    console.log(`   Scheduled Time: ${paymentRecord.razorpay_params?.notes?.scheduledTime || 'N/A'}\n`);

    // Step 2: Check if payment is already processed
    if (paymentRecord.status === 'success') {
      console.log('⚠️  Payment is already marked as success');
      console.log('   Checking if session exists...\n');
      
      const { data: existingSession } = await supabaseAdmin
        .from('sessions')
        .select('*')
        .eq('payment_id', paymentRecord.id)
        .single();
      
      if (existingSession) {
        console.log('✅ Session already exists:');
        console.log(`   Session ID: ${existingSession.id}`);
        console.log(`   Status: ${existingSession.status}`);
        console.log(`   Date: ${existingSession.scheduled_date}`);
        console.log(`   Time: ${existingSession.scheduled_time}`);
        console.log('\n✅ Payment and session are already processed correctly!');
        return;
      } else {
        console.log('⚠️  Payment is marked success but no session found!');
        console.log('   This indicates the session creation failed.\n');
      }
    }

    // Step 3: Check if we need to create a test payment ID and signature
    console.log('Step 2: Preparing test payment data...');
    const razorpayConfig = getRazorpayConfig();
    
    // For testing, we'll use a mock payment ID and generate a valid signature
    const testPaymentId = `pay_test_${Date.now()}`;
    const testSignature = crypto
      .createHmac('sha256', razorpayConfig.keySecret)
      .update(`${orderId}|${testPaymentId}`)
      .digest('hex');

    console.log(`   Test Payment ID: ${testPaymentId}`);
    console.log(`   Generated Signature: ${testSignature.substring(0, 20)}...\n`);

    // Step 4: Simulate the payment success handler
    console.log('Step 3: Simulating payment success handler...');
    console.log('   (This would normally be called by Razorpay callback)\n');

    // Import the payment controller
    const { handlePaymentSuccess } = require('./controllers/paymentController');
    
    // Create a mock request object
    const mockReq = {
      body: {
        razorpay_order_id: orderId,
        razorpay_payment_id: testPaymentId,
        razorpay_signature: testSignature
      },
      headers: {
        'content-type': 'application/json'
      }
    };

    // Create a mock response object
    let responseData = null;
    let responseStatus = 200;
    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return mockRes;
      },
      json: (data) => {
        responseData = data;
        console.log('📤 Response from handler:');
        console.log(`   Status: ${responseStatus}`);
        console.log(`   Success: ${data.success}`);
        console.log(`   Message: ${data.message || 'N/A'}`);
        if (data.data) {
          console.log(`   Session ID: ${data.data.sessionId || 'N/A'}`);
          console.log(`   Transaction ID: ${data.data.transactionId || 'N/A'}`);
        }
        return mockRes;
      }
    };

    // Call the handler
    await handlePaymentSuccess(mockReq, mockRes);

    // Step 5: Verify the results
    console.log('\nStep 4: Verifying results...\n');
    
    // Check payment status
    const { data: updatedPayment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('razorpay_order_id', orderId)
      .single();

    if (updatedPayment) {
      console.log('📊 Payment Status:');
      console.log(`   Status: ${updatedPayment.status}`);
      console.log(`   Completed At: ${updatedPayment.completed_at || 'N/A'}`);
      
      if (updatedPayment.status === 'success') {
        console.log('   ✅ Payment marked as success\n');
      } else {
        console.log('   ⚠️  Payment status not updated to success\n');
      }
    }

    // Check if session was created
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('payment_id', paymentRecord.id)
      .single();

    if (session) {
      console.log('📅 Session Created:');
      console.log(`   Session ID: ${session.id}`);
      console.log(`   Status: ${session.status}`);
      console.log(`   Date: ${session.scheduled_date}`);
      console.log(`   Time: ${session.scheduled_time}`);
      console.log(`   Client ID: ${session.client_id}`);
      console.log(`   Psychologist ID: ${session.psychologist_id}`);
      console.log(`   Price: ₹${session.price}`);
      console.log('   ✅ Session created successfully!\n');
    } else {
      console.log('❌ Session NOT Created!');
      console.log('   This indicates the payment success handler failed to create the session.\n');
    }

    // Final summary
    console.log('='.repeat(60));
    console.log('📋 TEST SUMMARY:');
    console.log('='.repeat(60));
    
    const paymentSuccess = updatedPayment?.status === 'success';
    const sessionCreated = !!session;
    
    if (paymentSuccess && sessionCreated) {
      console.log('✅ SUCCESS: Payment processed and session created correctly!');
    } else if (paymentSuccess && !sessionCreated) {
      console.log('⚠️  PARTIAL: Payment processed but session NOT created!');
      console.log('   This is the issue that needs to be fixed.');
    } else if (!paymentSuccess && sessionCreated) {
      console.log('⚠️  PARTIAL: Session created but payment status not updated!');
    } else {
      console.log('❌ FAILED: Neither payment nor session was processed!');
    }
    
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Test Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testPaymentSuccess()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
