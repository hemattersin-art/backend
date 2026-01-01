/**
 * View User Interaction Logs Script
 * 
 * Displays user interaction logs from Supabase Storage
 * Usage: node scripts/viewUserLogs.js <user_email> [limit]
 * 
 * Examples:
 *   node scripts/viewUserLogs.js user@example.com        # All logs for user
 *   node scripts/viewUserLogs.js user@example.com 50    # Last 50 logs
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

function sanitizeEmail(email) {
  return email
    .replace('@', '_at_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '_')
    .toLowerCase()
    .trim();
}

async function viewUserLogs() {
  try {
    const userEmail = process.argv[2];
    const limit = parseInt(process.argv[3]);

    if (!userEmail) {
      console.error('❌ Error: User email is required');
      console.error('💡 Usage: node scripts/viewUserLogs.js <user_email> [limit]');
      process.exit(1);
    }

    console.log(`🔍 Fetching logs for: ${userEmail}\n`);

    const sanitizedEmail = sanitizeEmail(userEmail);
    const filePath = `logs/${sanitizedEmail}/all_logs.json`;

    const { data, error } = await supabaseAdmin.storage
      .from('logs')
      .download(filePath);

    if (error) {
      if (error.statusCode === 404 || error.message.includes('not found')) {
        console.log(`✅ No logs found for user: ${userEmail}`);
        return;
      }
      console.error('❌ Error downloading log file:', error);
      return;
    }

    const text = await data.text();
    let logs = [];

    try {
      logs = JSON.parse(text);
      if (!Array.isArray(logs)) {
        logs = [logs];
      }
    } catch (parseError) {
      console.error('❌ Error parsing log file:', parseError.message);
      return;
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply limit if specified
    const displayLogs = limit ? logs.slice(0, limit) : logs;

    console.log(`📊 Found ${logs.length} log entry/entries (showing ${displayLogs.length}):\n`);
    console.log('='.repeat(120));

    displayLogs.forEach((log, index) => {
      console.log(`\n[${index + 1}] ${log.timestamp}`);
      console.log(`   Action: ${log.action}`);
      console.log(`   Status: ${log.status}`);
      console.log(`   User: ${log.userEmail} (${log.userRole})`);
      if (log.details && Object.keys(log.details).length > 0) {
        console.log(`   Details: ${JSON.stringify(log.details, null, 2).split('\n').join('\n      ')}`);
      }
      if (log.error) {
        console.log(`   Error: ${log.error.message || JSON.stringify(log.error)}`);
      }
    });

    console.log('\n' + '='.repeat(120));
    console.log(`\n✅ Displayed ${displayLogs.length} log(s) for ${userEmail}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

viewUserLogs();

