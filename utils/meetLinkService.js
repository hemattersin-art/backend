const { google } = require('googleapis');
const crypto = require('crypto');
const fs = require('fs').promises;

// Logging toggle for production
const DEBUG_MEET = process.env.DEBUG_MEET === 'true';
const log = (...args) => DEBUG_MEET && console.log(...args);
const logError = (...args) => console.error(...args); // Always log errors

class MeetLinkService {
  constructor() {
    this.oauth2Client = null;
    this.serviceAccount = null;
    this.oauthTokens = null;
    this.tokensLoaded = false;
    this.initializeAuth();
    // Load OAuth tokens asynchronously - but track when done
    this.loadOAuthTokensFromFile().catch(error => {
      log('ℹ️ OAuth token loading completed');
    });
  }

  // Helper: Format time consistently (HH:MM -> HH:MM:SS)
  formatTime(time) {
    if (!time) return '00:00:00';
    return time.length === 5 ? `${time}:00` : time;
  }

  // Helper: Build normalized return object
  createResult(success, meetLink, method, eventId = null, eventLink = null, error = null, note = null) {
    return {
      success,
      meetLink: meetLink || 'https://meet.google.com/new?hs=122&authuser=0',
      method: method || 'fallback',
      eventId,
      eventLink,
      error
    };
  }

  async initializeAuth() {
    try {
      // Load service account for fallback
      this.serviceAccount = require('../google-service-account.json');
      log('✅ Meet Link Service initialized');
    } catch (error) {
      logError('❌ Failed to initialize Meet Link Service:', error.message);
    }
  }

  // Wait for tokens to be loaded (fixes race condition)
  async ensureTokensLoaded() {
    if (this.tokensLoaded) return;
    // Wait up to 2 seconds for tokens to load
    const maxWait = 2000;
    const start = Date.now();
    while (!this.tokensLoaded && (Date.now() - start) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Refresh OAuth token using refresh token (using modern getAccessToken instead of deprecated refreshAccessToken)
   */
  async refreshOAuthToken(refreshToken) {
    try {
      log('🔄 Refreshing OAuth token...');
      
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'http://localhost:5001/api/oauth2/callback'
      );

      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      // Use getAccessToken() instead of deprecated refreshAccessToken()
      const { credentials } = await oauth2Client.getAccessToken();
      
      log('✅ OAuth token refreshed successfully');
      return {
        success: true,
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || refreshToken,
        expiryDate: credentials.expiry_date
      };
    } catch (error) {
      logError('❌ Token refresh failed:', error.message);
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
      const tokenData = await fs.readFile('./oauth-tokens.json', 'utf8');
      const tokens = JSON.parse(tokenData);
      
      // Check if tokens are still valid (not expired)
      const now = Date.now();
      if (tokens.expiryDate && tokens.expiryDate > now) {
        this.oauthTokens = tokens;
        log('✅ OAuth tokens loaded from file');
      } else {
        log('⚠️ OAuth tokens in file are expired');
        // Try to refresh if we have a refresh token
        if (tokens.refreshToken) {
          log('🔄 Attempting to refresh expired tokens...');
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
            log('✅ OAuth tokens refreshed and saved');
          } else {
            log('❌ Token refresh failed, will need new OAuth authorization');
          }
        } else {
          log('❌ No refresh token available, will need new OAuth authorization');
        }
      }
      this.tokensLoaded = true;
    } catch (error) {
      log('ℹ️ No OAuth tokens file found (this is normal on first run)');
      this.tokensLoaded = true; // Mark as loaded even if file doesn't exist
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
      const tokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        storedAt: Date.now()
      };
      
      await fs.writeFile('./oauth-tokens.json', JSON.stringify(tokenData, null, 2));
      log('✅ OAuth tokens stored in memory and file');
      
      return true;
    } catch (error) {
      logError('❌ Failed to store OAuth tokens:', error.message);
      return false;
    }
  }

  /**
   * Get valid OAuth token (refresh if needed)
   */
  async getValidOAuthToken() {
    try {
      // Ensure tokens are loaded first
      await this.ensureTokensLoaded();
      
      if (!this.oauthTokens) {
        log('⚠️ No OAuth tokens available');
        return null;
      }

      const now = Date.now();
      const expiryTime = this.oauthTokens.expiryDate;
      
      // Check if token expires in next 5 minutes
      if (expiryTime && (expiryTime - now) < 5 * 60 * 1000) {
        log('🔄 Token expires soon, checking refresh options...');
        
        if (this.oauthTokens.refreshToken) {
          log('🔄 Attempting token refresh...');
          const refreshResult = await this.refreshOAuthToken(this.oauthTokens.refreshToken);
          if (refreshResult.success) {
            this.oauthTokens = {
              accessToken: refreshResult.accessToken,
              refreshToken: refreshResult.refreshToken,
              expiryDate: refreshResult.expiryDate,
              storedAt: Date.now()
            };
            log('✅ Token refreshed successfully');
          } else {
            log('❌ Token refresh failed, will use service account fallback');
            return null;
          }
        } else {
          log('⚠️ No refresh token available - this is normal for Google OAuth');
          log('🔄 Will use service account fallback for reliability');
          return null;
        }
      }

      return this.oauthTokens.accessToken;
    } catch (error) {
      logError('❌ Error getting valid OAuth token:', error.message);
      return null;
    }
  }
  async createMeetLinkWithOAuth(oauthToken, sessionData, userAuth = null) {
    try {
      log('🔄 Creating Meet link with OAuth token via Calendar API...');
      
      // Create OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'http://localhost:5001/api/oauth2/callback'
      );

      // If userAuth is provided, check if token needs refresh and set refresh token
      let accessToken = oauthToken;
      if (userAuth?.refresh_token) {
        // Set both access and refresh tokens so OAuth client can auto-refresh if needed
        oauth2Client.setCredentials({
          access_token: oauthToken,
          refresh_token: userAuth.refresh_token,
          expiry_date: userAuth.expiry_date
        });
        
        // Check if token is expired or expires soon (within 5 minutes)
        const now = Date.now();
        const expiryDate = userAuth.expiry_date ? new Date(userAuth.expiry_date).getTime() : null;
        const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
        
        if (expiryDate && expiryDate <= (now + bufferTime)) {
          log('🔄 Access token expired or expires soon, refreshing...');
          try {
            // Use getAccessToken() which automatically refreshes if needed
            // Returns { token, res } where token is the access token string
            const { token } = await oauth2Client.getAccessToken();
            accessToken = token;
            
            // Get updated credentials from OAuth client after refresh
            const updatedCredentials = oauth2Client.credentials;
            log('✅ Token refreshed automatically');
            
            // Update userAuth with new token (caller should save this to database)
            if (userAuth && updatedCredentials) {
              userAuth.access_token = updatedCredentials.access_token || token;
              userAuth.expiry_date = updatedCredentials.expiry_date;
              userAuth.refresh_token = updatedCredentials.refresh_token || userAuth.refresh_token;
            }
          } catch (refreshError) {
            logError('❌ Auto-refresh failed:', refreshError.message);
            // Continue with original token - might still work if just expired
          }
        }
      } else {
        // Just set access token if no refresh token available
        oauth2Client.setCredentials({
          access_token: oauthToken
        });
      }

      // Update credentials with refreshed token if it was refreshed
      if (accessToken !== oauthToken) {
        oauth2Client.setCredentials({
          access_token: accessToken,
          refresh_token: userAuth.refresh_token,
          expiry_date: userAuth.expiry_date
        });
      }
      
      // Create Meet link using Calendar API with conference data
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Build attendees array - OAuth can use attendees
      const attendees = [];
      
      if (sessionData.clientEmail) {
        attendees.push({ email: sessionData.clientEmail });
      }
      
      if (sessionData.psychologistEmail) {
        attendees.push({ email: sessionData.psychologistEmail });
      }
      
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
          dateTime: `${sessionData.startDate}T${this.formatTime(sessionData.startTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: `${sessionData.startDate}T${this.formatTime(sessionData.endTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        attendees: attendees.length > 0 ? attendees : undefined,
        // Make meeting open to anyone with the link (no waiting room)
        visibility: 'public',
        guestsCanInviteOthers: true,
        guestsCanSeeOtherGuests: true,
        anyoneCanAddSelf: true, // Allows anyone with the link to join without approval
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        }
      };

      log('📅 Creating calendar event with Meet link...');
      log('   👥 Attendees:', attendees.map(a => a.email).join(', ') || 'None');
      const createdEvent = await calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Send calendar invites - invited attendees can join without approval
      });

      log('✅ Real Meet link created with OAuth via Calendar API');
      const meetLink = createdEvent.data.conferenceData?.entryPoints?.[0]?.uri;
      log('Meet Link:', meetLink);
      
      const result = this.createResult(
        true,
        meetLink,
        'oauth_calendar',
        createdEvent.data.id,
        createdEvent.data.htmlLink
      );
      
      // Add refreshed tokens to result if they were refreshed
      if (userAuth && userAuth.access_token !== oauthToken) {
        result.refreshedTokens = {
          access_token: userAuth.access_token,
          refresh_token: userAuth.refresh_token,
          expiry_date: userAuth.expiry_date
        };
      }
      
      return result;

    } catch (error) {
      logError('❌ OAuth Meet creation failed:', error.message);
      return this.createResult(false, null, 'oauth_calendar', null, null, error.message);
    }
  }

  /**
   * Create a Meet link using Calendar API with conference data
   * This works for users without OAuth tokens (service account)
   */
  async createMeetLinkWithCalendar(sessionData) {
    try {
      log('🔄 Creating Meet link with Calendar API...');
      
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

      // Build attendees list for description (service accounts can't use attendees field)
      const attendeeEmails = [];
      
      if (sessionData.clientEmail) {
        attendeeEmails.push(sessionData.clientEmail);
      }
      
      if (sessionData.psychologistEmail) {
        attendeeEmails.push(sessionData.psychologistEmail);
      }
      
      if (Array.isArray(sessionData.attendees) && sessionData.attendees.length > 0) {
        sessionData.attendees.forEach(email => {
          if (email && !attendeeEmails.includes(email)) {
            attendeeEmails.push(email);
          }
        });
      }

      // Service accounts CANNOT use attendees field - detect upfront and skip it
      const canUseAttendees = false; // Service account limitation
      
      // Add attendee emails to description so they're documented
      let description = sessionData.description || 'Therapy session with Google Meet';
      if (attendeeEmails.length > 0) {
        description += `\n\nAttendees: ${attendeeEmails.join(', ')}\n\nJoin via the Google Meet link above.`;
      }

      // Create event WITHOUT attendees field (service account limitation)
      const event = {
        summary: sessionData.summary || 'Therapy Session',
        description: description,
        start: {
          dateTime: `${sessionData.startDate}T${this.formatTime(sessionData.startTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: `${sessionData.startDate}T${this.formatTime(sessionData.endTime)}`,
          timeZone: 'Asia/Kolkata'
        },
        // Make meeting open to anyone with the link (no waiting room)
        visibility: 'public',
        guestsCanInviteOthers: true,
        guestsCanSeeOtherGuests: true,
        anyoneCanAddSelf: true, // Allows anyone with the link to join without approval
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID()
          }
        }
      };

      log('🔍 Calendar API Event Data:', {
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        attendees: attendeeEmails.join(', ') || 'None (service account limitation)',
        conferenceData: event.conferenceData ? 'present' : 'none'
      });

      // Service account cannot use attendees - create event without them
      log('⚠️ Service account cannot use attendees field - creating event without attendees');
      log('   📧 Meet link will be shared via email/WhatsApp instead');
      log('   📝 Attendees documented in event description');
      
      const result = await calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        requestBody: event
        // No attendees, no sendUpdates - service account limitation
      });
      
      log('✅ Calendar event created (without attendees - service account limitation)');

      log('✅ Calendar event created:', result.data.id);
      
      // Try to extract Meet link immediately from the created event
      let eventData = result.data;
      
      log('🔍 Checking for Meet link in created event...');
      log('   - Has conferenceData:', !!eventData.conferenceData);
      log('   - Has entryPoints:', !!eventData.conferenceData?.entryPoints);
      log('   - Has hangoutLink:', !!eventData.hangoutLink);
      
      // Check if Meet link is already available
      const immediateLink = this.extractMeetLink(eventData);
      if (immediateLink) {
        log('✅ REAL Meet link found immediately:', immediateLink);
        return this.createResult(
          true,
          immediateLink,
          'calendar_service_account',
          eventData.id,
          eventData.htmlLink
        );
      }
      
      // If no immediate Meet link, wait for conference with exponential backoff
      log('⏳ No immediate Meet link, waiting for conference...');
      const meetLink = await this.waitForConferenceReady(eventData.id, calendar);
      
      if (meetLink) {
        log('✅ Real Meet link created with Calendar:', meetLink);
        return this.createResult(
          true,
          meetLink,
          'calendar_service_account',
          eventData.id,
          eventData.htmlLink
        );
      }
      
      // Service account limitation - cannot create Meet conferences
      log('⚠️ Conference timeout - Service account limitation detected');
      log('⚠️ Service accounts CANNOT create Google Meet conferences via Calendar API');
      log('⚠️ Solution: Use OAuth tokens (psychologist Google Calendar connection) for real Meet links');
      
      return this.createResult(
        false,
        null,
        'service_account_limitation',
        eventData.id,
        eventData.htmlLink,
        'Service accounts cannot create Meet conferences - OAuth required for real Meet links'
      );

    } catch (error) {
      logError('❌ Calendar Meet creation failed:', error.message);
      
      const errorMsg = error.message || '';
      if (errorMsg.includes('Bad Request') || errorMsg.includes('insufficient authentication')) {
        log('🔍 Service account cannot create Meet conferences - this is expected');
        log('💡 OAuth tokens are required for real Meet link creation');
        return this.createResult(
          false,
          null,
          'service_account_limitation',
          null,
          null,
          'Service account cannot create Meet conferences'
        );
      }
      
      return this.createResult(
        false,
        null,
        'calendar_error',
        null,
        null,
        error.message
      );
    }
  }

  // Helper: Extract Meet link from event data
  extractMeetLink(eventData) {
    // Check entryPoints first
    if (eventData.conferenceData?.entryPoints) {
      const meetEntry = eventData.conferenceData.entryPoints.find(ep => 
        ep.entryPointType === 'video' || 
        ep.uri?.includes('meet.google.com') ||
        ep.uri?.includes('hangouts.google.com')
      );
      if (meetEntry?.uri) {
        return meetEntry.uri;
      }
    }
    
    // Check hangoutLink as fallback
    if (eventData.hangoutLink) {
      return eventData.hangoutLink;
    }
    
    return null;
  }

  /**
   * Wait for conference to be ready and extract Meet link
   * Uses exponential backoff for better reliability
   */
  async waitForConferenceReady(eventId, calendar, timeoutMs = 30000) {
    try {
      log('⏳ Waiting for conference to be ready...');
      
      const start = Date.now();
      let attempts = 0;
      const baseInterval = 1000; // Start with 1 second
      
      while (Date.now() - start < timeoutMs) {
        attempts++;
        
        // Exponential backoff: 1s, 2s, 4s, 6s, 8s, then cap at 8s
        const waitTime = Math.min(baseInterval * Math.pow(2, Math.min(attempts - 1, 2)), 8000);
        if (attempts > 3) {
          // After 3 attempts, use fixed 8s interval
          const fixedInterval = 8000;
          await new Promise(resolve => setTimeout(resolve, fixedInterval));
        } else if (attempts > 1) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        log(`   🔍 Attempt ${attempts}: Checking conference status...`);
        
        const { data } = await calendar.events.get({ 
          calendarId: 'primary', 
          eventId, 
          conferenceDataVersion: 1 
        });
        
        const status = data.conferenceData?.createRequest?.status?.statusCode;
        log(`   📊 Conference Status: ${status || 'pending'}`);
        
        // Check for Meet link (even if status is pending)
        const meetLink = this.extractMeetLink(data);
        if (meetLink) {
          log('   🔗 Meet link found:', meetLink);
          return meetLink;
        }
        
        if (status === 'failure') {
          throw new Error('Conference creation failed');
        }
        
        if (status === 'success') {
          log('   🎉 Conference status is success, but no Meet link found yet');
          // Continue waiting as link might populate shortly
        }
      }
      
      log(`⏰ Conference still pending after ${timeoutMs}ms, returning null`);
      return null;
      
    } catch (error) {
      logError('❌ Error waiting for conference:', error);
      return null;
    }
  }

  /**
   * Create a Meet link using the best available method
   * Priority: OAuth (if available) > Service Account > Fallback
   */
  async createMeetLink(sessionData, userAuth = null) {
    try {
      log('🔄 Creating Meet link with best available method...');
      
      // Ensure OAuth tokens are loaded
      await this.ensureTokensLoaded();
      
      // Priority 1: Try OAuth method (if userAuth provided or stored tokens available)
      let oauthToken = null;
      if (userAuth?.access_token) {
        oauthToken = userAuth.access_token;
        log('   🔑 Using provided OAuth token...');
      } else {
        oauthToken = await this.getValidOAuthToken();
        if (oauthToken) {
          log('   🔑 Using stored OAuth token...');
        }
      }
      
      if (oauthToken) {
        log('   🔑 Trying OAuth method...');
        const oauthResult = await this.createMeetLinkWithOAuth(oauthToken, sessionData, userAuth);
        
        if (oauthResult.success) {
          return oauthResult;
        }
        
        log('   ⚠️ OAuth method failed, trying Calendar method...');
      } else {
        log('   ⚠️ No OAuth token available, trying Calendar method...');
      }
      
      // Priority 2: Fall back to Calendar API method (service account)
      log('   📅 Trying Calendar API method...');
      const calendarResult = await this.createMeetLinkWithCalendar(sessionData);
      
      if (calendarResult.success) {
        return calendarResult;
      }
      
      // Priority 3: Fallback link
      log('   ⚠️ Both methods failed, returning fallback...');
      return this.createResult(
        false,
        null,
        'fallback',
        null,
        null,
        'Manual Meet creation required - both OAuth and Calendar methods failed'
      );
      
    } catch (error) {
      logError('❌ All Meet creation methods failed:', error.message);
      return this.createResult(
        false,
        null,
        'fallback',
        null,
        null,
        error.message
      );
    }
  }

  /**
   * Generate a unique Meet link for a session
   * This is the main method that should be called
   */
  async generateSessionMeetLink(sessionData, userAuth = null) {
    try {
      log('🔄 Generating session Meet link...');
      log('   📅 Session ID:', sessionData?.id || sessionData?.session_id);
      log('   🔑 User Auth:', userAuth ? 'Available' : 'Not available');
      
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
      
      log('✅ Meet link generation result:', result);
      
      return result;
      
    } catch (error) {
      logError('❌ Session Meet link generation failed:', error.message);
      return this.createResult(
        false,
        null,
        'fallback',
        null,
        null,
        error.message
      );
    }
  }
}

module.exports = new MeetLinkService();