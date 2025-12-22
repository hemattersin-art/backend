/**
 * Script to check Razorpay order status for pending payments
 * This helps determine if orders were created in test mode and never completed
 */

require('dotenv').config();
const supabaseConfig = require('../config/supabase');
const supabaseAdmin = supabaseConfig.supabaseAdmin;
const { getRazorpayInstance, getRazorpayConfig } = require('../config/razorpay');

async function checkRazorpayOrderStatus() {
  try {
    console.log('🔍 Checking Razorpay order status for pending payments...\n');
    
    const razorpayConfig = getRazorpayConfig();
    const isProduction = process.env.RAZORPAY_USE_PRODUCTION === 'true';
    console.log(`🔧 Razorpay Mode: ${isProduction ? 'PRODUCTION' : 'TEST MODE'}\n`);

    // Get a few recent pending payments to check
    const { data: pendingPayments, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select(`
        id,
        transaction_id,
        razorpay_order_id,
        razorpay_payment_id,
        amount,
        status,
        created_at
      `)
      .eq('status', 'pending')
      .not('razorpay_order_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10); // Check first 10

    if (paymentsError) {
      console.error('❌ Error fetching pending payments:', paymentsError);
      return;
    }

    if (!pendingPayments || pendingPayments.length === 0) {
      console.log('✅ No pending payments with Razorpay order IDs found!');
      return;
    }

    console.log(`📊 Checking ${pendingPayments.length} pending payments:\n`);
    console.log('='.repeat(100));

    const razorpay = getRazorpayInstance();
    let checked = 0;
    let completedInRazorpay = 0;
    let notFoundInRazorpay = 0;
    let errorChecking = 0;

    for (const payment of pendingPayments) {
      checked++;
      console.log(`\n💰 Payment ${checked}/${pendingPayments.length}`);
      console.log(`   Payment ID: ${payment.id}`);
      console.log(`   Order ID: ${payment.razorpay_order_id}`);
      console.log(`   Amount: ₹${payment.amount}`);
      console.log(`   Created: ${payment.created_at}`);

      try {
        // Check order status in Razorpay
        const order = await razorpay.orders.fetch(payment.razorpay_order_id);
        
        console.log(`   ✅ Order found in Razorpay:`);
        console.log(`      Order Status: ${order.status}`);
        console.log(`      Amount: ₹${order.amount / 100}`);
        console.log(`      Currency: ${order.currency}`);
        console.log(`      Created: ${order.created_at}`);
        console.log(`      Paid: ${order.amount_paid / 100}`);
        console.log(`      Attempts: ${order.attempts}`);

        if (order.status === 'paid') {
          console.log(`   ⚠️  ISSUE: Order is PAID in Razorpay but payment status is still pending!`);
          console.log(`      This means webhook was not received or failed to process.`);
          completedInRazorpay++;
          
          // Check if there are payments for this order
          try {
            const payments = await razorpay.orders.fetchPayments(payment.razorpay_order_id);
            if (payments && payments.items && payments.items.length > 0) {
              console.log(`      Razorpay Payments: ${payments.items.length}`);
              payments.items.forEach((p, idx) => {
                console.log(`         Payment ${idx + 1}: ${p.id} - ${p.status} - ₹${p.amount / 100}`);
              });
            }
          } catch (err) {
            console.log(`      Could not fetch payment details: ${err.message}`);
          }
        } else if (order.status === 'created' || order.status === 'attempted') {
          console.log(`   ✅ Order status in Razorpay matches: Payment was never completed`);
          console.log(`      User abandoned the payment or payment failed`);
        } else {
          console.log(`   ℹ️  Order status: ${order.status}`);
        }

      } catch (error) {
        if (error.statusCode === 404 || error.error?.code === 'BAD_REQUEST_ERROR') {
          console.log(`   ⚠️  Order NOT FOUND in Razorpay`);
          console.log(`      This could mean:`);
          console.log(`      - Order was created in different Razorpay account`);
          console.log(`      - Order ID is invalid`);
          console.log(`      - Order was deleted`);
          notFoundInRazorpay++;
        } else {
          console.log(`   ❌ Error checking order: ${error.message}`);
          errorChecking++;
        }
      }

      console.log(`   ${'-'.repeat(98)}`);
    }

    console.log(`\n\n📈 Summary:`);
    console.log(`   Total Checked: ${checked}`);
    console.log(`   ✅ Paid in Razorpay but stuck pending: ${completedInRazorpay} (WEBHOOK ISSUE)`);
    console.log(`   ✅ Abandoned/Incomplete in Razorpay: ${checked - completedInRazorpay - notFoundInRazorpay - errorChecking}`);
    console.log(`   ⚠️  Not Found in Razorpay: ${notFoundInRazorpay}`);
    console.log(`   ❌ Errors: ${errorChecking}`);

    if (completedInRazorpay > 0) {
      console.log(`\n⚠️  IMPORTANT: ${completedInRazorpay} payment(s) are PAID in Razorpay but status is still pending!`);
      console.log(`   This indicates a webhook processing issue.`);
      console.log(`   The payment was successful but the webhook didn't update the status.`);
    }

    console.log(`\n💡 Test Mode Impact:`);
    console.log(`   - Test mode uses Razorpay test keys (no real money)`);
    console.log(`   - Payment flow works the same way in test and production`);
    console.log(`   - Abandoned payments will stay pending in both modes`);
    console.log(`   - The issue is not caused by test mode, but by incomplete payment flows`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the check
checkRazorpayOrderStatus();

