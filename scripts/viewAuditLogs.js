/**
 * View Audit Logs Script
 * 
 * Displays audit logs from the database
 * Usage: node scripts/viewAuditLogs.js [limit] [user_email] [action]
 * 
 * Examples:
 *   node scripts/viewAuditLogs.js                    # Last 50 logs
 *   node scripts/viewAuditLogs.js 100                # Last 100 logs
 *   node scripts/viewAuditLogs.js 50 admin@example.com  # Logs for specific user
 *   node scripts/viewAuditLogs.js 50 null UPDATE_USER_ROLE  # Logs by action
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function viewAuditLogs() {
  try {
    const limit = parseInt(process.argv[2]) || 50;
    const userEmail = process.argv[3];
    const action = process.argv[4];

    console.log('🔍 Fetching audit logs...\n');

    let query = supabaseAdmin
      .from('audit_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    // Filter by user email
    if (userEmail) {
      if (userEmail === 'null') {
        // Get failed authentication attempts
        query = query.is('user_id', null);
      } else {
        query = query.eq('user_email', userEmail);
      }
    }

    // Filter by action
    if (action) {
      query = query.eq('action', action);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01') {
        console.error('❌ Error: audit_logs table does not exist!');
        console.error('💡 Run the migration: create_audit_logs_table.sql');
        return;
      }
      console.error('❌ Error fetching audit logs:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.log('✅ No audit logs found.');
      return;
    }

    console.log(`📊 Found ${data.length} audit log(s):\n`);
    console.log('='.repeat(120));

    data.forEach((log, index) => {
      console.log(`\n[${index + 1}] ${log.timestamp}`);
      console.log(`   User: ${log.user_email || 'N/A'} (${log.user_role || 'N/A'})`);
      console.log(`   Action: ${log.action}`);
      console.log(`   Resource: ${log.resource} (ID: ${log.resource_id || 'N/A'})`);
      console.log(`   Endpoint: ${log.method} ${log.endpoint}`);
      console.log(`   IP: ${log.ip_address || 'N/A'}`);
      if (log.details && Object.keys(log.details).length > 0) {
        console.log(`   Details: ${JSON.stringify(log.details, null, 2).split('\n').join('\n      ')}`);
      }
    });

    console.log('\n' + '='.repeat(120));
    console.log(`\n✅ Displayed ${data.length} log(s)`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

viewAuditLogs();

