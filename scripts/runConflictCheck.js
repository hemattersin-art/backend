/**
 * Manual script to run the daily calendar conflict checker
 * Usage: node scripts/runConflictCheck.js
 */

require('dotenv').config();
const dailyCalendarConflictAlert = require('../services/dailyCalendarConflictAlert');

async function runConflictCheck() {
  try {
    console.log('🔍 Starting manual calendar conflict check...');
    await dailyCalendarConflictAlert.triggerConflictCheck();
    console.log('✅ Conflict check completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running conflict check:', error);
    process.exit(1);
  }
}

runConflictCheck();

