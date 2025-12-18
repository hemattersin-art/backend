/**
 * Script to manually trigger calendar conflict check for all psychologists
 * This checks for conflicts between Google Calendar events and availability slots
 * 
 * Usage: node backend/trigger-conflict-check.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const dailyCalendarConflictAlert = require('./services/dailyCalendarConflictAlert');

// Run the conflict check
dailyCalendarConflictAlert.triggerConflictCheck()
  .then(() => {
    console.log('\n✅ Conflict check script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
