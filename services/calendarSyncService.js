const cron = require('node-cron');
const supabase = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');

class CalendarSyncService {
  constructor() {
    this.isRunning = false;
    // Track last sync time per psychologist to avoid unnecessary syncs
    this.lastSyncTimes = new Map();
    // Sync interval in minutes (configurable via env, default 15 minutes)
    this.syncIntervalMinutes = parseInt(process.env.CALENDAR_SYNC_INTERVAL_MINUTES) || 15;
  }

  /**
   * Start the calendar sync service
   * Runs at configurable intervals (default 15 minutes) to sync Google Calendar events
   * Optimized to reduce server load by staggering syncs and skipping recently synced psychologists
   */
  start() {
    console.log(`🔄 Starting Google Calendar sync service (interval: ${this.syncIntervalMinutes} minutes)...`);
    
    // Run at configurable interval (default 15 minutes - good balance between responsiveness and server load)
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

      // OPTIMIZATION: Process psychologists in parallel batches (concurrency limit: 3)
      // This is faster than sequential but still respects rate limits
      const concurrencyLimit = 3;
      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000);
      
      // Filter out recently synced psychologists first
      const psychologistsToSync = psychologists.filter(psychologist => {
        const lastSync = this.lastSyncTimes.get(psychologist.id);
        if (lastSync && lastSync > fiveMinutesAgo) {
          const minutesSinceSync = Math.floor((now - lastSync) / (60 * 1000));
          skipped.push({
            psychologist: `${psychologist.first_name} ${psychologist.last_name}`,
            reason: `Synced ${minutesSinceSync} minutes ago`
          });
          return false;
        }
        return true;
      });
      
      // Process in batches with concurrency limit
      for (let i = 0; i < psychologistsToSync.length; i += concurrencyLimit) {
        const batch = psychologistsToSync.slice(i, i + concurrencyLimit);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (psychologist) => {
          try {
            const result = await this.syncPsychologistCalendar(psychologist);
            this.lastSyncTimes.set(psychologist.id, now);
            return { success: true, result };
          } catch (error) {
            console.error(`❌ Error syncing calendar for ${psychologist.first_name} ${psychologist.last_name}:`, error.message);
            return { 
              success: false, 
              psychologist: `${psychologist.first_name} ${psychologist.last_name}`,
              error: error.message 
            };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Process results
        batchResults.forEach((batchResult) => {
          if (batchResult.success) {
            syncResults.push(batchResult.result);
          } else {
            errors.push({
              psychologist: batchResult.psychologist,
              error: batchResult.error
            });
          }
        });
        
        // Small delay between batches (reduced from 2s per psychologist to 1s per batch)
        if (i + concurrencyLimit < psychologistsToSync.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
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
    // OPTIMIZATION: Configurable date range (default 30 days, can be reduced for speed)
    const syncDays = parseInt(process.env.CALENDAR_SYNC_DAYS) || 30;
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + syncDays);
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

    // OPTIMIZATION: Batch fetch all availability records at once instead of one-by-one
    // Get all unique dates from events first
    const eventDates = new Set();
    const eventData = [];
    
    for (const event of syncResult.externalEvents) {
      try {
        const eventStartLocal = new Date(event.start);
        const year = eventStartLocal.getFullYear();
        const month = String(eventStartLocal.getMonth() + 1).padStart(2, '0');
        const day = String(eventStartLocal.getDate()).padStart(2, '0');
        const eventDate = `${year}-${month}-${day}`;
        
        const eventTime = eventStartLocal.toTimeString().split(' ')[0].substring(0, 5);
        const normalizedEventTime = normalizeTimeTo24Hour(eventTime);
        
        if (!normalizedEventTime) {
          continue; // Skip events with invalid time
        }
        
        eventDates.add(eventDate);
        eventData.push({
          date: eventDate,
          time: normalizedEventTime,
          title: event.title
        });
      } catch (error) {
        continue; // Skip invalid events
      }
    }
    
    // Batch fetch all availability records for all dates at once
    const availabilityMap = new Map();
    if (eventDates.size > 0) {
      const datesArray = Array.from(eventDates);
      const { data: availabilityRecords, error: availError } = await supabase
        .from('availability')
        .select('id, date, time_slots')
        .eq('psychologist_id', psychologist.id)
        .in('date', datesArray);
      
      if (availError) {
        console.error(`⚠️ Error batch fetching availability:`, availError.message);
      } else if (availabilityRecords) {
        // Create a map for O(1) lookup
        availabilityRecords.forEach(avail => {
          availabilityMap.set(avail.date, avail);
        });
      }
    }
    
    // Process events and collect updates
    const blockedSlots = [];
    const errors = [];
    const updatesToApply = new Map(); // Map of availability.id -> updated time_slots
    
    for (const eventInfo of eventData) {
      try {
        const availability = availabilityMap.get(eventInfo.date);
        
        if (!availability) {
          continue; // No availability record for this date
        }
        
        // Check if we already have an update pending for this availability record
        let currentSlots = updatesToApply.has(availability.id) 
          ? updatesToApply.get(availability.id)
          : [...availability.time_slots];
        
        // Remove conflicting time slot
        const updatedSlots = currentSlots.filter(slot => {
          const normalizedSlot = normalizeTimeTo24Hour(slot);
          return normalizedSlot !== eventInfo.time;
        });
        
        if (updatedSlots.length !== currentSlots.length) {
          updatesToApply.set(availability.id, updatedSlots);
          blockedSlots.push({
            date: eventInfo.date,
            time: eventInfo.time,
            reason: eventInfo.title
          });
        }
      } catch (error) {
        errors.push({
          event: eventInfo.title,
          error: error.message
        });
      }
    }
    
    // OPTIMIZATION: Batch update all availability records at once
    if (updatesToApply.size > 0) {
      const updatePromises = [];
      const now = new Date().toISOString();
      
      for (const [availabilityId, updatedSlots] of updatesToApply.entries()) {
        updatePromises.push(
          supabase
            .from('availability')
            .update({ 
              time_slots: updatedSlots,
              updated_at: now
            })
            .eq('id', availabilityId)
        );
      }
      
      // Execute all updates in parallel
      await Promise.all(updatePromises);
      
      if (blockedSlots.length > 0) {
        console.log(`✅ Blocked ${blockedSlots.length} time slot(s) across ${updatesToApply.size} date(s) for ${psychologist.first_name} ${psychologist.last_name}`);
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
