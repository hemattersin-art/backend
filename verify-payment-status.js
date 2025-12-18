/**
 * Script to verify payment status and check if sessions were created
 * Usage: node backend/verify-payment-status.js [order_id]
 * If no order_id provided, shows recent pending payments
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');

async function verifyPaymentStatus() {
  const orderId = process.argv[2];

  console.log('\n🔍 Payment Status Verification');
  console.log('='.repeat(60));

  try {
    if (orderId) {
      // Check specific order
      console.log(`📦 Checking order: ${orderId}\n`);
      
      const { data: payment, error } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('razorpay_order_id', orderId)
        .single();

      if (error || !payment) {
        console.error('❌ Payment not found:', error?.message);
        process.exit(1);
      }

      await checkPaymentAndSession(payment);
    } else {
      // Show recent pending payments
      console.log('📋 Recent Pending Payments (last 10):\n');
      
      const { data: payments, error } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('❌ Error fetching payments:', error);
        process.exit(1);
      }

      if (!payments || payments.length === 0) {
        console.log('✅ No pending payments found!\n');
        return;
      }

      console.log(`Found ${payments.length} pending payment(s):\n`);
      
      for (const payment of payments) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Order ID: ${payment.razorpay_order_id}`);
        console.log(`Transaction ID: ${payment.transaction_id}`);
        console.log(`Amount: ₹${payment.amount}`);
        console.log(`Created: ${payment.created_at}`);
        await checkPaymentAndSession(payment);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function checkPaymentAndSession(payment) {
  console.log(`\n📊 Payment Details:`);
  console.log(`   Status: ${payment.status}`);
  console.log(`   Amount: ₹${payment.amount}`);
  console.log(`   Client ID: ${payment.client_id}`);
  console.log(`   Psychologist ID: ${payment.psychologist_id}`);
  console.log(`   Package ID: ${payment.package_id || 'Individual'}`);
  
  if (payment.razorpay_params?.notes) {
    console.log(`   Scheduled Date: ${payment.razorpay_params.notes.scheduledDate || 'N/A'}`);
    console.log(`   Scheduled Time: ${payment.razorpay_params.notes.scheduledTime || 'N/A'}`);
  }

  // Check if session exists
  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('*')
    .eq('payment_id', payment.id)
    .single();

  if (session) {
    console.log(`\n✅ Session Found:`);
    console.log(`   Session ID: ${session.id}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Date: ${session.scheduled_date}`);
    console.log(`   Time: ${session.scheduled_time}`);
    console.log(`   Price: ₹${session.price}`);
  } else {
    console.log(`\n❌ NO SESSION FOUND!`);
    console.log(`   This payment has no associated session.`);
    console.log(`   The payment success handler was likely not called.`);
    console.log(`\n💡 To fix this, run:`);
    console.log(`   node backend/test-payment-success.js ${payment.razorpay_order_id}`);
  }

  // Status summary
  console.log(`\n📋 Status Summary:`);
  if (payment.status === 'success' && session) {
    console.log(`   ✅ Payment processed and session created correctly`);
  } else if (payment.status === 'success' && !session) {
    console.log(`   ⚠️  Payment marked success but session missing!`);
  } else if (payment.status === 'pending' && !session) {
    console.log(`   ⚠️  Payment pending - success handler not called`);
  } else {
    console.log(`   ⚠️  Unexpected state: payment=${payment.status}, session=${session ? 'exists' : 'missing'}`);
  }
}

verifyPaymentStatus()
  .then(() => {
    console.log('\n' + '='.repeat(60));
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
