/**
 * Script to check for stuck slot locks due to payment/booking failures
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function checkStuckSlotLocks() {
  try {
    console.log('🔍 Checking for stuck slot locks...\n');
    
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    
    // Find expired locks that are still active
    const { data: expiredLocks, error: expiredError } = await supabaseAdmin
      .from('slot_locks')
      .select(`
        *,
        payment:payments!slot_locks_order_id_fkey(
          id,
          status,
          razorpay_order_id,
          created_at
        )
      `)
      .in('status', ['SLOT_HELD', 'PAYMENT_PENDING'])
      .lt('slot_expires_at', now.toISOString())
      .order('created_at', { ascending: false });
    
    // Find old locks (older than 15 minutes) that might have failed
    const { data: oldLocks, error: oldLocksError } = await supabaseAdmin
      .from('slot_locks')
      .select(`
        *,
        payment:payments!slot_locks_order_id_fkey(
          id,
          status,
          razorpay_order_id,
          created_at
        )
      `)
      .in('status', ['SLOT_HELD', 'PAYMENT_PENDING'])
      .lt('created_at', fifteenMinutesAgo.toISOString())
      .order('created_at', { ascending: false });
    
    // Combine and deduplicate
    const allStuckLocks = [];
    const seenIds = new Set();
    
    if (!expiredError && expiredLocks) {
      expiredLocks.forEach(lock => {
        if (!seenIds.has(lock.id)) {
          allStuckLocks.push({ ...lock, reason: 'EXPIRED' });
          seenIds.add(lock.id);
        }
      });
    }
    
    if (!oldLocksError && oldLocks) {
      oldLocks.forEach(lock => {
        if (!seenIds.has(lock.id)) {
          allStuckLocks.push({ ...lock, reason: 'OLD_AND_PENDING' });
          seenIds.add(lock.id);
        }
      });
    }
    
    // Check payment status for each stuck lock
    const stuckLocksWithDetails = [];
    for (const lock of allStuckLocks) {
      let paymentStatus = 'UNKNOWN';
      let hasPayment = false;
      
      if (lock.order_id) {
        const { data: payment } = await supabaseAdmin
          .from('payments')
          .select('id, status, razorpay_order_id')
          .eq('razorpay_order_id', lock.order_id)
          .maybeSingle();
        
        if (payment) {
          hasPayment = true;
          paymentStatus = payment.status || 'UNKNOWN';
        }
      }
      
      stuckLocksWithDetails.push({
        ...lock,
        paymentStatus,
        hasPayment,
        isStuck: paymentStatus === 'failed' || paymentStatus === 'pending' || !hasPayment
      });
    }
    
    console.log('='.repeat(100));
    console.log('📋 STUCK SLOT LOCKS:');
    console.log('='.repeat(100));
    console.log(`Total stuck locks found: ${stuckLocksWithDetails.length}\n`);
    
    if (stuckLocksWithDetails.length === 0) {
      console.log('✅ No stuck slot locks found!');
    } else {
      stuckLocksWithDetails.forEach((lock, index) => {
        console.log(`\n${index + 1}. Lock ID: ${lock.id}`);
        console.log(`   Order ID: ${lock.order_id || 'N/A'}`);
        console.log(`   Status: ${lock.status}`);
        console.log(`   Reason: ${lock.reason}`);
        console.log(`   Psychologist ID: ${lock.psychologist_id}`);
        console.log(`   Client ID: ${lock.client_id}`);
        console.log(`   Date: ${lock.scheduled_date}`);
        console.log(`   Time: ${lock.scheduled_time}`);
        console.log(`   Expires At: ${lock.slot_expires_at}`);
        console.log(`   Created: ${lock.created_at}`);
        console.log(`   Payment Status: ${lock.paymentStatus}`);
        console.log(`   Has Payment Record: ${lock.hasPayment ? 'Yes' : 'No'}`);
        console.log(`   Is Stuck: ${lock.isStuck ? '⚠️ YES' : '✅ NO'}`);
      });
    }
    
    // Summary
    const trulyStuck = stuckLocksWithDetails.filter(l => l.isStuck);
    console.log('\n' + '='.repeat(100));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(100));
    console.log(`Total stuck locks: ${stuckLocksWithDetails.length}`);
    console.log(`Truly stuck (failed/missing payment): ${trulyStuck.length}`);
    console.log(`Expired locks: ${expiredLocks?.length || 0}`);
    console.log(`Old pending locks: ${oldLocks?.length || 0}`);
    
    if (trulyStuck.length > 0) {
      console.log('\n⚠️  Stuck locks that need attention:');
      trulyStuck.forEach((lock, index) => {
        console.log(`   ${index + 1}. Order: ${lock.order_id?.substring(0, 15)}... | Status: ${lock.status} | Payment: ${lock.paymentStatus}`);
      });
    }
    
    console.log('\n' + '='.repeat(100));
    
    // Return JSON for curl/API usage
    return {
      total: stuckLocksWithDetails.length,
      stuck: trulyStuck.length,
      locks: stuckLocksWithDetails
    };
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  checkStuckSlotLocks()
    .then(result => {
      console.log('\n✅ Check completed');
      console.log('\n📄 JSON Output:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { checkStuckSlotLocks };
