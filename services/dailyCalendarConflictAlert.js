/**
 * Daily Calendar Conflict Monitor Service
 * Runs every day at 1:00 AM to check for conflicts between Google Calendar events
 * and availability slots for all psychologists with synced calendars
 * 
 * Sends email and WhatsApp notifications for all psychologists:
 * - Conflict notifications when conflicts are detected
 * - No conflict notifications when everything is working correctly
 */

const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');
const calendarSyncService = require('./calendarSyncService');
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
    this.adminEmail = 'koottfordeveloper@gmail.com';
    this.adminWhatsApp = '+91 8281540004';
  }

  /**
   * Start the daily conflict monitor service
   * Runs every day at 1:00 AM
   */
  start() {
    console.log('🔍 Starting Daily Calendar Conflict Monitor Service...');
    console.log('   Schedule: Every day at 1:00 AM');
    console.log('   Notifications: Always sent (conflicts and no conflicts)');
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
   * Convert 12-hour time to 24-hour format (matches availabilityController logic)
   */
  convertTo24Hour(timeStr) {
    if (!timeStr) return null;
    
    const time = typeof timeStr === 'string' ? timeStr.trim() : String(timeStr).trim();
    
    // If already in 24-hour format (no AM/PM), extract HH:MM
    if (!time.includes('AM') && !time.includes('PM')) {
      // Extract first 5 characters (HH:MM) if longer string
      const match = time.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        const hours = parseInt(match[1]);
        const minutes = match[2];
        return `${String(hours).padStart(2, '0')}:${minutes}`;
      }
      return time.substring(0, 5);
    }
    
    // Parse 12-hour format (e.g., "5:00 PM" or "5:00PM")
    const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;
    
    let hour24 = parseInt(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    
    if (period === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    return `${String(hour24).padStart(2, '0')}:${minutes}`;
  }

  /**
   * Format time to HH:MM
   */
  formatTime(date) {
    return dayjs(date).utc().tz('Asia/Kolkata').format('HH:mm');
  }

  /**
   * Format date to YYYY-MM-DD
   */
  formatDate(date) {
    return dayjs(date).utc().tz('Asia/Kolkata').format('YYYY-MM-DD');
  }

  /**
   * Check if a time slot conflicts with calendar events
   */
  isTimeSlotBlocked(timeSlot12Hour, calendarEvents, dateStr) {
    const time24Hour = this.convertTo24Hour(timeSlot12Hour);
    if (!time24Hour) return false;
    
    const [hours, minutes] = time24Hour.split(':').map(Number);
    // Parse the slot time directly in IST timezone (not convert to IST)
    const slotStart = dayjs.tz(`${dateStr} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, 'Asia/Kolkata');
    const slotEnd = slotStart.add(60, 'minutes');

    return calendarEvents.some(event => {
      // event.start and event.end are Date objects from getBusyTimeSlots
      // Date objects are stored internally as UTC milliseconds
      // Parse as UTC first, then convert to IST for accurate timezone handling
      const eventStart = dayjs(event.start).utc().tz('Asia/Kolkata');
      const eventEnd = dayjs(event.end).utc().tz('Asia/Kolkata');
      
      // Check for actual overlap
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
        
        // Get calendar events for this date (convert to IST first for accurate date comparison)
        const dayEvents = activeEvents.filter(event => {
          // Parse as UTC first, then convert to IST for accurate timezone handling
          const eventStartIST = dayjs(event.start).utc().tz('Asia/Kolkata');
          const eventDate = eventStartIST.format('YYYY-MM-DD');
          return eventDate === dateStr;
        });

        // Check if any availability slots conflict with calendar events
        for (const slot of availabilitySlots) {
          const slotTime = typeof slot === 'string' ? slot : slot.time || slot;
          
          if (this.isTimeSlotBlocked(slotTime, dayEvents, dateStr)) {
            // Find conflicting events
            const time24Hour = this.convertTo24Hour(slotTime);
            if (!time24Hour) continue; // Skip invalid times
            const [hours, minutes] = time24Hour.split(':').map(Number);
            // Parse the slot time directly in IST timezone (not convert to IST)
            const slotStart = dayjs.tz(`${dateStr} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, 'Asia/Kolkata');
            const slotEnd = slotStart.add(60, 'minutes');
            
            const conflictingEvents = dayEvents.filter(event => {
              // Parse as UTC first, then convert to IST for accurate timezone handling
              const eventStart = dayjs(event.start).utc().tz('Asia/Kolkata');
              const eventEnd = dayjs(event.end).utc().tz('Asia/Kolkata');
              return slotStart.isBefore(eventEnd) && slotEnd.isAfter(eventStart);
            }).map(e => ({
              title: e.title,
              start: dayjs(e.start).utc().tz('Asia/Kolkata').format('HH:mm'),
              end: dayjs(e.end).utc().tz('Asia/Kolkata').format('HH:mm'),
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
          
          // Parse as UTC first, then convert to IST for accurate timezone handling
          const eventStart = dayjs(event.start).utc().tz('Asia/Kolkata');
          const eventEnd = dayjs(event.end).utc().tz('Asia/Kolkata');
          const eventStartTime = eventStart.format('HH:mm');
          const eventEndTime = eventEnd.format('HH:mm');
          
          // Check if this event time overlaps with any available slot
          const overlappingSlots = availabilitySlots.filter(slot => {
            const slotTime = typeof slot === 'string' ? slot : slot.time || slot;
            const time24Hour = this.convertTo24Hour(slotTime);
            if (!time24Hour) return false;
            
            const [hours, minutes] = time24Hour.split(':').map(Number);
            // Parse the slot time directly in IST timezone (not convert to IST)
            const slotStart = dayjs.tz(`${dateStr} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, 'Asia/Kolkata');
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
    const psychologistId = psychologist.id;
    
    let message = `🚨 Calendar Sync Conflict Detected\n\n`;
    message += `👤 Psychologist: ${psychologistName}\n`;
    message += `🆔 Doctor ID: ${psychologistId}\n`;
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
    const psychologistId = psychologist.id;
    
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">🚨 Calendar Sync Conflict Detected</h2>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>👤 Psychologist:</strong> ${psychologistName}</p>
          <p><strong>🆔 Doctor ID:</strong> ${psychologistId}</p>
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
      const subject = `🚨 Calendar Sync Conflict: ${psychologist.first_name} ${psychologist.last_name} (ID: ${psychologist.id}) - ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}`;
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
   * Format no conflicts message for email/WhatsApp
   */
  formatNoConflictsForNotification(psychologist) {
    const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`;
    const psychologistEmail = psychologist.email;
    const psychologistId = psychologist.id;
    
    let message = `✅ Calendar Sync Status: No Conflicts\n\n`;
    message += `👤 Psychologist: ${psychologistName}\n`;
    message += `🆔 Doctor ID: ${psychologistId}\n`;
    message += `📧 Email: ${psychologistEmail}\n`;
    message += `✅ Status: Calendar sync is working correctly - no conflicts detected.\n`;

    return message;
  }

  /**
   * Format no conflicts message for HTML email
   */
  formatNoConflictsForEmail(psychologist) {
    const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`;
    const psychologistEmail = psychologist.email;
    const psychologistId = psychologist.id;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #2e7d32;">✅ Calendar Sync Status: No Conflicts</h2>
        
        <div style="background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2e7d32;">
          <p><strong>👤 Psychologist:</strong> ${psychologistName}</p>
          <p><strong>🆔 Doctor ID:</strong> ${psychologistId}</p>
          <p><strong>📧 Email:</strong> ${psychologistEmail}</p>
          <p style="margin-top: 15px; color: #2e7d32;"><strong>✅ Status:</strong> Calendar sync is working correctly - no conflicts detected.</p>
        </div>
      </div>
    `;

    return html;
  }

  /**
   * Send no conflicts email
   */
  async sendNoConflictsEmail(psychologist) {
    try {
      const subject = `✅ Calendar Sync Status: ${psychologist.first_name} ${psychologist.last_name} (ID: ${psychologist.id}) - No Conflicts`;
      const html = this.formatNoConflictsForEmail(psychologist);
      const text = this.formatNoConflictsForNotification(psychologist);

      await emailService.sendEmail({
        to: this.adminEmail,
        subject: subject,
        html: html,
        text: text
      });

      console.log(`   ✅ No conflicts email sent to ${this.adminEmail}`);
    } catch (error) {
      console.error(`   ❌ Error sending no conflicts email:`, error);
    }
  }

  /**
   * Send no conflicts WhatsApp
   */
  async sendNoConflictsWhatsApp(psychologist) {
    try {
      const message = this.formatNoConflictsForNotification(psychologist);
      
      await whatsappService.sendWhatsAppTextWithRetry(this.adminWhatsApp, message);
      
      console.log(`   ✅ No conflicts WhatsApp sent to ${this.adminWhatsApp}`);
    } catch (error) {
      console.error(`   ❌ Error sending no conflicts WhatsApp:`, error);
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

      // Step 1: Sync Google Calendar and block slots for each psychologist BEFORE checking conflicts
      console.log(`\n🔄 Step 1: Syncing Google Calendar and blocking slots...\n`);
      for (const psychologist of validPsychologists) {
        try {
          console.log(`🔄 Syncing calendar for: ${psychologist.first_name} ${psychologist.last_name} (ID: ${psychologist.id})...`);
          
          // Sync calendar events and block conflicting slots
          // syncPsychologistCalendar handles date range internally (21 days by default)
          await calendarSyncService.syncPsychologistCalendar(psychologist);
          
          console.log(`   ✅ Calendar synced and slots blocked`);
        } catch (syncError) {
          console.error(`   ⚠️  Error syncing calendar for ${psychologist.first_name} ${psychologist.last_name}:`, syncError.message);
          // Continue with conflict check even if sync fails
        }
      }

      // Step 2: Check for conflicts after syncing
      console.log(`\n🔍 Step 2: Checking for conflicts after sync...\n`);
      for (const psychologist of validPsychologists) {
        console.log(`🔍 Checking: ${psychologist.first_name} ${psychologist.last_name} (ID: ${psychologist.id})...`);
        
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

      // Send notifications for all psychologists (conflicts or no conflicts)
      console.log(`\n📧 Sending notifications...\n`);

      // Send notifications for psychologists with conflicts
      if (psychologistsWithConflicts.length > 0) {
        console.log(`🚨 Found conflicts for ${psychologistsWithConflicts.length} psychologist(s)`);
        for (const { psychologist, conflicts } of psychologistsWithConflicts) {
          await this.sendConflictEmail(psychologist, conflicts);
          await this.sendConflictWhatsApp(psychologist, conflicts);
          
          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log(`✅ Conflict notifications sent for ${psychologistsWithConflicts.length} psychologist(s)`);
      }

      // Send notifications for psychologists without conflicts
      const psychologistsWithoutConflicts = validPsychologists.filter(p => {
        return !psychologistsWithConflicts.some(pwc => pwc.psychologist.id === p.id);
      });

      if (psychologistsWithoutConflicts.length > 0) {
        console.log(`\n✅ No conflicts detected for ${psychologistsWithoutConflicts.length} psychologist(s)`);
        for (const psychologist of psychologistsWithoutConflicts) {
          await this.sendNoConflictsEmail(psychologist);
          await this.sendNoConflictsWhatsApp(psychologist);
          
          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log(`✅ No conflicts notifications sent for ${psychologistsWithoutConflicts.length} psychologist(s)`);
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
