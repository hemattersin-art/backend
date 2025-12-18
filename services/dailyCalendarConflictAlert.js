/**
 * Daily Calendar Conflict Monitor Service
 * Runs every day at 1:00 AM to check for conflicts between Google Calendar events
 * and availability slots for all psychologists with synced calendars
 * 
 * Sends email and WhatsApp notifications only when conflicts are detected
 */

const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');
const emailService = require('../utils/emailService');
const whatsappService = require('../utils/whatsappService');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

class CalendarConflictMonitorService {
  constructor() {
    this.isRunning = false;
    this.adminEmail = 'abhishekravi063@gmail.com';
    this.adminWhatsApp = '+91 8281540004';
  }

  /**
   * Start the daily conflict monitor service
   * Runs every day at 1:00 AM
   */
  start() {
    console.log('🔍 Starting Daily Calendar Conflict Monitor Service...');
    console.log('   Schedule: Every day at 1:00 AM');
    console.log('   Notifications: Only when conflicts detected');
    console.log(`   Email: ${this.adminEmail}`);
    console.log(`   WhatsApp: ${this.adminWhatsApp}\n`);

    // Run every day at 1:00 AM
    // Cron format: '0 1 * * *' = minute 0, hour 1, every day, every month, every day of week
    cron.schedule('0 1 * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️  Calendar conflict check already running, skipping...');
        return;
      }

      this.isRunning = true;
      console.log('🕐 Running daily calendar conflict check (1:00 AM)...');

      try {
        await this.checkForConflicts();
      } catch (error) {
        console.error('❌ Error in calendar conflict check:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✅ Calendar Conflict Monitor Service started');
  }

  /**
   * Convert 12-hour time to 24-hour format
   */
  convertTo24Hour(time12) {
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
   * Format time to HH:MM
   */
  formatTime(date) {
    return dayjs(date).tz('Asia/Kolkata').format('HH:mm');
  }

  /**
   * Format date to YYYY-MM-DD
   */
  formatDate(date) {
    return dayjs(date).tz('Asia/Kolkata').format('YYYY-MM-DD');
  }

  /**
   * Check if a time slot conflicts with calendar events
   */
  isTimeSlotBlocked(timeSlot12Hour, calendarEvents, dateStr) {
    const time24Hour = this.convertTo24Hour(timeSlot12Hour);
    if (!time24Hour) return false;
    
    const [hours, minutes] = time24Hour.split(':').map(Number);
    const slotStart = dayjs(`${dateStr} ${hours}:${minutes}:00`).tz('Asia/Kolkata');
    const slotEnd = slotStart.add(60, 'minutes');

    return calendarEvents.some(event => {
      const eventStart = dayjs(event.start).tz('Asia/Kolkata');
      const eventEnd = dayjs(event.end).tz('Asia/Kolkata');
      return slotStart.isBefore(eventEnd) && slotEnd.isAfter(eventStart);
    });
  }

  /**
   * Get availability slots for a psychologist on a specific date
   */
  async getAvailabilitySlots(psychologistId, date) {
    try {
      const { data: availability, error } = await supabaseAdmin
        .from('availability')
        .select('*')
        .eq('psychologist_id', psychologistId)
        .eq('date', date)
        .single();

      if (error || !availability || !availability.is_available) {
        return [];
      }

      const timeSlots = availability.time_slots || [];
      return Array.isArray(timeSlots) ? timeSlots : [];
    } catch (error) {
      console.error(`Error fetching availability for psychologist ${psychologistId} on ${date}:`, error);
      return [];
    }
  }

  /**
   * Check a single psychologist for conflicts
   */
  async checkPsychologistConflicts(psychologist) {
    const conflicts = [];

    try {
      if (!psychologist.google_calendar_credentials) {
        return conflicts;
      }

      const credentials = typeof psychologist.google_calendar_credentials === 'string'
        ? JSON.parse(psychologist.google_calendar_credentials)
        : psychologist.google_calendar_credentials;

      if (!credentials.access_token) {
        return conflicts;
      }

      // Get date range (next 21 days)
      const startDate = dayjs().tz('Asia/Kolkata').startOf('day');
      const endDate = startDate.add(21, 'days').endOf('day');

      // Get Google Calendar events
      const calendarResult = await googleCalendarService.getBusyTimeSlots(
        credentials,
        startDate.toDate(),
        endDate.toDate()
      );

      const calendarEvents = calendarResult.busySlots || [];
      // Filter out cancelled events and exclude certain event titles (like recurring meetings)
      const excludedEventTitles = ['Weekly Meeting', 'weekly meeting', 'WEEKLY MEETING'];
      const activeEvents = calendarEvents.filter(e => 
        e.status !== 'cancelled' && 
        !excludedEventTitles.some(excluded => e.title && e.title.includes(excluded))
      );

      // Check each day in the date range
      let currentDate = startDate;
      while (currentDate.isBefore(endDate)) {
        const dateStr = this.formatDate(currentDate);
        
        // Get availability slots for this date
        const availabilitySlots = await this.getAvailabilitySlots(psychologist.id, dateStr);
        
        // Get calendar events for this date
        const dayEvents = activeEvents.filter(event => {
          const eventDate = this.formatDate(event.start);
          return eventDate === dateStr;
        });

        // Check if any availability slots conflict with calendar events
        for (const slot of availabilitySlots) {
          const slotTime = typeof slot === 'string' ? slot : slot.time || slot;
          
          if (this.isTimeSlotBlocked(slotTime, dayEvents, dateStr)) {
            // Find conflicting events
            const time24Hour = this.convertTo24Hour(slotTime);
            const [hours, minutes] = time24Hour ? time24Hour.split(':').map(Number) : [0, 0];
            const slotStart = dayjs(`${dateStr} ${hours}:${minutes}:00`).tz('Asia/Kolkata');
            const slotEnd = slotStart.add(60, 'minutes');
            
            const conflictingEvents = dayEvents.filter(event => {
              const eventStart = dayjs(event.start).tz('Asia/Kolkata');
              const eventEnd = dayjs(event.end).tz('Asia/Kolkata');
              return slotStart.isBefore(eventEnd) && slotEnd.isAfter(eventStart);
            }).map(e => ({
              title: e.title,
              start: this.formatTime(e.start),
              end: this.formatTime(e.end),
              status: e.status || 'confirmed'
            }));
            
            if (conflictingEvents.length > 0) {
              conflicts.push({
                type: 'slot_not_blocked',
                date: dateStr,
                time: slotTime,
                time24Hour: time24Hour,
                issue: 'Availability slot is showing as available but has conflicting Google Calendar event',
                conflictingEvents: conflictingEvents
              });
            }
          }
        }

        // Reverse check: Calendar events that should block slots but might not be in availability
        // Exclude certain event titles (like recurring meetings)
        const excludedEventTitles = ['Weekly Meeting', 'weekly meeting', 'WEEKLY MEETING'];
        for (const event of dayEvents) {
          if (event.status === 'cancelled') continue;
          if (excludedEventTitles.some(excluded => event.title && event.title.includes(excluded))) continue;
          
          const eventStart = dayjs(event.start).tz('Asia/Kolkata');
          const eventEnd = dayjs(event.end).tz('Asia/Kolkata');
          const eventStartTime = this.formatTime(event.start);
          const eventEndTime = this.formatTime(event.end);
          
          // Check if this event time overlaps with any available slot
          const overlappingSlots = availabilitySlots.filter(slot => {
            const slotTime = typeof slot === 'string' ? slot : slot.time || slot;
            const time24Hour = this.convertTo24Hour(slotTime);
            if (!time24Hour) return false;
            
            const [hours, minutes] = time24Hour.split(':').map(Number);
            const slotStart = dayjs(`${dateStr} ${hours}:${minutes}:00`).tz('Asia/Kolkata');
            const slotEnd = slotStart.add(60, 'minutes');
            
            return slotStart.isBefore(eventEnd) && slotEnd.isAfter(eventStart);
          });
          
          if (overlappingSlots.length > 0) {
            conflicts.push({
              type: 'calendar_event_not_blocking',
              date: dateStr,
              eventTitle: event.title,
              eventStart: eventStartTime,
              eventEnd: eventEndTime,
              eventStatus: event.status || 'confirmed',
              issue: 'Google Calendar event exists but availability slots are still showing as available',
              overlappingSlots: overlappingSlots.map(s => typeof s === 'string' ? s : s.time || s)
            });
          }
        }

        currentDate = currentDate.add(1, 'day');
      }

    } catch (error) {
      console.error(`Error checking psychologist ${psychologist.email}:`, error);
    }

    return conflicts;
  }

  /**
   * Format conflicts for email/WhatsApp
   */
  formatConflictsForNotification(psychologist, conflicts) {
    const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`;
    const psychologistEmail = psychologist.email;
    
    let message = `🚨 Calendar Sync Conflict Detected\n\n`;
    message += `👤 Psychologist: ${psychologistName}\n`;
    message += `📧 Email: ${psychologistEmail}\n`;
    message += `📊 Total Conflicts: ${conflicts.length}\n\n`;
    message += `Conflicts:\n`;
    message += `${'─'.repeat(50)}\n\n`;

    conflicts.forEach((conflict, index) => {
      message += `${index + 1}. ${conflict.type === 'slot_not_blocked' ? 'Slot Not Blocked' : 'Event Not Blocking'}\n`;
      message += `   📅 Date: ${conflict.date}\n`;
      
      if (conflict.type === 'slot_not_blocked') {
        message += `   ⏰ Time Slot: ${conflict.time} (${conflict.time24Hour})\n`;
        message += `   ⚠️  Issue: ${conflict.issue}\n`;
        if (conflict.conflictingEvents && conflict.conflictingEvents.length > 0) {
          message += `   🔴 Conflicting Events:\n`;
          conflict.conflictingEvents.forEach(event => {
            message += `      - "${event.title}" (${event.start} - ${event.end})\n`;
          });
        }
      } else {
        message += `   📅 Event: "${conflict.eventTitle}"\n`;
        message += `   ⏰ Event Time: ${conflict.eventStart} - ${conflict.eventEnd}\n`;
        message += `   ⚠️  Issue: ${conflict.issue}\n`;
        if (conflict.overlappingSlots && conflict.overlappingSlots.length > 0) {
          message += `   🔴 Overlapping Available Slots:\n`;
          conflict.overlappingSlots.forEach(slot => {
            message += `      - ${slot}\n`;
          });
        }
      }
      message += `\n`;
    });

    return message;
  }

  /**
   * Format conflicts for HTML email
   */
  formatConflictsForEmail(psychologist, conflicts) {
    const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`;
    const psychologistEmail = psychologist.email;
    
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">🚨 Calendar Sync Conflict Detected</h2>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>👤 Psychologist:</strong> ${psychologistName}</p>
          <p><strong>📧 Email:</strong> ${psychologistEmail}</p>
          <p><strong>📊 Total Conflicts:</strong> ${conflicts.length}</p>
        </div>

        <h3 style="color: #1976d2; margin-top: 30px;">Conflict Details:</h3>
    `;

    conflicts.forEach((conflict, index) => {
      html += `
        <div style="border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 5px; background: #fff;">
          <h4 style="color: #d32f2f; margin-top: 0;">Conflict ${index + 1}: ${conflict.type === 'slot_not_blocked' ? 'Slot Not Blocked' : 'Event Not Blocking'}</h4>
          <p><strong>📅 Date:</strong> ${conflict.date}</p>
      `;

      if (conflict.type === 'slot_not_blocked') {
        html += `
          <p><strong>⏰ Time Slot:</strong> ${conflict.time} (${conflict.time24Hour})</p>
          <p><strong>⚠️ Issue:</strong> ${conflict.issue}</p>
        `;
        if (conflict.conflictingEvents && conflict.conflictingEvents.length > 0) {
          html += `<p><strong>🔴 Conflicting Events:</strong></p><ul>`;
          conflict.conflictingEvents.forEach(event => {
            html += `<li>"${event.title}" (${event.start} - ${event.end})</li>`;
          });
          html += `</ul>`;
        }
      } else {
        html += `
          <p><strong>📅 Event:</strong> "${conflict.eventTitle}"</p>
          <p><strong>⏰ Event Time:</strong> ${conflict.eventStart} - ${conflict.eventEnd}</p>
          <p><strong>⚠️ Issue:</strong> ${conflict.issue}</p>
        `;
        if (conflict.overlappingSlots && conflict.overlappingSlots.length > 0) {
          html += `<p><strong>🔴 Overlapping Available Slots:</strong></p><ul>`;
          conflict.overlappingSlots.forEach(slot => {
            html += `<li>${slot}</li>`;
          });
          html += `</ul>`;
        }
      }

      html += `</div>`;
    });

    html += `
        <div style="margin-top: 30px; padding: 15px; background: #e3f2fd; border-radius: 5px;">
          <p style="margin: 0;"><strong>Note:</strong> Please review these conflicts and ensure calendar sync is working correctly.</p>
        </div>
      </div>
    `;

    return html;
  }

  /**
   * Send notification email
   */
  async sendConflictEmail(psychologist, conflicts) {
    try {
      const subject = `🚨 Calendar Sync Conflict: ${psychologist.first_name} ${psychologist.last_name} (${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''})`;
      const html = this.formatConflictsForEmail(psychologist, conflicts);
      const text = this.formatConflictsForNotification(psychologist, conflicts);

      await emailService.sendEmail({
        to: this.adminEmail,
        subject: subject,
        html: html,
        text: text
      });

      console.log(`   ✅ Conflict email sent to ${this.adminEmail}`);
    } catch (error) {
      console.error(`   ❌ Error sending conflict email:`, error);
    }
  }

  /**
   * Send notification WhatsApp
   */
  async sendConflictWhatsApp(psychologist, conflicts) {
    try {
      const message = this.formatConflictsForNotification(psychologist, conflicts);
      
      await whatsappService.sendWhatsAppTextWithRetry(this.adminWhatsApp, message);
      
      console.log(`   ✅ Conflict WhatsApp sent to ${this.adminWhatsApp}`);
    } catch (error) {
      console.error(`   ❌ Error sending conflict WhatsApp:`, error);
    }
  }

  /**
   * Main function to check for conflicts
   */
  async checkForConflicts() {
    console.log('🔍 Checking for calendar sync conflicts...\n');

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

      console.log(`📋 Found ${validPsychologists.length} psychologists with Google Calendar to check\n`);

      if (validPsychologists.length === 0) {
        console.log('✅ No psychologists with Google Calendar found - nothing to check');
        return;
      }

      let totalConflicts = 0;
      const psychologistsWithConflicts = [];

      // Check each psychologist
      for (const psychologist of validPsychologists) {
        console.log(`🔍 Checking: ${psychologist.first_name} ${psychologist.last_name} (${psychologist.email})...`);
        
        const conflicts = await this.checkPsychologistConflicts(psychologist);
        
        if (conflicts.length > 0) {
          console.log(`   ⚠️  Found ${conflicts.length} conflict(s)`);
          totalConflicts += conflicts.length;
          psychologistsWithConflicts.push({
            psychologist,
            conflicts
          });
        } else {
          console.log(`   ✅ No conflicts found`);
        }
      }

      // Send notifications only if conflicts found
      if (psychologistsWithConflicts.length > 0) {
        console.log(`\n🚨 Found conflicts for ${psychologistsWithConflicts.length} psychologist(s)`);
        console.log(`📧 Sending notifications...\n`);

        // Send notification for each psychologist with conflicts
        for (const { psychologist, conflicts } of psychologistsWithConflicts) {
          await this.sendConflictEmail(psychologist, conflicts);
          await this.sendConflictWhatsApp(psychologist, conflicts);
          
          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`\n✅ Notifications sent for ${psychologistsWithConflicts.length} psychologist(s) with conflicts`);
      } else {
        console.log(`\n✅ No conflicts detected - all calendar syncs are working correctly!`);
        console.log(`   (No notifications sent)`);
      }

      // Summary
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 CHECK SUMMARY`);
      console.log(`${'='.repeat(80)}`);
      console.log(`✅ Psychologists Checked: ${validPsychologists.length}`);
      console.log(`⚠️  Psychologists with Conflicts: ${psychologistsWithConflicts.length}`);
      console.log(`🚨 Total Conflicts: ${totalConflicts}`);
      console.log(`${'='.repeat(80)}\n`);

    } catch (error) {
      console.error('❌ Error checking for conflicts:', error);
      throw error;
    }
  }

  /**
   * Manually trigger conflict check (for testing/admin use)
   */
  async triggerConflictCheck() {
    console.log('🔍 Manually triggering calendar conflict check...');
    await this.checkForConflicts();
  }

  /**
   * Stop the service
   */
  stop() {
    console.log('🛑 Stopping Calendar Conflict Monitor Service...');
    this.isRunning = false;
  }
}

// Export singleton instance
const dailyCalendarConflictAlert = new CalendarConflictMonitorService();

module.exports = dailyCalendarConflictAlert;
