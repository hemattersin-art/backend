// Load environment variables
require('dotenv').config();

const supabase = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');
const calendarSyncService = require('../services/calendarSyncService');

async function checkIreneCalendarSync() {
  try {
    console.log('🔍 Checking calendar sync for doctor "irene"...\n');

    // Use the provided psychologist ID
    const PSYCHOLOGIST_ID = '85780653-cc64-4da4-ae99-6295257e966e';
    
    // Get psychologist by ID
    const { data: psychologist, error: psychError } = await supabase
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .eq('id', PSYCHOLOGIST_ID)
      .single();

    if (psychError || !psychologist) {
      console.error('❌ Error fetching psychologist:', psychError);
      return;
    }

    console.log(`✅ Found psychologist: ${psychologist.first_name} ${psychologist.last_name}`);
    console.log(`   ID: ${psychologist.id}`);
    console.log(`   Email: ${psychologist.email}`);
    console.log(`   Google Calendar Connected: ${psychologist.google_calendar_credentials ? 'Yes' : 'No'}\n`);

    const irene = psychologist;

    console.log(`\n📅 Checking calendar sync for: ${irene.first_name} ${irene.last_name} (ID: ${irene.id})\n`);

    if (!irene.google_calendar_credentials) {
      console.log('❌ This psychologist does not have Google Calendar credentials connected');
      return;
    }

    // Get tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const tomorrowDateStr = tomorrow.toISOString().split('T')[0];
    console.log(`📅 Checking for date: ${tomorrowDateStr} (Tomorrow)\n`);

    // 1. Get external events from Google Calendar for tomorrow
    console.log('1️⃣ Fetching external events from Google Calendar...');
    const syncResult = await googleCalendarService.syncCalendarEvents(
      irene,
      tomorrow,
      tomorrowEnd
    );

    if (!syncResult.success) {
      console.error('❌ Error syncing calendar:', syncResult.error);
      return;
    }

    console.log(`   ✅ Found ${syncResult.totalEvents} total events`);
    console.log(`   ✅ Found ${syncResult.externalEvents.length} external events (excluding system events)\n`);

    if (syncResult.externalEvents.length === 0) {
      console.log('ℹ️  No external events found for tomorrow');
    } else {
      console.log('📋 External Events for Tomorrow:');
      const meetEvents = [];
      syncResult.externalEvents.forEach((event, index) => {
        const eventDate = event.start.toISOString().split('T')[0];
        const eventTime = event.start.toTimeString().split(' ')[0].substring(0, 5);
        const eventEndTime = event.end.toTimeString().split(' ')[0].substring(0, 5);
        const hasMeetLink = event.hangoutsLink || (event.conferenceData && event.conferenceData.entryPoints);
        
        console.log(`   ${index + 1}. ${event.title}`);
        console.log(`      Date: ${eventDate}`);
        console.log(`      Time: ${eventTime} - ${eventEndTime}`);
        console.log(`      Has Google Meet: ${hasMeetLink ? 'Yes ✅' : 'No'}`);
        if (hasMeetLink) {
          const meetLink = event.hangoutsLink || (event.conferenceData?.entryPoints?.[0]?.uri || 'N/A');
          console.log(`      Meet Link: ${meetLink}`);
          meetEvents.push({ title: event.title, time: eventTime, link: meetLink });
        }
        console.log('');
      });
      
      if (meetEvents.length > 0) {
        console.log(`📹 Found ${meetEvents.length} Google Meet event(s):`);
        meetEvents.forEach((meet, idx) => {
          console.log(`   ${idx + 1}. ${meet.time} - ${meet.title}`);
        });
        console.log('');
      }
    }

    // 2. Get availability for tomorrow (and also check the actual event dates)
    console.log('2️⃣ Checking availability for tomorrow and event dates...');
    
    // Get availability for tomorrow
    const { data: availability, error: availError } = await supabase
      .from('availability')
      .select('id, date, time_slots, is_available, updated_at')
      .eq('psychologist_id', irene.id)
      .eq('date', tomorrowDateStr)
      .single();
    
    // Also get all unique dates from external events
    const eventDates = [...new Set(syncResult.externalEvents.map(e => e.start.toISOString().split('T')[0]))];
    console.log(`   📅 Event dates found: ${eventDates.join(', ')}`);
    
    // Get availability for all event dates
    const { data: allAvailability, error: allAvailError } = await supabase
      .from('availability')
      .select('id, date, time_slots, is_available, updated_at')
      .eq('psychologist_id', irene.id)
      .in('date', eventDates);
    
    if (allAvailability && allAvailability.length > 0) {
      console.log(`   📊 Availability records found for ${allAvailability.length} date(s):`);
      allAvailability.forEach(avail => {
        console.log(`      ${avail.date}: ${avail.time_slots?.length || 0} slots - ${JSON.stringify(avail.time_slots || [])}`);
      });
    }

    if (availError) {
      if (availError.code === 'PGRST116') {
        console.log('   ⚠️  No availability record found for tomorrow');
      } else {
        console.error('   ❌ Error fetching availability:', availError);
      }
    } else if (availability) {
      console.log(`   ✅ Availability found for ${tomorrowDateStr}`);
      console.log(`   📊 Total time slots: ${availability.time_slots?.length || 0}`);
      console.log(`   📋 Time slots: ${JSON.stringify(availability.time_slots || [])}`);
      console.log(`   🔄 Last updated: ${availability.updated_at}`);
      console.log('');
    }

    // 3. Check if external event times are blocked in availability
    console.log('3️⃣ Cross-checking external events with availability...\n');
    
    if (syncResult.externalEvents.length > 0 && availability && availability.time_slots) {
      const blockedSlots = [];
      const availableSlots = [];
      
      syncResult.externalEvents.forEach(event => {
        const eventTime = event.start.toTimeString().split(' ')[0].substring(0, 5);
        const normalizedEventTime = normalizeTimeTo24Hour(eventTime);
        
        // Check if this time slot exists in availability
        const slotExists = availability.time_slots.some(slot => {
          const normalizedSlot = normalizeTimeTo24Hour(slot);
          return normalizedSlot === normalizedEventTime;
        });
        
        if (slotExists) {
          blockedSlots.push({
            event: event.title,
            time: normalizedEventTime,
            shouldBeBlocked: true
          });
        } else {
          availableSlots.push({
            event: event.title,
            time: normalizedEventTime,
            status: 'NOT in availability (may already be blocked or never existed)'
          });
        }
      });

      console.log('📊 Analysis Results:');
      console.log(`   ✅ External events that SHOULD be blocked: ${blockedSlots.length}`);
      blockedSlots.forEach(slot => {
        console.log(`      - ${slot.time} (${slot.event})`);
      });
      
      if (availableSlots.length > 0) {
        console.log(`\n   ⚠️  External events NOT in availability: ${availableSlots.length}`);
        availableSlots.forEach(slot => {
          console.log(`      - ${slot.time} (${slot.event}) - ${slot.status}`);
        });
      }

      // Check if slots are actually blocked (not in time_slots)
      console.log('\n4️⃣ Verifying if external event slots are actually blocked...\n');
      
      const actuallyBlocked = [];
      const notBlocked = [];
      
      syncResult.externalEvents.forEach(event => {
        const eventTime = event.start.toTimeString().split(' ')[0].substring(0, 5);
        const normalizedEventTime = normalizeTimeTo24Hour(eventTime);
        
        // Check if this time slot is in the availability time_slots array
        const isInAvailability = availability.time_slots.some(slot => {
          const normalizedSlot = normalizeTimeTo24Hour(slot);
          return normalizedSlot === normalizedEventTime;
        });
        
        if (isInAvailability) {
          notBlocked.push({
            event: event.title,
            time: normalizedEventTime,
            issue: '❌ This slot is still in availability - NOT BLOCKED!'
          });
        } else {
          actuallyBlocked.push({
            event: event.title,
            time: normalizedEventTime,
            status: '✅ Correctly blocked (not in availability)'
          });
        }
      });

      if (notBlocked.length > 0) {
        console.log('❌ ISSUE FOUND: External event slots that are NOT blocked:');
        notBlocked.forEach(slot => {
          console.log(`   ${slot.issue}`);
          console.log(`   Event: ${slot.event} at ${slot.time}`);
        });
        console.log('\n⚠️  These slots should be removed from availability but are still present!');
      } else {
        console.log('✅ All external event slots are correctly blocked in availability');
      }

      if (actuallyBlocked.length > 0) {
        console.log(`\n✅ Correctly blocked slots (${actuallyBlocked.length}):`);
        actuallyBlocked.forEach(slot => {
          console.log(`   - ${slot.time} (${slot.event})`);
        });
      }
    } else {
      console.log('ℹ️  Cannot cross-check: No external events or no availability found');
    }

    // 4. Run actual sync to see what happens
    console.log('\n5️⃣ Running calendar sync to block slots...');
    try {
      const syncResult2 = await calendarSyncService.syncPsychologistCalendar(irene);
      console.log(`   ✅ Sync completed`);
      console.log(`   📊 Total external events: ${syncResult2.totalExternalEvents}`);
      console.log(`   🚫 Blocked slots: ${syncResult2.blockedSlots.length}`);
      
      if (syncResult2.blockedSlots.length > 0) {
        console.log('\n   Blocked slots:');
        syncResult2.blockedSlots.forEach(slot => {
          console.log(`      - ${slot.date} ${slot.time} (${slot.reason})`);
        });
      }
      
      if (syncResult2.errors && syncResult2.errors.length > 0) {
        console.log('\n   ⚠️  Errors during sync:');
        syncResult2.errors.forEach(err => {
          console.log(`      - ${err.event}: ${err.error}`);
        });
      }
    } catch (syncError) {
      console.error('   ❌ Error running sync:', syncError);
    }

    // 5. Check availability again after sync
    console.log('\n6️⃣ Checking availability again after sync...');
    const { data: availabilityAfter, error: availErrorAfter } = await supabase
      .from('availability')
      .select('id, date, time_slots, is_available, updated_at')
      .eq('psychologist_id', irene.id)
      .eq('date', tomorrowDateStr)
      .single();

    if (availabilityAfter) {
      console.log(`   📊 Time slots after sync: ${availabilityAfter.time_slots?.length || 0}`);
      console.log(`   📋 Time slots: ${JSON.stringify(availabilityAfter.time_slots || [])}`);
      console.log(`   🔄 Last updated: ${availabilityAfter.updated_at}`);
      
      if (availability && availabilityAfter) {
        const beforeCount = availability.time_slots?.length || 0;
        const afterCount = availabilityAfter.time_slots?.length || 0;
        const removed = beforeCount - afterCount;
        
        if (removed > 0) {
          console.log(`\n   ✅ Sync removed ${removed} time slot(s) from availability`);
        } else if (removed < 0) {
          console.log(`\n   ⚠️  Availability increased by ${Math.abs(removed)} slots (unexpected)`);
        } else {
          console.log(`\n   ℹ️  No slots were removed (may already be blocked or no matches found)`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Helper function to normalize time format to HH:MM (24-hour)
function normalizeTimeTo24Hour(timeStr) {
  if (!timeStr) return null;
  
  // If already in HH:MM format (24-hour), return as is
  const hhmmMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    return `${hhmmMatch[1].padStart(2, '0')}:${hhmmMatch[2]}`;
  }
  
  // If in HH:MM-HH:MM format, extract first part
  const rangeMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})-/);
  if (rangeMatch) {
    return `${rangeMatch[1].padStart(2, '0')}:${rangeMatch[2]}`;
  }
  
  // If in 12-hour format (e.g., "2:30 PM" or "2:30PM")
  const ampmMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  }
  
  // Try to extract HH:MM from any string
  const extractMatch = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (extractMatch) {
    return `${extractMatch[1].padStart(2, '0')}:${extractMatch[2]}`;
  }
  
  return null;
}

// Run the check
checkIreneCalendarSync()
  .then(() => {
    console.log('\n✅ Check completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

