/**
 * Script to list all successful payments
 * Shows payment details, associated sessions, and statistics
 */

require('dotenv').config();
const supabaseConfig = require('../config/supabase');
const supabaseAdmin = supabaseConfig.supabaseAdmin;

async function listSuccessfulPayments() {
  try {
    console.log('🔍 Fetching successful payments...\n');

    // Get all successful payments with related data
    const { data: successfulPayments, error: paymentsError } = await supabaseAdmin
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
      .eq('status', 'success')
      .order('created_at', { ascending: false });

    if (paymentsError) {
      console.error('❌ Error fetching successful payments:', paymentsError);
      return;
    }

    if (!successfulPayments || successfulPayments.length === 0) {
      console.log('✅ No successful payments found!');
      return;
    }

    console.log(`📊 Found ${successfulPayments.length} successful payments:\n`);
    console.log('='.repeat(120));

    let totalAmount = 0;
    let withSession = 0;
    let withoutSession = 0;
    const now = new Date();

    // Get client and psychologist details in batches
    const clientIds = [...new Set(successfulPayments.map(p => p.client_id).filter(Boolean))];
    const psychologistIds = [...new Set(successfulPayments.map(p => p.psychologist_id).filter(Boolean))];

    const { data: clients } = await supabaseAdmin
      .from('clients')
      .select('id, first_name, last_name, phone_number')
      .in('id', clientIds);

    const { data: psychologists } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .in('id', psychologistIds);

    const clientMap = new Map(clients?.map(c => [c.id, c]) || []);
    const psychologistMap = new Map(psychologists?.map(p => [p.id, p]) || []);

    for (const payment of successfulPayments) {
      totalAmount += parseFloat(payment.amount || 0);

      const createdAt = new Date(payment.created_at);
      const completedAt = payment.completed_at ? new Date(payment.completed_at) : null;
      const processingTime = completedAt ? Math.floor((completedAt - createdAt) / 1000) : null;

      console.log(`\n💰 Payment ID: ${payment.id}`);
      console.log(`   Transaction ID: ${payment.transaction_id || 'N/A'}`);
      console.log(`   Razorpay Order ID: ${payment.razorpay_order_id || 'N/A'}`);
      console.log(`   Razorpay Payment ID: ${payment.razorpay_payment_id || 'N/A'}`);
      console.log(`   Amount: ₹${payment.amount || 0}`);
      console.log(`   Status: ${payment.status}`);
      console.log(`   Created: ${payment.created_at}`);
      if (completedAt) {
        console.log(`   Completed: ${payment.completed_at} (${processingTime}s processing time)`);
      }

      // Check if session exists
      if (payment.session_id) {
        const { data: session } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time, client_id')
          .eq('id', payment.session_id)
          .single();
        
        if (session) {
          console.log(`   ✅ Session Created: ${session.id}`);
          console.log(`      Session Status: ${session.status}`);
          console.log(`      Session Date: ${session.scheduled_date || 'N/A'} ${session.scheduled_time || ''}`);
          withSession++;
        } else {
          console.log(`   ⚠️  Session ID exists (${payment.session_id}) but session not found in database`);
          withoutSession++;
        }
      } else {
        // Check if there are sessions linked via payment_id
        const { data: sessionsByPaymentId } = await supabaseAdmin
          .from('sessions')
          .select('id, status, scheduled_date, scheduled_time, client_id')
          .eq('payment_id', payment.id);
        
        if (sessionsByPaymentId && sessionsByPaymentId.length > 0) {
          console.log(`   ✅ ${sessionsByPaymentId.length} Session(s) Created (via payment_id):`);
          sessionsByPaymentId.forEach((s, idx) => {
            console.log(`      Session ${idx + 1}: ${s.id} - ${s.status} (${s.scheduled_date || 'N/A'} ${s.scheduled_time || ''})`);
          });
          withSession++;
        } else {
          console.log(`   ⚠️  No session linked to this payment`);
          withoutSession++;
        }
      }

      // Client info
      if (payment.client_id) {
        const client = clientMap.get(payment.client_id);
        if (client) {
          console.log(`   Client: ${client.first_name} ${client.last_name} (${client.phone_number || 'N/A'})`);
        }
      }

      // Psychologist info
      if (payment.psychologist_id) {
        const psychologist = psychologistMap.get(payment.psychologist_id);
        if (psychologist) {
          console.log(`   Psychologist: ${psychologist.first_name} ${psychologist.last_name}`);
        }
      }

      console.log(`   ${'-'.repeat(118)}`);
    }

    // Calculate statistics
    const oldest = successfulPayments[successfulPayments.length - 1];
    const newest = successfulPayments[0];
    const oldestDate = new Date(oldest.created_at);
    const newestDate = new Date(newest.created_at);
    const daysSpan = Math.floor((newestDate - oldestDate) / (1000 * 60 * 60 * 24));

    // Group by date
    const paymentsByDate = {};
    successfulPayments.forEach(p => {
      const date = new Date(p.created_at).toISOString().split('T')[0];
      paymentsByDate[date] = (paymentsByDate[date] || 0) + 1;
    });

    // Group by amount
    const paymentsByAmount = {};
    successfulPayments.forEach(p => {
      const amount = p.amount || 0;
      paymentsByAmount[amount] = (paymentsByAmount[amount] || 0) + 1;
    });

    console.log(`\n\n📈 Summary:`);
    console.log(`   Total Successful Payments: ${successfulPayments.length}`);
    console.log(`   Total Revenue: ₹${totalAmount.toFixed(2)}`);
    console.log(`   Average Payment: ₹${(totalAmount / successfulPayments.length).toFixed(2)}`);
    console.log(`   ✅ With Session: ${withSession}`);
    console.log(`   ⚠️  Without Session: ${withoutSession}`);
    console.log(`   Date Range: ${oldestDate.toISOString().split('T')[0]} to ${newestDate.toISOString().split('T')[0]} (${daysSpan} days)`);

    console.log(`\n   Payment Distribution by Amount:`);
    Object.entries(paymentsByAmount)
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .forEach(([amount, count]) => {
        const percentage = ((count / successfulPayments.length) * 100).toFixed(1);
        console.log(`      ₹${amount}: ${count} payments (${percentage}%)`);
      });

    console.log(`\n   Recent Activity (Last 7 days):`);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentPayments = successfulPayments.filter(p => new Date(p.created_at) >= sevenDaysAgo);
    console.log(`      Last 7 days: ${recentPayments.length} payments`);
    const recentAmount = recentPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    console.log(`      Last 7 days revenue: ₹${recentAmount.toFixed(2)}`);

    // Show breakdown by date (last 10 days)
    console.log(`\n   Payment Activity by Date (Last 10 Days):`);
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const recentPaymentsByDate = {};
    successfulPayments
      .filter(p => new Date(p.created_at) >= tenDaysAgo)
      .forEach(p => {
        const date = new Date(p.created_at).toISOString().split('T')[0];
        recentPaymentsByDate[date] = (recentPaymentsByDate[date] || 0) + 1;
      });
    
    Object.entries(recentPaymentsByDate)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10)
      .forEach(([date, count]) => {
        console.log(`      ${date}: ${count} payment(s)`);
      });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the check
listSuccessfulPayments();

