const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { 
  successResponse, 
  errorResponse,
  hashPassword
} = require('../utils/helpers');

// Create admin user
const createAdmin = async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json(
        errorResponse('Email, password, first name, and last name are required')
      );
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json(
        errorResponse('User with this email already exists')
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create admin user
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email,
        password_hash: hashedPassword,
        role: 'admin'
      }])
      .select('id, email, role, created_at')
      .single();

    if (userError) {
      console.error('Create admin user error:', userError);
      return res.status(500).json(
        errorResponse('Failed to create admin user')
      );
    }

    res.status(201).json(
      successResponse(user, 'Admin user created successfully')
    );

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating admin user')
    );
  }
};

// Delete user (superadmin only)
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json(
        errorResponse('User not found')
      );
    }

    // Prevent deleting superadmin
    if (user.role === 'superadmin') {
      return res.status(403).json(
        errorResponse('Cannot delete superadmin user')
      );
    }

    // If client, delete all related data first
    if (user.role === 'client') {
      // Find client record (for new system, client.id != user.id)
      const { data: clientRecord } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      const clientId = clientRecord?.id || userId; // Fallback to userId for old system

      console.log(`🗑️  Deleting all related data for client_id: ${clientId}`);

      // 1. Delete messages (via conversations)
      const { data: conversations } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('client_id', clientId);

      if (conversations && conversations.length > 0) {
        const conversationIds = conversations.map(c => c.id);
        await supabaseAdmin
          .from('messages')
          .delete()
          .in('conversation_id', conversationIds);
        console.log(`   ✅ Deleted messages from ${conversations.length} conversation(s)`);
      }

      // 2. Delete conversations
      await supabaseAdmin
        .from('conversations')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted conversations`);

      // 3. Delete receipts (via sessions)
      const { data: sessions } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('client_id', clientId);

      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map(s => s.id);
        await supabaseAdmin
          .from('receipts')
          .delete()
          .in('session_id', sessionIds);
        console.log(`   ✅ Deleted receipts for ${sessions.length} session(s)`);
      }

      // 4. Delete payments
      await supabaseAdmin
        .from('payments')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted payments`);

      // 5. Delete sessions
      await supabaseAdmin
        .from('sessions')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted sessions`);

      // 6. Delete assessment sessions
      await supabaseAdmin
        .from('assessment_sessions')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted assessment sessions`);

      // 7. Delete free assessments
      await supabaseAdmin
        .from('free_assessments')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted free assessments`);

      // 8. Delete client packages
      await supabaseAdmin
        .from('client_packages')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted client packages`);

      // 9. Delete client profile
      await supabaseAdmin
        .from('clients')
        .delete()
        .or(`id.eq.${clientId},user_id.eq.${userId}`); // Delete by either id or user_id
      console.log(`   ✅ Deleted client profile`);
    }

    // Delete user account
    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Delete user error:', error);
      return res.status(500).json(
        errorResponse('Failed to delete user')
      );
    }

    console.log(`   ✅ Deleted user account`);

    res.json(
      successResponse(null, 'User and all related data deleted successfully')
    );

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting user')
    );
  }
};

// Get comprehensive platform analytics
const getPlatformAnalytics = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get comprehensive statistics
    const [
      { data: users, error: usersError },
      { data: sessions, error: sessionsError },
      { data: psychologists, error: psychologistsError },
      { data: clients, error: clientsError }
    ] = await Promise.all([
      supabase.from('users').select('role, created_at'),
      supabase.from('sessions').select('status, scheduled_date, price, created_at'),
      supabase.from('psychologists').select('area_of_expertise, created_at'),
      supabase.from('clients').select('child_age, created_at')
    ]);

    if (usersError || sessionsError || psychologistsError || clientsError) {
      console.error('Analytics data fetch error:', { usersError, sessionsError, psychologistsError, clientsError });
      return res.status(500).json(
        errorResponse('Failed to fetch analytics data')
      );
    }

    // Calculate comprehensive analytics
    const analytics = {
      overview: {
        total_users: users.length,
        total_sessions: sessions.length,
        total_revenue: sessions.reduce((sum, session) => sum + parseFloat(session.price || 0), 0)
      },
      users: {
        by_role: {},
        growth: {
          this_month: 0,
          this_quarter: 0,
          this_year: 0
        }
      },
      sessions: {
        by_status: {},
        by_month: {},
        revenue_trends: {}
      },
      psychologists: {
        total: psychologists.length,
        expertise_distribution: {},
        performance_metrics: {}
      },
      clients: {
        age_distribution: {},
        growth_trends: {}
      },
      platform_health: {
        session_completion_rate: 0,
        average_session_price: 0,
        user_retention_rate: 0
      }
    };

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentQuarter = Math.floor(currentMonth / 3);

    // User analytics
    users.forEach(user => {
      analytics.users.by_role[user.role] = (analytics.users.by_role[user.role] || 0) + 1;
      
      const userDate = new Date(user.created_at);
      if (userDate.getMonth() === currentMonth && userDate.getFullYear() === currentYear) {
        analytics.users.growth.this_month++;
      }
      if (userDate.getFullYear() === currentYear && Math.floor(userDate.getMonth() / 3) === currentQuarter) {
        analytics.users.growth.this_quarter++;
      }
      if (userDate.getFullYear() === currentYear) {
        analytics.users.growth.this_year++;
      }
    });

    // Session analytics
    sessions.forEach(session => {
      analytics.sessions.by_status[session.status] = (analytics.sessions.by_status[session.status] || 0) + 1;
      
      const sessionDate = new Date(session.scheduled_date);
      const monthKey = `${sessionDate.getFullYear()}-${sessionDate.getMonth() + 1}`;
      analytics.sessions.by_month[monthKey] = (analytics.sessions.by_month[monthKey] || 0) + 1;
      
      const revenueKey = `${sessionDate.getFullYear()}-${sessionDate.getMonth() + 1}`;
      analytics.sessions.revenue_trends[revenueKey] = (analytics.sessions.revenue_trends[revenueKey] || 0) + parseFloat(session.price || 0);
    });

    // Psychologist analytics
    psychologists.forEach(psychologist => {
      psychologist.area_of_expertise?.forEach(expertise => {
        analytics.psychologists.expertise_distribution[expertise] = (analytics.psychologists.expertise_distribution[expertise] || 0) + 1;
      });
    });

    // Client analytics
    clients.forEach(client => {
      const ageGroup = client.child_age <= 5 ? '0-5' : 
                      client.child_age <= 12 ? '6-12' : '13-18';
      analytics.clients.age_distribution[ageGroup] = (analytics.clients.age_distribution[ageGroup] || 0) + 1;
    });

    // Platform health metrics
    const completedSessions = analytics.sessions.by_status['completed'] || 0;
    const totalBookedSessions = (analytics.sessions.by_status['booked'] || 0) + 
                               (analytics.sessions.by_status['rescheduled'] || 0) + 
                               completedSessions;
    
    analytics.platform_health.session_completion_rate = totalBookedSessions > 0 ? 
      (completedSessions / totalBookedSessions * 100).toFixed(2) : 0;
    
    analytics.platform_health.average_session_price = analytics.overview.total_sessions > 0 ? 
      (analytics.overview.total_revenue / analytics.overview.total_sessions).toFixed(2) : 0;

    res.json(
      successResponse(analytics)
    );

  } catch (error) {
    console.error('Get platform analytics error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching platform analytics')
    );
  }
};

// System maintenance functions
const systemMaintenance = async (req, res) => {
  try {
    const { action, target } = req.body;

    if (!action || !target) {
      return res.status(400).json(
        errorResponse('Action and target are required')
      );
    }

    let result;
    switch (action) {
      case 'cleanup_old_sessions':
        // Clean up sessions older than 1 year
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        const { data: oldSessions, error: cleanupError } = await supabase
          .from('sessions')
          .delete()
          .lt('scheduled_date', oneYearAgo.toISOString().split('T')[0])
          .in('status', ['completed', 'canceled', 'noshow']);

        if (cleanupError) {
          console.error('Cleanup error:', cleanupError);
          return res.status(500).json(
            errorResponse('Failed to cleanup old sessions')
          );
        }

        result = { message: 'Old sessions cleaned up successfully' };
        break;

      case 'recalculate_stats':
        // This would trigger a recalculation of all statistics
        result = { message: 'Statistics recalculation triggered' };
        break;

      default:
        return res.status(400).json(
          errorResponse('Invalid action specified')
        );
    }

    res.json(
      successResponse(result, 'System maintenance completed successfully')
    );

  } catch (error) {
    console.error('System maintenance error:', error);
    res.status(500).json(
      errorResponse('Internal server error during system maintenance')
    );
  }
};

// Get system logs (placeholder for future implementation)
const getSystemLogs = async (req, res) => {
  try {
    const { level, start_date, end_date, limit = 100 } = req.query;

    // This is a placeholder - in a real system you'd have a logs table
    // For now, we'll return a mock response
    const mockLogs = [
      {
        id: 1,
        level: 'INFO',
        message: 'System startup completed',
        timestamp: new Date().toISOString(),
        source: 'system'
      },
      {
        id: 2,
        level: 'INFO',
        message: 'Database connection established',
        timestamp: new Date().toISOString(),
        source: 'database'
      }
    ];

    res.json(
      successResponse({
        logs: mockLogs,
        total: mockLogs.length
      })
    );

  } catch (error) {
    console.error('Get system logs error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching system logs')
    );
  }
};

module.exports = {
  createAdmin,
  deleteUser,
  getPlatformAnalytics,
  systemMaintenance,
  getSystemLogs
};
