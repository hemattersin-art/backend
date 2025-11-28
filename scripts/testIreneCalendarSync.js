/**
 * Test script to check calendar sync for Irene (psychologist ID: 85780653-cc64-4da4-ae99-6295257e966e)
 * 
 * This script checks:
 * 1. External Google Calendar events (including Google Meet events) for tomorrow
 * 2. Current availability for tomorrow
 * 3. Whether external event time slots are blocked in availability
 * 
 * Run this script when the backend server is running:
 * node scripts/testIreneCalendarSync.js
 */

const axios = require('axios');

const PSYCHOLOGIST_ID = '85780653-cc64-4da4-ae99-6295257e966e';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

// Get tomorrow's date
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowDateStr = tomorrow.toISOString().split('T')[0];

async function testCalendarSync() {
  try {
    console.log('🔍 Testing Calendar Sync for Irene');
    console.log(`📅 Psychologist ID: ${PSYCHOLOGIST_ID}`);
    console.log(`📅 Checking date: ${tomorrowDateStr} (Tomorrow)\n`);

    // Note: This requires admin authentication
    // You'll need to provide a valid admin token
    const adminToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken) {
      console.log('⚠️  ADMIN_TOKEN environment variable not set.');
      console.log('   To test this endpoint, you need to:');
      console.log('   1. Get an admin JWT token from your login');
      console.log('   2. Set it as: export ADMIN_TOKEN="your_token_here"');
      console.log('   3. Run this script again\n');
      console.log('   OR use the admin panel UI to call:');
      console.log(`   GET ${BACKEND_URL}/api/admin/psychologists/${PSYCHOLOGIST_ID}/calendar-sync-status?date=${tomorrowDateStr}\n`);
      return;
    }

    const url = `${BACKEND_URL}/api/admin/psychologists/${PSYCHOLOGIST_ID}/calendar-sync-status?date=${tomorrowDateStr}`;
    
    console.log(`📡 Calling: ${url}\n`);

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      const data = response.data.data;
      
      console.log('✅ Calendar Sync Status Check Results:\n');
      console.log(`👤 Psychologist: ${data.psychologist.name} (${data.psychologist.email})`);
      console.log(`📅 Date: ${data.date}`);
      console.log(`🔗 Google Calendar Connected: ${data.googleCalendarConnected ? 'Yes ✅' : 'No ❌'}\n`);

      if (!data.googleCalendarConnected) {
        console.log('⚠️  Google Calendar is not connected for this psychologist');
        return;
      }

      // Availability status
      console.log('📊 Availability Status:');
      if (data.availability.exists) {
        console.log(`   ✅ Availability record exists`);
        console.log(`   📋 Total time slots: ${data.availability.totalSlots}`);
        console.log(`   🕐 Time slots: ${JSON.stringify(data.availability.timeSlots)}`);
        console.log(`   🔄 Last updated: ${data.availability.lastUpdated}\n`);
      } else {
        console.log(`   ⚠️  No availability record found: ${data.availability.error}\n`);
      }

      // External events
      console.log(`📅 External Calendar Events (${data.summary.totalExternalEvents} total):\n`);
      
      if (data.externalEvents.length === 0) {
        console.log('   ℹ️  No external events found for tomorrow\n');
      } else {
        data.externalEvents.forEach((event, index) => {
          console.log(`   ${index + 1}. ${event.title}`);
          console.log(`      ⏰ Time: ${event.time} - ${event.endTime}`);
          console.log(`      📹 Google Meet: ${event.hasGoogleMeet ? 'Yes ✅' : 'No'}`);
          if (event.hasGoogleMeet && event.meetLink) {
            console.log(`      🔗 Meet Link: ${event.meetLink}`);
          }
          console.log(`      📊 Status: ${event.status}`);
          if (event.status === 'not_blocked') {
            console.log(`      ⚠️  ISSUE: This event is NOT blocked in availability!`);
          } else if (event.status === 'blocked') {
            console.log(`      ✅ Correctly blocked in availability`);
          }
          console.log('');
        });
      }

      // Summary
      console.log('📊 Summary:');
      console.log(`   Total external events: ${data.summary.totalExternalEvents}`);
      console.log(`   Events with Google Meet: ${data.summary.eventsWithGoogleMeet}`);
      console.log(`   ✅ Correctly blocked: ${data.summary.blockedEvents}`);
      console.log(`   ❌ NOT blocked (should be): ${data.summary.notBlockedEvents}`);
      console.log(`   ⚠️  No availability record: ${data.summary.noAvailabilityRecord}\n`);

      // Issues
      if (data.issues && data.issues.length > 0) {
        console.log('⚠️  ISSUES FOUND:');
        data.issues.forEach(issue => {
          console.log(`   - ${issue}`);
        });
        console.log('\n💡 These external events should be blocked in availability but are still present!');
        console.log('   The calendar sync may need to be run manually or there may be a bug.\n');
      } else {
        console.log('✅ All external events are correctly handled!\n');
      }

      // Google Meet events specifically
      const meetEvents = data.externalEvents.filter(e => e.hasGoogleMeet);
      if (meetEvents.length > 0) {
        console.log('📹 Google Meet Events Analysis:');
        console.log(`   Total Google Meet events: ${meetEvents.length}`);
        const blockedMeetEvents = meetEvents.filter(e => e.status === 'blocked').length;
        const notBlockedMeetEvents = meetEvents.filter(e => e.status === 'not_blocked').length;
        console.log(`   ✅ Blocked: ${blockedMeetEvents}`);
        console.log(`   ❌ NOT Blocked: ${notBlockedMeetEvents}\n`);
        
        if (notBlockedMeetEvents > 0) {
          console.log('⚠️  WARNING: Some Google Meet events are NOT blocked in availability!');
          meetEvents.filter(e => e.status === 'not_blocked').forEach(event => {
            console.log(`   - ${event.time} (${event.title})`);
          });
          console.log('');
        }
      }

    } else {
      console.error('❌ Error:', response.data.error || response.data.message);
    }

  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('❌ Network Error: Could not reach backend server');
      console.error('   Make sure the backend server is running at:', BACKEND_URL);
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

// Run the test
testCalendarSync()
  .then(() => {
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

