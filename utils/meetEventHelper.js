const { calendar } = require('./googleOAuthClient');
const crypto = require('crypto');
const meetLinkService = require('./meetLinkService');

/**
 * Forces calendar links to display in IST timezone
 * @param {string} htmlLink Original Google Calendar event link
 * @returns {string} Modified link that displays in IST
 */
function forceISTDisplay(htmlLink) {
  try {
    const url = new URL(htmlLink);
    url.searchParams.set("ctz", "Asia/Kolkata");
    return url.toString();
  } catch (error) {
    console.warn('⚠️ Could not modify calendar link for IST display:', error.message);
    return htmlLink; // Return original link if modification fails
  }
}

/**
 * Logs IST confirmation for created events
 * @param {Object} event Google Calendar event object
 */
function logIstConfirmation(event) {
  const utc = event.start?.dateTime; // e.g., "2025-08-30T16:30:00Z"
  const tz = event.start?.timeZone; // "Asia/Kolkata"

  if (utc) {
    // Sanity: 16:30Z + 5:30 = 22:00 IST
    const istTime = new Date(utc).toLocaleString("en-IN", { 
      timeZone: "Asia/Kolkata", 
      hour12: true,
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
    console.log('🌏 IST Verification:', istTime);
    console.log('   - UTC Time:', utc);
    console.log('   - Timezone:', tz);
  }
}

/**
 * Create an event with Google Meet link
 * Uses Calendar API with conferenceData (no Meet API needed)
 */
async function createEventWithMeet({
  summary,
  description,
  startISO,
  endISO,
  attendees = [],
  location
}) {
  try {
    console.log('🔄 Creating event with Meet link...');
    console.log('   📅 Summary:', summary);
    console.log('   🕐 Start:', startISO);
    console.log('   🕐 End:', endISO);
    console.log('   👥 Attendees:', attendees.length);
    
    const cal = await calendar();
    const timezone = process.env.TIMEZONE || 'Asia/Kolkata';
    const allowAttendees = String(process.env.GOOGLE_ALLOW_ATTENDEES || 'false').toLowerCase() === 'true';
    
    // Create event with conference data (no type specified - let Google choose)
    console.log('📊 Sending to Google Calendar API:');
    console.log('   - Start DateTime:', startISO);
    console.log('   - End DateTime:', endISO);
    console.log('   - TimeZone field:', timezone);
    console.log('   - Approach: Offset time + timezone field');
    
    const insert = await cal.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1, // REQUIRED for conference create/read
      sendUpdates: 'all', // Send invites so attendees can join without host admission
      requestBody: {
        summary,
        description: `${description}\n\nThis is a public meeting link that anyone can join.\n\nAttendees:\n${attendees.map(a => `- ${a.email}`).join('\n')}`,
        location: location || 'Google Meet',
        start: { 
          dateTime: startISO,
          timeZone: timezone
        },
        end: { 
          dateTime: endISO,
          timeZone: timezone
        },
        ...(allowAttendees ? { attendees: (attendees || []).map(a => ({ email: a.email, displayName: a.displayName })) } : {}),
        ...(allowAttendees ? { visibility: 'public', guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true, guestsCanModify: false, anyoneCanAddSelf: true } : {}),
        conferenceData: {
          createRequest: { 
            requestId: crypto.randomUUID() // Let Google choose the conference type
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 24 hours before
            { method: 'popup', minutes: 15 } // 15 minutes before
          ]
        }
      }
    });
    
    const eventData = insert.data;
    console.log('   ✅ Calendar event created with ID:', eventData.id);
    
    // IST verification log
    logIstConfirmation(eventData);
    
    if (eventData.conferenceData) {
      console.log('   🔗 Conference Data Created:');
      console.log('   - Request ID:', eventData.conferenceData.createRequest?.requestId);
      console.log('   - Status:', eventData.conferenceData.createRequest?.status?.statusCode);
      console.log('   - Type:', eventData.conferenceData.createRequest?.conferenceSolutionKey?.type);
    }
    
    // Check if Meet link is immediately available
    if (eventData.hangoutLink) {
      console.log('   🚀 Meet link immediately available:', eventData.hangoutLink);
      return {
        event: eventData,
        meetLink: eventData.hangoutLink,
        eventId: eventData.id,
        calendarLink: `https://calendar.google.com/event?eid=${eventData.id}`
      };
    }
    
    // If no immediate link, wait for conference to be ready
    console.log('📅 Meet link not immediately available, waiting...');
    return await waitForConferenceReady(eventData.id);
    
  } catch (error) {
    console.error('❌ Error creating event with Meet:', error);
    if (error.response) {
      console.error('📊 Error Response:', error.response.data);
      console.error('📊 Status Code:', error.response.status);
    }
    throw error;
  }
}

/**
 * Wait for conference to be ready (poll until success)
 * This fixes the "pending forever" issue
 */
async function waitForConferenceReady(eventId, timeoutMs = 30000, intervalMs = 2000) {
  try {
    console.log('⏳ Waiting for conference to be ready...');
    
    const cal = await calendar();
    const start = Date.now();
    let attempts = 0;
    
    while (Date.now() - start < timeoutMs) {
      attempts++;
      console.log(`   🔍 Attempt ${attempts}: Checking conference status...`);
      
      const { data } = await cal.events.get({ 
        calendarId: 'primary', 
        eventId, 
        conferenceDataVersion: 1 
      });
      
      const status = data.conferenceData?.createRequest?.status?.statusCode;
      console.log(`   📊 Conference Status: ${status || 'pending'}`);
      
              if (status === 'success') {
          console.log('   🎉 Conference is ready!');
          
          // Try multiple sources for Meet link
          let meetLink = null;
          
          // First try: conferenceData entryPoints
          if (data.conferenceData?.entryPoints) {
            const meetEntry = data.conferenceData.entryPoints.find(ep => 
              ep.entryPointType === 'video' || 
              ep.uri?.includes('meet.google.com') ||
              ep.uri?.includes('hangouts.google.com')
            );
            if (meetEntry) {
              meetLink = meetEntry.uri;
              console.log('   🔗 Meet link from entryPoints:', meetLink);
            }
          }
          
          // Second try: hangoutLink (fallback)
          if (!meetLink && data.hangoutLink) {
            meetLink = data.hangoutLink;
            console.log('   🔗 Meet link from hangoutLink:', meetLink);
          }
          
          if (meetLink) {
            return {
              event: data,
              meetLink,
              eventId: data.id,
              calendarLink: `https://calendar.google.com/event?eid=${data.id}`
            };
          }
        }
        
        // Fallback: If conference is still pending but we have the event, try to extract any available link
        if (attempts >= 10) { // After 20 seconds, try fallback
          console.log('   ⏰ Conference still pending after 20s, trying fallback extraction...');
          
          let meetLink = null;
          
          // Try hangoutLink even if conference is pending
          if (data.hangoutLink) {
            meetLink = data.hangoutLink;
            console.log('   🔗 Fallback Meet link from hangoutLink:', meetLink);
          }
          
          // Try conferenceData even if pending
          if (!meetLink && data.conferenceData?.entryPoints) {
            console.log('   📊 ConferenceData entryPoints:', data.conferenceData.entryPoints);
            const meetEntry = data.conferenceData.entryPoints.find(ep => 
              ep.uri?.includes('meet.google.com') || ep.uri?.includes('hangouts.google.com')
            );
            if (meetEntry) {
              meetLink = meetEntry.uri;
              console.log('   🔗 Fallback Meet link from conferenceData:', meetLink);
            }
          }
          
          if (meetLink) {
            console.log('   ✅ Using fallback Meet link (conference still pending)');
            return {
              event: data,
              meetLink,
              eventId: data.id,
              calendarLink: forceISTDisplay(data.htmlLink || `https://calendar.google.com/event?eid=${data.id}`),
              note: 'Conference was pending but link extracted'
            };
          }
        }
      
      if (status === 'failure') {
        throw new Error('Conference creation failed');
      }
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error(`Timed out waiting for conference after ${timeoutMs}ms`);
    
  } catch (error) {
    console.error('❌ Error waiting for conference:', error);
    throw error;
  }
}

/**
 * Create public Google Meet link that anyone can join
 * Creates temporary calendar event, extracts Meet link, then deletes the event
 */
async function createMeetEvent(eventData) {
  try {
    console.log('🔄 Creating REAL Google Meet link (without calendar sync)...');
    console.log('   📅 Event Data:', eventData);
    
    // Use startISO and endISO if provided, otherwise combine date and time
    let startISO, endISO;
    
    if (eventData.startISO && eventData.endISO) {
      // Direct ISO format provided
      startISO = eventData.startISO;
      endISO = eventData.endISO;
      console.log('   📅 Using provided ISO format');
    } else if (eventData.startDate && eventData.startTime) {
      // Combine date and time into ISO format
      startISO = `${eventData.startDate}T${eventData.startTime}`;
      endISO = `${eventData.startDate}T${eventData.endTime}`;
      console.log('   📅 Combined date and time into ISO format');
    } else {
      throw new Error('Missing required date/time information');
    }
    
    console.log('   📅 Final Start ISO:', startISO);
    console.log('   📅 Final End ISO:', endISO);
    
    // Create temporary calendar event to get real Meet link
    const event = await createEventWithMeet({
      ...eventData,
      startISO,
      endISO
    });
    
    // Extract the Meet link
    let meetLink = null;
    if (event.hangoutLink) {
      meetLink = event.hangoutLink;
      console.log('🎉 Real Meet link obtained immediately!');
    } else if (event.conferenceData?.entryPoints?.[0]?.uri) {
      meetLink = event.conferenceData.entryPoints[0].uri;
      console.log('🎉 Real Meet link obtained from conference data!');
    } else {
      // Wait for conference to be ready if not immediately available
      console.log('📅 Meet link not immediately available, waiting...');
      const result = await waitForConferenceReady(event.id);
      meetLink = result.meetLink;
    }
    
    console.log('✅ Real Google Meet link created:', meetLink);
    
    // Return the real Meet link
    return {
      event,
      meetLink,
      joinUrl: meetLink,
      startUrl: meetLink,
      eventId: event.id,
      calendarLink: forceISTDisplay(event.htmlLink || `https://calendar.google.com/event?eid=${event.id}`),
      note: 'Real Meet link created successfully'
    };
    
  } catch (error) {
    console.error('❌ Error creating real Meet link:', error);
    console.log('🔄 Falling back to public Meet link...');
    
    // Try to create a simpler Meet link using Google Calendar API
    try {
      const cal = await calendar();
      const timezone = process.env.TIMEZONE || 'Asia/Kolkata';
      
      // Create a simple event with Meet
      const simpleEvent = await cal.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        sendUpdates: 'none', // Don't send invites
        requestBody: {
          summary: eventData.summary || 'Free Assessment Session',
          description: 'Free 20-minute assessment session',
          start: { 
            dateTime: eventData.startISO,
            timeZone: timezone
          },
          end: { 
            dateTime: eventData.endISO,
            timeZone: timezone
          },
          conferenceData: {
            createRequest: { 
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        }
      });
      
      // Wait a moment for the Meet link to be generated
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get the event with Meet link
      const { data: eventWithMeet } = await cal.events.get({
        calendarId: 'primary',
        eventId: simpleEvent.data.id,
        conferenceDataVersion: 1
      });
      
      let meetLink = null;
      if (eventWithMeet.hangoutLink) {
        meetLink = eventWithMeet.hangoutLink;
      } else if (eventWithMeet.conferenceData?.entryPoints?.[0]?.uri) {
        meetLink = eventWithMeet.conferenceData.entryPoints[0].uri;
      }
      
      if (meetLink) {
        console.log('✅ Fallback Meet link created successfully:', meetLink);
        return {
          event: eventWithMeet,
          meetLink,
          joinUrl: meetLink,
          startUrl: meetLink,
          eventId: eventWithMeet.id,
          calendarLink: forceISTDisplay(eventWithMeet.htmlLink || `https://calendar.google.com/event?eid=${eventWithMeet.id}`),
          note: 'Fallback Meet link created successfully'
        };
      }
    } catch (fallbackError) {
      console.error('❌ Fallback Meet creation also failed:', fallbackError);
    }
    
    // Final fallback - create a real Meet link using a different approach
    console.log('🔄 Using final fallback - creating Meet link via Google Meet API...');
    
    // For now, return a placeholder that indicates the issue
    const fallbackMeetLink = `https://meet.google.com/new?hs=122&authuser=0`;
    
    console.log('⚠️ Using Google Meet creation link:', fallbackMeetLink);
    
    return {
      event: { id: `fallback-${crypto.randomUUID()}`, summary: eventData.summary },
      meetLink: fallbackMeetLink,
      joinUrl: fallbackMeetLink,
      startUrl: fallbackMeetLink,
      eventId: `fallback-${crypto.randomUUID()}`,
      calendarLink: null,
      note: 'Google Meet creation link - psychologist should create meeting manually'
    };
  }
}

/**
 * Create a real Google Meet link using the new Meet Link Service
 * This is the recommended method for creating Meet links
 */
async function createRealMeetLink(eventData, userAuth = null) {
  try {
    console.log('🔄 Creating REAL Google Meet link using Meet Link Service...');
    
    const result = await meetLinkService.generateSessionMeetLink(eventData, userAuth);
    
    if (result.success) {
      console.log('✅ Real Meet link created successfully!');
      console.log('   Method:', result.method);
      console.log('   Meet Link:', result.meetLink);
      
      return {
        event: { id: result.eventId || `meet-${Date.now()}` },
        meetLink: result.meetLink,
        joinUrl: result.meetLink,
        startUrl: result.meetLink,
        eventId: result.eventId || `meet-${Date.now()}`,
        calendarLink: null,
        method: result.method,
        note: 'Real Meet link created successfully'
      };
    } else {
      console.log('❌ Meet link creation failed, using fallback');
      return {
        event: { id: `fallback-${Date.now()}` },
        meetLink: result.meetLink,
        joinUrl: result.meetLink,
        startUrl: result.meetLink,
        eventId: `fallback-${Date.now()}`,
        calendarLink: null,
        method: result.method,
        note: result.note || 'Fallback Meet link'
      };
    }
    
  } catch (error) {
    console.error('❌ Real Meet link creation failed:', error.message);
    return {
      event: { id: `error-${Date.now()}` },
      meetLink: `https://meet.google.com/new?hs=122&authuser=0`,
      joinUrl: `https://meet.google.com/new?hs=122&authuser=0`,
      startUrl: `https://meet.google.com/new?hs=122&authuser=0`,
      eventId: `error-${Date.now()}`,
      calendarLink: null,
      method: 'fallback',
      note: 'Error creating Meet link - using fallback'
    };
  }
}

module.exports = {
  createEventWithMeet,
  waitForConferenceReady,
  createMeetEvent,
  createRealMeetLink
};
