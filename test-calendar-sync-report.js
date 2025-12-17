/**
 * Detailed Calendar Sync Report
 * Shows external Google Calendar events and availability slots for each psychologist
 * 
 * Usage: node backend/test-calendar-sync-report.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');
const googleCalendarService = require('./utils/googleCalendarService');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// Date range: 3 weeks (21 days) to match availability window
const START_DATE = dayjs().tz('Asia/Kolkata');
const END_DATE = START_DATE.add(21, 'days');

/**
 * Format time to HH:MM
 */
function formatTime(date) {
  return dayjs(date).tz('Asia/Kolkata').format('HH:mm');
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
  return dayjs(date).tz('Asia/Kolkata').format('YYYY-MM-DD');
}

/**
 * Convert 12-hour time to 24-hour format
 */
function convertTo24Hour(time12) {
  if (!time12) return null;
  
  if (!time12.includes('AM') && !time12.includes('PM')) {
    return time12;
  }
  
  const [time, period] = time12.split(' ');
  const [hours, minutes] = time.split(':');
  let hour24 = parseInt(hours);
  
  if (period === 'PM' && hour24 !== 12) {
    hour24 += 12;
  } else if (period === 'AM' && hour24 === 12) {
    hour24 = 0;
  }
  
  return `${String(hour24).padStart(2, '0')}:${minutes || '00'}:00`;
}

/**
 * Get availability slots for a psychologist on a specific date
 */
async function getAvailabilitySlots(psychologistId, date) {
  try {
    const { data: availability, error } = await supabaseAdmin
      .from('availability')
      .select('*')
      .eq('psychologist_id', psychologistId)
      .eq('date', date)
      .single();

    if (error || !availability || !availability.is_available) {
      return { slots: [], blocked: [] };
    }

    const timeSlots = availability.time_slots || [];
    const blockedSlots = availability.blocked_slots || [];
    
    return {
      slots: Array.isArray(timeSlots) ? timeSlots : [],
      blocked: Array.isArray(blockedSlots) ? blockedSlots : [],
      total: timeSlots.length,
      available: timeSlots.length - blockedSlots.length
    };
  } catch (error) {
    console.error(`Error fetching availability for psychologist ${psychologistId} on ${date}:`, error);
    return { slots: [], blocked: [] };
  }
}

/**
 * Generate detailed report for a psychologist
 */
async function generateReport(psychologist) {
  const report = {
    id: psychologist.id,
    name: `${psychologist.first_name} ${psychologist.last_name}`,
    email: psychologist.email,
    hasCredentials: !!psychologist.google_calendar_credentials,
    events: [],
    availability: {},
    summary: {
      totalEvents: 0,
      totalDates: 0,
      datesWithAvailability: 0,
      datesWithoutAvailability: 0
    }
  };

  try {
    if (!psychologist.google_calendar_credentials) {
      report.error = 'No Google Calendar credentials found';
      return report;
    }

    const credentials = typeof psychologist.google_calendar_credentials === 'string'
      ? JSON.parse(psychologist.google_calendar_credentials)
      : psychologist.google_calendar_credentials;

    if (!credentials.access_token) {
      report.error = 'No access token in credentials';
      return report;
    }

    // Get Google Calendar events
    const calendarResult = await googleCalendarService.getBusyTimeSlots(
      credentials,
      START_DATE.toDate(),
      END_DATE.toDate()
    );

    const calendarEvents = calendarResult.busySlots || [];
    
    // Filter out cancelled events
    const activeEvents = calendarEvents.filter(e => e.status !== 'cancelled');
    
    report.summary.totalEvents = activeEvents.length;

    // Group events by date
    const eventsByDate = new Map();
    
    activeEvents.forEach(event => {
      const eventDate = formatDate(event.start);
      if (!eventsByDate.has(eventDate)) {
        eventsByDate.set(eventDate, []);
      }
      eventsByDate.get(eventDate).push({
        title: event.title || 'Untitled Event',
        start: formatTime(event.start),
        end: formatTime(event.end),
        startFull: dayjs(event.start).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm'),
        endFull: dayjs(event.end).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm'),
        status: event.status || 'confirmed'
      });
    });

    report.summary.totalDates = eventsByDate.size;

    // Get availability for each date with events
    for (const [dateStr, events] of eventsByDate.entries()) {
      const availability = await getAvailabilitySlots(psychologist.id, dateStr);
      
      // Sort events by start time
      events.sort((a, b) => a.start.localeCompare(b.start));
      
      report.availability[dateStr] = {
        date: dateStr,
        events: events,
        availability: {
          totalSlots: availability.total || 0,
          availableSlots: availability.slots || [],
          blockedSlots: availability.blocked || [],
          availableCount: availability.available || 0
        }
      };

      if (availability.total > 0) {
        report.summary.datesWithAvailability++;
      } else {
        report.summary.datesWithoutAvailability++;
      }
    }

  } catch (error) {
    report.error = `Error generating report: ${error.message}`;
    console.error(`Error for ${psychologist.email}:`, error);
  }

  return report;
}

/**
 * Print formatted report
 */
function printReport(report) {
  console.log('\n' + '='.repeat(100));
  console.log(`📋 CALENDAR SYNC REPORT: ${report.name}`);
  console.log(`📧 Email: ${report.email}`);
  console.log('='.repeat(100));

  if (report.error) {
    console.log(`❌ Error: ${report.error}\n`);
    return;
  }

  console.log(`\n📊 SUMMARY:`);
  console.log(`   Total External Events: ${report.summary.totalEvents}`);
  console.log(`   Dates with Events: ${report.summary.totalDates}`);
  console.log(`   Dates with Availability: ${report.summary.datesWithAvailability}`);
  console.log(`   Dates without Availability: ${report.summary.datesWithoutAvailability}`);

  if (Object.keys(report.availability).length === 0) {
    console.log(`\n✅ No external events found in the date range.\n`);
    return;
  }

  // Sort dates
  const sortedDates = Object.keys(report.availability).sort();

  console.log(`\n📅 DETAILED BREAKDOWN BY DATE:\n`);

  sortedDates.forEach(dateStr => {
    const dateData = report.availability[dateStr];
    const dayName = dayjs(dateStr).format('dddd');
    
    console.log('─'.repeat(100));
    console.log(`📅 ${dateStr} (${dayName})`);
    console.log('─'.repeat(100));

    // Show events
    console.log(`\n📆 External Google Calendar Events (${dateData.events.length}):`);
    dateData.events.forEach((event, idx) => {
      console.log(`   ${idx + 1}. "${event.title}"`);
      console.log(`      ⏰ Time: ${event.start} - ${event.end} IST`);
      console.log(`      📊 Status: ${event.status}`);
    });

    // Show availability
    console.log(`\n📋 Availability Slots:`);
    if (dateData.availability.totalSlots === 0) {
      console.log(`   ⚠️  No availability slots set for this date`);
    } else {
      console.log(`   Total Slots: ${dateData.availability.totalSlots}`);
      console.log(`   Available: ${dateData.availability.availableCount}`);
      console.log(`   Blocked: ${dateData.availability.blockedSlots.length}`);
      
      if (dateData.availability.availableSlots.length > 0) {
        console.log(`\n   ✅ Available Slots:`);
        dateData.availability.availableSlots.forEach(slot => {
          const time24 = convertTo24Hour(slot);
          console.log(`      • ${slot}${time24 ? ` (${time24.substring(0, 5)})` : ''}`);
        });
      }
      
      if (dateData.availability.blockedSlots.length > 0) {
        console.log(`\n   🚫 Blocked Slots:`);
        dateData.availability.blockedSlots.forEach(slot => {
          const time24 = convertTo24Hour(slot);
          console.log(`      • ${slot}${time24 ? ` (${time24.substring(0, 5)})` : ''}`);
        });
      }
    }

    // Check for overlaps
    console.log(`\n🔍 Overlap Analysis:`);
    let hasOverlaps = false;
    
    dateData.events.forEach(event => {
      const eventStart = dayjs(`${dateStr} ${event.start}:00`).tz('Asia/Kolkata');
      const eventEnd = dayjs(`${dateStr} ${event.end}:00`).tz('Asia/Kolkata');
      
      const overlappingSlots = dateData.availability.availableSlots.filter(slot => {
        const time24 = convertTo24Hour(slot);
        if (!time24) return false;
        
        const [hours, minutes] = time24.split(':').map(Number);
        const slotStart = dayjs(`${dateStr} ${hours}:${minutes}:00`).tz('Asia/Kolkata');
        const slotEnd = slotStart.add(60, 'minutes');
        
        return slotStart.isBefore(eventEnd) && slotEnd.isAfter(eventStart);
      });
      
      if (overlappingSlots.length > 0) {
        hasOverlaps = true;
        console.log(`   ⚠️  Event "${event.title}" (${event.start}-${event.end}) overlaps with available slots:`);
        overlappingSlots.forEach(slot => {
          console.log(`      • ${slot}`);
        });
      }
    });
    
    if (!hasOverlaps) {
      console.log(`   ✅ No overlapping available slots found - all conflicts properly blocked`);
    }

    console.log('');
  });
}

/**
 * Main function
 */
async function runReport() {
  console.log('📊 Generating Detailed Calendar Sync Report...\n');
  console.log(`📅 Date Range: ${formatDate(START_DATE)} to ${formatDate(END_DATE)}\n`);

  try {
    // Get all psychologists with Google Calendar
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

    console.log(`📋 Found ${validPsychologists.length} psychologists with Google Calendar\n`);

    if (validPsychologists.length === 0) {
      console.log('⚠️  No psychologists found with Google Calendar credentials');
      return;
    }

    // Generate report for each psychologist
    for (const psychologist of validPsychologists) {
      const report = await generateReport(psychologist);
      printReport(report);
    }

    console.log('\n' + '='.repeat(100));
    console.log('✅ Report generation completed!');
    console.log('='.repeat(100) + '\n');

  } catch (error) {
    console.error('❌ Error generating report:', error);
    process.exit(1);
  }
}

// Run the report
runReport()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
