/**
 * Script to update all existing psychologists with default availability
 * Run with: node backend/scripts/updateAllPsychologistsAvailability.js
 */

require('dotenv').config();
const defaultAvailabilityService = require('../utils/defaultAvailabilityService');

async function main() {
  console.log('🚀 Starting to update all psychologists with default availability...');
  console.log('📅 This will add availability from today to 3 weeks ahead (10 AM - 1 PM and 2 PM - 5 PM daily)');
  console.log('');
  
  try {
    const result = await defaultAvailabilityService.updateAllPsychologistsAvailability();
    
    if (result.success) {
      console.log('');
      console.log('✅ SUCCESS!');
      console.log(`   - Updated: ${result.updated} psychologists`);
      if (result.errors > 0) {
        console.log(`   - Errors: ${result.errors} psychologists`);
      }
      console.log('');
      console.log('📝 Each psychologist now has:');
      console.log('   - Availability from today to 3 weeks ahead');
      console.log('   - Time slots: 10:00 AM to 1:00 PM and 2:00 PM to 5:00 PM (IST)');
      console.log('   - Total: 8 time slots per day');
      console.log('');
      process.exit(0);
    } else {
      console.error('');
      console.error('❌ FAILED!');
      console.error(`   Error: ${result.message}`);
      if (result.error) {
        console.error(`   Details: ${result.error}`);
      }
      console.error('');
      process.exit(1);
    }
  } catch (error) {
    console.error('');
    console.error('❌ UNEXPECTED ERROR!');
    console.error(`   ${error.message}`);
    console.error('');
    process.exit(1);
  }
}

// Run the script
main();

