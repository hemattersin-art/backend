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
    
    // Check if this is the first session in the package (for packages) or first session overall (for individual)
    const clientId = session.client_id;
    let isFirstSessionInPackage = false;
    let isFirstSessionOverall = true;
    
    if (sessionType === 'package' && session.package_id) {
      // For packages: Commission is only added ONCE when ALL sessions in the package are completed
      // Check if all sessions in this package are completed
      const { data: packageData } = await supabaseAdmin
        .from('packages')
        .select('session_count')
        .eq('id', session.package_id)
        .single();
      
      const totalSessions = packageData?.session_count || 0;
      
      // Get all sessions for this package
      const { data: packageSessions } = await supabaseAdmin
        .from('sessions')
        .select('id, status')
        .eq('package_id', session.package_id)
        .eq('client_id', clientId);
      
      // Count completed sessions (including current session)
      const completedSessions = packageSessions?.filter(s => 
        s.status === 'completed' || s.id === sessionId
      ).length || 0;
      
      // Check if commission has already been added for this package
      const { data: existingCommission } = await supabaseAdmin
        .from('commission_history')
        .select('id')
        .eq('psychologist_id', psychologistId)
        .eq('package_id', session.package_id)
        .maybeSingle();
      
      // Only add commission if:
      // 1. All sessions are completed (completedSessions === totalSessions)
      // 2. Commission hasn't been added yet (no existing commission record)
      if (completedSessions < totalSessions) {
        console.log(`⏭️  Skipping commission calculation for session ${sessionId} - package ${session.package_id} not fully completed (${completedSessions}/${totalSessions} sessions)`);
        return null;
      }
      
      if (existingCommission) {
        console.log(`⏭️  Skipping commission calculation for session ${sessionId} - commission already added for package ${session.package_id}`);
        return null;
      }
      
      // All sessions completed and commission not yet added - proceed with calculation
      // Check if this is the client's FIRST package/session ever (new client) or FOLLOW-UP (existing client)
      // For packages: Use First Session Commission if new client, Follow-up Commission if existing client
      
      // Check if client has any previous completed sessions (individual or package)
      const { data: previousSessions } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('client_id', clientId)
        .neq('id', sessionId)
        .neq('session_type', 'free_assessment')
        .eq('status', 'completed')
        .limit(1);
      
      // Also check if client has any previous packages (even if not all sessions completed)
      const { data: previousPackages } = await supabaseAdmin
        .from('client_packages')
        .select('id')
        .eq('client_id', clientId)
        .neq('package_id', session.package_id)
        .limit(1);
      
      // If client has NO previous completed sessions AND NO previous packages, this is a NEW client
      const isNewClient = (!previousSessions || previousSessions.length === 0) && 
                          (!previousPackages || previousPackages.length === 0);
      
      isFirstSessionInPackage = isNewClient; // Use First Session Commission for new clients, Follow-up for existing
    } else {
      // For individual sessions: Check if this is the client's first paid session overall
      if (clientId) {
        const { data: previousSessions } = await supabaseAdmin
          .from('sessions')
          .select('id, price, payment_id, session_type, scheduled_date, created_at')
          .eq('client_id', clientId)
          .neq('id', sessionId)
          .neq('session_type', 'free_assessment')
          .gt('price', 0)
          .order('created_at', { ascending: true })
          .limit(1);
        
        if (previousSessions && previousSessions.length > 0) {
          isFirstSessionOverall = false;
        }
      }
    }
    
    // Use the appropriate flag based on session type
    const isFirstSession = sessionType === 'package' ? isFirstSessionInPackage : isFirstSessionOverall;

    // Get doctor's commission (fixed amount per session type) including first/follow-up fields
    const { data: commissionRecord } = await supabaseAdmin
      .from('doctor_commissions')
      .select('commission_amount_individual, commission_amount_package, commission_percentage, commission_amounts, doctor_commission_first_session, doctor_commission_followup, doctor_commission_individual, doctor_commission_first_session_package, doctor_commission_followup_package, doctor_commission_packages')
      .eq('psychologist_id', psychologistId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    // Get fixed commission amount based on session type
    let commissionAmount = 0;
    let packageType = 'individual';
    
    if (commissionRecord) {
      // Get package type if it's a package session
      let packageSessionCount = null;
      if (sessionType === 'package' && session.package_id) {
        // Fetch package to get its type and session count
        const { data: packageData } = await supabaseAdmin
          .from('packages')
          .select('package_type, session_count')
          .eq('id', session.package_id)
          .single();
        
        if (packageData) {
          if (packageData.package_type) {
            packageType = packageData.package_type;
          } else {
            packageType = 'package'; // Fallback to generic package
          }
          packageSessionCount = packageData.session_count || null;
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

    // Apply first session vs follow-up session logic:
    // - First session: Use first session commission if set, otherwise use regular commission
    // - Follow-up session: Use follow-up commission if set, otherwise use 2x commission (for backward compatibility)
    let finalCommissionAmount = commissionAmount;
    
    if (sessionType === 'individual') {
      // Individual session logic
      if (isFirstSession) {
        // First session: use doctor_commission_first_session if set, otherwise use regular commission
        if (commissionRecord?.doctor_commission_first_session !== null && commissionRecord?.doctor_commission_first_session !== undefined) {
          // doctor_commission_first_session is what doctor gets, so company gets: sessionAmount - doctor_commission
          const doctorCommissionFirst = parseFloat(commissionRecord.doctor_commission_first_session) || 0;
          finalCommissionAmount = Math.max(0, sessionAmount - doctorCommissionFirst);
        } else {
          // Fallback to regular commission amount
          finalCommissionAmount = commissionAmount;
        }
      } else {
        // Follow-up session: use doctor_commission_followup if set, otherwise use 2x commission (backward compatibility)
        if (commissionRecord?.doctor_commission_followup !== null && commissionRecord?.doctor_commission_followup !== undefined) {
          // doctor_commission_followup is what doctor gets, so company gets: sessionAmount - doctor_commission
          const doctorCommissionFollowup = parseFloat(commissionRecord.doctor_commission_followup) || 0;
          finalCommissionAmount = Math.max(0, sessionAmount - doctorCommissionFollowup);
        } else {
          // Fallback to 2x commission (backward compatibility)
          finalCommissionAmount = commissionAmount * 2;
        }
      }
    } else {
      // Package session logic
      // IMPORTANT: For packages, commission is added ONCE when ALL sessions in the package are completed
      // - NEW CLIENT (first package): Use First Session Commission (ONE TIME for whole package)
      // - EXISTING CLIENT (follow-up package): Use Follow-up Commission (ONE TIME for whole package)
      
      const doctorCommissionPackages = commissionRecord?.doctor_commission_packages || {};
      let doctorCommissionAmount = null; // Use null to distinguish between "not set" and "set to 0"
      
      if (isFirstSessionInPackage) {
        // NEW CLIENT: Use First Session Commission (ONE TIME for entire package)
        const packageFirstSessionKey = `${packageType}_first_session`;
        console.log(`🔍 Looking for first session commission with key: ${packageFirstSessionKey}`);
        console.log(`   doctor_commission_packages:`, JSON.stringify(doctorCommissionPackages));
        
        if (doctorCommissionPackages[packageFirstSessionKey] !== null && doctorCommissionPackages[packageFirstSessionKey] !== undefined) {
          doctorCommissionAmount = parseFloat(doctorCommissionPackages[packageFirstSessionKey]) || 0;
          console.log(`✅ Found in doctor_commission_packages: ₹${doctorCommissionAmount}`);
        } else if (commissionRecord?.doctor_commission_first_session_package !== null && commissionRecord?.doctor_commission_first_session_package !== undefined) {
          doctorCommissionAmount = parseFloat(commissionRecord.doctor_commission_first_session_package) || 0;
          console.log(`✅ Found in legacy field doctor_commission_first_session_package: ₹${doctorCommissionAmount}`);
        } else {
          console.log(`⚠️ First session commission NOT FOUND for package type: ${packageType}`);
        }
      } else {
        // EXISTING CLIENT: Use Follow-up Commission (ONE TIME for entire package)
        const packageFollowupKey = `${packageType}_followup`;
        console.log(`🔍 Looking for follow-up commission with key: ${packageFollowupKey}`);
        console.log(`   doctor_commission_packages:`, JSON.stringify(doctorCommissionPackages));
        
        if (doctorCommissionPackages[packageFollowupKey] !== null && doctorCommissionPackages[packageFollowupKey] !== undefined) {
          doctorCommissionAmount = parseFloat(doctorCommissionPackages[packageFollowupKey]) || 0;
          console.log(`✅ Found in doctor_commission_packages: ₹${doctorCommissionAmount}`);
        } else if (commissionRecord?.doctor_commission_followup_package !== null && commissionRecord?.doctor_commission_followup_package !== undefined) {
          doctorCommissionAmount = parseFloat(commissionRecord.doctor_commission_followup_package) || 0;
          console.log(`✅ Found in legacy field doctor_commission_followup_package: ₹${doctorCommissionAmount}`);
        } else {
          console.log(`⚠️ Follow-up commission NOT FOUND for package type: ${packageType}`);
        }
      }
      
      // If doctor commission is not found, throw an error - we should not proceed
      if (doctorCommissionAmount === null) {
        throw new Error(`Doctor commission not configured for ${isFirstSessionInPackage ? 'first session' : 'follow-up'} package type: ${packageType}. Please set commission in finance dashboard.`);
      }
      
      // Get total package amount from packages table (this is the actual package price)
      // Fallback to summing session prices if package price not available
      let totalPackageAmount = sessionAmount;
      
      // First, try to get package price from packages table
      const { data: packageData } = await supabaseAdmin
        .from('packages')
        .select('price')
        .eq('id', session.package_id)
        .single();
      
      if (packageData?.price) {
        totalPackageAmount = parseFloat(packageData.price) || 0;
        console.log(`📦 Package price from packages table: ₹${totalPackageAmount}`);
      } else {
        // Fallback: sum all session prices in the package
        const { data: allPackageSessions } = await supabaseAdmin
          .from('sessions')
          .select('price')
          .eq('package_id', session.package_id)
          .eq('client_id', clientId);
        
        totalPackageAmount = allPackageSessions?.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0) || sessionAmount;
        console.log(`📦 Package price from summing sessions: ₹${totalPackageAmount}`);
      }
      
      console.log(`💰 Package Commission Calculation:`);
      console.log(`   Total Package Amount: ₹${totalPackageAmount}`);
      console.log(`   Doctor Commission: ₹${doctorCommissionAmount}`);
      console.log(`   Company Commission: ₹${totalPackageAmount - doctorCommissionAmount}`);
      console.log(`   Doctor Wallet: ₹${doctorCommissionAmount}`);
      
      // Company commission = Total package amount - Doctor commission (ONE TIME for whole package)
      finalCommissionAmount = Math.max(0, totalPackageAmount - doctorCommissionAmount);
      
      // Update sessionAmount to total package amount for commission history
      sessionAmount = totalPackageAmount;
    }

    // Commission calculation (Fixed Amount System):
    // finalCommissionAmount = commission amount based on first/follow-up = what COMPANY gets as commission
    // doctorWalletAmount = sessionAmount - finalCommissionAmount = what DOCTOR gets
    const doctorWalletAmount = Math.max(0, sessionAmount - finalCommissionAmount);
    const companyCommission = finalCommissionAmount; // Company gets this commission amount

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
    // commission_amount = final commission amount (first session = 1x, follow-up = 2x) = what COMPANY gets
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
        commission_amount: finalCommissionAmount, // Final commission (1x for first, 2x for follow-up) = what COMPANY gets
        commission_amount_fixed: commissionAmount, // Store base fixed amount (before first/follow-up multiplier)
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
    console.log(`   Session order: ${isFirstSession ? 'First Session' : 'Follow-up Session'}`);
    console.log(`   Session amount: ₹${sessionAmount.toFixed(2)}`);
    console.log(`   Base commission: ₹${commissionAmount.toFixed(2)}`);
    if (sessionType === 'individual') {
      if (isFirstSession && commissionRecord?.doctor_commission_first_session !== null && commissionRecord?.doctor_commission_first_session !== undefined) {
        console.log(`   Using first session doctor commission (individual): ₹${parseFloat(commissionRecord.doctor_commission_first_session).toFixed(2)}`);
      } else if (!isFirstSession && commissionRecord?.doctor_commission_followup !== null && commissionRecord?.doctor_commission_followup !== undefined) {
        console.log(`   Using follow-up doctor commission (individual): ₹${parseFloat(commissionRecord.doctor_commission_followup).toFixed(2)}`);
      }
    } else {
      if (isFirstSession && commissionRecord?.doctor_commission_first_session_package !== null && commissionRecord?.doctor_commission_first_session_package !== undefined) {
        console.log(`   Using first session doctor commission (package): ₹${parseFloat(commissionRecord.doctor_commission_first_session_package).toFixed(2)}`);
      } else if (!isFirstSession && commissionRecord?.doctor_commission_followup_package !== null && commissionRecord?.doctor_commission_followup_package !== undefined) {
        console.log(`   Using follow-up doctor commission (package): ₹${parseFloat(commissionRecord.doctor_commission_followup_package).toFixed(2)}`);
      }
    }
    console.log(`   Final company commission: ₹${finalCommissionAmount.toFixed(2)}`);
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

