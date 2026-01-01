const { supabaseAdmin } = require('../config/supabase');

/**
 * Commission Calculation Service
 * Automatically calculates commission, company revenue, and GST when sessions are completed
 */

/**
 * Calculate and record commission for a completed session
 * @param {string} sessionId - Session ID
 * @param {Object} sessionData - Session data (optional, will fetch if not provided)
 * @returns {Promise<Object>} Commission calculation result
 */
async function calculateAndRecordCommission(sessionId, sessionData = null) {
  try {
    // Fetch session data if not provided
    let session = sessionData;
    if (!session) {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error || !data) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      session = data;
    }

    // Only calculate for completed sessions
    if (session.status !== 'completed') {
      console.log(`⏭️  Skipping commission calculation for session ${sessionId} - status: ${session.status}`);
      return null;
    }

    // Check if payment exists and is successful (for paid sessions)
    // Free sessions (price = 0) don't need payment check
    const sessionAmount = parseFloat(session.price) || 0;
    if (sessionAmount > 0 && session.payment_id) {
      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('status')
        .eq('id', session.payment_id)
        .single();

      if (!payment || payment.status !== 'success') {
        console.log(`⏭️  Skipping commission calculation for session ${sessionId} - payment not successful`);
        return null;
      }
    }

    const psychologistId = session.psychologist_id;

    // Check if commission already calculated
    const { data: existingCommission } = await supabaseAdmin
      .from('commission_history')
      .select('id')
      .eq('session_id', sessionId)
      .single();

    if (existingCommission) {
      console.log(`⏭️  Commission already calculated for session ${sessionId}`);
      return existingCommission;
    }

    // Determine session type
    const sessionType = session.package_id || session.session_type === 'Package Session' ? 'package' : 'individual';

    // Get doctor's commission (fixed amount per session type)
    const { data: commissionRecord } = await supabaseAdmin
      .from('doctor_commissions')
      .select('commission_amount_individual, commission_amount_package, commission_percentage, commission_amounts')
      .eq('psychologist_id', psychologistId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    // Get fixed commission amount based on session type
    let commissionAmount = 0;
    
    if (commissionRecord) {
      // Get package type if it's a package session
      let packageType = 'individual';
      if (sessionType === 'package' && session.package_id) {
        // Fetch package to get its type
        const { data: packageData } = await supabaseAdmin
          .from('packages')
          .select('package_type')
          .eq('id', session.package_id)
          .single();
        
        if (packageData && packageData.package_type) {
          packageType = packageData.package_type;
        } else {
          packageType = 'package'; // Fallback to generic package
        }
      }

      // Use JSONB commission_amounts if available
      if (commissionRecord.commission_amounts && typeof commissionRecord.commission_amounts === 'object') {
        commissionAmount = parseFloat(commissionRecord.commission_amounts[packageType] || 0);
      } else {
        // Fallback to legacy columns
        if (sessionType === 'package' && commissionRecord.commission_amount_package !== null) {
          commissionAmount = parseFloat(commissionRecord.commission_amount_package) || 0;
        } else if (sessionType === 'individual' && commissionRecord.commission_amount_individual !== null) {
          commissionAmount = parseFloat(commissionRecord.commission_amount_individual) || 0;
        } else if (commissionRecord.commission_percentage && parseFloat(commissionRecord.commission_percentage) > 0) {
          // Fallback to percentage if fixed amount not set
          const commissionPercentage = parseFloat(commissionRecord.commission_percentage);
          commissionAmount = (sessionAmount * commissionPercentage) / 100;
        }
      }
    }

    // If no commission record exists, default to 0 (company keeps all)
    // This ensures sessions can still be completed even without commission setup

    // Commission calculation (Fixed Amount System):
    // commissionAmount = fixed amount (e.g., ₹300) = what COMPANY gets as commission
    // doctorWalletAmount = sessionAmount - commissionAmount (e.g., ₹1000 - ₹300 = ₹700) = what DOCTOR gets
    const doctorWalletAmount = Math.max(0, sessionAmount - commissionAmount);
    const companyCommission = commissionAmount; // Company gets this fixed commission amount

    // Get GST settings
    const { data: gstSettings } = await supabaseAdmin
      .from('gst_settings')
      .select('healthcare_gst_rate, default_gst_rate')
      .limit(1)
      .single();

    // Determine GST rate (healthcare services typically 5% or 12%)
    // GST is calculated on the company commission amount
    const gstRate = parseFloat(gstSettings?.healthcare_gst_rate || 5);
    const gstAmount = (companyCommission * gstRate) / 100;
    const netCompanyRevenue = companyCommission - gstAmount;

    // Create commission history record
    // commission_amount = fixed commission amount = what COMPANY gets (e.g., ₹300)
    // company_revenue = commission_amount (what company receives as commission)
    // Note: doctor_wallet = session_amount - commission_amount (calculated, not stored)
    const { data: commissionHistoryRecord, error: commissionError } = await supabaseAdmin
      .from('commission_history')
      .insert([{
        psychologist_id: psychologistId,
        session_id: sessionId,
        session_type: sessionType,
        session_date: session.scheduled_date,
        session_amount: sessionAmount,
        commission_percentage: 0, // Not used in fixed amount system
        commission_amount: commissionAmount, // Fixed commission = what COMPANY gets (e.g., ₹300)
        commission_amount_fixed: commissionAmount, // Store fixed amount
        company_revenue: companyCommission, // Company gets this commission amount
        gst_amount: gstAmount,
        net_company_revenue: netCompanyRevenue,
        payment_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (commissionError) {
      console.error('Error creating commission record:', commissionError);
      throw commissionError;
    }

    // Create GST record (GST is calculated on company commission)
    await supabaseAdmin
      .from('gst_records')
      .insert([{
        record_type: 'session',
        record_id: sessionId,
        transaction_date: session.scheduled_date,
        amount: companyCommission, // GST base is the company commission
        gst_rate: gstRate,
        gst_amount: gstAmount,
        cgst: gstAmount / 2, // Split GST (assuming intra-state)
        sgst: gstAmount / 2,
        hsn_sac_code: '999311', // Medical services SAC code
        is_input_tax: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .catch(err => {
        console.error('Error creating GST record:', err);
        // Don't throw - GST record is secondary
      });

    console.log(`✅ Commission calculated for session ${sessionId}:`);
    console.log(`   Session type: ${sessionType}`);
    console.log(`   Session amount: ₹${sessionAmount.toFixed(2)}`);
    console.log(`   Company commission (fixed): ₹${commissionAmount.toFixed(2)}`);
    console.log(`   Doctor wallet: ₹${doctorWalletAmount.toFixed(2)}`);
    console.log(`   GST: ₹${gstAmount.toFixed(2)} (${gstRate}%)`);
    console.log(`   Net company revenue: ₹${netCompanyRevenue.toFixed(2)}`);

    return commissionHistoryRecord;

  } catch (error) {
    console.error('Error calculating commission:', error);
    throw error;
  }
}

/**
 * Recalculate commission for a session (if needed)
 * @param {string} sessionId - Session ID
 */
async function recalculateCommission(sessionId) {
  try {
    // Delete existing commission and GST records
    await supabaseAdmin
      .from('commission_history')
      .delete()
      .eq('session_id', sessionId);

    await supabaseAdmin
      .from('gst_records')
      .delete()
      .eq('record_id', sessionId)
      .eq('record_type', 'session');

    // Recalculate
    return await calculateAndRecordCommission(sessionId);
  } catch (error) {
    console.error('Error recalculating commission:', error);
    throw error;
  }
}

/**
 * Calculate commission for multiple sessions (batch processing)
 * @param {Array<string>} sessionIds - Array of session IDs
 */
async function calculateCommissionsBatch(sessionIds) {
  const results = [];
  for (const sessionId of sessionIds) {
    try {
      const result = await calculateAndRecordCommission(sessionId);
      results.push({ sessionId, success: true, data: result });
    } catch (error) {
      results.push({ sessionId, success: false, error: error.message });
    }
  }
  return results;
}

module.exports = {
  calculateAndRecordCommission,
  recalculateCommission,
  calculateCommissionsBatch
};

