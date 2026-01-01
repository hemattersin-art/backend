/**
 * List Users with Logs Script
 * 
 * Lists all users who have interaction logs in Supabase Storage
 * Usage: node scripts/listUsersWithLogs.js
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

function unsanitizeEmail(folderName) {
  return folderName.replace('_at_', '@');
}

async function listUsersWithLogs() {
  try {
    console.log('🔍 Fetching list of users with logs...\n');

    const { data, error } = await supabaseAdmin.storage
      .from('logs')
      .list('logs', {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      if (error.statusCode === 404 || error.message.includes('not found')) {
        console.log('✅ No logs bucket found or empty.');
        return;
      }
      console.error('❌ Error listing logs:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.log('✅ No users with logs found.');
      return;
    }

    console.log(`📊 Found ${data.length} user(s) with logs:\n`);
    console.log('='.repeat(80));

    data.forEach((folder, index) => {
      const userEmail = unsanitizeEmail(folder.name);
      console.log(`[${index + 1}] ${userEmail}`);
      if (folder.created_at) {
        console.log(`    Created: ${folder.created_at}`);
      }
      if (folder.updated_at) {
        console.log(`    Updated: ${folder.updated_at}`);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Total: ${data.length} user(s) with logs`);
    console.log(`\n💡 To view logs for a specific user, run:`);
    console.log(`   node scripts/viewUserLogs.js <user_email>`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listUsersWithLogs();

