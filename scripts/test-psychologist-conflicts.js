/**
 * Test script to check calendar conflicts for a specific psychologist
 * 
 * Usage: node backend/scripts/test-psychologist-conflicts.js <psychologist_id>
 * Example: node backend/scripts/test-psychologist-conflicts.js 0f3d9a3c-cefa-4ce7-a7d6-ba570643770b
 */

require('dotenv').config();

const { supabaseAdmin } = require('../config/supabase');
const dailyCalendarConflictAlert = require('../services/dailyCalendarConflictAlert');

async function testPsychologistConflicts(psychologistId) {
  console.log('🔍 Testing Calendar Conflicts for Psychologist\n');
  console.log('='.repeat(80));
  
  try {
    // Get psychologist details
    const { data: psychologist, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .eq('id', psychologistId)
      .single();

    if (psychError || !psychologist) {
      console.error('❌ Psychologist not found:', psychologistId);
      console.error('Error:', psychError);
      process.exit(1);
    }

    console.log(`👤 Psychologist: ${psychologist.first_name} ${psychologist.last_name}`);
    console.log(`🆔 Doctor ID: ${psychologist.id}`);
    console.log(`📧 Email: ${psychologist.email}`);
    console.log(`🔑 Has Google Calendar: ${!!psychologist.google_calendar_credentials}\n`);

    if (!psychologist.google_calendar_credentials) {
      console.error('❌ Psychologist does not have Google Calendar credentials');
      process.exit(1);
    }

    // Check conflicts using the conflict monitor service
    console.log('🔍 Checking for conflicts...\n');
    const conflicts = await dailyCalendarConflictAlert.checkPsychologistConflicts(psychologist);

    if (conflicts.length === 0) {
      console.log('✅ No conflicts found!');
    } else {
      console.log(`\n🚨 Found ${conflicts.length} conflict(s):\n`);
      
      // Group conflicts by type
      const slotNotBlocked = conflicts.filter(c => c.type === 'slot_not_blocked');
      const eventNotBlocking = conflicts.filter(c => c.type === 'calendar_event_not_blocking');
      
      console.log(`📊 Conflict Summary:`);
      console.log(`   - Slots Not Blocked: ${slotNotBlocked.length}`);
      console.log(`   - Events Not Blocking: ${eventNotBlocking.length}\n`);

      // Display conflicts in detail
      conflicts.forEach((conflict, index) => {
        console.log(`${'─'.repeat(80)}`);
        console.log(`Conflict ${index + 1}: ${conflict.type === 'slot_not_blocked' ? 'Slot Not Blocked' : 'Event Not Blocking'}`);
        console.log(`📅 Date: ${conflict.date}`);
        
        if (conflict.type === 'slot_not_blocked') {
          console.log(`⏰ Time Slot: ${conflict.time} (${conflict.time24Hour})`);
          console.log(`⚠️  Issue: ${conflict.issue}`);
          if (conflict.conflictingEvents && conflict.conflictingEvents.length > 0) {
            console.log(`🔴 Conflicting Events:`);
            conflict.conflictingEvents.forEach(event => {
              console.log(`   - "${event.title}" (${event.start} - ${event.end})`);
            });
          }
        } else {
          console.log(`📅 Event: "${conflict.eventTitle}"`);
          console.log(`⏰ Event Time: ${conflict.eventStart} - ${conflict.eventEnd}`);
          console.log(`⚠️  Issue: ${conflict.issue}`);
          if (conflict.overlappingSlots && conflict.overlappingSlots.length > 0) {
            console.log(`🔴 Overlapping Available Slots:`);
            conflict.overlappingSlots.forEach(slot => {
              console.log(`   - ${slot}`);
            });
          }
        }
        console.log('');
      });

      // Analyze root causes
      console.log(`${'='.repeat(80)}`);
      console.log('🔍 Root Cause Analysis:\n');
      
      // Check if it's a timezone issue
      const timezoneIssues = conflicts.filter(c => {
        if (c.type === 'slot_not_blocked') {
          // Check if event time and slot time are far apart (timezone issue)
          return c.conflictingEvents?.some(e => {
            const eventHour = parseInt(e.start.split(':')[0]);
            const slotHour = parseInt(c.time24Hour.split(':')[0]);
            return Math.abs(eventHour - slotHour) > 5; // More than 5 hours difference
          });
        }
        return false;
      });

      if (timezoneIssues.length > 0) {
        console.log('⚠️  Potential Timezone Issues Detected:');
        console.log('   Events and slots have significant time differences');
        console.log('   This suggests timezone conversion problems\n');
      }

      // Check if it's a sync issue
      const syncIssues = conflicts.filter(c => c.type === 'calendar_event_not_blocking');
      if (syncIssues.length > 0) {
        console.log('⚠️  Calendar Sync Issues Detected:');
        console.log('   Google Calendar events exist but are not blocking availability slots');
        console.log('   This suggests the calendar sync service is not working correctly\n');
      }

      // Check if it's an overlap detection issue
      const overlapIssues = conflicts.filter(c => {
        if (c.type === 'slot_not_blocked') {
          return c.conflictingEvents?.some(e => {
            const eventStart = parseInt(e.start.split(':')[0]);
            const eventEnd = parseInt(e.end.split(':')[0]);
            const slotStart = parseInt(c.time24Hour.split(':')[0]);
            // Check if times actually overlap
            return !(slotStart >= eventEnd || (slotStart + 1) <= eventStart);
          });
        }
        return false;
      });

      if (overlapIssues.length > 0) {
        console.log('⚠️  Overlap Detection Issues:');
        console.log('   Events and slots appear to overlap but are not being blocked');
        console.log('   This suggests the overlap detection logic has issues\n');
      }

      // Format and display notification format
      console.log(`${'='.repeat(80)}`);
      console.log('📧 Notification Format:\n');
      const notification = dailyCalendarConflictAlert.formatConflictsForNotification(psychologist, conflicts);
      console.log(notification);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ Test completed');
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Error testing conflicts:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Get psychologist ID from command line arguments
const psychologistId = process.argv[2];

if (!psychologistId) {
  console.error('❌ Usage: node backend/scripts/test-psychologist-conflicts.js <psychologist_id>');
  console.error('Example: node backend/scripts/test-psychologist-conflicts.js 0f3d9a3c-cefa-4ce7-a7d6-ba570643770b');
  process.exit(1);
}

// Run the test
testPsychologistConflicts(psychologistId)
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

