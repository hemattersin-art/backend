const cron = require('node-cron');
const supabase = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');

class CalendarSyncService {
  constructor() {
    this.isRunning = false;
    // Track last sync time per psychologist to avoid unnecessary syncs
    this.lastSyncTimes = new Map();
    // Sync interval in minutes (configurable via env, default 10 minutes)
    this.syncIntervalMinutes = parseInt(process.env.CALENDAR_SYNC_INTERVAL_MINUTES) || 10;
  }

  /**
   * Start the calendar sync service
   * Runs at configurable intervals (default 10 minutes) to sync Google Calendar events
   * Optimized to reduce server load by staggering syncs and skipping recently synced psychologists
   */
  start() {
    console.log(`🔄 Starting Google Calendar sync service (interval: ${this.syncIntervalMinutes} minutes)...`);
    
    // Run at configurable interval (default 10 minutes - good balance between responsiveness and server load)
    cron.schedule(`*/${this.syncIntervalMinutes} * * * *`, async () => {
      if (this.isRunning) {
        console.log('⏭️  Calendar sync already running, skipping...');
        return;
      }
      
      await this.syncAllPsychologists();
    });

    // Also run immediately on startup
    setTimeout(() => {
      this.syncAllPsychologists();
    }, 5000); // Wait 5 seconds after startup
  }

  /**
   * Sync calendar events for all psychologists with Google Calendar credentials
   */
  async syncAllPsychologists() {
    this.isRunning = true;
    console.log('🔄 Starting calendar sync for all psychologists...');

    try {
      // Get all psychologists with Google Calendar credentials
      const { data: psychologists, error } = await supabase
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .not('google_calendar_credentials', 'is', null);

      if (error) {
        console.error('Error fetching psychologists:', error);
        return;
      }

      if (!psychologists || psychologists.length === 0) {
        console.log('ℹ️  No psychologists with Google Calendar credentials found');
        return;
      }

      console.log(`📅 Found ${psychologists.length} psychologists with Google Calendar credentials`);

      const syncResults = [];
      const errors = [];
      const skipped = [];

      // Sync each psychologist's calendar with delays to avoid overwhelming the server
      for (let i = 0; i < psychologists.length; i++) {
        const psychologist = psychologists[i];
        
        // Skip if synced recently (within last 5 minutes) to reduce load
        const lastSync = this.lastSyncTimes.get(psychologist.id);
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        
        if (lastSync && lastSync > fiveMinutesAgo) {
          const minutesSinceSync = Math.floor((now - lastSync) / (60 * 1000));
          console.log(`⏭️  Skipping ${psychologist.first_name} ${psychologist.last_name} - synced ${minutesSinceSync} minutes ago`);
          skipped.push({
            psychologist: `${psychologist.first_name} ${psychologist.last_name}`,
            reason: `Synced ${minutesSinceSync} minutes ago`
          });
          continue;
        }
        
        try {
          console.log(`🔄 Syncing calendar for ${psychologist.first_name} ${psychologist.last_name} (${i + 1}/${psychologists.length})...`);
          
          const result = await this.syncPsychologistCalendar(psychologist);
          syncResults.push(result);
          
          // Update last sync time
          this.lastSyncTimes.set(psychologist.id, now);
          
          console.log(`✅ Synced calendar for ${psychologist.first_name} ${psychologist.last_name}`);
          
          // Add delay between syncs to avoid rate limiting and reduce server load
          // 2 second delay between each psychologist (except the last one)
          if (i < psychologists.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`❌ Error syncing calendar for ${psychologist.first_name} ${psychologist.last_name}:`, error);
          errors.push({
            psychologist: `${psychologist.first_name} ${psychologist.last_name}`,
            error: error.message
          });
        }
      }

      console.log(`✅ Calendar sync completed. ${syncResults.length} successful, ${skipped.length} skipped, ${errors.length} errors`);
      
      if (errors.length > 0) {
        console.error('❌ Sync errors:', errors);
      }
      
      if (skipped.length > 0) {
        console.log(`ℹ️  Skipped ${skipped.length} psychologists (recently synced)`);
      }

    } catch (error) {
      console.error('❌ Error in calendar sync service:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Sync calendar events for a specific psychologist
   * @param {Object} psychologist - Psychologist object with Google Calendar credentials
   */
  async syncPsychologistCalendar(psychologist) {
    // Cover the entire current day and next 30 days so events earlier today are included
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30); // Sync next 30 days
    endDate.setHours(23, 59, 59, 999);

    // Sync calendar events
    const syncResult = await googleCalendarService.syncCalendarEvents(
      psychologist,
      startDate,
      endDate
    );

    if (!syncResult.success) {
      // Handle token expiration gracefully
      if (syncResult.error && syncResult.error.includes('expired')) {
        console.warn('⚠️ Google Calendar sync skipped due to expired tokens for psychologist:', psychologist.email);
        console.warn('💡 Psychologist needs to reconnect Google Calendar in settings');
        return {
          success: true,
          message: 'Calendar sync skipped - Google Calendar connection expired',
          blockedSlots: [],
          errors: ['Google Calendar connection has expired. Please reconnect in settings.']
        };
      }
      throw new Error(syncResult.error);
    }

    // Helper function to normalize time format to HH:MM (24-hour)
    const normalizeTimeTo24Hour = (timeStr) => {
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
    };

    // Block conflicting time slots in availability
    const blockedSlots = [];
    const errors = [];

    for (const event of syncResult.externalEvents) {
      try {
        // Extract date in local timezone to match availability dates (which are stored in local timezone)
        // Use the date part of the local date, not UTC
        const eventStartLocal = new Date(event.start);
        const year = eventStartLocal.getFullYear();
        const month = String(eventStartLocal.getMonth() + 1).padStart(2, '0');
        const day = String(eventStartLocal.getDate()).padStart(2, '0');
        const eventDate = `${year}-${month}-${day}`;
        
        const eventTime = eventStartLocal.toTimeString().split(' ')[0].substring(0, 5);
        const normalizedEventTime = normalizeTimeTo24Hour(eventTime);
        
        if (!normalizedEventTime) {
          console.warn(`⚠️ Could not normalize event time: ${eventTime} for event ${event.title}`);
          continue;
        }
        
        // Get current availability for this date
        const { data: availability, error: availError } = await supabase
          .from('availability')
          .select('id, date, time_slots')
          .eq('psychologist_id', psychologist.id)
          .eq('date', eventDate)
          .single();
        
        // Debug: Log what we're checking
        if (availability) {
          console.log(`🔍 Checking event "${event.title}" at ${normalizedEventTime} on ${eventDate} against availability date ${availability.date} with slots: ${JSON.stringify(availability.time_slots)}`);
        } else if (availError && availError.code !== 'PGRST116') {
          console.warn(`⚠️ Error fetching availability for ${eventDate}:`, availError.message);
        }

        if (availability) {
          // Remove conflicting time slot - normalize both slot and eventTime for comparison
          const updatedSlots = availability.time_slots.filter(slot => {
            const normalizedSlot = normalizeTimeTo24Hour(slot);
            const shouldKeep = normalizedSlot !== normalizedEventTime;
            
            // Debug logging for mismatches
            if (!shouldKeep) {
              console.log(`🔍 Found matching slot: "${slot}" (normalized: ${normalizedSlot}) matches event time ${normalizedEventTime} for "${event.title}"`);
            }
            
            return shouldKeep;
          });
          
          if (updatedSlots.length !== availability.time_slots.length) {
            const removedCount = availability.time_slots.length - updatedSlots.length;
            await supabase
              .from('availability')
              .update({ 
                time_slots: updatedSlots,
                updated_at: new Date().toISOString()
              })
              .eq('id', availability.id);

            blockedSlots.push({
              date: eventDate,
              time: normalizedEventTime,
              reason: event.title
            });
            
            console.log(`✅ Blocked ${removedCount} time slot(s) (${normalizedEventTime}) on ${eventDate} due to external event: ${event.title}`);
          } else {
            // Debug: log why slot wasn't blocked
            const slotTimes = availability.time_slots.map(s => {
              const norm = normalizeTimeTo24Hour(s);
              return `${s} (→${norm})`;
            }).join(', ');
            console.log(`⚠️  Event time ${normalizedEventTime} (${event.title}) did not match any slots: [${slotTimes}]`);
          }
        } else {
          console.log(`ℹ️  No availability record found for date ${eventDate}, skipping event ${event.title} at ${normalizedEventTime}`);
        }
      } catch (error) {
        console.error(`Error blocking slot for event ${event.title}:`, error);
        errors.push({
          event: event.title,
          error: error.message
        });
      }
    }

    return {
      psychologistId: psychologist.id,
      psychologistName: `${psychologist.first_name} ${psychologist.last_name}`,
      syncedAt: syncResult.syncedAt,
      totalExternalEvents: syncResult.externalEvents.length,
      blockedSlots: blockedSlots,
      errors: errors
    };
  }

  /**
   * Manually sync a specific psychologist's calendar
   * @param {string} psychologistId - Psychologist ID
   * @param {Date} startDate - Start date for sync
   * @param {Date} endDate - End date for sync
   */
  async syncPsychologistById(psychologistId, startDate, endDate) {
    try {
      const { data: psychologist, error } = await supabase
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (error || !psychologist) {
        throw new Error('Psychologist not found');
      }

      if (!psychologist.google_calendar_credentials) {
        throw new Error('Psychologist has no Google Calendar credentials');
      }

      const result = await this.syncPsychologistCalendar(psychologist);
      
      // Update last sync time for manual syncs too
      this.lastSyncTimes.set(psychologistId, Date.now());
      
      return result;
    } catch (error) {
      console.error(`Error syncing psychologist ${psychologistId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the calendar sync service
   */
  stop() {
    console.log('🛑 Stopping Google Calendar sync service...');
    cron.destroy();
  }
}

module.exports = new CalendarSyncService();
