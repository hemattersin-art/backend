/**
 * Script to manually trigger Google Calendar sync for all psychologists
 * This updates the availability table to block slots based on Google Calendar events
 * 
 * Usage: node backend/trigger-calendar-sync.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');
const googleCalendarService = require('./utils/googleCalendarService');
const calendarSyncService = require('./services/calendarSyncService');

async function triggerCalendarSync() {
  console.log('🔄 Starting manual Google Calendar sync for all psychologists...\n');

  try {
    // Get all psychologists with Google Calendar credentials
    const { data: psychologists, error } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .not('google_calendar_credentials', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch psychologists: ${error.message}`);
    }

    // Filter out assessment accounts
    const validPsychologists = (psychologists || []).filter(p => {
      const email = p.email?.toLowerCase() || '';
      return !email.includes('assessment') && !email.includes('koottassesment');
    });

    console.log(`📋 Found ${validPsychologists.length} psychologists with Google Calendar to sync\n`);

    if (validPsychologists.length === 0) {
      console.log('⚠️  No psychologists found with Google Calendar credentials');
      return;
    }

    // Sync each psychologist
    const syncResults = [];
    for (const psychologist of validPsychologists) {
      try {
        console.log(`🔄 Syncing: ${psychologist.first_name} ${psychologist.last_name} (${psychologist.email})...`);
        
        // Use calendarSyncService to sync (this updates the availability table)
        const result = await calendarSyncService.syncPsychologistCalendar(psychologist);
        
        if (result.success) {
          console.log(`   ✅ Synced successfully - ${result.blockedSlots?.length || 0} slots blocked`);
          syncResults.push({ psychologist: psychologist.email, success: true, blockedSlots: result.blockedSlots?.length || 0 });
        } else {
          console.log(`   ⚠️  Sync completed with warnings: ${result.message || 'Unknown issue'}`);
          syncResults.push({ psychologist: psychologist.email, success: false, error: result.message });
        }
      } catch (error) {
        console.error(`   ❌ Error syncing ${psychologist.email}:`, error.message);
        syncResults.push({ psychologist: psychologist.email, success: false, error: error.message });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SYNC SUMMARY');
    console.log('='.repeat(80));
    const successful = syncResults.filter(r => r.success).length;
    const failed = syncResults.filter(r => !r.success).length;
    const totalBlocked = syncResults.reduce((sum, r) => sum + (r.blockedSlots || 0), 0);
    
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`🚫 Total slots blocked: ${totalBlocked}`);
    console.log('='.repeat(80));

    if (failed > 0) {
      console.log('\n⚠️  Failed syncs:');
      syncResults.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.psychologist}: ${r.error}`);
      });
    }

    console.log('\n✅ Calendar sync completed!');
    console.log('💡 You can now run the test script to verify: node backend/test-psychologist-calendar-sync.js\n');

  } catch (error) {
    console.error('❌ Error during calendar sync:', error);
    process.exit(1);
  }
}

// Run the sync
triggerCalendarSync()
  .then(() => {
    console.log('Script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
