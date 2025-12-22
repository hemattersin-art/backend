/**
 * Script to check pending payments and identify why they're stuck
 * Checks if sessions were created for pending payments
 */

require('dotenv').config();
const supabaseConfig = require('../config/supabase');
const supabaseAdmin = supabaseConfig.supabaseAdmin;

async function checkPendingPayments() {
  try {
    console.log('🔍 Checking pending payments...\n');

    // Get all pending payments with related data
    const { data: pendingPayments, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select(`
        id,
        transaction_id,
        razorpay_order_id,
        razorpay_payment_id,
        session_id,
        psychologist_id,
        client_id,
        amount,
        status,
        created_at,
        completed_at,
        razorpay_params
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (paymentsError) {
      console.error('❌ Error fetching pending payments:', paymentsError);
      return;
    }

    if (!pendingPayments || pendingPayments.length === 0) {
      console.log('✅ No pending payments found!');
      return;
    }

    console.log(`📊 Found ${pendingPayments.length} pending payments:\n`);
    console.log('='.repeat(100));

    let stuckWithSession = 0;
    let stuckWithoutSession = 0;
    const now = new Date();

    for (const payment of pendingPayments) {
      const createdAt = new Date(payment.created_at);
      const ageInMinutes = Math.floor((now - createdAt) / (1000 * 60));
      const ageInHours = Math.floor(ageInMinutes / 60);
      const ageInDays = Math.floor(ageInHours / 24);

      let ageText = '';
      if (ageInDays > 0) {
        ageText = `${ageInDays} day(s)`;
      } else if (ageInHours > 0) {
        ageText = `${ageInHours} hour(s)`;
      } else {
        ageText = `${ageInMinutes} minute(s)`;
      }

      console.log(`\n💰 Payment ID: ${payment.id}`);
      console.log(`   Transaction ID: ${payment.transaction_id || 'N/A'}`);
      console.log(`   Razorpay Order ID: ${payment.razorpay_order_id || 'N/A'}`);
      console.log(`   Razorpay Payment ID: ${payment.razorpay_payment_id || 'N/A'}`);
      console.log(`   Amount: ₹${payment.amount || 0}`);
      console.log(`   Created: ${payment.created_at} (${ageText} ago)`);
      console.log(`   Status: ${payment.status}`);

      // Check if session was created
      if (payment.session_id) {
        // Try to get session by session_id (the one stored in payments table)
        const { data: session } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time, client_id')
          .eq('id', payment.session_id)
          .single();
        
        if (session) {
          console.log(`   ⚠️  ISSUE: Session WAS created but payment status is still pending!`);
          console.log(`      Session ID: ${session.id}`);
          console.log(`      Session Status: ${session.status}`);
          console.log(`      Session Date: ${session.scheduled_date || 'N/A'} ${session.scheduled_time || ''}`);
          stuckWithSession++;
        } else {
          console.log(`   ⚠️  Session ID exists (${payment.session_id}) but session not found in database`);
          stuckWithSession++;
        }

        // Also check if there are sessions with this payment_id (alternative relationship)
        const { data: sessionsByPaymentId } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time, client_id')
          .eq('payment_id', payment.id);
        
        if (sessionsByPaymentId && sessionsByPaymentId.length > 0) {
          console.log(`   ⚠️  Also found ${sessionsByPaymentId.length} session(s) linked via payment_id:`);
          sessionsByPaymentId.forEach(s => {
            console.log(`      - Session ${s.id}: ${s.status} (${s.scheduled_date || 'N/A'})`);
          });
          if (!session) {
            stuckWithSession++;
          }
        }
      } else {
        // Check if there are sessions linked via payment_id even though session_id is null
        const { data: sessionsByPaymentId } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time, client_id')
          .eq('payment_id', payment.id);
        
        if (sessionsByPaymentId && sessionsByPaymentId.length > 0) {
          console.log(`   ⚠️  ISSUE: Session WAS created (via payment_id) but payment.session_id is NULL!`);
          sessionsByPaymentId.forEach(s => {
            console.log(`      Session ID: ${s.id}`);
            console.log(`      Session Status: ${s.status}`);
            console.log(`      Session Date: ${s.scheduled_date || 'N/A'} ${s.scheduled_time || ''}`);
          });
          stuckWithSession++;
        } else {
          console.log(`   ⚠️  No session created yet`);
          stuckWithoutSession++;
        }
      }

      // Check client and psychologist info
      if (payment.client_id) {
        const { data: client } = await supabaseAdmin
          .from('clients')
          .select('first_name, last_name, phone_number')
          .eq('id', payment.client_id)
          .single();
        if (client) {
          console.log(`   Client: ${client.first_name} ${client.last_name} (${client.phone_number || 'N/A'})`);
        }
      }

      if (payment.psychologist_id) {
        const { data: psychologist } = await supabaseAdmin
          .from('psychologists')
          .select('first_name, last_name, email')
          .eq('id', payment.psychologist_id)
          .single();
        if (psychologist) {
          console.log(`   Psychologist: ${psychologist.first_name} ${psychologist.last_name}`);
        }
      }

      console.log(`   ${'-'.repeat(98)}`);
    }

    console.log(`\n\n📈 Summary:`);
    console.log(`   Total Pending Payments: ${pendingPayments.length}`);
    console.log(`   ⚠️  Stuck with Session Created: ${stuckWithSession} (PAYMENT STATUS NOT UPDATED)`);
    console.log(`   ⚠️  Stuck without Session: ${stuckWithoutSession} (WEBHOOK NOT RECEIVED OR PAYMENT ABANDONED)`);

    // Group by age
    const recent = pendingPayments.filter(p => {
      const age = (now - new Date(p.created_at)) / (1000 * 60);
      return age < 60; // Less than 1 hour
    });
    const old = pendingPayments.filter(p => {
      const age = (now - new Date(p.created_at)) / (1000 * 60);
      return age >= 1440; // 24 hours or more
    });

    console.log(`\n   By Age:`);
    console.log(`   - Recent (< 1 hour): ${recent.length}`);
    console.log(`   - Old (≥ 24 hours): ${old.length}`);

    if (stuckWithSession > 0) {
      console.log(`\n⚠️  RECOMMENDATION: ${stuckWithSession} payment(s) have sessions but status is stuck on pending.`);
      console.log(`   These payments should be updated to 'success' status.`);
      console.log(`   This is likely a webhook processing issue where the session was created but payment status wasn't updated.`);
    }

    if (stuckWithoutSession > 0 && old.length > 0) {
      console.log(`\n⚠️  RECOMMENDATION: ${old.length} payment(s) are older than 24 hours without sessions.`);
      console.log(`   These are likely abandoned payments and should be reviewed.`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the check
checkPendingPayments();

