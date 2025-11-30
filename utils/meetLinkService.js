const { google } = require('googleapis');
const crypto = require('crypto');

class MeetLinkService {
  constructor() {
    this.oauth2Client = null;
    this.serviceAccount = null;
    this.oauthTokens = null;
    this.initializeAuth();
    // Load OAuth tokens asynchronously
    this.loadOAuthTokensFromFile().catch(error => {
      console.log('ℹ️ OAuth token loading completed');
    });
  }

  async initializeAuth() {
    try {
      // Load service account for fallback
      this.serviceAccount = require('../google-service-account.json');
      console.log('✅ Meet Link Service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Meet Link Service:', error.message);
    }
  }

  /**
   * Refresh OAuth token using refresh token
   */
  async refreshOAuthToken(refreshToken) {
    try {
      console.log('🔄 Refreshing OAuth token...');
      
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'http://localhost:5001/api/oauth2/callback'
      );

      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await oauth2Client.refreshAccessToken();
      
      console.log('✅ OAuth token refreshed successfully');
      return {
        success: true,
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || refreshToken,
        expiryDate: credentials.expiry_date
      };
    } catch (error) {
      console.error('❌ Token refresh failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Load OAuth tokens from file on startup
   */
  async loadOAuthTokensFromFile() {
    try {
      const fs = require('fs').promises;
      const tokenData = await fs.readFile('./oauth-tokens.json', 'utf8');
      const tokens = JSON.parse(tokenData);
      
      // Check if tokens are still valid (not expired)
      const now = Date.now();
      if (tokens.expiryDate && tokens.expiryDate > now) {
        this.oauthTokens = tokens;
        console.log('✅ OAuth tokens loaded from file');
      } else {
        console.log('⚠️ OAuth tokens in file are expired');
        // Try to refresh if we have a refresh token
        if (tokens.refreshToken) {
          console.log('🔄 Attempting to refresh expired tokens...');
          const refreshResult = await this.refreshOAuthToken(tokens.refreshToken);
          if (refreshResult.success) {
            this.oauthTokens = {
              accessToken: refreshResult.accessToken,
              refreshToken: refreshResult.refreshToken,
              expiryDate: refreshResult.expiryDate,
              storedAt: Date.now()
            };
            // Save refreshed tokens to file
            await fs.writeFile('./oauth-tokens.json', JSON.stringify(this.oauthTokens, null, 2));
            console.log('✅ OAuth tokens refreshed and saved');
          } else {
            console.log('❌ Token refresh failed, will need new OAuth authorization');
          }
        } else {
          console.log('❌ No refresh token available, will need new OAuth authorization');
        }
      }
    } catch (error) {
      console.log('ℹ️ No OAuth tokens file found (this is normal on first run)');
    }
  }

  /**
   * Store and manage OAuth tokens
   */
  async storeOAuthTokens(tokens) {
    try {
      // Store tokens in memory and file for persistence
      this.oauthTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        storedAt: Date.now()
      };
      
      // Also store in file for persistence across server restarts
      const fs = require('fs').promises;
      const tokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        storedAt: Date.now()
      };
      
      await fs.writeFile('./oauth-tokens.json', JSON.stringify(tokenData, null, 2));
      console.log('✅ OAuth tokens stored in memory and file');
      
      console.log('✅ OAuth tokens stored successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to store OAuth tokens:', error.message);
      return false;
    }
  }

  /**
   * Get valid OAuth token (refresh if needed)
   */
  async getValidOAuthToken() {
    try {
      if (!this.oauthTokens) {
        console.log('⚠️ No OAuth tokens available');
        return null;
      }

      const now = Date.now();
      const expiryTime = this.oauthTokens.expiryDate;
      
      // Check if token expires in next 5 minutes
      if (expiryTime && (expiryTime - now) < 5 * 60 * 1000) {
        console.log('🔄 Token expires soon, checking refresh options...');
        
        if (this.oauthTokens.refreshToken) {
          console.log('🔄 Attempting token refresh...');
          const refreshResult = await this.refreshOAuthToken(this.oauthTokens.refreshToken);
          if (refreshResult.success) {
            this.oauthTokens = {
              accessToken: refreshResult.accessToken,
              refreshToken: refreshResult.refreshToken,
              expiryDate: refreshResult.expiryDate,
              storedAt: Date.now()
            };
            console.log('✅ Token refreshed successfully');
          } else {
            console.log('❌ Token refresh failed, will use service account fallback');
            return null;
          }
        } else {
          console.log('⚠️ No refresh token available - this is normal for Google OAuth');
          console.log('🔄 Will use service account fallback for reliability');
          return null;
        }
      }

      return this.oauthTokens.accessToken;
    } catch (error) {
      console.error('❌ Error getting valid OAuth token:', error.message);
      return null;
    }
  }
  async createMeetLinkWithOAuth(oauthToken, sessionData) {
    try {
      console.log('🔄 Creating Meet link with OAuth token via Calendar API...');
      
      // Create OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'http://localhost:5001/api/oauth2/callback' // Use local redirect URI
      );

      // Set credentials
      oauth2Client.setCredentials({
        access_token: oauthToken
      });

      // Create Meet link using Calendar API with conference data
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      
      // Ensure consistent time format (with seconds)
      const formatTime = (time) => {
        if (!time) return '00:00:00';
        const parts = time.split(':');
        if (parts.length === 2) {
          return `${time}:00`; // Add seconds if missing
        }
        return time;
      };

      // Build attendees array - this is THE KEY to bypassing host approval
      // Google Meet automatically allows invited guests to join without approval
      const attendees = [];
      
      // Add client email if provided
      if (sessionData.clientEmail) {
        attendees.push({ email: sessionData.clientEmail });
      }
      
      // Add psychologist email if provided
      if (sessionData.psychologistEmail) {
        attendees.push({ email: sessionData.psychologistEmail });
      }
      
      // Also support attendees array format (for backward compatibility)
      if (Array.isArray(sessionData.attendees) && sessionData.attendees.length > 0) {
        sessionData.attendees.forEach(email => {
          if (email && !attendees.find(a => a.email === email)) {
            attendees.push({ email });
          }
        });
      }

      const event = {
        summary: sessionData.summary || 'Therapy Session',
        description: sessionData.description || 'Therapy session with Google Meet',
        start: {
          dateTime: `${sessionData.startDate}T${formatTime(sessionData.startTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: `${sessionData.startDate}T${formatTime(sessionData.endTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        attendees: attendees.length > 0 ? attendees : undefined,
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        }
      };

      console.log('📅 Creating calendar event with Meet link...');
      console.log('   👥 Attendees:', attendees.map(a => a.email).join(', ') || 'None');
      const createdEvent = await calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Send calendar invites - invited attendees can join without approval
      });

      console.log('✅ Real Meet link created with OAuth via Calendar API');
      console.log('Meet Link:', createdEvent.data.conferenceData.entryPoints[0].uri);
      
      return {
        success: true,
        meetLink: createdEvent.data.conferenceData.entryPoints[0].uri,
        eventId: createdEvent.data.id,
        eventLink: createdEvent.data.htmlLink,
        method: 'oauth_calendar'
      };

    } catch (error) {
      console.error('❌ OAuth Meet creation failed:', error.message);
      return {
        success: false,
        error: error.message,
        method: 'oauth_calendar'
      };
    }
  }

  /**
   * Create a Meet link using Calendar API with conference data
   * This works for users without OAuth tokens
   */
  async createMeetLinkWithCalendar(sessionData) {
    try {
      console.log('🔄 Creating Meet link with Calendar API...');
      
      // Create service account auth
      const auth = new google.auth.JWT({
        email: this.serviceAccount.client_email,
        key: this.serviceAccount.private_key,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events'
        ]
      });

      await auth.authorize();
      
      const calendar = google.calendar({ version: 'v3', auth });
      
      // Ensure consistent time format (with seconds)
      const formatTime = (time) => {
        if (!time) return '00:00:00';
        const parts = time.split(':');
        if (parts.length === 2) {
          return `${time}:00`; // Add seconds if missing
        }
        return time;
      };

      // Build attendees array - this is THE KEY to bypassing host approval
      // Google Meet automatically allows invited guests to join without approval
      const attendees = [];
      
      // Add client email if provided
      if (sessionData.clientEmail) {
        attendees.push({ email: sessionData.clientEmail });
      }
      
      // Add psychologist email if provided
      if (sessionData.psychologistEmail) {
        attendees.push({ email: sessionData.psychologistEmail });
      }
      
      // Also support attendees array format (for backward compatibility)
      if (Array.isArray(sessionData.attendees) && sessionData.attendees.length > 0) {
        sessionData.attendees.forEach(email => {
          if (email && !attendees.find(a => a.email === email)) {
            attendees.push({ email });
          }
        });
      }

      // Create event with conference data
      const event = {
        summary: sessionData.summary || 'Therapy Session',
        description: sessionData.description || 'Therapy session with Google Meet',
        start: {
          dateTime: `${sessionData.startDate}T${formatTime(sessionData.startTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: `${sessionData.startDate}T${formatTime(sessionData.endTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        attendees: attendees.length > 0 ? attendees : undefined,
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID()
          }
        }
      };

      console.log('🔍 Calendar API Event Data:', {
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        attendees: attendees.map(a => a.email).join(', ') || 'None',
        conferenceData: event.conferenceData ? 'present' : 'none'
      });

      // Service accounts cannot include attendees in events without Domain-Wide Delegation
      // So we need to create the event WITHOUT attendees field, but still get the Meet link
      // The attendees are documented in the description, and the Meet link is shared via email/WhatsApp
      
      // Add attendee emails to description so they're documented (even if not in attendees field)
      if (attendees.length > 0) {
        const attendeeList = attendees.map(a => a.email).join(', ');
        event.description = (event.description || '') + 
          `\n\nAttendees: ${attendeeList}\n\nJoin via the Google Meet link above.`;
      }
      
      // Remove attendees from event object for service account (they can't use it)
      // The Meet link will still be created via conferenceData
      const eventWithoutAttendees = {
        ...event,
        attendees: undefined // Remove attendees - service account limitation
      };
      
      let result;
      try {
        // Try with attendees first (in case OAuth is used, which allows attendees)
        result = await calendar.events.insert({
          calendarId: 'primary',
          conferenceDataVersion: 1,
          requestBody: event,
          sendUpdates: 'all' // Try to send invites first
        });
        console.log('✅ Calendar event created with invites sent');
      } catch (inviteError) {
        // Check error message from different possible locations (Google API error structure)
        const errorMessage = inviteError.message || 
                            inviteError.response?.data?.error?.message || 
                            JSON.stringify(inviteError.response?.data?.error || {});
        
        // If sending invites fails (service account limitation), create without attendees
        if (errorMessage.includes('forbiddenForServiceAccounts') || 
            errorMessage.includes('Domain-Wide Delegation') ||
            errorMessage.includes('cannot invite attendees')) {
          console.log('⚠️ Service account cannot use attendees - creating event without attendees field');
          console.log('   📧 Meet link will be shared via email/WhatsApp instead');
          console.log('   📝 Attendees documented in event description');
          
          // Create event WITHOUT attendees field (service account limitation)
          result = await calendar.events.insert({
            calendarId: 'primary',
            conferenceDataVersion: 1,
            requestBody: eventWithoutAttendees
            // No attendees, no sendUpdates - service account limitation
          });
          console.log('✅ Calendar event created (without attendees - service account limitation)');
        } else {
          throw inviteError; // Re-throw if it's a different error
        }
      }

      console.log('✅ Calendar event created:', result.data.id);
      
      // Try to extract Meet link immediately from the created event
      let eventData = result.data;
      
      console.log('🔍 Checking for Meet link in created event...');
      console.log('   - Has conferenceData:', !!eventData.conferenceData);
      console.log('   - Has entryPoints:', !!eventData.conferenceData?.entryPoints);
      console.log('   - Has hangoutLink:', !!eventData.hangoutLink);
      
      // If conferenceData is missing, service account may have limitations
      // Try fetching the event again after a short delay - sometimes Google populates it later
      if (!eventData.conferenceData) {
        console.log('⚠️ No conferenceData in initial response - service account limitation detected');
        console.log('⏳ Waiting 2 seconds and fetching event again...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          const { data: refreshedEvent } = await calendar.events.get({
            calendarId: 'primary',
            eventId: eventData.id,
            conferenceDataVersion: 1
          });
          eventData = refreshedEvent;
          console.log('   - After refresh - Has conferenceData:', !!eventData.conferenceData);
          console.log('   - After refresh - Has entryPoints:', !!eventData.conferenceData?.entryPoints);
          console.log('   - After refresh - Has hangoutLink:', !!eventData.hangoutLink);
        } catch (refreshError) {
          console.log('⚠️ Could not refresh event:', refreshError.message);
        }
      }
      
      // Check if Meet link is already available in entryPoints
      if (eventData.conferenceData?.entryPoints) {
        const meetEntry = eventData.conferenceData.entryPoints.find(ep => 
          ep.entryPointType === 'video' || 
          ep.uri?.includes('meet.google.com') ||
          ep.uri?.includes('hangouts.google.com')
        );
        if (meetEntry && meetEntry.uri) {
          console.log('✅ REAL Meet link found immediately:', meetEntry.uri);
          return {
            success: true,
            meetLink: meetEntry.uri,
            eventId: eventData.id,
            eventLink: eventData.htmlLink,
            method: 'calendar_service_account'
          };
        }
      }
      
      // Check hangoutLink as fallback
      if (eventData.hangoutLink) {
        console.log('✅ REAL Meet link found in hangoutLink:', eventData.hangoutLink);
        return {
          success: true,
          meetLink: eventData.hangoutLink,
          eventId: eventData.id,
          eventLink: eventData.htmlLink,
          method: 'calendar_service_account'
        };
      }
      
      // If no immediate Meet link, wait for conference
      console.log('⏳ No immediate Meet link, waiting for conference...');
      const meetLink = await this.waitForConferenceReady(eventData.id, calendar);
      
      if (meetLink) {
        console.log('✅ Real Meet link created with Calendar:', meetLink);
        return {
          success: true,
          meetLink: meetLink,
          eventId: eventData.id,
          eventLink: eventData.htmlLink,
          method: 'calendar_service_account'
        };
      }
      
      // Final check: Sometimes Google populates the Meet link shortly after creation
      // Wait a bit more and check one last time before giving up
      console.log('⏳ Final check after timeout - sometimes Meet link appears shortly after...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 more seconds
      
      try {
        const { data: finalEventData } = await calendar.events.get({ 
          calendarId: 'primary', 
          eventId: eventData.id, 
          conferenceDataVersion: 1 
        });
        
        // Check for Meet link one more time
        let finalMeetLink = null;
        if (finalEventData.conferenceData?.entryPoints) {
          const meetEntry = finalEventData.conferenceData.entryPoints.find(ep => 
            ep.entryPointType === 'video' || 
            ep.uri?.includes('meet.google.com') ||
            ep.uri?.includes('hangouts.google.com')
          );
          if (meetEntry && meetEntry.uri) {
            finalMeetLink = meetEntry.uri;
          }
        }
        
        if (!finalMeetLink && finalEventData.hangoutLink) {
          finalMeetLink = finalEventData.hangoutLink;
        }
        
        if (finalMeetLink) {
          console.log('✅ Meet link found in final check:', finalMeetLink);
          return {
            success: true,
            meetLink: finalMeetLink,
            eventId: eventData.id,
            eventLink: eventData.htmlLink,
            method: 'calendar_service_account'
          };
        }
      } catch (finalCheckError) {
        console.log('⚠️ Final check failed:', finalCheckError.message);
      }
      
      // Even if conference times out, return success with calendar event
      // This happens when service accounts cannot create Meet conferences (Google limitation)
      console.log('⚠️ Conference timeout - Service account limitation detected');
      console.log('⚠️ Service accounts CANNOT create Google Meet conferences via Calendar API');
      console.log('⚠️ This is a Google limitation, not a code issue');
      console.log('⚠️ Solution: Use OAuth tokens (psychologist Google Calendar connection) for real Meet links');
      console.log('⚠️ For now, using fallback link - users can create Meet manually or use the calendar event');
      
      // Return the calendar event link so users can access it and create Meet manually if needed
      return {
        success: false, // Mark as false since no real Meet link was created
        meetLink: 'https://meet.google.com/new?hs=122&authuser=0', // Fallback
        eventId: eventData.id,
        eventLink: eventData.htmlLink, // Calendar event link - users can access this
        method: 'service_account_limitation',
        note: 'Service accounts cannot create Meet conferences - OAuth required for real Meet links. Calendar event created successfully.'
      };

    } catch (error) {
      console.error('❌ Calendar Meet creation failed:', error.message);
      
      // Check if it's a service account permission issue
      if (error.message.includes('Bad Request') || error.message.includes('insufficient authentication')) {
        console.log('🔍 Service account cannot create Meet conferences - this is expected');
        console.log('💡 OAuth tokens are required for real Meet link creation');
        return {
          success: false,
          meetLink: 'https://meet.google.com/new?hs=122&authuser=0',
          method: 'service_account_limitation',
          error: 'Service account cannot create Meet conferences',
          note: 'OAuth tokens required for real Meet links - please complete OAuth setup'
        };
      }
      
      console.error('❌ Full error details:', JSON.stringify(error, null, 2));
      return {
        success: false,
        meetLink: 'https://meet.google.com/new?hs=122&authuser=0',
        method: 'calendar_error',
        error: error.message,
        note: 'Calendar API failed - using fallback'
      };
    }
  }

  /**
   * Wait for conference to be ready and extract Meet link
   */
  async waitForConferenceReady(eventId, calendar, timeoutMs = 30000, intervalMs = 2000) {
    try {
      console.log('⏳ Waiting for conference to be ready...');
      
      const start = Date.now();
      let attempts = 0;
      
      while (Date.now() - start < timeoutMs) {
        attempts++;
        console.log(`   🔍 Attempt ${attempts}: Checking conference status...`);
        
        const { data } = await calendar.events.get({ 
          calendarId: 'primary', 
          eventId, 
          conferenceDataVersion: 1 
        });
        
        const status = data.conferenceData?.createRequest?.status?.statusCode;
        console.log(`   📊 Conference Status: ${status || 'pending'}`);
        
        // IMPORTANT: Check for Meet link even if status is pending
        // Sometimes Google populates the link even before status becomes 'success'
        // Also check hangoutLink which may be available regardless of status
        let meetLink = null;
        
        // First try: conferenceData entryPoints (even if status is pending)
        if (data.conferenceData?.entryPoints) {
          const meetEntry = data.conferenceData.entryPoints.find(ep => 
            ep.entryPointType === 'video' || 
            ep.uri?.includes('meet.google.com') ||
            ep.uri?.includes('hangouts.google.com')
          );
          if (meetEntry && meetEntry.uri) {
            meetLink = meetEntry.uri;
            console.log('   🔗 Meet link found in entryPoints (even with pending status):', meetLink);
            return meetLink;
          }
        }
        
        // Second try: hangoutLink (may be available even if status is pending)
        if (data.hangoutLink) {
          meetLink = data.hangoutLink;
          console.log('   🔗 Meet link found in hangoutLink:', meetLink);
          return meetLink;
        }
        
        // If status is success, we already checked above, but let's confirm
        if (status === 'success') {
          console.log('   🎉 Conference status is success, but no Meet link found yet');
          // Continue waiting as link might populate shortly
        }
        
        if (status === 'failure') {
          throw new Error('Conference creation failed');
        }
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
      
      console.log(`⏰ Conference still pending after ${timeoutMs}ms, returning null`);
      return null;
      
    } catch (error) {
      console.error('❌ Error waiting for conference:', error);
      return null;
    }
  }

  /**
   * Create a Meet link using the best available method
   * Tries OAuth first, then falls back to Calendar API
   */
  async createMeetLink(sessionData, userAuth = null) {
    try {
      console.log('🔄 Creating Meet link with best available method...');
      
      // Ensure OAuth tokens are loaded before proceeding
      if (!this.oauthTokens) {
        console.log('⏳ Waiting for OAuth tokens to load...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Try OAuth method first - check stored tokens or user auth
      let oauthToken = null;
      if (userAuth && userAuth.access_token) {
        oauthToken = userAuth.access_token;
        console.log('   🔑 Using provided OAuth token...');
      } else {
        // Try to get valid OAuth token from stored tokens
        oauthToken = await this.getValidOAuthToken();
        if (oauthToken) {
          console.log('   🔑 Using stored OAuth token...');
        }
      }
      
      if (oauthToken) {
        console.log('   🔑 Trying OAuth method...');
        const oauthResult = await this.createMeetLinkWithOAuth(oauthToken, sessionData);
        
        if (oauthResult.success) {
          return oauthResult;
        }
        
        console.log('   ⚠️ OAuth method failed, trying Calendar method...');
      } else {
        console.log('   ⚠️ No OAuth token available, trying Calendar method...');
      }
      
      // Fall back to Calendar API method
      console.log('   📅 Trying Calendar API method...');
      const calendarResult = await this.createMeetLinkWithCalendar(sessionData);
      
      if (calendarResult.success) {
        return calendarResult;
      }
      
      // If both methods fail, return fallback
      console.log('   ⚠️ Both methods failed, returning fallback...');
      return {
        success: false,
        meetLink: `https://meet.google.com/new?hs=122&authuser=0`,
        method: 'fallback',
        note: 'Manual Meet creation required - both OAuth and Calendar methods failed'
      };
      
    } catch (error) {
      console.error('❌ All Meet creation methods failed:', error.message);
      return {
        success: false,
        meetLink: `https://meet.google.com/new?hs=122&authuser=0`,
        method: 'fallback',
        error: error.message,
        note: 'Manual Meet creation required - all methods failed'
      };
    }
  }

  /**
   * Generate a unique Meet link for a session
   * This is the main method that should be called
   */
  async generateSessionMeetLink(sessionData, userAuth = null) {
    try {
      console.log('🔄 Generating session Meet link...');
      console.log('   📅 Session ID:', sessionData?.id || sessionData?.session_id);
      console.log('   🔑 User Auth:', userAuth ? 'Available' : 'Not available');
      
      // Prepare session data - include emails for attendees (KEY to bypassing host approval)
      const meetSessionData = {
        summary: sessionData.summary || 'Therapy Session',
        description: sessionData.description || 'Therapy session',
        startDate: sessionData.startDate,
        startTime: sessionData.startTime,
        endTime: sessionData.endTime,
        startISO: sessionData.startISO || `${sessionData.startDate}T${sessionData.startTime}`,
        endISO: sessionData.endISO || `${sessionData.startDate}T${sessionData.endTime}`,
        // Pass through email addresses - these will be added as attendees
        clientEmail: sessionData.clientEmail,
        psychologistEmail: sessionData.psychologistEmail,
        attendees: sessionData.attendees // Support both formats
      };
      
      // Create Meet link
      const result = await this.createMeetLink(meetSessionData, userAuth);
      
      console.log('✅ Meet link generation result:', result);
      
      return result;
      
    } catch (error) {
      console.error('❌ Session Meet link generation failed:', error.message);
      return {
        success: false,
        meetLink: `https://meet.google.com/new?hs=122&authuser=0`,
        method: 'fallback',
        error: error.message,
        note: 'Manual Meet creation required - generation failed'
      };
    }
  }
}

module.exports = new MeetLinkService();