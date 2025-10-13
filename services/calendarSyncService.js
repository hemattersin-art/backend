const cron = require('node-cron');
const supabase = require('../config/supabase');
const googleCalendarService = require('../utils/googleCalendarService');

class CalendarSyncService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the calendar sync service
   * Runs every 30 minutes to sync Google Calendar events
   */
  start() {
    console.log('🔄 Starting Google Calendar sync service...');
    
    // Run every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
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

      // Sync each psychologist's calendar
      for (const psychologist of psychologists) {
        try {
          console.log(`🔄 Syncing calendar for ${psychologist.first_name} ${psychologist.last_name}...`);
          
          const result = await this.syncPsychologistCalendar(psychologist);
          syncResults.push(result);
          
          console.log(`✅ Synced calendar for ${psychologist.first_name} ${psychologist.last_name}`);
        } catch (error) {
          console.error(`❌ Error syncing calendar for ${psychologist.first_name} ${psychologist.last_name}:`, error);
          errors.push({
            psychologist: `${psychologist.first_name} ${psychologist.last_name}`,
            error: error.message
          });
        }
      }

      console.log(`✅ Calendar sync completed. ${syncResults.length} successful, ${errors.length} errors`);
      
      if (errors.length > 0) {
        console.error('❌ Sync errors:', errors);
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
      throw new Error(syncResult.error);
    }

    // Block conflicting time slots in availability
    const blockedSlots = [];
    const errors = [];

    for (const event of syncResult.externalEvents) {
      try {
        const eventDate = event.start.toISOString().split('T')[0];
        const eventTime = event.start.toTimeString().split(' ')[0].substring(0, 5);
        
        // Get current availability for this date
        const { data: availability } = await supabase
          .from('availability')
          .select('id, time_slots')
          .eq('psychologist_id', psychologist.id)
          .eq('date', eventDate)
          .single();

        if (availability) {
          // Remove conflicting time slot
          const updatedSlots = availability.time_slots.filter(slot => slot !== eventTime);
          
          if (updatedSlots.length !== availability.time_slots.length) {
            await supabase
              .from('availability')
              .update({ 
                time_slots: updatedSlots,
                updated_at: new Date().toISOString()
              })
              .eq('id', availability.id);

            blockedSlots.push({
              date: eventDate,
              time: eventTime,
              reason: event.title
            });
          }
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

      return await this.syncPsychologistCalendar(psychologist);
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
