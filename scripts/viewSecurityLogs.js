/**
 * View Security Logs Script
 * 
 * Displays security logs and metrics from database
 * Usage: node scripts/viewSecurityLogs.js [limit] [event_type] [ip_address]
 * 
 * Examples:
 *   node scripts/viewSecurityLogs.js                    # Summary + last 50 events
 *   node scripts/viewSecurityLogs.js 100                # Summary + last 100 events
 *   node scripts/viewSecurityLogs.js 50 BLOCKED_REQUEST # Filter by event type
 *   node scripts/viewSecurityLogs.js 50 null 192.168.1.1 # Filter by IP
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');
const securityMonitor = require('../utils/securityMonitor');

async function viewSecurityLogs() {
  try {
    const limit = parseInt(process.argv[2]) || 50;
    const eventType = process.argv[3];
    const ipAddress = process.argv[4];

    console.log('🔍 Security Logs & Metrics\n');
    console.log('='.repeat(120));

    // Refresh metrics from database
    await securityMonitor.loadMetrics();

    // Get security summary
    console.log('\n📊 Security Summary:');
    const summary = securityMonitor.getSecuritySummary();
    console.log(JSON.stringify(summary, null, 2));

    // Build query
    let query = supabaseAdmin
      .from('security_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    // Apply filters
    if (eventType && eventType !== 'null') {
      query = query.eq('event_type', eventType);
    }

    if (ipAddress && ipAddress !== 'null') {
      query = query.eq('ip_address', ipAddress);
    }

    // Get recent events from database
    console.log(`\n\n🔍 Recent Security Events (last ${limit}):`);
    const { data: events, error } = await query;

    if (error) {
      if (error.code === '42P01') {
        console.error('❌ Error: security_logs table does not exist!');
        console.error('💡 Run the migration: create_security_logs_table.sql');
        return;
      }
      console.error('❌ Error fetching security logs:', error);
      return;
    }

    if (!events || events.length === 0) {
      console.log('✅ No security events found.');
      return;
    }

    console.log(`\n📋 Found ${events.length} event(s):\n`);

    events.forEach((event, index) => {
      console.log(`\n[${index + 1}] ${event.timestamp || 'N/A'}`);
      console.log(`   Type: ${event.event_type}`);
      if (event.ip_address) console.log(`   IP: ${event.ip_address}`);
      if (event.email) console.log(`   Email: ${event.email}`);
      if (event.reason) console.log(`   Reason: ${event.reason}`);
      if (event.url) console.log(`   URL: ${event.url}`);
      if (event.method) console.log(`   Method: ${event.method}`);
      if (event.memory_usage_mb) console.log(`   Memory: ${event.memory_usage_mb} MB`);
      if (event.user_agent) console.log(`   User Agent: ${event.user_agent}`);
      if (event.event_data && Object.keys(event.event_data).length > 0) {
        console.log(`   Additional Data: ${JSON.stringify(event.event_data, null, 2).split('\n').join('\n      ')}`);
      }
    });

    console.log('\n' + '='.repeat(120));
    console.log(`\n✅ Displayed ${events.length} event(s)`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

viewSecurityLogs();

