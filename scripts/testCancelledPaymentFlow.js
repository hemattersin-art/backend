/**
 * Test Script: Cancelled Payment Flow
 * 
 * Tests what happens when:
 * 1. User opens Razorpay payment modal
 * 2. User exits/cancels without completing payment
 * 
 * Expected behavior:
 * - Slot lock is created with status 'SLOT_HELD'
 * - Payment record is created with status 'pending'
 * - No session is created
 * - Slot lock expires after 5 minutes (or is cleaned up by job)
 * - Payment stays as 'pending' (manual cleanup may be needed)
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function testCancelledPaymentFlow() {
  console.log('🧪 Testing Cancelled Payment Flow\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Check for recent pending payments (created in last 10 minutes)
    console.log('\n📋 Step 1: Checking for recent pending payments...');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { data: pendingPayments, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select(`
        id,
        razorpay_order_id,
        razorpay_payment_id,
        status,
        amount,
        created_at,
        client_id,
        psychologist_id
      `)
      .eq('status', 'pending')
      .gte('created_at', tenMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(10);

    if (paymentsError) {
      console.error('❌ Error fetching pending payments:', paymentsError);
      return;
    }

    console.log(`Found ${pendingPayments?.length || 0} pending payments in last 10 minutes\n`);

    if (pendingPayments && pendingPayments.length > 0) {
      for (const payment of pendingPayments) {
        console.log(`Payment ID: ${payment.id}`);
        console.log(`Order ID: ${payment.razorpay_order_id}`);
        console.log(`Payment ID (Razorpay): ${payment.razorpay_payment_id || 'N/A (not completed)'}`);
        console.log(`Status: ${payment.status}`);
        console.log(`Amount: ₹${payment.amount}`);
        console.log(`Created: ${payment.created_at}`);
        console.log('-'.repeat(60));

        // Step 2: Check for associated slot lock
        console.log('\n🔒 Step 2: Checking for associated slot lock...');
        const { data: slotLock, error: slotLockError } = await supabaseAdmin
          .from('slot_locks')
          .select('*')
          .eq('order_id', payment.razorpay_order_id)
          .single();

        if (slotLockError) {
          if (slotLockError.code === 'PGRST116') {
            console.log('⚠️  No slot lock found (may have been cleaned up or never created)');
          } else {
            console.error('❌ Error fetching slot lock:', slotLockError);
          }
        } else {
          console.log(`Slot Lock ID: ${slotLock.id}`);
          console.log(`Status: ${slotLock.status}`);
          console.log(`Expires At: ${slotLock.slot_expires_at}`);
          
          const expiresAt = new Date(slotLock.slot_expires_at);
          const now = new Date();
          const isExpired = expiresAt < now;
          const minutesUntilExpiry = isExpired ? 0 : Math.ceil((expiresAt - now) / (1000 * 60));
          
          console.log(`Is Expired: ${isExpired ? 'Yes' : 'No'}`);
          if (!isExpired) {
            console.log(`Expires in: ${minutesUntilExpiry} minutes`);
          }
        }
        console.log('-'.repeat(60));

        // Step 3: Check for associated session
        console.log('\n📅 Step 3: Checking for associated session...');
        const { data: session, error: sessionError } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time')
          .eq('payment_id', payment.id)
          .maybeSingle();

        if (sessionError) {
          console.error('❌ Error fetching session:', sessionError);
        } else if (session) {
          console.log(`⚠️  WARNING: Session found (should not exist for cancelled payment)`);
          console.log(`Session ID: ${session.id}`);
          console.log(`Status: ${session.status}`);
          console.log(`Scheduled: ${session.scheduled_date} ${session.scheduled_time}`);
        } else {
          console.log('✅ No session found (expected for cancelled payment)');
        }
        console.log('-'.repeat(60));
        console.log('\n');
      }
    } else {
      console.log('ℹ️  No recent pending payments found');
      console.log('\n💡 To test this scenario:');
      console.log('   1. Create a booking and open Razorpay payment');
      console.log('   2. Exit/cancel the Razorpay modal without completing payment');
      console.log('   3. Run this script again to see the pending payment state');
    }

    // Step 4: Check for expired slot locks that should be cleaned up
    console.log('\n🧹 Step 4: Checking for expired slot locks...');
    const { data: expiredLocks, error: expiredError } = await supabaseAdmin
      .from('slot_locks')
      .select('id, order_id, status, slot_expires_at, created_at')
      .lt('slot_expires_at', new Date().toISOString())
      .in('status', ['SLOT_HELD', 'PAYMENT_PENDING'])
      .limit(10);

    if (expiredError) {
      console.error('❌ Error fetching expired locks:', expiredError);
    } else {
      console.log(`Found ${expiredLocks?.length || 0} expired slot locks that should be cleaned up`);
      if (expiredLocks && expiredLocks.length > 0) {
        expiredLocks.forEach(lock => {
          const expiredSince = Math.floor((new Date() - new Date(lock.slot_expires_at)) / (1000 * 60));
          console.log(`  - Lock ${lock.id}: Status=${lock.status}, Expired ${expiredSince} minutes ago`);
        });
      }
    }

    // Step 5: Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(60));
    console.log('\n✅ Expected behavior for cancelled payments:');
    console.log('   1. Payment record created with status "pending"');
    console.log('   2. Slot lock created with status "SLOT_HELD" (expires after 5 minutes)');
    console.log('   3. No session is created');
    console.log('   4. Cleanup job runs every 10 minutes and:');
    console.log('      - Releases expired slot locks (marks as EXPIRED)');
    console.log('      - Marks associated pending payments as "failed"');
    console.log('      - Cleans up abandoned pending payments (>10 minutes old, no active locks)');
    console.log('\n✅ Implemented cleanup:');
    console.log('   - Expired slot locks are automatically released');
    console.log('   - Pending payments with expired locks are marked as "failed"');
    console.log('   - Old abandoned pending payments are cleaned up');
    console.log('\n⚠️  Note:');
    console.log('   - User can try to book again but slot is locked until expiry (5 minutes)');
    console.log('   - This is by design to prevent double bookings during payment');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }

  process.exit(0);
}

testCancelledPaymentFlow();

