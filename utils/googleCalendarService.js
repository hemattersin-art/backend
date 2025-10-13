const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

class GoogleCalendarService {
  constructor() {
    this.calendar = google.calendar({ version: 'v3' });
  }

  /**
   * Create OAuth2 client for psychologist
   * @param {Object} credentials - Psychologist's Google OAuth credentials
   * @returns {OAuth2Client}
   */
  createOAuthClient(credentials) {
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

    return oauth2Client;
  }

  /**
   * Fetch calendar events for a specific time range
   * @param {Object} credentials - Psychologist's Google OAuth credentials
   * @param {string} calendarId - Calendar ID (default: 'primary')
   * @param {Date} timeMin - Start time
   * @param {Date} timeMax - End time
   * @returns {Promise<Array>} Array of calendar events
   */
  async getCalendarEvents(credentials, calendarId = 'primary', timeMin, timeMax) {
    try {
      const oauth2Client = this.createOAuthClient(credentials);
      
      const response = await this.calendar.events.list({
        auth: oauth2Client,
        calendarId: calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        showDeleted: false,
        maxResults: 2500
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      
      // Handle token refresh if needed
      if (error.code === 401) {
        await this.refreshAccessToken(credentials);
        // Retry the request
        return this.getCalendarEvents(credentials, calendarId, timeMin, timeMax);
      }
      
      throw error;
    }
  }

  /**
   * Refresh access token if expired
   * @param {Object} credentials - Psychologist's Google OAuth credentials
   * @returns {Promise<Object>} Updated credentials
   */
  async refreshAccessToken(credentials) {
    try {
      const oauth2Client = this.createOAuthClient(credentials);
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      
      return {
        ...credentials,
        access_token: newCredentials.access_token,
        refresh_token: newCredentials.refresh_token || credentials.refresh_token
      };
    } catch (error) {
      console.error('Error refreshing access token:', error);
      throw error;
    }
  }

  /**
   * Check if a specific time slot conflicts with existing calendar events
   * @param {Object} credentials - Psychologist's Google OAuth credentials
   * @param {Date} startTime - Session start time
   * @param {Date} endTime - Session end time
   * @param {string} calendarId - Calendar ID (default: 'primary')
   * @returns {Promise<boolean>} True if there's a conflict
   */
  async hasTimeConflict(credentials, startTime, endTime, calendarId = 'primary') {
    try {
      const events = await this.getCalendarEvents(credentials, calendarId, startTime, endTime);
      
      return events.some(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        
        // Check for overlap
        return (startTime < eventEnd && endTime > eventStart);
      });
    } catch (error) {
      console.error('Error checking time conflict:', error);
      // If we can't check, assume no conflict to avoid blocking legitimate bookings
      return false;
    }
  }

  /**
   * Get all busy time slots for a date range
   * @param {Object} credentials - Psychologist's Google OAuth credentials
   * @param {Date} timeMin - Start time
   * @param {Date} timeMax - End time
   * @param {string} calendarId - Calendar ID (default: 'primary')
   * @returns {Promise<Array>} Array of busy time slots
   */
  async getBusyTimeSlots(credentials, timeMin, timeMax, calendarId = 'primary') {
    try {
      const events = await this.getCalendarEvents(credentials, calendarId, timeMin, timeMax);
      
      return events.map(event => ({
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date),
        title: event.summary || 'Busy',
        source: 'google_calendar',
        eventId: event.id
      }));
    } catch (error) {
      console.error('Error getting busy time slots:', error);
      return [];
    }
  }

  /**
   * Sync calendar events and update psychologist's blocked times
   * @param {Object} psychologist - Psychologist object with Google credentials
   * @param {Date} startDate - Start date for sync
   * @param {Date} endDate - End date for sync
   * @returns {Promise<Object>} Sync result
   */
  async syncCalendarEvents(psychologist, startDate, endDate) {
    try {
      if (!psychologist.google_calendar_credentials) {
        throw new Error('Psychologist has no Google Calendar credentials');
      }

      const busySlots = await this.getBusyTimeSlots(
        psychologist.google_calendar_credentials,
        startDate,
        endDate
      );

      // Filter out events created by our own system to avoid circular blocking
      const externalEvents = busySlots.filter(slot => 
        !slot.title.includes('LittleMinds') && 
        !slot.title.includes('Session') &&
        !slot.title.includes('Therapy')
      );

      return {
        success: true,
        externalEvents: externalEvents,
        totalEvents: busySlots.length,
        syncedAt: new Date()
      };
    } catch (error) {
      console.error('Error syncing calendar events:', error);
      return {
        success: false,
        error: error.message,
        syncedAt: new Date()
      };
    }
  }
}

module.exports = new GoogleCalendarService();
