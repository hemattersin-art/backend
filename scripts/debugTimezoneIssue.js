/**
 * Debug script to check timezone handling for Liana Sameer's calendar events
 * This will help identify the timezone conversion issue
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

async function debugTimezoneIssue() {
  try {
    console.log('🔍 Debugging timezone issue for Liana Sameer...\n');
    
    // Get Liana Sameer's psychologist record
    const psychologistId = 'cf792edb-a1b1-4eec-8bb7-b9ae5364975a';
    const { data: psychologist, error } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .eq('id', psychologistId)
      .single();

    if (error || !psychologist) {
      console.error('❌ Psychologist not found:', error);
      return;
    }

    console.log(`👤 Psychologist: ${psychologist.first_name} ${psychologist.last_name}`);
    console.log(`📧 Email: ${psychologist.email}\n`);

    if (!psychologist.google_calendar_credentials) {
      console.error('❌ No Google Calendar credentials found');
      return;
    }

    const credentials = typeof psychologist.google_calendar_credentials === 'string'
      ? JSON.parse(psychologist.google_calendar_credentials)
      : psychologist.google_calendar_credentials;

    // Get date range (next 21 days)
    const startDate = dayjs().tz('Asia/Kolkata').startOf('day');
    const endDate = startDate.add(21, 'days').endOf('day');

    console.log(`📅 Date Range: ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}`);
    console.log(`🌍 Timezone: Asia/Kolkata (IST)\n`);

    // Get Google Calendar events
    console.log('📥 Fetching Google Calendar events...\n');
    const calendarResult = await googleCalendarService.getBusyTimeSlots(
      credentials,
      startDate.toDate(),
      endDate.toDate()
    );

    const calendarEvents = calendarResult.busySlots || [];
    console.log(`📊 Found ${calendarEvents.length} total events\n`);

    // Filter events for December 25, 2025 (one of the conflict dates from email)
    const targetDate = '2025-12-25';
    const targetEvents = calendarEvents.filter(event => {
      const eventStartIST = dayjs(event.start).tz('Asia/Kolkata');
      const eventDate = eventStartIST.format('YYYY-MM-DD');
      return eventDate === targetDate;
    });

    console.log(`\n📅 Events on ${targetDate}:`);
    console.log('='.repeat(80));
    
    targetEvents.forEach((event, index) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      
      // Show raw Date object
      console.log(`\nEvent ${index + 1}: "${event.title}"`);
      console.log(`  Raw start (Date): ${eventStart.toISOString()}`);
      console.log(`  Raw end (Date): ${eventEnd.toISOString()}`);
      
      // Show UTC interpretation
      const eventStartUTC = dayjs(event.start).utc();
      const eventEndUTC = dayjs(event.end).utc();
      console.log(`  UTC: ${eventStartUTC.format('YYYY-MM-DD HH:mm:ss')} - ${eventEndUTC.format('HH:mm:ss')}`);
      
      // Show IST interpretation (current method)
      const eventStartIST = dayjs(event.start).tz('Asia/Kolkata');
      const eventEndIST = dayjs(event.end).tz('Asia/Kolkata');
      console.log(`  IST (current): ${eventStartIST.format('YYYY-MM-DD HH:mm:ss')} - ${eventEndIST.format('HH:mm:ss')}`);
      
      // Show what happens if we parse as UTC first
      const eventStartUTCFirst = dayjs(event.start).utc().tz('Asia/Kolkata');
      const eventEndUTCFirst = dayjs(event.end).utc().tz('Asia/Kolkata');
      console.log(`  UTC→IST: ${eventStartUTCFirst.format('YYYY-MM-DD HH:mm:ss')} - ${eventEndUTCFirst.format('HH:mm:ss')}`);
      
      // Show system timezone
      console.log(`  System local: ${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()}`);
    });

    // Now check availability slots for the same date
    console.log(`\n\n📋 Availability slots on ${targetDate}:`);
    console.log('='.repeat(80));
    
    const { data: availability, error: availError } = await supabaseAdmin
      .from('availability')
      .select('*')
      .eq('psychologist_id', psychologistId)
      .eq('date', targetDate)
      .single();

    if (availError || !availability) {
      console.log('  No availability record found for this date');
    } else {
      console.log(`  Time slots: ${JSON.stringify(availability.time_slots)}`);
      
      // Check each slot against events
      (availability.time_slots || []).forEach(slot => {
        const slotTime = typeof slot === 'string' ? slot : slot.time || slot;
        console.log(`\n  Slot: ${slotTime}`);
        
        // Convert to 24-hour
        let time24Hour = null;
        if (slotTime.includes('AM') || slotTime.includes('PM')) {
          const match = slotTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (match) {
            let hour24 = parseInt(match[1]);
            const minutes = match[2];
            const period = match[3].toUpperCase();
            if (period === 'PM' && hour24 !== 12) hour24 += 12;
            else if (period === 'AM' && hour24 === 12) hour24 = 0;
            time24Hour = `${String(hour24).padStart(2, '0')}:${minutes}`;
          }
        } else {
          const match = slotTime.match(/(\d{1,2}):(\d{2})/);
          if (match) {
            time24Hour = `${String(parseInt(match[1])).padStart(2, '0')}:${match[2]}`;
          }
        }
        
        if (time24Hour) {
          const [hours, minutes] = time24Hour.split(':').map(Number);
          const slotStart = dayjs(`${targetDate} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`).tz('Asia/Kolkata');
          const slotEnd = slotStart.add(60, 'minutes');
          
          console.log(`    Slot time (IST): ${slotStart.format('HH:mm')} - ${slotEnd.format('HH:mm')}`);
          
          // Check against each event
          targetEvents.forEach(event => {
            const eventStartIST = dayjs(event.start).tz('Asia/Kolkata');
            const eventEndIST = dayjs(event.end).tz('Asia/Kolkata');
            
            const overlaps = slotStart.isBefore(eventEndIST) && slotEnd.isAfter(eventStartIST);
            console.log(`    vs Event "${event.title}" (${eventStartIST.format('HH:mm')} - ${eventEndIST.format('HH:mm')}): ${overlaps ? '⚠️ OVERLAPS' : '✓ No overlap'}`);
          });
        }
      });
    }

    console.log('\n\n' + '='.repeat(80));
    console.log('🔍 Timezone Analysis Complete');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugTimezoneIssue();

