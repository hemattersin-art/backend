const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');
const auditLogger = require('../utils/auditLogger');

/**
 * Finance Controller
 * Handles all finance-related operations with security protection
 */

// ============================================
// DASHBOARD & OVERVIEW
// ============================================

/**
 * Get Finance Dashboard Data
 * GET /api/finance/dashboard
 */
const getDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Security: Only finance, admin, superadmin can access
    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { dateFrom, dateTo } = req.query;
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfQuarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    // Calculate date ranges
    const mtdFrom = dateFrom || startOfMonth.toISOString().split('T')[0];
    const mtdTo = dateTo || today.toISOString().split('T')[0];
    const qtdFrom = startOfQuarter.toISOString().split('T')[0];
    const qtdTo = today.toISOString().split('T')[0];
    const ytdFrom = startOfYear.toISOString().split('T')[0];
    const ytdTo = today.toISOString().split('T')[0];

    // Get revenue data - include all sessions where payment was made (exclude free assessments)
    // Statuses where payment exists: booked, completed, rescheduled, reschedule_requested, no_show, cancelled
    // Fetch all sessions (no date filter) - filter in calculation function
    let sessionsData = [];
    try {
      const { data: sessions, error: sessionsError } = await supabaseAdmin
        .from('sessions')
        .select('id, scheduled_date, price, psychologist_id, status, payment_id, session_type')
        .in('status', ['completed', 'booked', 'rescheduled', 'reschedule_requested', 'no_show', 'noshow', 'cancelled', 'canceled'])
        .neq('session_type', 'free_assessment');

      if (sessionsError) {
        console.error('Error fetching sessions:', sessionsError);
        sessionsData = [];
      } else {
        sessionsData = sessions || [];
      }
    } catch (err) {
      console.error('Exception fetching sessions:', err);
      sessionsData = [];
    }

    // Calculate revenue metrics
    // Include all sessions where payment was made (regardless of final status)
    // Statuses: completed, booked, rescheduled, reschedule_requested, no_show, cancelled
    const calculateRevenue = (sessions, fromDate, toDate) => {
      if (!sessions || !Array.isArray(sessions)) {
        return { total: 0, count: 0, sessions: [] };
      }
      const filtered = sessions.filter(s => {
        if (!s || !s.scheduled_date) return false;
        const date = s.scheduled_date;
        if (date < fromDate || date > toDate) return false;
        
        // Include all statuses where payment was made (these sessions exist only after successful payment)
        const paidStatuses = ['completed', 'booked', 'rescheduled', 'reschedule_requested', 'no_show', 'noshow', 'cancelled', 'canceled'];
        return paidStatuses.includes(s.status);
      });
      const total = filtered.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
      return {
        total,
        count: filtered.length,
        sessions: filtered
      };
    };

    const mtdRevenue = calculateRevenue(sessionsData, mtdFrom, mtdTo);
    const qtdRevenue = calculateRevenue(sessionsData, qtdFrom, qtdTo);
    const ytdRevenue = calculateRevenue(sessionsData, ytdFrom, ytdTo);
    
    // For header summary, use revenue calculated from commission section (matches doctors page exactly)
    // This will be calculated below in the commission calculation section

    // Get expenses (handle table not existing)
    let expensesData = [];
    try {
      const { data: expenses, error: expensesError } = await supabaseAdmin
        .from('expenses')
        .select('*')
        .eq('approval_status', 'approved')
        .gte('date', ytdFrom);

      if (expensesError) {
        console.error('Error fetching expenses:', expensesError);
        // If table doesn't exist, continue with empty array
        if (expensesError.code === '42P01') {
          console.log('Expenses table does not exist yet, using empty data');
        }
        expensesData = [];
      } else {
        expensesData = expenses || [];
      }
    } catch (err) {
      console.error('Exception fetching expenses:', err);
      expensesData = [];
    }

    const calculateExpenses = (expenses, fromDate, toDate) => {
      if (!expenses || !Array.isArray(expenses)) {
        return 0;
      }
      const filtered = expenses.filter(e => {
        if (!e || !e.date) return false;
        const date = e.date;
        return date >= fromDate && date <= toDate;
      });
      return filtered.reduce((sum, e) => sum + (parseFloat(e.total_amount) || 0), 0);
    };

    const mtdExpenses = calculateExpenses(expensesData, mtdFrom, mtdTo);
    const qtdExpenses = calculateExpenses(expensesData, qtdFrom, qtdTo);
    const ytdExpenses = calculateExpenses(expensesData, ytdFrom, ytdTo);

    // Calculate profits
    const mtdProfit = mtdRevenue.total - mtdExpenses;
    const qtdProfit = qtdRevenue.total - qtdExpenses;
    const ytdProfit = ytdRevenue.total - ytdExpenses;

    // Get pending payments (check payments table instead)
    let pendingPayments = 0;
    try {
      const { data: pendingPaymentsData } = await supabaseAdmin
        .from('payments')
        .select('amount')
        .eq('status', 'pending');

      pendingPayments = pendingPaymentsData?.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0) || 0;
    } catch (err) {
      console.error('Exception fetching pending payments:', err);
      pendingPayments = 0;
    }

    // Get pending commission (handle table not existing)
    let totalPendingCommission = 0;
    try {
      const { data: pendingCommission, error: commissionError } = await supabaseAdmin
        .from('commission_history')
        .select('commission_amount')
        .eq('payment_status', 'pending');

      if (!commissionError && pendingCommission) {
        totalPendingCommission = pendingCommission.reduce((sum, c) => sum + (parseFloat(c.commission_amount) || 0), 0);
      }
    } catch (err) {
      console.error('Exception fetching commission:', err);
      totalPendingCommission = 0;
    }

    // Get GST payable (handle table not existing)
    let gstPayable = 0;
    try {
      const { data: gstRecords, error: gstError } = await supabaseAdmin
        .from('gst_records')
        .select('gst_amount, is_input_tax')
        .gte('transaction_date', mtdFrom)
        .lte('transaction_date', mtdTo);

      if (!gstError && gstRecords) {
        const gstCollected = gstRecords.filter(g => !g.is_input_tax).reduce((sum, g) => sum + (parseFloat(g.gst_amount) || 0), 0);
        const gstInput = gstRecords.filter(g => g.is_input_tax).reduce((sum, g) => sum + (parseFloat(g.gst_amount) || 0), 0);
        gstPayable = gstCollected - gstInput;
      }
    } catch (err) {
      console.error('Exception fetching GST records:', err);
      gstPayable = 0;
    }

    // Get active sessions count
    const { data: activeSessions } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .in('status', ['booked'])
      .gte('scheduled_date', today.toISOString().split('T')[0]);

    // Get total sessions count (all time) - exclude free assessments
    let totalSessions = 0;
    try {
      const { count: totalSessionsCount } = await supabaseAdmin
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .neq('session_type', 'free_assessment');
      totalSessions = totalSessionsCount || 0;
    } catch (err) {
      console.error('Error fetching total sessions:', err);
      totalSessions = 0;
    }

    // Get active doctors count (psychologists with at least one session) - exclude free assessments
    let activeDoctors = 0;
    try {
      const { data: activeDoctorsData } = await supabaseAdmin
        .from('sessions')
        .select('psychologist_id')
        .not('psychologist_id', 'is', null)
        .neq('session_type', 'free_assessment');
      
      if (activeDoctorsData && activeDoctorsData.length > 0) {
        const uniqueDoctors = new Set(activeDoctorsData.map(s => s.psychologist_id).filter(Boolean));
        activeDoctors = uniqueDoctors.size;
      }
    } catch (err) {
      console.error('Error fetching active doctors:', err);
      activeDoctors = 0;
    }

    // Get GST collected (output tax)
    let gstCollected = 0;
    try {
      const { data: gstData } = await supabaseAdmin
        .from('gst_records')
        .select('gst_amount, is_input_tax')
        .eq('is_input_tax', false);
      
      if (gstData) {
        gstCollected = gstData.reduce((sum, g) => sum + (parseFloat(g.gst_amount) || 0), 0);
      }
    } catch (err) {
      console.error('Error fetching GST collected:', err);
      gstCollected = 0;
    }

    // Get total commission paid
    let commissionPaid = 0;
    try {
      const { data: commissionData } = await supabaseAdmin
        .from('commission_history')
        .select('commission_amount')
        .eq('payment_status', 'paid');
      
      if (commissionData) {
        commissionPaid = commissionData.reduce((sum, c) => sum + (parseFloat(c.commission_amount) || 0), 0);
      }
    } catch (err) {
      console.error('Error fetching commission paid:', err);
      commissionPaid = 0;
    }

    // Calculate growth rates
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const lastMonthRevenue = calculateRevenue(sessionsData, lastMonth.toISOString().split('T')[0], lastMonthEnd.toISOString().split('T')[0]);
    const revenueGrowthMoM = lastMonthRevenue.total > 0 
      ? ((mtdRevenue.total - lastMonthRevenue.total) / lastMonthRevenue.total * 100).toFixed(2)
      : 0;

    const lastYear = new Date(today.getFullYear() - 1, 0, 1);
    const lastYearEnd = new Date(today.getFullYear() - 1, 11, 31);
    const lastYearRevenue = calculateRevenue(sessionsData, lastYear.toISOString().split('T')[0], lastYearEnd.toISOString().split('T')[0]);
    const revenueGrowthYoY = lastYearRevenue.total > 0
      ? ((ytdRevenue.total - lastYearRevenue.total) / lastYearRevenue.total * 100).toFixed(2)
      : 0;

    // Helper function to check if session should be included in revenue
    // Include all statuses where payment was made (sessions exist only after successful payment)
    const shouldIncludeInRevenue = (s) => {
      if (!s) return false;
      const paidStatuses = ['completed', 'booked', 'rescheduled', 'reschedule_requested', 'no_show', 'noshow', 'cancelled', 'canceled'];
      return paidStatuses.includes(s.status);
    };

    // Get revenue by session type
    const individualSessions = sessionsData.filter(shouldIncludeInRevenue);
    const revenueByType = {
      individual: individualSessions.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0),
      package: 0 // Will be calculated from package sessions
    };

    // Get top 5 doctors by revenue
    const doctorRevenue = {};
    sessionsData.filter(shouldIncludeInRevenue).forEach(s => {
      if (s.psychologist_id) {
        if (!doctorRevenue[s.psychologist_id]) {
          doctorRevenue[s.psychologist_id] = { revenue: 0, session_count: 0 };
        }
        doctorRevenue[s.psychologist_id].revenue += parseFloat(s.price) || 0;
        doctorRevenue[s.psychologist_id].session_count += 1;
      }
    });

    const topDoctors = Object.entries(doctorRevenue)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([id, data]) => ({ psychologist_id: id, total_commission: data.revenue, session_count: data.session_count }));

    // Get all unique psychologist IDs for both top doctors and recent sessions
    const allPsychologistIds = [...new Set([
      ...topDoctors.map(d => d.psychologist_id),
      ...sessionsData.slice(0, 10).map(s => s?.psychologist_id).filter(Boolean)
    ])];
    
    // Get all unique client IDs for recent sessions
    const allClientIds = [...new Set(sessionsData.slice(0, 10).map(s => s?.client_id).filter(Boolean))];

    let allPsychologists = [];
    let allClients = [];
    
    if (allPsychologistIds.length > 0) {
      const { data: psychologists } = await supabaseAdmin
        .from('psychologists')
        .select('id, first_name, last_name')
        .in('id', allPsychologistIds);
      allPsychologists = psychologists || [];
    }
    
    if (allClientIds.length > 0) {
      const { data: clients } = await supabaseAdmin
        .from('clients')
        .select('id, first_name, last_name')
        .in('id', allClientIds);
      allClients = clients || [];
    }

    // Get doctor names for top doctors
    let topDoctorsWithNames = [];
    if (topDoctors.length > 0) {
      topDoctorsWithNames = topDoctors.map(d => {
        const psych = allPsychologists.find(p => p.id === d.psychologist_id);
        return {
          ...d,
          first_name: psych?.first_name || 'Unknown',
          last_name: psych?.last_name || '',
          psychologist: psych ? { first_name: psych.first_name, last_name: psych.last_name } : null
        };
      });
    }

    // Get expense breakdown
    const expenseByCategory = {};
    expensesData.forEach(e => {
      if (e && e.category) {
        if (!expenseByCategory[e.category]) {
          expenseByCategory[e.category] = 0;
        }
        expenseByCategory[e.category] += parseFloat(e.total_amount) || 0;
      }
    });

    // Calculate monthly revenue for charts (last 12 months)
    const monthlyRevenueData = [];
    const monthlyExpensesData = [];
    const monthlyCommissionData = [];
    const monthlyDoctorWalletData = [];
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthNum = date.getMonth() + 1;
      const monthKey = `${date.getFullYear()}-${monthNum < 10 ? '0' : ''}${monthNum}`;
      const monthName = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const monthStart = `${monthKey}-01`;
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
      
      const monthRevenue = calculateRevenue(sessionsData, monthStart, monthEnd);
      const monthExpenses = expensesData
        .filter(e => e && e.date && e.date >= monthStart && e.date <= monthEnd)
        .reduce((sum, e) => sum + (parseFloat(e.total_amount) || 0), 0);
      
      // Get commission data for this month
      let monthCommission = 0;
      let monthDoctorWallet = 0;
      try {
        const { data: monthCommissions } = await supabaseAdmin
          .from('commission_history')
          .select('commission_amount, session_amount')
          .gte('session_date', monthStart)
          .lte('session_date', monthEnd);
        
        if (monthCommissions) {
          monthCommission = monthCommissions.reduce((sum, c) => sum + (parseFloat(c.commission_amount) || 0), 0);
          monthDoctorWallet = monthCommissions.reduce((sum, c) => {
            const sessionAmount = parseFloat(c.session_amount || 0);
            const commissionAmount = parseFloat(c.commission_amount || 0);
            return sum + (sessionAmount - commissionAmount);
          }, 0);
        }
      } catch (err) {
        // Ignore errors
      }
      
      monthlyRevenueData.push({ month: monthName, revenue: monthRevenue.total });
      monthlyExpensesData.push({ month: monthName, expenses: monthExpenses });
      monthlyCommissionData.push({ month: monthName, commission: monthCommission });
      monthlyDoctorWalletData.push({ month: monthName, wallet: monthDoctorWallet });
    }

    // Calculate commission breakdown - simple: use same logic as doctors page and sum all totals
    let totalCompanyCommission = 0;
    let totalDoctorWallet = 0;
    let totalRevenueFromSessions = 0; // Calculate total revenue from all sessions
    
    try {
      // Get all psychologists (exclude assessment specialist)
      const assessmentPsychId = process.env.ASSESSMENT_PSYCHOLOGIST_ID || '00000000-0000-0000-0000-000000000000';
      const { data: psychologists } = await supabaseAdmin
        .from('psychologists')
        .select('id')
        .neq('id', assessmentPsychId);
      
      const allPsychIds = psychologists?.map(p => p.id).filter(Boolean) || [];
      
      if (allPsychIds.length > 0) {
        // Get all sessions (same as doctors page) - include all paid statuses
        const { data: allSessions } = await supabaseAdmin
          .from('sessions')
          .select('id, psychologist_id, session_type, package_id, price, scheduled_date, status, payment_id')
          .not('psychologist_id', 'is', null)
          .neq('session_type', 'free_assessment')
          .in('status', ['booked', 'completed', 'rescheduled', 'reschedule_requested', 'no_show', 'noshow', 'cancelled', 'canceled'])
          .in('psychologist_id', allPsychIds);
        
        // Get commission settings (same as doctors page)
        const { data: commissions } = await supabaseAdmin
          .from('doctor_commissions')
          .select('psychologist_id, commission_amounts, commission_amount_individual, commission_amount_package')
          .eq('is_active', true)
          .in('psychologist_id', allPsychIds)
          .order('effective_from', { ascending: false });
        
        // Build commission amounts map
        const commissionAmountsMap = {};
        const seenPsychIds = new Set();
        commissions?.forEach(c => {
          if (c.psychologist_id && !seenPsychIds.has(c.psychologist_id)) {
            seenPsychIds.add(c.psychologist_id);
            if (c.commission_amounts && typeof c.commission_amounts === 'object') {
              commissionAmountsMap[c.psychologist_id] = c.commission_amounts;
            } else {
              commissionAmountsMap[c.psychologist_id] = {
                individual: parseFloat(c.commission_amount_individual || 0),
                package: parseFloat(c.commission_amount_package || 0)
              };
            }
          }
        });
        
        // Get packages (need full package data for packagePricesMap)
        const { data: packages } = await supabaseAdmin
          .from('packages')
          .select('id, psychologist_id, package_type, name, price, session_count')
          .in('psychologist_id', allPsychIds);
        
        const packageTypeMap = {};
        const packagePricesMap = {};
        packages?.forEach(pkg => {
          packageTypeMap[pkg.id] = pkg.package_type || 'package';
          if (!packagePricesMap[pkg.psychologist_id]) {
            packagePricesMap[pkg.psychologist_id] = [];
          }
          packagePricesMap[pkg.psychologist_id].push({
            id: pkg.id,
            type: pkg.package_type,
            name: pkg.name || `${pkg.session_count} Session Package`,
            price: parseFloat(pkg.price) || 0,
            session_count: pkg.session_count || 1
          });
        });
        
        // Get commission history
        const sessionIds = allSessions?.map(s => s.id).filter(Boolean) || [];
        let commissionHistory = [];
        if (sessionIds.length > 0) {
          const { data: history } = await supabaseAdmin
            .from('commission_history')
            .select('session_id, commission_amount, session_amount')
            .in('session_id', sessionIds);
          commissionHistory = history || [];
        }
        
        const commissionHistoryMap = {};
        commissionHistory?.forEach(ch => {
          if (ch.session_id) {
            commissionHistoryMap[ch.session_id] = ch;
          }
        });
        
        // Calculate totals - exact same logic as doctors page
        allSessions?.forEach(s => {
          if (!s.psychologist_id) return;
          
          const sessionPrice = parseFloat(s.price) || 0;
          const historyRecord = commissionHistoryMap[s.id];
          
          let commissionToCompany = 0;
          let toDoctorWallet = sessionPrice;
          
          if (historyRecord) {
            // Completed - use commission_history
            const commissionAmount = parseFloat(historyRecord.commission_amount || 0);
            const sessionAmount = parseFloat(historyRecord.session_amount || sessionPrice);
            commissionToCompany = commissionAmount;
            toDoctorWallet = sessionAmount - commissionAmount;
          } else {
            // Booked/Non-completed - calculate from commission settings
            const commissionAmounts = commissionAmountsMap[s.psychologist_id];
            const isPackage = s.package_id && s.package_id !== 'null' && s.package_id !== 'undefined' && s.package_id !== 'individual' ||
                             s.session_type === 'Package Session' || 
                             (s.session_type && s.session_type.toLowerCase().includes('package'));
            
            let commissionAmount = 0;
            if (isPackage && s.package_id) {
              // Package session - need to find package to get type
              const pkg = packagePricesMap[s.psychologist_id]?.find(p => p.id === s.package_id);
              const packageType = pkg?.type || packageTypeMap[s.package_id] || 'package';
              commissionAmount = parseFloat(commissionAmounts?.[packageType] || commissionAmounts?.package || 0);
            } else {
              // Individual session
              commissionAmount = parseFloat(commissionAmounts?.individual || 0);
            }
            
            commissionToCompany = commissionAmount;
            toDoctorWallet = sessionPrice - commissionAmount;
          }
          
          totalCompanyCommission += commissionToCompany;
          totalDoctorWallet += toDoctorWallet;
          totalRevenueFromSessions += sessionPrice; // Sum all session prices for total revenue
        });
      }
    } catch (err) {
      console.error('Error calculating commission totals:', err);
    }

    // Audit log (non-blocking)
    auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_DASHBOARD_VIEWED',
      resource: 'finance_dashboard',
      endpoint: '/api/finance/dashboard',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error (non-blocking):', err));

    // Profit = Total company commission (what company gets from commissions)
    // Total Revenue = Sum of all session prices
    // Profit = Total company commission (company's share from commissions)
    // Doctor Wallet = Total amount doctors get
    
    res.json(successResponse({
      summary: {
        total_revenue: totalRevenueFromSessions, // Sum of all session prices
        net_profit: totalCompanyCommission, // Profit = Total company commission (what company gets)
        total_expenses: ytdExpenses,
        pending_payouts: totalPendingCommission,
        total_sessions: totalSessions,
        active_doctors: activeDoctors,
        gst_collected: gstCollected,
        commission_paid: commissionPaid,
        total_company_commission: totalCompanyCommission,
        total_doctor_wallet: totalDoctorWallet,
        revenue_change: revenueGrowthMoM ? `${revenueGrowthMoM > 0 ? '+' : ''}${revenueGrowthMoM}%` : null,
        revenue_change_type: parseFloat(revenueGrowthMoM) >= 0 ? 'increase' : 'decrease',
        profit_change: revenueGrowthMoM ? `${revenueGrowthMoM > 0 ? '+' : ''}${revenueGrowthMoM}%` : null,
        profit_change_type: parseFloat(revenueGrowthMoM) >= 0 ? 'increase' : 'decrease',
        expenses_change: null,
        expenses_change_type: null
      },
      metrics: {
        revenue: {
          mtd: mtdRevenue.total,
          qtd: qtdRevenue.total,
          ytd: ytdRevenue.total,
          growthMoM: parseFloat(revenueGrowthMoM),
          growthYoY: parseFloat(revenueGrowthYoY)
        },
        expenses: {
          mtd: mtdExpenses,
          qtd: qtdExpenses,
          ytd: ytdExpenses
        },
        profit: {
          mtd: mtdProfit,
          qtd: qtdProfit,
          ytd: ytdProfit
        },
        pendingPayments,
        pendingCommission: totalPendingCommission,
        gstPayable,
        activeSessions: activeSessions?.length || 0
      },
      charts: {
        topDoctors: topDoctorsWithNames,
        revenueByType,
        expenseByCategory: Object.entries(expenseByCategory).map(([category, amount]) => ({
          category,
          amount
        })),
        monthlyRevenue: monthlyRevenueData,
        monthlyExpenses: monthlyExpensesData,
        monthlyCommission: monthlyCommissionData,
        monthlyDoctorWallet: monthlyDoctorWalletData,
        commissionBreakdown: {
          company: totalCompanyCommission,
          doctor: totalDoctorWallet
        }
      },
      recent_sessions: sessionsData.slice(0, 10).map(s => {
        if (!s) return null;
        const psych = allPsychologists.find(p => p.id === s.psychologist_id);
        const client = allClients.find(c => c.id === s.client_id);
        return {
          id: s.id,
          session_date: s.scheduled_date,
          amount: s.price,
          status: s.status,
          psychologist: psych ? {
            id: psych.id,
            first_name: psych.first_name,
            last_name: psych.last_name
          } : null,
          client: client ? {
            id: client.id,
            first_name: client.first_name,
            last_name: client.last_name
          } : null
        };
      }).filter(Boolean),
      top_doctors: topDoctorsWithNames,
      monthly_revenue: monthlyRevenueData
    }, 'Dashboard data fetched successfully'));

  } catch (error) {
    console.error('Finance dashboard error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching dashboard data')
    );
  }
};

// ============================================
// SESSIONS MANAGEMENT
// ============================================

/**
 * Get All Sessions with Filters
 * GET /api/finance/sessions
 */
const getSessions = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      dateFrom,
      dateTo,
      psychologistId,
      sessionType,
      status,
      page = 1,
      limit = 50,
      search
    } = req.query;

    // First, get sessions with payment status filter
    // Exclude free assessments and only include sessions with successful payments
    // Get all sessions first, then filter by payment status
    let query = supabaseAdmin
      .from('sessions')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        price,
        status,
        payment_id,
        psychologist_id,
        client_id,
        session_type
      `, { count: 'exact' })
      .neq('session_type', 'free_assessment') // Exclude free assessments
      .not('payment_id', 'is', null); // Only sessions with payment_id

    // Apply filters
    if (dateFrom) {
      query = query.gte('scheduled_date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('scheduled_date', dateTo);
    }
    if (psychologistId) {
      query = query.eq('psychologist_id', psychologistId);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      // Search in client name or session ID
      query = query.or(`id.ilike.%${search}%`);
    }

    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);
    query = query.order('scheduled_date', { ascending: false });

    const { data: sessions, error, count } = await query;

    if (error) {
      console.error('Error fetching sessions:', error);
      // Return empty result instead of throwing
      return res.json(successResponse({
        sessions: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          totalPages: 0
        }
      }, 'Sessions fetched successfully (empty)'));
    }

    // Ensure sessions is an array
    const sessionsData = sessions || [];

    // Filter by successful payment status (paid, success, completed, cash)
    // Get payment IDs and check their status
    const paymentIds = [...new Set(sessionsData.map(s => s.payment_id).filter(Boolean))];
    let successfulPaymentIds = [];
    
    if (paymentIds.length > 0) {
      const { data: payments, error: paymentError } = await supabaseAdmin
        .from('payments')
        .select('id, status')
        .in('id', paymentIds)
        .in('status', ['paid', 'success', 'completed', 'cash']); // Only successful payments
      
      if (!paymentError && payments) {
        successfulPaymentIds = payments.map(p => p.id);
      }
    }

    // Filter sessions to only include those with successful payments
    const sessionsWithSuccessfulPayments = sessionsData.filter(s => 
      s.payment_id && successfulPaymentIds.includes(s.payment_id)
    );

    // Get commission data for each session
    const sessionIds = sessionsWithSuccessfulPayments.map(s => s?.id).filter(Boolean);
    let commissions = [];
    
    if (sessionIds.length > 0) {
      const { data: commissionData, error: commissionError } = await supabaseAdmin
        .from('commission_history')
        .select('session_id, commission_amount, company_revenue, net_company_revenue')
        .in('session_id', sessionIds);
      
      if (!commissionError && commissionData) {
        commissions = commissionData;
      }
    }

    // Get psychologist and client details separately
    const psychologistIds = [...new Set(sessionsData.map(s => s?.psychologist_id).filter(Boolean))];
    const clientIds = [...new Set(sessionsData.map(s => s?.client_id).filter(Boolean))];
    
    let psychologists = [];
    let clients = [];
    
    if (psychologistIds.length > 0) {
      const { data: psychData } = await supabaseAdmin
        .from('psychologists')
        .select('id, first_name, last_name')
        .in('id', psychologistIds);
      psychologists = psychData || [];
    }
    
    if (clientIds.length > 0) {
      const { data: clientData } = await supabaseAdmin
        .from('clients')
        .select('id, first_name, last_name, child_name')
        .in('id', clientIds);
      clients = clientData || [];
    }

    const sessionsWithCommission = sessionsWithSuccessfulPayments.map(session => {
      if (!session) return null;
      const commission = commissions.find(c => c.session_id === session.id);
      const psychologist = psychologists.find(p => p.id === session.psychologist_id);
      const client = clients.find(c => c.id === session.client_id);
      
      return {
        ...session,
        // Map backend fields to frontend expected fields
        session_date: session.scheduled_date,
        amount: session.price,
        session_type: session.session_type || 'Individual', // Default to Individual if not set
        psychologist: psychologist ? {
          id: psychologist.id,
          first_name: psychologist.first_name,
          last_name: psychologist.last_name
        } : null,
        client: client ? {
          id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          child_name: client.child_name
        } : null,
        commission_amount: commission?.commission_amount || 0,
        company_revenue: commission?.company_revenue || 0,
        net_company_revenue: commission?.net_company_revenue || 0
      };
    }).filter(Boolean);

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_SESSIONS_VIEWED',
      resource: 'sessions',
      endpoint: '/api/finance/sessions',
      method: 'GET',
      details: { filters: req.query },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      sessions: sessionsWithCommission || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit))
      }
    }, 'Sessions fetched successfully'));

  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching sessions')
    );
  }
};

/**
 * Get Session Details
 * GET /api/finance/sessions/:sessionId
 */
const getSessionDetails = async (req, res) => {
  try {
    const userRole = req.user.role;
    const { sessionId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    // Get session with related data
    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        psychologist:psychologists(*),
        client:clients(*)
      `)
      .eq('id', sessionId)
      .single();

    if (error || !session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Get complete payment details
    let paymentDetails = null;
    if (session.payment_id) {
      const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', session.payment_id)
        .single();
      
      if (!paymentError && payment) {
        // Extract payment method from payment record or Razorpay response
        let paymentMethod = payment.payment_method;
        
        // If payment_method is not stored, try to extract from razorpay_response
        if (!paymentMethod && payment.razorpay_response) {
          const razorpayResponse = typeof payment.razorpay_response === 'string' 
            ? JSON.parse(payment.razorpay_response) 
            : payment.razorpay_response;
          
          // Razorpay stores method in payment.entity.method
          if (razorpayResponse.payment?.entity?.method) {
            paymentMethod = razorpayResponse.payment.entity.method;
          } else if (razorpayResponse.method) {
            paymentMethod = razorpayResponse.method;
          } else if (razorpayResponse.razorpay_payment_id) {
            // If there's a payment ID but no method, it's an online payment
            paymentMethod = 'online';
          }
        }
        
        // Map Razorpay method names to readable format
        let paymentMethodDisplay = paymentMethod;
        if (paymentMethod && paymentMethod !== 'cash') {
          const methodMap = {
            'netbanking': 'Net Banking',
            'card': 'Card Payment',
            'credit_card': 'Card Payment',
            'debit_card': 'Card Payment',
            'upi': 'UPI Payment',
            'wallet': 'Wallet Payment',
            'online': 'Online Payment'
          };
          paymentMethodDisplay = methodMap[paymentMethod.toLowerCase()] || 'Online Payment';
        } else if (paymentMethod === 'cash') {
          paymentMethodDisplay = 'Cash Payment';
        }
        
        paymentDetails = {
          id: payment.id,
          transaction_id: payment.transaction_id,
          razorpay_order_id: payment.razorpay_order_id,
          razorpay_payment_id: payment.razorpay_payment_id,
          amount: payment.amount,
          currency: payment.currency || 'INR',
          status: payment.status,
          payment_method: paymentMethodDisplay || paymentMethod || 'Online Payment',
          payment_date: payment.completed_at || payment.created_at,
          receipt_url: payment.receipt_url,
          reference_number: payment.reference_number,
          notes: payment.notes,
          razorpay_params: payment.razorpay_params
        };
      }
    }

    // Get receipt details if available
    let receiptDetails = null;
    if (paymentDetails?.transaction_id) {
      const { data: receipt, error: receiptError } = await supabaseAdmin
        .from('receipts')
        .select('*')
        .eq('transaction_id', paymentDetails.transaction_id)
        .maybeSingle();
      
      if (!receiptError && receipt) {
        receiptDetails = {
          receipt_number: receipt.receipt_number,
          receipt_number_long: receipt.receipt_number_long,
          receipt_url: receipt.receipt_url,
          file_path: receipt.file_path,
          file_url: receipt.file_url,
          created_at: receipt.created_at
        };
      }
    }

    // Get commission data
    const { data: commission } = await supabaseAdmin
      .from('commission_history')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    // Get GST data
    const { data: gst } = await supabaseAdmin
      .from('gst_records')
      .select('*')
      .eq('record_id', sessionId)
      .eq('record_type', 'session')
      .single();

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_SESSION_DETAILS_VIEWED',
      resource: 'sessions',
      resourceId: sessionId,
      endpoint: `/api/finance/sessions/${sessionId}`,
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      session: {
        id: session.id,
        session_date: session.scheduled_date,
        session_time: session.scheduled_time,
        status: session.status,
        session_type: session.session_type,
        price: session.price,
        package_id: session.package_id,
        created_at: session.created_at,
        updated_at: session.updated_at,
        psychologist: session.psychologist ? {
          id: session.psychologist.id,
          first_name: session.psychologist.first_name,
          last_name: session.psychologist.last_name,
          email: session.psychologist.email,
          phone: session.psychologist.phone,
          cover_image_url: session.psychologist.cover_image_url,
          specialization: session.psychologist.specialization,
          experience_years: session.psychologist.experience_years
        } : null,
        client: session.client ? {
          id: session.client.id,
          first_name: session.client.first_name,
          last_name: session.client.last_name,
          child_name: session.client.child_name,
          phone_number: session.client.phone_number,
          email: session.client.user?.email || null,
          date_of_birth: session.client.date_of_birth,
          gender: session.client.gender
        } : null,
        payment: paymentDetails,
        receipt: receiptDetails,
        commission: commission || null,
        gst: gst || null
      }
    }, 'Session details fetched successfully'));

  } catch (error) {
    console.error('Get session details error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching session details')
    );
  }
};

// ============================================
// REVENUE MANAGEMENT
// ============================================

/**
 * Get Revenue Summary
 * GET /api/finance/revenue
 */
const getRevenue = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { dateFrom, dateTo, psychologistId, sessionType } = req.query;

    // Get sessions with commission data
    // Exclude free assessments
    let query = supabaseAdmin
      .from('sessions')
      .select(`
        id,
        scheduled_date,
        price,
        psychologist_id,
        status,
        session_type,
        psychologist:psychologists(id, first_name, last_name)
      `)
      .eq('status', 'completed')
      .neq('session_type', 'free_assessment');

    if (dateFrom) query = query.gte('scheduled_date', dateFrom);
    if (dateTo) query = query.lte('scheduled_date', dateTo);
    if (psychologistId) query = query.eq('psychologist_id', psychologistId);

    const { data: sessions, error } = await query;

    if (error) throw error;

    // Get commission data
    const sessionIds = sessions?.map(s => s.id) || [];
    const { data: commissions } = await supabaseAdmin
      .from('commission_history')
      .select('session_id, commission_amount, company_revenue, net_company_revenue, gst_amount')
      .in('session_id', sessionIds);

    // Calculate totals
    const totalRevenue = sessions?.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0) || 0;
    const totalCommission = commissions?.reduce((sum, c) => sum + (parseFloat(c.commission_amount) || 0), 0) || 0;
    const totalCompanyRevenue = commissions?.reduce((sum, c) => sum + (parseFloat(c.company_revenue) || 0), 0) || 0;
    const totalGST = commissions?.reduce((sum, c) => sum + (parseFloat(c.gst_amount) || 0), 0) || 0;
    const totalNetRevenue = commissions?.reduce((sum, c) => sum + (parseFloat(c.net_company_revenue) || 0), 0) || 0;

    // Revenue by doctor
    const revenueByDoctor = {};
    sessions?.forEach(s => {
      const commission = commissions?.find(c => c.session_id === s.id);
      if (!revenueByDoctor[s.psychologist_id]) {
        revenueByDoctor[s.psychologist_id] = {
          id: s.psychologist_id,
          psychologist_id: s.psychologist_id,
          first_name: s.psychologist?.first_name || 'Unknown',
          last_name: s.psychologist?.last_name || '',
          revenue: 0,
          session_count: 0
        };
      }
      revenueByDoctor[s.psychologist_id].revenue += parseFloat(s.price) || 0;
      revenueByDoctor[s.psychologist_id].session_count += 1;
    });

    // Revenue by session type
    const revenueByType = {};
    sessions?.forEach(s => {
      const sessionType = s.session_type || 'Individual';
      if (!revenueByType[sessionType]) {
        revenueByType[sessionType] = {
          session_type: sessionType,
          revenue: 0,
          session_count: 0
        };
      }
      revenueByType[sessionType].revenue += parseFloat(s.price) || 0;
      revenueByType[sessionType].session_count += 1;
    });

    // Monthly breakdown
    const monthlyBreakdown = {};
    sessions?.forEach(s => {
      if (s.scheduled_date) {
        const monthKey = s.scheduled_date.substring(0, 7); // YYYY-MM
        const dateObj = new Date(s.scheduled_date + 'T00:00:00');
        const monthName = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (!monthlyBreakdown[monthKey]) {
          monthlyBreakdown[monthKey] = {
            month: monthName,
            monthKey: monthKey,
            revenue: 0
          };
        }
        monthlyBreakdown[monthKey].revenue += parseFloat(s.price) || 0;
      }
    });

    // Sort monthly breakdown by monthKey (chronologically)
    const sortedMonthlyBreakdown = Object.values(monthlyBreakdown).sort((a, b) => {
      return a.monthKey.localeCompare(b.monthKey);
    });

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_REVENUE_VIEWED',
      resource: 'revenue',
      endpoint: '/api/finance/revenue',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      total_revenue: totalRevenue,
      net_revenue: totalNetRevenue,
      total_sessions: sessions?.length || 0,
      monthly_breakdown: sortedMonthlyBreakdown,
      by_doctor: Object.values(revenueByDoctor),
      by_session_type: Object.values(revenueByType)
    }, 'Revenue data fetched successfully'));

  } catch (error) {
    console.error('Get revenue error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching revenue data')
    );
  }
};

// ============================================
// EXPENSE MANAGEMENT
// ============================================

/**
 * Get Expenses
 * GET /api/finance/expenses
 */
const getExpenses = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { dateFrom, dateTo, category, approvalStatus, page = 1, limit = 50 } = req.query;

    let query = supabaseAdmin
      .from('expenses')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false });

    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    if (category) query = query.eq('category', category);
    if (approvalStatus) query = query.eq('approval_status', approvalStatus);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: expenses, error, count } = await query;

    if (error) throw error;

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_EXPENSES_VIEWED',
      resource: 'expenses',
      endpoint: '/api/finance/expenses',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      expenses: expenses || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit))
      }
    }, 'Expenses fetched successfully'));

  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching expenses')
    );
  }
};

/**
 * Create Expense
 * POST /api/finance/expenses
 */
const createExpense = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      date,
      category,
      description,
      amount,
      gst_amount = 0,
      payment_method,
      vendor_supplier,
      receipt_url,
      is_recurring = false,
      recurring_frequency
    } = req.body;

    if (!date || !category || !amount) {
      return res.status(400).json(
        errorResponse('Date, category, and amount are required')
      );
    }

    const total_amount = parseFloat(amount) + parseFloat(gst_amount);

    const { data: expense, error } = await supabaseAdmin
      .from('expenses')
      .insert([{
        date,
        category,
        description,
        amount: parseFloat(amount),
        gst_amount: parseFloat(gst_amount),
        total_amount,
        payment_method,
        vendor_supplier,
        receipt_url,
        is_recurring,
        recurring_frequency,
        approval_status: 'pending',
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_EXPENSE_CREATED',
      resource: 'expenses',
      resourceId: expense.id,
      endpoint: '/api/finance/expenses',
      method: 'POST',
      details: { amount, category },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.status(201).json(
      successResponse(expense, 'Expense created successfully')
    );

  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating expense')
    );
  }
};

/**
 * Approve Expense
 * POST /api/finance/expenses/:expenseId/approve
 */
const approveExpense = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { expenseId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { data: expense, error: fetchError } = await supabaseAdmin
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .single();

    if (fetchError || !expense) {
      return res.status(404).json(
        errorResponse('Expense not found')
      );
    }

    const { data: updatedExpense, error } = await supabaseAdmin
      .from('expenses')
      .update({
        approval_status: 'approved',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', expenseId)
      .select()
      .single();

    if (error) throw error;

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_EXPENSE_APPROVED',
      resource: 'expenses',
      resourceId: expenseId,
      endpoint: `/api/finance/expenses/${expenseId}/approve`,
      method: 'POST',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(updatedExpense, 'Expense approved successfully')
    );

  } catch (error) {
    console.error('Approve expense error:', error);
    res.status(500).json(
      errorResponse('Internal server error while approving expense')
    );
  }
};

/**
 * Update Expense
 * PUT /api/finance/expenses/:expenseId
 */
const updateExpense = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { expenseId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      date,
      category,
      description,
      amount,
      gst_amount,
      payment_method,
      vendor_supplier,
      receipt_url,
      reference_number,
      notes,
      is_recurring,
      recurring_frequency
    } = req.body;

    // Check if expense exists
    const { data: existingExpense, error: checkError } = await supabaseAdmin
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .single();

    if (checkError || !existingExpense) {
      return res.status(404).json(
        errorResponse('Expense not found')
      );
    }

    // Build update data
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (date) updateData.date = date;
    if (category) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (amount !== undefined) {
      updateData.amount = parseFloat(amount);
      // Recalculate total_amount if amount or gst_amount changed
      const gst = gst_amount !== undefined ? parseFloat(gst_amount) : (existingExpense.gst_amount || 0);
      updateData.total_amount = parseFloat(amount) + gst;
    }
    if (gst_amount !== undefined) {
      updateData.gst_amount = parseFloat(gst_amount);
      // Recalculate total_amount
      const amt = amount !== undefined ? parseFloat(amount) : (existingExpense.amount || 0);
      updateData.total_amount = amt + parseFloat(gst_amount);
    }
    if (payment_method !== undefined) updateData.payment_method = payment_method;
    if (vendor_supplier !== undefined) updateData.vendor_supplier = vendor_supplier;
    if (receipt_url !== undefined) updateData.receipt_url = receipt_url;
    if (reference_number !== undefined) updateData.reference_number = reference_number;
    if (notes !== undefined) updateData.notes = notes;
    if (is_recurring !== undefined) updateData.is_recurring = is_recurring;
    if (recurring_frequency !== undefined) updateData.recurring_frequency = recurring_frequency;

    const { data: updatedExpense, error } = await supabaseAdmin
      .from('expenses')
      .update(updateData)
      .eq('id', expenseId)
      .select()
      .single();

    if (error) {
      console.error('Error updating expense:', error);
      throw error;
    }

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_EXPENSE_UPDATED',
      resource: 'expenses',
      resourceId: expenseId,
      endpoint: `/api/finance/expenses/${expenseId}`,
      method: 'PUT',
      details: { amount: updatedExpense.amount, category: updatedExpense.category },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(updatedExpense, 'Expense updated successfully')
    );

  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating expense')
    );
  }
};

/**
 * Delete Expense
 * DELETE /api/finance/expenses/:expenseId
 */
const deleteExpense = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { expenseId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    // Check if expense exists
    const { data: existingExpense, error: checkError } = await supabaseAdmin
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .single();

    if (checkError || !existingExpense) {
      return res.status(404).json(
        errorResponse('Expense not found')
      );
    }

    // Delete expense
    const { error } = await supabaseAdmin
      .from('expenses')
      .delete()
      .eq('id', expenseId);

    if (error) {
      console.error('Error deleting expense:', error);
      throw error;
    }

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_EXPENSE_DELETED',
      resource: 'expenses',
      resourceId: expenseId,
      endpoint: `/api/finance/expenses/${expenseId}`,
      method: 'DELETE',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(null, 'Expense deleted successfully')
    );

  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting expense')
    );
  }
};

// ============================================
// COMMISSION MANAGEMENT
// ============================================

/**
 * Get Doctor Commissions
 * GET /api/finance/commissions
 */
const getCommissions = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { psychologistId, month, year } = req.query;

    // Get ALL psychologists (not just those with sessions)
    // Filter out assessment specialist
    const assessmentEmail = (process.env.FREE_ASSESSMENT_PSYCHOLOGIST_EMAIL || 'assessment.koott@gmail.com').toLowerCase();
    
    let psychologists = [];
    try {
      let query = supabaseAdmin
        .from('psychologists')
        .select('id, first_name, last_name, experience_years, email, individual_session_price, cover_image_url')
        .neq('email', assessmentEmail)
        .order('first_name', { ascending: true });

      if (psychologistId) {
        query = query.eq('id', psychologistId);
      }

      const { data: psychData, error: psychError } = await query;
      
      if (psychError) {
        console.error('Error fetching psychologists:', psychError);
        psychologists = [];
      } else {
        psychologists = psychData || [];
      }
    } catch (err) {
      console.error('Exception fetching psychologists:', err);
      psychologists = [];
    }

    const allPsychologistIds = psychologists.map(p => p.id);

    // Get package prices for each psychologist
    const packagePricesMap = {};
    if (allPsychologistIds.length > 0) {
      try {
        const { data: packages } = await supabaseAdmin
          .from('packages')
          .select('id, psychologist_id, package_type, price, session_count, name')
          .in('psychologist_id', allPsychologistIds)
          .neq('package_type', 'individual')
          .order('session_count', { ascending: true });

        packages?.forEach(pkg => {
          if (!packagePricesMap[pkg.psychologist_id]) {
            packagePricesMap[pkg.psychologist_id] = [];
          }
          packagePricesMap[pkg.psychologist_id].push({
            id: pkg.id,
            type: pkg.package_type,
            name: pkg.name || `${pkg.session_count} Session Package`,
            price: parseFloat(pkg.price) || 0,
            session_count: pkg.session_count || 1,
            price_per_session: (parseFloat(pkg.price) || 0) / (pkg.session_count || 1)
          });
        });
      } catch (err) {
        console.error('Error fetching package prices:', err);
      }
    }

    // Get all sessions (booked, completed, rescheduled, etc.) for counts, but commissions only for completed
    let allSessionsQuery = supabaseAdmin
      .from('sessions')
      .select('id, psychologist_id, session_type, package_id, price, scheduled_date, status, payment_id')
      .not('psychologist_id', 'is', null)
      .neq('session_type', 'free_assessment')
      .in('status', ['booked', 'completed', 'rescheduled', 'reschedule_requested', 'no_show', 'noshow', 'cancelled', 'canceled']); // Include all paid sessions

    if (month && year) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
      allSessionsQuery = allSessionsQuery
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate);
    }

    const { data: allSessions } = await allSessionsQuery;

    // Get commission rates for all psychologists
    let commissions = [];
    if (allPsychologistIds.length > 0) {
      try {
        const { data: commissionData, error } = await supabaseAdmin
          .from('doctor_commissions')
          .select('*')
          .eq('is_active', true)
          .in('psychologist_id', allPsychologistIds)
          .order('effective_from', { ascending: false });

        if (error) {
          console.error('Error fetching commissions:', error);
          commissions = [];
        } else {
          commissions = commissionData || [];
        }
      } catch (err) {
        console.error('Exception fetching commissions:', err);
        commissions = [];
      }
    }

    // Build commission amounts map (from JSONB or legacy columns)
    // Only use the most recent commission for each psychologist (first one since ordered by effective_from DESC)
    const commissionAmountsMap = {};
    const seenPsychologistIds = new Set();
    commissions?.forEach(c => {
      if (c.psychologist_id && !seenPsychologistIds.has(c.psychologist_id)) {
        seenPsychologistIds.add(c.psychologist_id);
        
        // Try JSONB first
        if (c.commission_amounts && typeof c.commission_amounts === 'object') {
          commissionAmountsMap[c.psychologist_id] = c.commission_amounts;
        } else {
          // Fallback to legacy columns
          commissionAmountsMap[c.psychologist_id] = {
            individual: c.commission_amount_individual !== null && c.commission_amount_individual !== undefined ? parseFloat(c.commission_amount_individual) : 0,
            package: c.commission_amount_package !== null && c.commission_amount_package !== undefined ? parseFloat(c.commission_amount_package) : 0
          };
        }
      }
    });
    
    // Get commission history for all sessions
    const sessionIds = allSessions?.map(s => s.id).filter(Boolean) || [];
    let commissionHistory = [];
    if (sessionIds.length > 0) {
      const { data: history } = await supabaseAdmin
        .from('commission_history')
        .select('psychologist_id, commission_amount, company_revenue, session_id, session_date, session_amount')
        .in('session_id', sessionIds);
      commissionHistory = history || [];
    }

    // Build commissions map
    const commissionsMap = {};
    commissions?.forEach(c => {
      if (c.psychologist_id) {
        commissionsMap[c.psychologist_id] = c;
      }
    });

    // Build commission history map by session_id
    const commissionHistoryMap = {};
    commissionHistory?.forEach(ch => {
      if (ch.session_id) {
        commissionHistoryMap[ch.session_id] = ch;
      }
    });

    // Calculate average prices from actual sessions
    const averagePricesByPsych = {};
    allSessions?.forEach(s => {
      if (!s.psychologist_id) return;
      
      if (!averagePricesByPsych[s.psychologist_id]) {
        averagePricesByPsych[s.psychologist_id] = {
          individual: { total: 0, count: 0 },
          package: { total: 0, count: 0 }
        };
      }

      const isPackage = s.package_id && s.package_id !== 'null' && s.package_id !== 'undefined' && s.package_id !== 'individual' ||
                       s.session_type === 'Package Session' || 
                       (s.session_type && s.session_type.toLowerCase().includes('package'));
      
      const sessionPrice = parseFloat(s.price) || 0;
      if (isPackage) {
        averagePricesByPsych[s.psychologist_id].package.total += sessionPrice;
        averagePricesByPsych[s.psychologist_id].package.count += 1;
      } else {
        averagePricesByPsych[s.psychologist_id].individual.total += sessionPrice;
        averagePricesByPsych[s.psychologist_id].individual.count += 1;
      }
    });

    // Calculate statistics per psychologist
    const statsByPsych = {};
    
    // Process sessions - use commission_history if available, otherwise calculate
    allSessions?.forEach(s => {
      if (!s.psychologist_id) return;
      
      if (!statsByPsych[s.psychologist_id]) {
        statsByPsych[s.psychologist_id] = {
          individual_sessions: 0,
          package_sessions: 0,
          total_sessions: 0,
          total_revenue: 0,
          total_commission_to_company: 0,
          total_to_doctor_wallet: 0,
          monthly_breakdown: {}
        };
      }

      const isPackage = s.package_id && s.package_id !== 'null' && s.package_id !== 'undefined' && s.package_id !== 'individual' ||
                       s.session_type === 'Package Session' || 
                       (s.session_type && s.session_type.toLowerCase().includes('package'));
      
      // Count all sessions (booked, completed, etc.) for session counts
      if (isPackage) {
        statsByPsych[s.psychologist_id].package_sessions++;
      } else {
        statsByPsych[s.psychologist_id].individual_sessions++;
      }
      statsByPsych[s.psychologist_id].total_sessions++;

      // Calculate revenue and commissions for all sessions
      // For completed sessions: use commission_history if available, otherwise calculate
      // For booked sessions: calculate expected commission based on doctor's commission settings
      const sessionPrice = parseFloat(s.price) || 0;
      const isCompleted = s.status === 'completed';
      const historyRecord = commissionHistoryMap[s.id];
      
      // Calculate commission values (used in both total stats and monthly breakdown)
      let commissionToCompany = 0;
      let toDoctorWallet = sessionPrice;
      
      // If commission history exists (completed session with calculated commission), use it
      if (historyRecord) {
        // commission_amount in history = fixed commission amount = what COMPANY gets (e.g., ₹300)
        // company_revenue in history = commission_amount (same value, for backward compatibility)
        // doctor wallet = session_amount - commission_amount = what DOCTOR gets (e.g., ₹700)
        const commissionAmount = parseFloat(historyRecord.commission_amount || 0);
        const sessionAmount = parseFloat(historyRecord.session_amount || sessionPrice);
        commissionToCompany = commissionAmount; // Company gets the commission (fixed amount)
        toDoctorWallet = sessionAmount - commissionAmount; // Doctor gets the rest
      } else {
        // Simple calculation: Get commission amount, subtract from session price
        const commission = commissionsMap[s.psychologist_id];
        const commissionAmounts = commissionAmountsMap[s.psychologist_id];
        
        let commissionAmount = 0;
        
        if (isPackage && s.package_id) {
          // Package session
          const pkg = packagePricesMap[s.psychologist_id]?.find(p => p.id === s.package_id);
          const packageType = pkg?.type || 'package';
          commissionAmount = parseFloat(commissionAmounts?.[packageType] || commissionAmounts?.package || commission?.commission_amount_package || 0);
        } else {
          // Individual session - simple: get individual commission
          // Check JSONB first, then legacy column
          if (commissionAmounts && commissionAmounts.individual !== undefined && commissionAmounts.individual !== null) {
            commissionAmount = parseFloat(commissionAmounts.individual);
          } else if (commission && commission.commission_amount_individual !== undefined && commission.commission_amount_individual !== null) {
            commissionAmount = parseFloat(commission.commission_amount_individual);
          } else {
            commissionAmount = 0;
          }
        }
        
        // Simple calculation: commission = company, rest = doctor wallet
        commissionToCompany = commissionAmount;
        toDoctorWallet = sessionPrice - commissionAmount;
      }

      // Add to total stats (for all sessions - booked sessions show expected amounts, completed show actual)
      statsByPsych[s.psychologist_id].total_revenue += sessionPrice;
      statsByPsych[s.psychologist_id].total_commission_to_company += commissionToCompany;
      statsByPsych[s.psychologist_id].total_to_doctor_wallet += toDoctorWallet;

      // Monthly breakdown - include all sessions for counts, but revenue/commission only for completed
      if (s.scheduled_date) {
        const monthKey = s.scheduled_date.substring(0, 7); // YYYY-MM
        if (!statsByPsych[s.psychologist_id].monthly_breakdown[monthKey]) {
          statsByPsych[s.psychologist_id].monthly_breakdown[monthKey] = {
            month: monthKey,
            individual_sessions: 0,
            package_sessions: 0,
            total_revenue: 0,
            commission_to_company: 0,
            to_doctor_wallet: 0
          };
        }
        
        // Count all sessions in monthly breakdown
        if (isPackage) {
          statsByPsych[s.psychologist_id].monthly_breakdown[monthKey].package_sessions++;
        } else {
          statsByPsych[s.psychologist_id].monthly_breakdown[monthKey].individual_sessions++;
        }
        
        // Add revenue and commission for all sessions (commission values already calculated above)
        statsByPsych[s.psychologist_id].monthly_breakdown[monthKey].total_revenue += sessionPrice;
        statsByPsych[s.psychologist_id].monthly_breakdown[monthKey].commission_to_company += commissionToCompany;
        statsByPsych[s.psychologist_id].monthly_breakdown[monthKey].to_doctor_wallet += toDoctorWallet;
      }
    });

    // Build final response with all doctors
    const commissionsWithTotals = psychologists?.map(psych => {
      const commission = commissionsMap[psych.id];
      const stats = statsByPsych[psych.id] || {
        individual_sessions: 0,
        package_sessions: 0,
        total_sessions: 0,
        total_revenue: 0,
        total_commission_to_company: 0,
        total_to_doctor_wallet: 0,
        monthly_breakdown: {}
      };

      const avgPrices = averagePricesByPsych[psych.id] || {
        individual: { total: 0, count: 0 },
        package: { total: 0, count: 0 }
      };

      const individualAvgPrice = avgPrices.individual.count > 0 
        ? avgPrices.individual.total / avgPrices.individual.count 
        : 0;
      const packageAvgPrice = avgPrices.package.count > 0 
        ? avgPrices.package.total / avgPrices.package.count 
        : 0;

      // Get commission amounts (from JSONB or legacy columns)
      const commissionAmounts = commissionAmountsMap[psych.id] || {};
      
      // Get packages for this doctor
      const packages = packagePricesMap[psych.id] || [];
      
      // Build commission amounts for each package type
      const packageCommissions = packages.map(pkg => ({
        ...pkg,
        commission_amount: parseFloat(commissionAmounts[pkg.type] || commissionAmounts.package || 0)
      }));

      return {
        psychologist_id: psych.id,
        commission_amounts: commissionAmounts, // Full JSONB object
        commission_amount_individual: commissionAmounts.individual || 0, // For backward compatibility
        commission_amount_package: commissionAmounts.package || 0, // For backward compatibility
        package_commissions: packageCommissions, // Packages with their commission amounts
        individual_sessions: stats.individual_sessions,
        package_sessions: stats.package_sessions,
        total_sessions: stats.total_sessions,
        total_revenue: stats.total_revenue,
        total_commission_to_company: stats.total_commission_to_company,
        total_to_doctor_wallet: stats.total_to_doctor_wallet,
        monthly_breakdown: Object.values(stats.monthly_breakdown).sort((a, b) => 
          b.month.localeCompare(a.month)
        ),
        // Pricing information
        individual_session_price: psych.individual_session_price || 0,
        package_prices: packages,
        average_individual_price: individualAvgPrice,
        average_package_price: packageAvgPrice,
        psychologist: {
          id: psych.id,
          first_name: psych.first_name,
          last_name: psych.last_name,
          email: psych.email,
          experience_years: psych.experience_years,
          cover_image_url: psych.cover_image_url
        }
      };
    }) || [];

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_COMMISSIONS_VIEWED',
      resource: 'commissions',
      endpoint: '/api/finance/commissions',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      commissions: commissionsWithTotals || []
    }, 'Commissions fetched successfully'));

  } catch (error) {
    console.error('Get commissions error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching commissions')
    );
  }
};

/**
 * Update Commission Rate (Fixed Amounts)
 * PUT /api/finance/commissions/:psychologistId
 */
const updateCommissionRate = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { psychologistId } = req.params;
    const { 
      commission_amounts, // New: JSONB object with package types as keys
      commission_amount_individual, // Legacy support
      commission_amount_package, // Legacy support
      effective_from, 
      notes 
    } = req.body;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    // Build commission amounts object
    let commissionAmountsObj = {};
    
    if (commission_amounts && typeof commission_amounts === 'object') {
      // New format: JSONB object
      for (const [packageType, amount] of Object.entries(commission_amounts)) {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 0) {
          return res.status(400).json(
            errorResponse(`Invalid commission amount for ${packageType}: must be ≥ 0`)
          );
        }
        commissionAmountsObj[packageType] = parsedAmount;
      }
    } else {
      // Legacy format: individual and package
      const individualAmount = commission_amount_individual ? parseFloat(commission_amount_individual) : null;
      const packageAmount = commission_amount_package ? parseFloat(commission_amount_package) : null;

      if (individualAmount !== null && (isNaN(individualAmount) || individualAmount < 0)) {
        return res.status(400).json(
          errorResponse('Valid commission amount for individual sessions (≥ 0) is required')
        );
      }

      if (packageAmount !== null && (isNaN(packageAmount) || packageAmount < 0)) {
        return res.status(400).json(
          errorResponse('Valid commission amount for package sessions (≥ 0) is required')
        );
      }

      if (individualAmount === null && packageAmount === null) {
        return res.status(400).json(
          errorResponse('At least one commission amount must be provided')
        );
      }

      if (individualAmount !== null) {
        commissionAmountsObj.individual = individualAmount;
      }
      if (packageAmount !== null) {
        commissionAmountsObj.package = packageAmount;
      }
    }

    if (Object.keys(commissionAmountsObj).length === 0) {
      return res.status(400).json(
        errorResponse('At least one commission amount must be provided')
      );
    }

    // Deactivate old commission record
    await supabaseAdmin
      .from('doctor_commissions')
      .update({ is_active: false, effective_to: new Date().toISOString().split('T')[0] })
      .eq('psychologist_id', psychologistId)
      .eq('is_active', true);

    // Create new commission record with fixed amounts
    const effectiveDate = effective_from || new Date().toISOString().split('T')[0];

    // Check if a record already exists with this psychologist_id and effective_from (even if inactive)
    const { data: existingRecord } = await supabaseAdmin
      .from('doctor_commissions')
      .select('id')
      .eq('psychologist_id', psychologistId)
      .eq('effective_from', effectiveDate)
      .maybeSingle();

    const commissionData = {
      psychologist_id: psychologistId,
      effective_from: effectiveDate,
      is_active: true,
      notes,
      updated_at: new Date().toISOString(),
      commission_amounts: commissionAmountsObj, // Store as JSONB
      commission_percentage: 0 // Keep for backward compatibility
    };

    // Also set legacy columns for backward compatibility
    if (commissionAmountsObj.individual !== undefined) {
      commissionData.commission_amount_individual = commissionAmountsObj.individual;
    }
    if (commissionAmountsObj.package !== undefined) {
      commissionData.commission_amount_package = commissionAmountsObj.package;
    }

    let newCommission;
    let error;

    if (existingRecord && existingRecord.id) {
      // Update existing record
      const { data, error: updateError } = await supabaseAdmin
        .from('doctor_commissions')
        .update(commissionData)
        .eq('id', existingRecord.id)
        .select()
        .single();
      
      newCommission = data;
      error = updateError;
    } else {
      // Create new record
      commissionData.created_by = userId;
      commissionData.created_at = new Date().toISOString();
      
      const { data, error: insertError } = await supabaseAdmin
        .from('doctor_commissions')
        .insert([commissionData])
        .select()
        .single();
      
      newCommission = data;
      error = insertError;
    }

    if (error) throw error;

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_COMMISSION_UPDATED',
      resource: 'commissions',
      resourceId: psychologistId,
      endpoint: `/api/finance/commissions/${psychologistId}`,
      method: 'PUT',
      details: { 
        commission_amounts: commissionAmountsObj
      },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(newCommission, 'Commission amounts updated successfully')
    );

  } catch (error) {
    console.error('Update commission error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating commission')
    );
  }
};

// ============================================
// PAYOUTS MANAGEMENT
// ============================================

/**
 * Get Pending Payouts
 * GET /api/finance/payouts/pending
 * Returns doctors with completed sessions only, grouped by month
 */
const getPendingPayouts = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { month, year } = req.query;
    
    // Default to current month if not specified
    const today = new Date();
    const targetMonth = month ? parseInt(month) : today.getMonth() + 1;
    const targetYear = year ? parseInt(year) : today.getFullYear();
    
    const monthStr = targetMonth < 10 ? `0${targetMonth}` : String(targetMonth);
    const monthStart = `${targetYear}-${monthStr}-01`;
    const monthEnd = new Date(targetYear, targetMonth, 0).toISOString().split('T')[0]; // Last day of month

    // Get all completed sessions from the specified month with successful payments
    const { data: completedSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select(`
        id,
        psychologist_id,
        session_type,
        package_id,
        scheduled_date,
        status,
        payment_id,
        psychologist:psychologists(id, first_name, last_name, email, phone, cover_image_url)
      `)
      .eq('status', 'completed') // Only completed sessions
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd)
      .not('psychologist_id', 'is', null)
      .neq('session_type', 'free_assessment') // Exclude free assessments
      .not('payment_id', 'is', null); // Only sessions with payment_id

    if (sessionsError) throw sessionsError;

    // Filter by successful payment status
    const paymentIds = [...new Set(completedSessions?.map(s => s.payment_id).filter(Boolean) || [])];
    let successfulPaymentIds = [];
    
    if (paymentIds.length > 0) {
      const { data: payments, error: paymentError } = await supabaseAdmin
        .from('payments')
        .select('id, status')
        .in('id', paymentIds)
        .in('status', ['paid', 'success', 'completed', 'cash']); // Only successful payments
      
      if (!paymentError && payments) {
        successfulPaymentIds = payments.map(p => p.id);
      }
    }

    // Filter to only include sessions with successful payments
    const completedSessionsWithPayments = (completedSessions || []).filter(s => 
      s.payment_id && successfulPaymentIds.includes(s.payment_id)
    );

    if (sessionsError) throw sessionsError;

    if (!completedSessionsWithPayments || completedSessionsWithPayments.length === 0) {
      await auditLogger.logAction({
        userId: req.user.id,
        userEmail: req.user.email,
        userRole,
        action: 'FINANCE_PENDING_PAYOUTS_VIEWED',
        resource: 'payouts',
        endpoint: '/api/finance/payouts/pending',
        method: 'GET',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }).catch(err => console.error('Audit log error:', err));

      return res.json(successResponse({
        payouts: [],
        month: targetMonth,
        year: targetYear
      }, 'No completed sessions found for the selected month'));
    }

    // Get commission_history for these completed sessions
    const sessionIds = completedSessionsWithPayments.map(s => s.id);
    const { data: commissionHistory, error: commissionError } = await supabaseAdmin
      .from('commission_history')
      .select(`
        session_id,
        psychologist_id,
        session_amount,
        commission_amount,
        session_type
      `)
      .in('session_id', sessionIds)
      .eq('payment_status', 'pending'); // Only pending payments

    if (commissionError) throw commissionError;

    // Get package types for package sessions
    const packageIds = [...new Set(completedSessionsWithPayments.map(s => s.package_id).filter(Boolean))];
    let packagesMap = {};
    if (packageIds.length > 0) {
      const { data: packages } = await supabaseAdmin
        .from('packages')
        .select('id, package_type, session_count')
        .in('id', packageIds);
      
      if (packages) {
        packages.forEach(pkg => {
          packagesMap[pkg.id] = pkg;
        });
      }
    }

    // Build commission map by session_id
    const commissionMap = {};
    commissionHistory?.forEach(ch => {
      commissionMap[ch.session_id] = ch;
    });

    // Group by psychologist
    const payoutsByDoctor = {};
    
    completedSessionsWithPayments.forEach(session => {
      const psychId = session.psychologist_id;
      const commission = commissionMap[session.id];
      
      // Skip if no commission history (shouldn't happen, but safety check)
      if (!commission) return;

      if (!payoutsByDoctor[psychId]) {
        payoutsByDoctor[psychId] = {
          psychologist_id: psychId,
          psychologist: session.psychologist,
          total_sessions: 0,
          session_counts_by_type: {},
          total_doctor_wallet: 0,
          total_company_commission: 0,
          sessions: []
        };
      }

      // Determine session type for counting
      let sessionTypeForCount = 'individual';
      if (session.package_id) {
        const pkg = packagesMap[session.package_id];
        if (pkg) {
          sessionTypeForCount = pkg.package_type || `package_${pkg.session_count || 'unknown'}`;
        } else {
          sessionTypeForCount = 'package_unknown';
        }
      }

      // Update counts
      payoutsByDoctor[psychId].total_sessions += 1;
      if (!payoutsByDoctor[psychId].session_counts_by_type[sessionTypeForCount]) {
        payoutsByDoctor[psychId].session_counts_by_type[sessionTypeForCount] = 0;
      }
      payoutsByDoctor[psychId].session_counts_by_type[sessionTypeForCount] += 1;

      // Calculate wallet and commission
      const sessionAmount = parseFloat(commission.session_amount || 0);
      const commissionAmount = parseFloat(commission.commission_amount || 0);
      const doctorWallet = sessionAmount - commissionAmount;

      payoutsByDoctor[psychId].total_doctor_wallet += doctorWallet;
      payoutsByDoctor[psychId].total_company_commission += commissionAmount;

      // Store session details
      payoutsByDoctor[psychId].sessions.push({
        session_id: session.id,
        session_date: session.scheduled_date,
        session_type: sessionTypeForCount,
        session_amount: sessionAmount,
        doctor_wallet: doctorWallet,
        company_commission: commissionAmount
      });
    });

    // Convert to array and format for frontend
    const payouts = Object.values(payoutsByDoctor).map(payout => ({
      id: payout.psychologist_id, // Using psychologist_id as ID for pending payouts
      psychologist_id: payout.psychologist_id,
      psychologist: payout.psychologist,
      total_sessions: payout.total_sessions,
      session_counts_by_type: payout.session_counts_by_type,
      total_doctor_wallet: Math.round(payout.total_doctor_wallet * 100) / 100,
      total_company_commission: Math.round(payout.total_company_commission * 100) / 100,
      // For backward compatibility with frontend
      total_commission: payout.total_company_commission,
      net_payout: payout.total_doctor_wallet,
      session_details: payout.sessions
    }));

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_PENDING_PAYOUTS_VIEWED',
      resource: 'payouts',
      endpoint: '/api/finance/payouts/pending',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      payouts,
      month: targetMonth,
      year: targetYear,
      month_name: new Date(targetYear, targetMonth - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }, 'Pending payouts fetched successfully'));

  } catch (error) {
    console.error('Get pending payouts error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching pending payouts')
    );
  }
};

/**
 * Process Payout
 * POST /api/finance/payouts
 */
const processPayout = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      psychologist_id,
      payout_date,
      total_commission,
      tds_percentage = 0,
      payment_method,
      bank_account_number,
      ifsc_code,
      upi_id,
      cheque_number,
      transaction_id,
      reference_number,
      notes
    } = req.body;

    if (!psychologist_id || !payout_date || !total_commission || !payment_method) {
      return res.status(400).json(
        errorResponse('Psychologist ID, payout date, commission amount, and payment method are required')
      );
    }

    // Calculate TDS and net payout
    const tds_amount = (parseFloat(total_commission) * parseFloat(tds_percentage)) / 100;
    const net_payout = parseFloat(total_commission) - tds_amount;

    // Create payout record
    const { data: payout, error } = await supabaseAdmin
      .from('payouts')
      .insert([{
        psychologist_id,
        payout_date,
        total_commission: parseFloat(total_commission),
        tds_amount,
        tds_percentage: parseFloat(tds_percentage),
        net_payout,
        payment_method,
        bank_account_number,
        ifsc_code,
        upi_id,
        cheque_number,
        transaction_id,
        reference_number,
        status: 'paid',
        processed_by: userId,
        processed_at: new Date().toISOString(),
        notes,
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    // Update commission history to mark as paid
    await supabaseAdmin
      .from('commission_history')
      .update({
        payment_status: 'paid',
        payout_id: payout.id,
        updated_at: new Date().toISOString()
      })
      .eq('psychologist_id', psychologist_id)
      .eq('payment_status', 'pending');

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_PAYOUT_PROCESSED',
      resource: 'payouts',
      resourceId: payout.id,
      endpoint: '/api/finance/payouts',
      method: 'POST',
      details: { psychologist_id, amount: net_payout },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.status(201).json(
      successResponse(payout, 'Payout processed successfully')
    );

  } catch (error) {
    console.error('Process payout error:', error);
    res.status(500).json(
      errorResponse('Internal server error while processing payout')
    );
  }
};

// Export all functions
// ============================================
// INCOME MANAGEMENT
// ============================================

/**
 * Get Income Entries
 * GET /api/finance/income
 */
const getIncome = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { dateFrom, dateTo, incomeSource, page = 1, limit = 50 } = req.query;

    let query = supabaseAdmin
      .from('income_entries')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false });

    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    if (incomeSource) query = query.eq('income_source', incomeSource);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: income, error, count } = await query;

    if (error) {
      console.error('Error fetching income:', error);
      return res.status(500).json(
        errorResponse('Internal server error while fetching income')
      );
    }

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_INCOME_VIEWED',
      resource: 'income',
      endpoint: '/api/finance/income',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      income: income || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit))
      }
    }, 'Income entries fetched successfully'));

  } catch (error) {
    console.error('Get income error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching income')
    );
  }
};

/**
 * Create Income Entry
 * POST /api/finance/income
 */
const createIncome = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      date,
      income_source,
      description,
      amount,
      payment_method,
      reference_number,
      notes
    } = req.body;

    if (!date || !income_source || !amount) {
      return res.status(400).json(
        errorResponse('Date, income source, and amount are required')
      );
    }

    const { data: income, error } = await supabaseAdmin
      .from('income_entries')
      .insert([{
        date,
        income_source,
        description,
        amount: parseFloat(amount),
        payment_method,
        reference_number,
        notes,
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating income:', error);
      throw error;
    }

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_INCOME_CREATED',
      resource: 'income',
      resourceId: income.id,
      endpoint: '/api/finance/income',
      method: 'POST',
      details: { amount, income_source },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.status(201).json(
      successResponse(income, 'Income entry created successfully')
    );

  } catch (error) {
    console.error('Create income error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating income entry')
    );
  }
};

// ============================================
// GST SETTINGS
// ============================================

/**
 * Get GST Settings
 * GET /api/finance/gst/settings
 */
const getGSTSettings = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { data: settings, error } = await supabaseAdmin
      .from('gst_settings')
      .select('*')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching GST settings:', error);
      throw error;
    }

    // Return default settings if none exist
    const defaultSettings = {
      company_gst_number: null,
      company_pan_number: null,
      company_name: null,
      company_address: null,
      bank_name: null,
      bank_account_number: null,
      bank_ifsc_code: null,
      tax_year_start: null,
      tax_year_end: null,
      filing_frequency: 'monthly',
      default_gst_rate: 18,
      healthcare_gst_rate: 5,
      software_gst_rate: 18
    };

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_GST_SETTINGS_VIEWED',
      resource: 'gst_settings',
      endpoint: '/api/finance/gst/settings',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse(
      settings || defaultSettings,
      'GST settings fetched successfully'
    ));

  } catch (error) {
    console.error('Get GST settings error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching GST settings')
    );
  }
};

/**
 * Update GST Settings
 * PUT /api/finance/gst/settings
 */
const updateGSTSettings = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString()
    };

    // Check if settings exist
    const { data: existing } = await supabaseAdmin
      .from('gst_settings')
      .select('id')
      .limit(1)
      .single();

    let result;
    if (existing) {
      // Update existing
      const { data, error } = await supabaseAdmin
        .from('gst_settings')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Create new
      const { data, error } = await supabaseAdmin
        .from('gst_settings')
        .insert([{
          ...updateData,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    }

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_GST_SETTINGS_UPDATED',
      resource: 'gst_settings',
      endpoint: '/api/finance/gst/settings',
      method: 'PUT',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(result, 'GST settings updated successfully')
    );

  } catch (error) {
    console.error('Update GST settings error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating GST settings')
    );
  }
};

// ============================================
// EXPENSE CATEGORIES
// ============================================

/**
 * Get Expense Categories
 * GET /api/finance/settings/categories
 */
const getExpenseCategories = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { data: categories, error } = await supabaseAdmin
      .from('expense_categories')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching expense categories:', error);
      throw error;
    }

    res.json(successResponse({
      categories: categories || []
    }, 'Expense categories fetched successfully'));

  } catch (error) {
    console.error('Get expense categories error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching expense categories')
    );
  }
};

/**
 * Create Expense Category
 * POST /api/finance/settings/categories
 */
const createExpenseCategory = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { name, description, parent_category_id } = req.body;

    if (!name) {
      return res.status(400).json(
        errorResponse('Category name is required')
      );
    }

    const { data: category, error } = await supabaseAdmin
      .from('expense_categories')
      .insert([{
        name,
        description,
        parent_category_id,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating expense category:', error);
      if (error.code === '23505') {
        return res.status(400).json(
          errorResponse('Category with this name already exists')
        );
      }
      throw error;
    }

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_EXPENSE_CATEGORY_CREATED',
      resource: 'expense_categories',
      resourceId: category.id,
      endpoint: '/api/finance/settings/categories',
      method: 'POST',
      details: { name },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.status(201).json(
      successResponse(category, 'Expense category created successfully')
    );

  } catch (error) {
    console.error('Create expense category error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating expense category')
    );
  }
};

// ============================================
// INCOME SOURCES
// ============================================

/**
 * Get Income Sources
 * GET /api/finance/settings/income-sources
 */
const getIncomeSources = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { data: sources, error } = await supabaseAdmin
      .from('income_sources')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching income sources:', error);
      throw error;
    }

    res.json(successResponse({
      sources: sources || []
    }, 'Income sources fetched successfully'));

  } catch (error) {
    console.error('Get income sources error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching income sources')
    );
  }
};

/**
 * Create Income Source
 * POST /api/finance/settings/income-sources
 */
const createIncomeSource = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { name, description, default_gst_rate, is_auto_calculated } = req.body;

    if (!name) {
      return res.status(400).json(
        errorResponse('Income source name is required')
      );
    }

    const { data: source, error } = await supabaseAdmin
      .from('income_sources')
      .insert([{
        name,
        description,
        default_gst_rate: parseFloat(default_gst_rate || 0),
        is_auto_calculated: is_auto_calculated || false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating income source:', error);
      if (error.code === '23505') {
        return res.status(400).json(
          errorResponse('Income source with this name already exists')
        );
      }
      throw error;
    }

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_INCOME_SOURCE_CREATED',
      resource: 'income_sources',
      resourceId: source.id,
      endpoint: '/api/finance/settings/income-sources',
      method: 'POST',
      details: { name },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.status(201).json(
      successResponse(source, 'Income source created successfully')
    );

  } catch (error) {
    console.error('Create income source error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating income source')
    );
  }
};

module.exports = {
  getDashboard,
  getSessions,
  getSessionDetails,
  getRevenue,
  getExpenses,
  createExpense,
  approveExpense,
  updateExpense,
  deleteExpense,
  getCommissions,
  updateCommissionRate,
  getPendingPayouts,
  processPayout,
  getIncome,
  createIncome,
  getGSTSettings,
  updateGSTSettings,
  getExpenseCategories,
  createExpenseCategory,
  getIncomeSources,
  createIncomeSource
};

// ============================================
// INCOME MANAGEMENT (UPDATE & DELETE)
// ============================================

/**
 * Update Income Entry
 * PUT /api/finance/income/:incomeId
 */
const updateIncome = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { incomeId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      date,
      income_source,
      description,
      amount,
      payment_method,
      reference_number,
      notes
    } = req.body;

    // Check if income entry exists
    const { data: existingIncome, error: checkError } = await supabaseAdmin
      .from('income_entries')
      .select('*')
      .eq('id', incomeId)
      .single();

    if (checkError || !existingIncome) {
      return res.status(404).json(
        errorResponse('Income entry not found')
      );
    }

    // Build update data
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (date) updateData.date = date;
    if (income_source) updateData.income_source = income_source;
    if (description !== undefined) updateData.description = description;
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (payment_method !== undefined) updateData.payment_method = payment_method;
    if (reference_number !== undefined) updateData.reference_number = reference_number;
    if (notes !== undefined) updateData.notes = notes;

    const { data: updatedIncome, error } = await supabaseAdmin
      .from('income_entries')
      .update(updateData)
      .eq('id', incomeId)
      .select()
      .single();

    if (error) {
      console.error('Error updating income:', error);
      throw error;
    }

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_INCOME_UPDATED',
      resource: 'income',
      resourceId: incomeId,
      endpoint: `/api/finance/income/${incomeId}`,
      method: 'PUT',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(updatedIncome, 'Income entry updated successfully')
    );

  } catch (error) {
    console.error('Update income error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating income entry')
    );
  }
};

/**
 * Delete Income Entry
 * DELETE /api/finance/income/:incomeId
 */
const deleteIncome = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { incomeId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    // Check if income entry exists
    const { data: existingIncome, error: checkError } = await supabaseAdmin
      .from('income_entries')
      .select('*')
      .eq('id', incomeId)
      .single();

    if (checkError || !existingIncome) {
      return res.status(404).json(
        errorResponse('Income entry not found')
      );
    }

    // Delete income entry
    const { error } = await supabaseAdmin
      .from('income_entries')
      .delete()
      .eq('id', incomeId);

    if (error) {
      console.error('Error deleting income:', error);
      throw error;
    }

    await auditLogger.logAction({
      userId,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_INCOME_DELETED',
      resource: 'income',
      resourceId: incomeId,
      endpoint: `/api/finance/income/${incomeId}`,
      method: 'DELETE',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(
      successResponse(null, 'Income entry deleted successfully')
    );

  } catch (error) {
    console.error('Delete income error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting income entry')
    );
  }
};

// ============================================
// GST RECORDS
// ============================================

/**
 * Get GST Records
 * GET /api/finance/gst
 */
const getGSTRecords = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { dateFrom, dateTo, recordType, page = 1, limit = 50 } = req.query;

    let query = supabaseAdmin
      .from('gst_records')
      .select('*', { count: 'exact' })
      .order('transaction_date', { ascending: false });

    if (dateFrom) query = query.gte('transaction_date', dateFrom);
    if (dateTo) query = query.lte('transaction_date', dateTo);
    if (recordType) query = query.eq('record_type', recordType);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: gstRecords, error, count } = await query;

    if (error) {
      console.error('Error fetching GST records:', error);
      throw error;
    }

    // Calculate totals
    const totalGST = gstRecords?.reduce((sum, r) => sum + (parseFloat(r.gst_amount) || 0), 0) || 0;
    const totalInputTax = gstRecords?.filter(r => r.is_input_tax).reduce((sum, r) => sum + (parseFloat(r.gst_amount) || 0), 0) || 0;
    const totalOutputTax = gstRecords?.filter(r => !r.is_input_tax).reduce((sum, r) => sum + (parseFloat(r.gst_amount) || 0), 0) || 0;
    const netGST = totalOutputTax - totalInputTax;

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_GST_RECORDS_VIEWED',
      resource: 'gst_records',
      endpoint: '/api/finance/gst',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      records: gstRecords || [],
      summary: {
        total_gst: totalGST,
        input_tax: totalInputTax,
        output_tax: totalOutputTax,
        net_gst: netGST
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit))
      }
    }, 'GST records fetched successfully'));

  } catch (error) {
    console.error('Get GST records error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching GST records')
    );
  }
};

// ============================================
// PAYOUTS (GET ALL & DETAILS)
// ============================================

/**
 * Get All Payouts
 * GET /api/finance/payouts
 */
const getPayouts = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { dateFrom, dateTo, psychologistId, status, page = 1, limit = 50 } = req.query;

    let query = supabaseAdmin
      .from('payouts')
      .select(`
        *,
        psychologist:psychologists(id, first_name, last_name)
      `, { count: 'exact' })
      .order('payout_date', { ascending: false });

    if (dateFrom) query = query.gte('payout_date', dateFrom);
    if (dateTo) query = query.lte('payout_date', dateTo);
    if (psychologistId) query = query.eq('psychologist_id', psychologistId);
    if (status) query = query.eq('status', status);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: payouts, error, count } = await query;

    if (error) {
      console.error('Error fetching payouts:', error);
      throw error;
    }

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_PAYOUTS_VIEWED',
      resource: 'payouts',
      endpoint: '/api/finance/payouts',
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      payouts: payouts || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit))
      }
    }, 'Payouts fetched successfully'));

  } catch (error) {
    console.error('Get payouts error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching payouts')
    );
  }
};

/**
 * Get Payout Details
 * GET /api/finance/payouts/:payoutId
 */
const getPayoutDetails = async (req, res) => {
  try {
    const userRole = req.user.role;
    const { payoutId } = req.params;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const { data: payout, error } = await supabaseAdmin
      .from('payouts')
      .select(`
        *,
        psychologist:psychologists(id, first_name, last_name, email, phone)
      `)
      .eq('id', payoutId)
      .single();

    if (error || !payout) {
      return res.status(404).json(
        errorResponse('Payout not found')
      );
    }

    // Get related commission history
    const { data: commissions } = await supabaseAdmin
      .from('commission_history')
      .select('*')
      .eq('payout_id', payoutId);

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_PAYOUT_DETAILS_VIEWED',
      resource: 'payouts',
      resourceId: payoutId,
      endpoint: `/api/finance/payouts/${payoutId}`,
      method: 'GET',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      payout: {
        ...payout,
        commissions: commissions || []
      }
    }, 'Payout details fetched successfully'));

  } catch (error) {
    console.error('Get payout details error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching payout details')
    );
  }
};

module.exports = {
  getDashboard,
  getSessions,
  getSessionDetails,
  getRevenue,
  getExpenses,
  createExpense,
  approveExpense,
  updateExpense,
  deleteExpense,
  getCommissions,
  updateCommissionRate,
  getPendingPayouts,
  processPayout,
  getIncome,
  createIncome,
  updateIncome,
  deleteIncome,
  getGSTSettings,
  updateGSTSettings,
  getGSTRecords,
  getExpenseCategories,
  createExpenseCategory,
  getIncomeSources,
  createIncomeSource,
  getPayouts,
  getPayoutDetails
};

// ============================================
// FREE ASSESSMENTS MANAGEMENT
// ============================================

/**
 * Get All Free Assessments
 * GET /api/finance/free-assessments
 */
const getFreeAssessments = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (!['finance', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json(
        errorResponse('Access denied. Finance role required.')
      );
    }

    const {
      dateFrom,
      dateTo,
      psychologistId,
      status,
      page = 1,
      limit = 50,
      search
    } = req.query;

    // Build query for free assessments
    let query = supabaseAdmin
      .from('free_assessments')
      .select(`
        id,
        assessment_number,
        scheduled_date,
        scheduled_time,
        status,
        psychologist_id,
        client_id,
        user_id,
        session_id
      `, { count: 'exact' });

    // Apply filters
    if (dateFrom) {
      query = query.gte('scheduled_date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('scheduled_date', dateTo);
    }
    if (psychologistId) {
      query = query.eq('psychologist_id', psychologistId);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.or(`id.ilike.%${search}%,assessment_number.ilike.%${search}%`);
    }

    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);
    query = query.order('scheduled_date', { ascending: false });
    query = query.order('scheduled_time', { ascending: false });

    const { data: assessments, error, count } = await query;

    if (error) {
      console.error('Error fetching free assessments:', error);
      return res.json(successResponse({
        assessments: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          totalPages: 0
        }
      }, 'Free assessments fetched successfully (empty)'));
    }

    const assessmentsData = assessments || [];

    // Get psychologist and client details separately
    const psychologistIds = [...new Set(assessmentsData.map(a => a?.psychologist_id).filter(Boolean))];
    const clientIds = [...new Set(assessmentsData.map(a => a?.client_id).filter(Boolean))];
    
    let psychologists = [];
    let clients = [];
    
    if (psychologistIds.length > 0) {
      const { data: psychData } = await supabaseAdmin
        .from('psychologists')
        .select('id, first_name, last_name, email')
        .in('id', psychologistIds);
      psychologists = psychData || [];
    }
    
    if (clientIds.length > 0) {
      const { data: clientData } = await supabaseAdmin
        .from('clients')
        .select('id, first_name, last_name, child_name')
        .in('id', clientIds);
      clients = clientData || [];
    }

    // Get session data for meet links using session_id from free_assessments
    const sessionIds = assessmentsData.map(a => a?.session_id).filter(Boolean);
    let sessions = [];
    if (sessionIds.length > 0) {
      const { data: sessionData } = await supabaseAdmin
        .from('sessions')
        .select('id, google_meet_link')
        .in('id', sessionIds);
      sessions = sessionData || [];
    }

    const assessmentsWithDetails = assessmentsData.map(assessment => {
      if (!assessment) return null;
      const psychologist = psychologists.find(p => p.id === assessment.psychologist_id);
      const client = clients.find(c => c.id === assessment.client_id);
      // Match session by session_id from free_assessments table
      const session = assessment.session_id ? sessions.find(s => s && s.id === assessment.session_id) : null;
      
      return {
        id: assessment.id,
        assessment_number: assessment.assessment_number,
        scheduled_date: assessment.scheduled_date,
        scheduled_time: assessment.scheduled_time,
        status: assessment.status,
        psychologist: psychologist ? {
          id: psychologist.id,
          first_name: psychologist.first_name,
          last_name: psychologist.last_name,
          email: psychologist.email
        } : null,
        client: client ? {
          id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          child_name: client.child_name
        } : null,
        meet_link: session?.google_meet_link || null
      };
    }).filter(Boolean);

    await auditLogger.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole,
      action: 'FINANCE_FREE_ASSESSMENTS_VIEWED',
      resource: 'free_assessments',
      endpoint: '/api/finance/free-assessments',
      method: 'GET',
      details: { filters: req.query },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('Audit log error:', err));

    res.json(successResponse({
      assessments: assessmentsWithDetails || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit))
      }
    }, 'Free assessments fetched successfully'));

  } catch (error) {
    console.error('Get free assessments error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching free assessments')
    );
  }
};

module.exports = {
  getDashboard,
  getSessions,
  getSessionDetails,
  getRevenue,
  getExpenses,
  createExpense,
  approveExpense,
  updateExpense,
  deleteExpense,
  getCommissions,
  updateCommissionRate,
  getPendingPayouts,
  processPayout,
  getIncome,
  createIncome,
  updateIncome,
  deleteIncome,
  getGSTSettings,
  updateGSTSettings,
  getGSTRecords,
  getExpenseCategories,
  createExpenseCategory,
  getIncomeSources,
  createIncomeSource,
  getPayouts,
  getPayoutDetails,
  getFreeAssessments
};

