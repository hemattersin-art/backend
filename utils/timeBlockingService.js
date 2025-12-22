const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { supabaseAdmin } = require('../config/supabase');

class TimeBlockingService {
  constructor() {
    this.calendar = google.calendar({ version: 'v3' });
  }

  /**
   * Create OAuth2 client for psychologist
   */
  createOAuthClient(credentials) {
    console.log('🔍 Creating OAuth client with credentials:', {
      hasAccessToken: !!credentials.access_token,
      hasRefreshToken: !!credentials.refresh_token,
      scope: credentials.scope,
      tokenExpiry: credentials.expiry_date
    });

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      scope: credentials.scope
    });

    console.log('🔍 OAuth client created successfully');
    return oauth2Client;
  }

  /**
   * Block time slots and sync to Google Calendar
   * @param {string} psychologistId - Psychologist ID
   * @param {Object} blockingData - Blocking configuration
   * @returns {Promise<Object>} Result of blocking operation
   */
  async blockTimeSlots(psychologistId, blockingData) {
    try {
      console.log(`🚫 Blocking time slots for psychologist ${psychologistId}:`, blockingData);

      // Get psychologist's Google Calendar credentials
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data: psychologist, error: psychError } = await supabaseAdmin
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (psychError || !psychologist) {
        throw new Error('Psychologist not found');
      }

      if (!psychologist.google_calendar_credentials) {
        throw new Error('Google Calendar not connected');
      }

      const credentials = typeof psychologist.google_calendar_credentials === 'string' 
        ? JSON.parse(psychologist.google_calendar_credentials)
        : psychologist.google_calendar_credentials;
      
      console.log('🔍 Psychologist Google Calendar credentials:', {
        hasCredentials: !!credentials,
        hasAccessToken: !!credentials.access_token,
        hasRefreshToken: !!credentials.refresh_token,
        scope: credentials.scope,
        tokenExpiry: credentials.expiry_date,
        credentialsType: typeof psychologist.google_calendar_credentials
      });
      
      // Check if the scope is correct for creating events
      if (credentials.scope && credentials.scope.includes('calendar.readonly')) {
        throw new Error('Google Calendar is connected with read-only permissions. Please reconnect with full calendar access to block time slots.');
      }
      
      const oauth2Client = this.createOAuthClient(credentials);

      const results = {
        blockedSlots: [],
        googleCalendarEvents: [],
        errors: []
      };

      // Process different blocking types
      console.log(`🔍 Blocking type: ${blockingData.type}`);
      
      if (blockingData.type === 'whole_day') {
        console.log(`🔍 Calling blockWholeDay`);
        await this.blockWholeDay(psychologistId, blockingData, oauth2Client, results);
      } else if (blockingData.type === 'multiple_days') {
        console.log(`🔍 Calling blockMultipleDays`);
        await this.blockMultipleDays(psychologistId, blockingData, oauth2Client, results);
      } else if (blockingData.type === 'specific_slots') {
        console.log(`🔍 Calling blockSpecificSlots`);
        await this.blockSpecificSlots(psychologistId, blockingData, oauth2Client, results);
      }

      return {
        success: true,
        message: 'Time slots blocked successfully',
        data: results
      };

    } catch (error) {
      console.error('Error blocking time slots:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Block entire day
   */
  async blockWholeDay(psychologistId, blockingData, oauth2Client, results) {
    const { date, reason = 'Blocked - Personal Time' } = blockingData;
    
    // Validate and format the date
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date format: ${date}`);
    }
    
    // Format date as YYYY-MM-DD
    const formattedDate = dateObj.toISOString().split('T')[0];
    
    // Create Google Calendar event for the whole day
    const startTime = new Date(`${formattedDate}T00:00:00`);
    const endTime = new Date(`${formattedDate}T23:59:59`);
    
    // Validate the created dates
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new Error(`Invalid datetime created from date: ${formattedDate}`);
    }

    const event = {
      summary: `🚫 BLOCKED - ${reason}`,
      description: `Time blocked by psychologist - ${reason}`,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'Asia/Kolkata'
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'Asia/Kolkata'
      },
      colorId: '11', // Red color for blocked time
      transparency: 'opaque',
      visibility: 'private'
    };

    try {
      const response = await this.calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        resource: event
      });

      results.googleCalendarEvents.push({
        date,
        eventId: response.data.id,
        type: 'whole_day'
      });

      // Remove all availability slots for this date
      await this.removeAvailabilitySlots(psychologistId, date, results);

    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      results.errors.push({
        date,
        error: error.message
      });
    }
  }

  /**
   * Block multiple days
   */
  async blockMultipleDays(psychologistId, blockingData, oauth2Client, results) {
    const { startDate, endDate, reason = 'Blocked - Personal Time' } = blockingData;
    
    // Validate and format the dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error(`Invalid date format: startDate: ${startDate}, endDate: ${endDate}`);
    }
    
    // Format dates as YYYY-MM-DD
    const formattedStartDate = start.toISOString().split('T')[0];
    const formattedEndDate = end.toISOString().split('T')[0];
    
    // Create Google Calendar event for the date range
    const event = {
      summary: `🚫 BLOCKED - ${reason}`,
      description: `Time blocked by psychologist - ${reason}`,
      start: {
        date: formattedStartDate
      },
      end: {
        date: new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      },
      colorId: '11', // Red color for blocked time
      transparency: 'opaque',
      visibility: 'private'
    };

    try {
      const response = await this.calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        resource: event
      });

      results.googleCalendarEvents.push({
        startDate,
        endDate,
        eventId: response.data.id,
        type: 'multiple_days'
      });

      // Remove availability slots for each day in the range
      const currentDate = new Date(start);
      while (currentDate <= end) {
        const dateStr = currentDate.toISOString().split('T')[0];
        await this.removeAvailabilitySlots(psychologistId, dateStr, results);
        currentDate.setDate(currentDate.getDate() + 1);
      }

    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      results.errors.push({
        startDate,
        endDate,
        error: error.message
      });
    }
  }

  /**
   * Block specific time slots
   */
  async blockSpecificSlots(psychologistId, blockingData, oauth2Client, results) {
    const { date, timeSlots, reason = 'Blocked - Personal Time' } = blockingData;
    
    console.log(`🔍 blockSpecificSlots called: psychologistId=${psychologistId}, date=${date}, timeSlots=${JSON.stringify(timeSlots)}`);
    
    // Validate and format the date
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date format: ${date}`);
    }
    
    // Format date as YYYY-MM-DD
    const formattedDate = dateObj.toISOString().split('T')[0];
    
    for (const timeSlot of timeSlots) {
      const [startTime, endTime] = timeSlot.split('-');
      
      // Validate time format
      if (!startTime || !endTime) {
        throw new Error(`Invalid time slot format: ${timeSlot}. Expected format: HH:MM-HH:MM`);
      }
      
      // Create proper datetime strings
      const startDateTime = new Date(`${formattedDate}T${startTime}:00`);
      const endDateTime = new Date(`${formattedDate}T${endTime}:00`);
      
      // Validate the created dates
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        throw new Error(`Invalid datetime created from date: ${formattedDate}, startTime: ${startTime}, endTime: ${endTime}`);
      }

      const event = {
        summary: `🚫 BLOCKED - ${reason}`,
        description: `Time blocked by psychologist - ${reason}`,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'Asia/Kolkata'
        },
        colorId: '11', // Red color for blocked time
        transparency: 'opaque',
        visibility: 'private'
      };

      try {
        console.log('🔍 Creating Google Calendar event:', {
          summary: event.summary,
          start: event.start,
          end: event.end,
          calendarId: 'primary'
        });

        // Try to refresh access token if needed
        try {
          console.log('🔄 Attempting to refresh access token...');
          const googleCalendarService = require('./googleCalendarService');
          const refreshedCredentials = await googleCalendarService.refreshAccessToken(credentials);
          
          console.log('🔍 Refreshed credentials:', {
            hasNewAccessToken: !!refreshedCredentials.access_token,
            hasNewRefreshToken: !!refreshedCredentials.refresh_token,
            scope: refreshedCredentials.scope
          });
          
          // Update the OAuth client with refreshed credentials
          oauth2Client.setCredentials({
            access_token: refreshedCredentials.access_token,
            refresh_token: refreshedCredentials.refresh_token,
            scope: refreshedCredentials.scope
          });
          
          console.log('✅ Access token refreshed successfully');
        } catch (refreshError) {
          console.log('⚠️ Token refresh failed, proceeding with existing credentials:', refreshError.message);
          console.log('🔍 Refresh error details:', refreshError);
        }

        // Test Google Calendar API access before creating event
        try {
          console.log('🧪 Testing Google Calendar API access...');
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          const testResponse = await calendar.calendarList.list();
          console.log('✅ Google Calendar API access confirmed, calendars found:', testResponse.data.items?.length || 0);
        } catch (testError) {
          console.log('❌ Google Calendar API test failed:', testError.message);
          throw new Error(`Google Calendar API access failed: ${testError.message}`);
        }

        console.log('🚀 Creating Google Calendar event with OAuth client...');
        const response = await this.calendar.events.insert({
          auth: oauth2Client,
          calendarId: 'primary',
          resource: event
        });

        console.log('✅ Google Calendar event created successfully!');
        console.log('📅 Event details:', {
          eventId: response.data.id,
          summary: response.data.summary,
          start: response.data.start,
          end: response.data.end,
          htmlLink: response.data.htmlLink
        });

        results.googleCalendarEvents.push({
          date,
          timeSlot,
          eventId: response.data.id,
          type: 'specific_slot'
        });

        console.log(`✅ Google Calendar event created successfully`);

      } catch (error) {
        console.error('Error creating Google Calendar event:', error);
        results.errors.push({
          date,
          timeSlot,
          error: error.message
        });
        console.log(`⚠️ Google Calendar failed, but continuing with availability removal`);
      }

      // Remove this specific time slot from availability (regardless of Google Calendar success)
      console.log(`🔍 About to call removeSpecificTimeSlot for ${timeSlot}`);
      await this.removeSpecificTimeSlot(psychologistId, date, timeSlot, results);
      console.log(`🔍 Finished removeSpecificTimeSlot for ${timeSlot}`);

      // Store blocked slot in database for tracking
      await this.storeBlockedSlot(psychologistId, date, timeSlot, reason, results);
    }
  }

  /**
   * Store blocked slot in database for tracking
   */
  async storeBlockedSlot(psychologistId, date, timeSlot, reason, results) {
    try {
      console.log(`🔍 Storing blocked slot in database: ${date} ${timeSlot}`);
      
      // Convert timeSlot from HH:MM-HH:MM format to HH:MM format for storage
      const slotToStore = timeSlot.includes('-') ? timeSlot.split('-')[0] : timeSlot;
      
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data, error } = await supabaseAdmin
        .from('availability')
        .select('id, blocked_slots')
        .eq('psychologist_id', psychologistId)
        .eq('date', date)
        .single();

      if (data) {
        // Add to blocked_slots array (create if doesn't exist)
        const blockedSlots = data.blocked_slots || [];
        const blockedSlot = {
          time_slot: slotToStore,
          reason: reason,
          blocked_at: new Date().toISOString(),
          type: 'specific_slot'
        };
        
        // Check if this slot is already blocked
        const existingBlock = blockedSlots.find(slot => slot.time_slot === slotToStore);
        if (!existingBlock) {
          blockedSlots.push(blockedSlot);
          
          // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
          const { error: updateError } = await supabaseAdmin
            .from('availability')
            .update({ 
              blocked_slots: blockedSlots,
              updated_at: new Date().toISOString()
            })
            .eq('id', data.id);

          if (updateError) {
            console.error(`❌ Error storing blocked slot:`, updateError);
          } else {
            console.log(`✅ Stored blocked slot ${slotToStore} in database`);
          }
        } else {
          console.log(`⚠️ Slot ${slotToStore} already blocked`);
        }
      } else {
        console.log(`⚠️ No availability record found to store blocked slot`);
      }
    } catch (error) {
      console.error('Error storing blocked slot:', error);
    }
  }

  /**
   * Remove all availability slots for a specific date
   */
  async removeAvailabilitySlots(psychologistId, date, results) {
    try {
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data: availability, error: availabilityError } = await supabaseAdmin
        .from('availability')
        .select('id, time_slots')
        .eq('psychologist_id', psychologistId)
        .eq('date', date)
        .single();

      if (availability && availability.time_slots.length > 0) {
        // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
        await supabaseAdmin
          .from('availability')
          .update({ 
            time_slots: [],
            updated_at: new Date().toISOString()
          })
          .eq('id', availability.id);

        results.blockedSlots.push({
          date,
          type: 'whole_day',
          removedSlots: availability.time_slots
        });
        
        console.log(`✅ Removed all ${availability.time_slots.length} time slots from availability for ${date}`);
      } else {
        console.log(`⚠️ No availability slots found for psychologist ${psychologistId} on ${date}`);
      }
    } catch (error) {
      console.error('Error removing availability slots:', error);
      results.errors.push({
        date,
        operation: 'remove_availability',
        error: error.message
      });
    }
  }

  /**
   * Remove specific time slot from availability
   */
  async removeSpecificTimeSlot(psychologistId, date, timeSlot, results) {
    try {
      console.log(`🔍 removeSpecificTimeSlot called: psychologistId=${psychologistId}, date=${date}, timeSlot=${timeSlot}`);
      
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data: availability, error: availabilityError } = await supabaseAdmin
        .from('availability')
        .select('id, time_slots')
        .eq('psychologist_id', psychologistId)
        .eq('date', date)
        .single();

      console.log(`🔍 Availability query result:`, { 
        found: !!availability, 
        error: availabilityError ? 'Yes' : 'No' 
      });

      if (availability) {
        // Convert timeSlot from HH:MM-HH:MM format to HH:MM format for comparison
        const slotToRemove = timeSlot.includes('-') ? timeSlot.split('-')[0] : timeSlot;
        
        console.log(`🔍 Original slots:`, availability.time_slots);
        console.log(`🔍 Slot to remove:`, slotToRemove);
        
        const updatedSlots = availability.time_slots.filter(slot => slot !== slotToRemove);
        
        console.log(`🔍 Updated slots:`, updatedSlots);
        
        if (updatedSlots.length !== availability.time_slots.length) {
          // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
          const { error: updateError } = await supabaseAdmin
            .from('availability')
            .update({ 
              time_slots: updatedSlots,
              updated_at: new Date().toISOString()
            })
            .eq('id', availability.id);

          if (updateError) {
            console.error(`❌ Error updating availability:`, updateError);
          } else {
            console.log(`✅ Successfully updated availability table`);
          }

          results.blockedSlots.push({
            date,
            timeSlot,
            removedSlot: slotToRemove,
            type: 'specific_slot'
          });
          
          console.log(`✅ Removed time slot ${slotToRemove} from availability for ${date}`);
        } else {
          console.log(`⚠️ Time slot ${slotToRemove} not found in availability for ${date}`);
        }
      } else {
        console.log(`⚠️ No availability found for psychologist ${psychologistId} on ${date}`);
      }
    } catch (error) {
      console.error('Error removing specific time slot:', error);
      results.errors.push({
        date,
        timeSlot,
        operation: 'remove_specific_slot',
        error: error.message
      });
    }
  }

  /**
   * Unblock time slots (remove Google Calendar events and restore availability)
   */
  async unblockTimeSlots(psychologistId, blockingData) {
    try {
      console.log(`✅ Unblocking time slots for psychologist ${psychologistId}:`, blockingData);

      // Get psychologist's Google Calendar credentials
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data: psychologist, error: psychError } = await supabaseAdmin
        .from('psychologists')
        .select('id, google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (psychError || !psychologist) {
        throw new Error('Psychologist not found');
      }

      const credentials = typeof psychologist.google_calendar_credentials === 'string' 
        ? JSON.parse(psychologist.google_calendar_credentials)
        : psychologist.google_calendar_credentials;
      const oauth2Client = this.createOAuthClient(credentials);

      const results = {
        unblockedSlots: [],
        removedEvents: [],
        errors: []
      };

      // Remove Google Calendar events
      for (const eventId of blockingData.eventIds) {
        try {
          await this.calendar.events.delete({
            auth: oauth2Client,
            calendarId: 'primary',
            eventId: eventId
          });

          results.removedEvents.push(eventId);
        } catch (error) {
          console.error('Error removing Google Calendar event:', error);
          results.errors.push({
            eventId,
            error: error.message
          });
        }
      }

      return {
        success: true,
        message: 'Time slots unblocked successfully',
        data: results
      };

    } catch (error) {
      console.error('Error unblocking time slots:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get blocked time slots for a psychologist
   */
  async getBlockedTimeSlots(psychologistId, startDate, endDate) {
    try {
      // Get psychologist's Google Calendar credentials
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data: psychologist, error: psychError } = await supabaseAdmin
        .from('psychologists')
        .select('google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (psychError || !psychologist) {
        throw new Error('Psychologist not found');
      }

      if (!psychologist.google_calendar_credentials) {
        // Return empty array if no Google Calendar is connected
        return {
          success: true,
          data: []
        };
      }

      const credentials = typeof psychologist.google_calendar_credentials === 'string' 
        ? JSON.parse(psychologist.google_calendar_credentials)
        : psychologist.google_calendar_credentials;
      const oauth2Client = this.createOAuthClient(credentials);

      // Get calendar events in the date range
      const events = await this.calendar.events.list({
        auth: oauth2Client,
        calendarId: 'primary',
        timeMin: new Date(startDate).toISOString(),
        timeMax: new Date(endDate).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        q: 'BLOCKED' // Search for blocked events
      });

      const blockedEvents = (events.data.items || []).filter(event => 
        event.summary && event.summary.includes('🚫 BLOCKED')
      );

      // Also get blocked slots from database
      // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
      const { data: availabilityRecords, error: dbError } = await supabaseAdmin
        .from('availability')
        .select('date, blocked_slots')
        .eq('psychologist_id', psychologistId)
        .gte('date', startDate)
        .lte('date', endDate);

      let databaseBlockedSlots = [];
      if (availabilityRecords && !dbError) {
        availabilityRecords.forEach(record => {
          if (record.blocked_slots && Array.isArray(record.blocked_slots)) {
            record.blocked_slots.forEach(blockedSlot => {
              databaseBlockedSlots.push({
                id: `db_${record.date}_${blockedSlot.time_slot}`,
                summary: `🚫 BLOCKED - ${blockedSlot.reason}`,
                start: {
                  dateTime: `${record.date}T${blockedSlot.time_slot}:00+05:30`
                },
                end: {
                  dateTime: `${record.date}T${blockedSlot.time_slot}:00+05:30`
                },
                description: `Time blocked by psychologist - ${blockedSlot.reason}`,
                source: 'database',
                date: record.date,
                time_slot: blockedSlot.time_slot,
                reason: blockedSlot.reason,
                blocked_at: blockedSlot.blocked_at
              });
            });
          }
        });
      }

      console.log(`🔍 Found ${databaseBlockedSlots.length} blocked slots from database`);

      // Combine Google Calendar and database blocked slots
      const googleCalendarSlots = blockedEvents.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start,
        end: event.end,
        description: event.description,
        source: 'google_calendar',
        date: event.start.dateTime ? event.start.dateTime.split('T')[0] : event.start.date,
        time_slot: event.start.dateTime ? event.start.dateTime.split('T')[1].substring(0, 5) : null,
        reason: event.summary.replace('🚫 BLOCKED - ', ''),
        created: event.created
      }));

      const allBlockedSlots = [...googleCalendarSlots, ...databaseBlockedSlots];
      
      // Remove duplicates based on date and time_slot
      const uniqueBlockedSlots = allBlockedSlots.filter((slot, index, self) => 
        index === self.findIndex(s => s.date === slot.date && s.time_slot === slot.time_slot)
      );

      console.log(`🔍 Total unique blocked slots: ${uniqueBlockedSlots.length}`);

      return {
        success: true,
        data: uniqueBlockedSlots
      };

    } catch (error) {
      console.error('Error getting blocked time slots:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new TimeBlockingService();
