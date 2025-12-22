/**
 * Script to cleanup pending payment records and related data
 * Removes:
 * - Pending payment records
 * - Sessions linked to pending payments (if any)
 * - Slot locks related to pending payments
 * Does NOT remove:
 * - Users/clients
 * - Psychologists
 */

require('dotenv').config();
const supabaseConfig = require('../config/supabase');
const supabaseAdmin = supabaseConfig.supabaseAdmin;

async function cleanupPendingPayments() {
  try {
    console.log('🧹 Starting cleanup of pending payments and related data...\n');

    // First, get all pending payments to review
    const { data: pendingPayments, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select(`
        id,
        transaction_id,
        razorpay_order_id,
        session_id,
        created_at
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (paymentsError) {
      console.error('❌ Error fetching pending payments:', paymentsError);
      return;
    }

    if (!pendingPayments || pendingPayments.length === 0) {
      console.log('✅ No pending payments found. Nothing to clean up!');
      return;
    }

    console.log(`📊 Found ${pendingPayments.length} pending payments to clean up\n`);
    console.log('='.repeat(100));

    let sessionsDeleted = 0;
    let slotLocksDeleted = 0;
    let paymentsDeleted = 0;
    let errors = [];

    // Process each pending payment
    for (const payment of pendingPayments) {
      console.log(`\n💰 Processing Payment: ${payment.id}`);
      console.log(`   Transaction ID: ${payment.transaction_id || 'N/A'}`);
      console.log(`   Razorpay Order ID: ${payment.razorpay_order_id || 'N/A'}`);

      try {
        // 1. Check and delete sessions linked via session_id
        if (payment.session_id) {
          const { data: session, error: sessionError } = await supabaseAdmin
            .from('sessions')
            .select('id, status')
            .eq('id', payment.session_id)
            .single();

          if (session && !sessionError) {
            console.log(`   🗑️  Deleting session: ${session.id} (status: ${session.status})`);
            const { error: deleteSessionError } = await supabaseAdmin
              .from('sessions')
              .delete()
              .eq('id', payment.session_id);

            if (deleteSessionError) {
              console.error(`   ❌ Error deleting session: ${deleteSessionError.message}`);
              errors.push(`Session ${payment.session_id}: ${deleteSessionError.message}`);
            } else {
              sessionsDeleted++;
              console.log(`   ✅ Session deleted`);
            }
          }
        }

        // 2. Check and delete sessions linked via payment_id
        const { data: sessionsByPaymentId, error: sessionsError } = await supabaseAdmin
          .from('sessions')
          .select('id, status')
          .eq('payment_id', payment.id);

        if (sessionsByPaymentId && sessionsByPaymentId.length > 0) {
          console.log(`   🗑️  Found ${sessionsByPaymentId.length} session(s) linked via payment_id`);
          for (const session of sessionsByPaymentId) {
            console.log(`      Deleting session: ${session.id} (status: ${session.status})`);
            const { error: deleteSessionError } = await supabaseAdmin
              .from('sessions')
              .delete()
              .eq('id', session.id);

            if (deleteSessionError) {
              console.error(`      ❌ Error deleting session: ${deleteSessionError.message}`);
              errors.push(`Session ${session.id}: ${deleteSessionError.message}`);
            } else {
              sessionsDeleted++;
              console.log(`      ✅ Session deleted`);
            }
          }
        }

        // 3. Check and delete assessment sessions linked via payment_id
        const { data: assessmentSessions, error: assessmentError } = await supabaseAdmin
          .from('assessment_sessions')
          .select('id, status')
          .eq('payment_id', payment.id);

        if (assessmentSessions && assessmentSessions.length > 0) {
          console.log(`   🗑️  Found ${assessmentSessions.length} assessment session(s) linked via payment_id`);
          for (const session of assessmentSessions) {
            console.log(`      Deleting assessment session: ${session.id} (status: ${session.status})`);
            const { error: deleteAssessmentError } = await supabaseAdmin
              .from('assessment_sessions')
              .delete()
              .eq('id', session.id);

            if (deleteAssessmentError) {
              console.error(`      ❌ Error deleting assessment session: ${deleteAssessmentError.message}`);
              errors.push(`Assessment Session ${session.id}: ${deleteAssessmentError.message}`);
            } else {
              sessionsDeleted++;
              console.log(`      ✅ Assessment session deleted`);
            }
          }
        }

        // 4. Delete slot locks if they exist (check by order_id)
        if (payment.razorpay_order_id) {
          const { data: slotLocks, error: slotLockError } = await supabaseAdmin
            .from('slot_locks')
            .select('id, status')
            .eq('order_id', payment.razorpay_order_id);

          if (slotLocks && slotLocks.length > 0) {
            console.log(`   🗑️  Found ${slotLocks.length} slot lock(s)`);
            for (const lock of slotLocks) {
              console.log(`      Deleting slot lock: ${lock.id} (status: ${lock.status})`);
              const { error: deleteLockError } = await supabaseAdmin
                .from('slot_locks')
                .delete()
                .eq('id', lock.id);

              if (deleteLockError) {
                console.error(`      ❌ Error deleting slot lock: ${deleteLockError.message}`);
                errors.push(`Slot Lock ${lock.id}: ${deleteLockError.message}`);
              } else {
                slotLocksDeleted++;
                console.log(`      ✅ Slot lock deleted`);
              }
            }
          }
        }

        // 5. Finally, delete the payment record itself
        console.log(`   🗑️  Deleting payment record...`);
        const { error: deletePaymentError } = await supabaseAdmin
          .from('payments')
          .delete()
          .eq('id', payment.id);

        if (deletePaymentError) {
          console.error(`   ❌ Error deleting payment: ${deletePaymentError.message}`);
          errors.push(`Payment ${payment.id}: ${deletePaymentError.message}`);
        } else {
          paymentsDeleted++;
          console.log(`   ✅ Payment deleted`);
        }

        console.log(`   ${'-'.repeat(98)}`);

      } catch (error) {
        console.error(`   ❌ Error processing payment ${payment.id}:`, error.message);
        errors.push(`Payment ${payment.id}: ${error.message}`);
      }
    }

    // Summary
    console.log(`\n\n📈 Cleanup Summary:`);
    console.log(`   ✅ Payments deleted: ${paymentsDeleted}/${pendingPayments.length}`);
    console.log(`   ✅ Sessions deleted: ${sessionsDeleted}`);
    console.log(`   ✅ Slot locks deleted: ${slotLocksDeleted}`);
    
    if (errors.length > 0) {
      console.log(`   ❌ Errors encountered: ${errors.length}`);
      console.log(`\n   Error details:`);
      errors.forEach((error, idx) => {
        console.log(`      ${idx + 1}. ${error}`);
      });
    } else {
      console.log(`   ✅ No errors - all cleanup completed successfully!`);
    }

    console.log(`\n💡 Note: Users, clients, and psychologists were NOT deleted.`);
    console.log(`   Only payment records and their related sessions/slot locks were removed.`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

// Ask for confirmation before running
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('⚠️  WARNING: This script will permanently delete:');
console.log('   - All pending payment records');
console.log('   - All sessions linked to pending payments');
console.log('   - All slot locks related to pending payments');
console.log('\n   This action CANNOT be undone!\n');

rl.question('Are you sure you want to proceed? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    rl.close();
    cleanupPendingPayments();
  } else {
    console.log('\n❌ Cleanup cancelled.');
    rl.close();
    process.exit(0);
  }
});

