const { calendar } = require('./googleOAuthClient');
const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const googleCalendarService = require('./googleCalendarService');

class AvailabilityCalendarService {
  constructor() {
    this.calendar = calendar();
  }

  /**
   * Get psychologist's availability from Google Calendar
   * This checks for existing sessions and blocks those time slots
   */
  async getPsychologistAvailability(psychologistId, date) {
    try {
      console.log(`🔍 Getting availability for psychologist ${psychologistId} on ${date}`);
      
      // Get psychologist details
      const { data: psychologist, error: psychError } = await supabase
        .from('psychologists')
        .select('email')
        .eq('id', psychologistId)
        .single();
      
      if (psychError || !psychologist) {
        throw new Error('Psychologist not found');
      }

      // Get existing sessions from database for this date (include all active session statuses)
      const { data: existingSessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('scheduled_time, status, id')
        .eq('psychologist_id', psychologistId)
        .eq('scheduled_date', date)
        .in('status', ['booked', 'rescheduled', 'confirmed']);
      
      if (sessionsError) {
        console.error('Error fetching existing sessions:', sessionsError);
        throw sessionsError;
      }

      // Also get booked assessment sessions for this date
      const { data: existingAssessmentSessions, error: assessmentSessionsError } = await supabaseAdmin
        .from('assessment_sessions')
        .select('scheduled_time, status, id')
        .eq('psychologist_id', psychologistId)
        .eq('scheduled_date', date)
        .in('status', ['booked', 'reserved']); // Include reserved as they're also blocked

      if (assessmentSessionsError) {
        console.error('Error fetching existing assessment sessions:', assessmentSessionsError);
      }

      // Combine both types of sessions
      const allExistingSessions = [
        ...(existingSessions || []),
        ...(existingAssessmentSessions || [])
      ];

      console.log(`📊 Found ${existingSessions?.length || 0} regular sessions and ${existingAssessmentSessions?.length || 0} assessment sessions for ${date}`);

      // Get Google Calendar events for this date
      const startOfDay = new Date(`${date}T00:00:00`);
      const endOfDay = new Date(`${date}T23:59:59`);
      
      const { data: calendarEvents, error: calendarError } = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      if (calendarError) {
        console.error('Error fetching calendar events:', calendarError);
        // Continue with database-only approach if calendar fails
      }

      // Combine database sessions, calendar events, and blocked time slots
      const blockedSlots = new Set();
      
      // Add database sessions (both regular and assessment)
      allExistingSessions.forEach(session => {
        const timeSlot = session.scheduled_time;
        blockedSlots.add(timeSlot);
        const sessionType = existingAssessmentSessions?.some(s => s.id === session.id) ? 'assessment' : 'regular';
        console.log(`   🚫 Blocked slot from DB: ${timeSlot} (${session.status}, ${sessionType}, ID: ${session.id})`);
      });

      // Add calendar events (if available)
      if (calendarEvents && calendarEvents.items) {
        calendarEvents.items.forEach(event => {
          // Check if this is a blocked time slot (marked with 🚫 BLOCKED)
          const isBlockedSlot = event.summary && event.summary.includes('🚫 BLOCKED');
          
          if (event.start && event.start.dateTime) {
            const eventTime = new Date(event.start.dateTime);
            const timeSlot = eventTime.toTimeString().split(' ')[0]; // HH:MM:SS
            
            if (isBlockedSlot) {
              blockedSlots.add(timeSlot);
              console.log(`   🚫 Blocked slot from Calendar: ${timeSlot} (${event.summary})`);
            } else {
              // Regular calendar event - also block this slot
              blockedSlots.add(timeSlot);
              console.log(`   📅 Blocked slot from Calendar Event: ${timeSlot} (${event.summary})`);
            }
          } else if (event.start && event.start.date) {
            // All-day event (like blocked whole day)
            if (isBlockedSlot) {
              console.log(`   🚫 Whole day blocked from Calendar: ${event.summary}`);
              // Block all time slots for whole day events
              for (let hour = 9; hour < 18; hour++) {
                const timeSlot = `${hour.toString().padStart(2, '0')}:00:00`;
                blockedSlots.add(timeSlot);
              }
            }
          }
        });
      }

      // Generate available time slots (9 AM to 6 PM, 1-hour slots)
      const availableSlots = [];
      const startHour = 9; // 9 AM
      const endHour = 18; // 6 PM
      
      for (let hour = startHour; hour < endHour; hour++) {
        const timeSlot = `${hour.toString().padStart(2, '0')}:00:00`;
        if (!blockedSlots.has(timeSlot)) {
          availableSlots.push({
            time: timeSlot,
            available: true,
            displayTime: `${hour}:00 ${hour < 12 ? 'AM' : 'PM'}`
          });
        } else {
          availableSlots.push({
            time: timeSlot,
            available: false,
            displayTime: `${hour}:00 ${hour < 12 ? 'AM' : 'PM'}`,
            reason: 'Booked'
          });
        }
      }

      console.log(`✅ Generated ${availableSlots.length} time slots for ${date}`);
      console.log(`   🟢 Available: ${availableSlots.filter(slot => slot.available).length}`);
      console.log(`   🔴 Blocked: ${availableSlots.filter(slot => !slot.available).length}`);

      return {
        date,
        psychologistId,
        timeSlots: availableSlots,
        totalSlots: availableSlots.length,
        availableSlots: availableSlots.filter(slot => slot.available).length,
        blockedSlots: availableSlots.filter(slot => !slot.available).length
      };

    } catch (error) {
      console.error('Error getting psychologist availability:', error);
      throw error;
    }
  }

  /**
   * Check if a specific time slot is available
   */
  async isTimeSlotAvailable(psychologistId, date, time) {
    try {
      // Use the same data source as the frontend - the availability table
      const { data: availabilityData, error: availabilityError } = await supabase
        .from('availability')
        .select('*')
        .eq('psychologist_id', psychologistId)
        .eq('date', date)
        .single();

      if (availabilityError || !availabilityData || !availabilityData.is_available) {
        return false;
      }

      // Convert 24-hour format to 12-hour format for comparison
      let timeToMatch = time;
      if (time.includes(':')) {
        const [hour, minute] = time.split(':');
        const hourNum = parseInt(hour);
        if (hourNum === 0) {
          timeToMatch = `12:${minute} AM`;
        } else if (hourNum === 12) {
          timeToMatch = `12:${minute} PM`;
        } else if (hourNum > 12) {
          timeToMatch = `${hourNum - 12}:${minute} PM`;
        } else {
          timeToMatch = `${hourNum}:${minute} AM`;
        }
      }

      // Check if the converted time slot exists in the time_slots array
      const timeSlots = availabilityData.time_slots || [];
      return timeSlots.includes(timeToMatch);
    } catch (error) {
      console.error('Error checking time slot availability:', error);
      return false;
    }
  }

  /**
   * Get psychologist availability for a date range - USING AVAILABILITY TABLE + GOOGLE CALENDAR
   */
  async getPsychologistAvailabilityRange(psychologistId, startDate, endDate) {
    try {
      const startTime = Date.now();
      console.log(`🚀 Getting availability range for psychologist ${psychologistId} from ${startDate} to ${endDate}`);
      
      // Get psychologist details including Google Calendar credentials
      const { data: psychologist, error: psychError } = await supabase
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .eq('id', psychologistId)
        .single();
      
      if (psychError || !psychologist) {
        throw new Error('Psychologist not found');
      }

      // SINGLE QUERY: Get availability from availability table
      const { data: availabilityData, error: availabilityError } = await supabase
        .from('availability')
        .select('*')
        .eq('psychologist_id', psychologistId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
      
      if (availabilityError) {
        console.error('Error fetching availability:', availabilityError);
        throw availabilityError;
      }

      console.log(`📊 Found ${availabilityData.length} availability records in date range`);

      // Get all booked sessions in the date range to filter them out
      // Check both regular therapy sessions and assessment sessions
      const { data: bookedSessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('scheduled_date, scheduled_time, status, id')
        .eq('psychologist_id', psychologistId)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .in('status', ['booked', 'rescheduled', 'confirmed']);

      if (sessionsError) {
        console.error('Error fetching booked sessions:', sessionsError);
      }

      // Also get booked assessment sessions for the same period
      const { data: bookedAssessmentSessions, error: assessmentSessionsError } = await supabaseAdmin
        .from('assessment_sessions')
        .select('scheduled_date, scheduled_time, status, id')
        .eq('psychologist_id', psychologistId)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .in('status', ['booked', 'reserved']); // Include reserved as they're also blocked

      if (assessmentSessionsError) {
        console.error('Error fetching booked assessment sessions:', assessmentSessionsError);
      }

      // Combine both types of booked sessions
      const allBookedSessions = [
        ...(bookedSessions || []),
        ...(bookedAssessmentSessions || [])
      ];

      console.log(`🔒 Found ${bookedSessions?.length || 0} booked regular sessions and ${bookedAssessmentSessions?.length || 0} booked assessment sessions in date range`);

      // SKIP Google Calendar check entirely to prevent any blocking
      // The scheduled cron job (every 10 minutes) will handle syncing and updating the database
      // Availability will be shown from the database, which is updated by the background sync
      // This ensures the page loads instantly without any Google Calendar API calls
      let googleCalendarEvents = [];
      
      // REMOVED: Google Calendar real-time check - was causing page to hang
      // REMOVED: Background sync trigger - was causing infinite logs
      // The scheduled cron job (every 10 minutes) will handle all Google Calendar syncing
      // Users will see availability from the database, which is kept up-to-date by the cron job

      // Helper function to convert 24-hour format to 12-hour format
      const convertTo12Hour = (time24) => {
        // Handle if time is already in 12-hour format
        if (time24.includes('AM') || time24.includes('PM')) {
          return time24;
        }
        
        const [hours, minutes] = time24.split(':');
        const hour = parseInt(hours);
        const minute = minutes || '00';
        
        if (hour === 0) {
          return `12:${minute} AM`;
        } else if (hour < 12) {
          return `${hour}:${minute} AM`;
        } else if (hour === 12) {
          return `12:${minute} PM`;
        } else {
          return `${hour - 12}:${minute} PM`;
        }
      };

      // Create a map of booked sessions by date (convert to 12-hour format to match availability)
      // Store multiple format variations to ensure matching
      const bookedSlotsByDate = {};
      allBookedSessions.forEach(session => {
        if (!bookedSlotsByDate[session.scheduled_date]) {
          bookedSlotsByDate[session.scheduled_date] = new Set();
        }
        
        const time12Hour = convertTo12Hour(session.scheduled_time);
        if (time12Hour) {
          // Add multiple format variations for reliable matching
          bookedSlotsByDate[session.scheduled_date].add(time12Hour); // "9:00 PM"
          bookedSlotsByDate[session.scheduled_date].add(time12Hour.replace(' ', '')); // "9:00PM"
          // Also add with padded hour
          if (time12Hour.includes(':')) {
            const [hour, rest] = time12Hour.split(':');
            const paddedHour = hour.padStart(2, '0');
            bookedSlotsByDate[session.scheduled_date].add(`${paddedHour}:${rest}`); // "09:00 PM"
            bookedSlotsByDate[session.scheduled_date].add(`${paddedHour}:${rest.replace(' ', '')}`); // "09:00PM"
          }
          // Also add the original 24-hour format for matching
          const time24 = session.scheduled_time.substring(0, 5); // "21:00"
          bookedSlotsByDate[session.scheduled_date].add(time24);
        }
        
        const sessionType = session.status === 'reserved' ? 'assessment (reserved)' : 
                           bookedSessions?.some(s => s.id === session.id) ? 'regular therapy' : 'assessment';
        console.log(`   🚫 Blocked: ${session.scheduled_date} at ${session.scheduled_time} → ${time12Hour} (${session.status}, ${sessionType})`);
      });

      // Create a map of Google Calendar events by date
      const googleCalendarSlotsByDate = {};
      googleCalendarEvents.forEach(event => {
        const eventDate = new Date(event.start);
        const year = eventDate.getFullYear();
        const month = String(eventDate.getMonth() + 1).padStart(2, '0');
        const day = String(eventDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        if (!googleCalendarSlotsByDate[dateStr]) {
          googleCalendarSlotsByDate[dateStr] = new Set();
        }
        
        // Convert Google Calendar event time to 12-hour format
        const eventTime = eventDate.toTimeString().split(' ')[0]; // HH:MM:SS
        const time12Hour = convertTo12Hour(eventTime);
        googleCalendarSlotsByDate[dateStr].add(time12Hour);
        console.log(`   📅 Google Calendar Blocked: ${dateStr} at ${time12Hour} (${event.title})`);
      });

      // Create availability for each date in range
      const availability = [];
      const currentDate = new Date(startDate);
      const end = new Date(endDate);
      
      while (currentDate <= end) {
        // Use local date formatting to avoid timezone conversion issues
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        // Find availability record for this date
        const dayAvailability = availabilityData.find(avail => avail.date === dateStr);
        
        if (dayAvailability && dayAvailability.is_available) {
          // Use the time slots from availability table
          const timeSlots = dayAvailability.time_slots || [];
          const bookedSlots = bookedSlotsByDate[dateStr] || new Set();
          const googleCalendarSlots = googleCalendarSlotsByDate[dateStr] || new Set();
          
          // Create formatted time slots showing both available and blocked (including Google Calendar)
          // Use flexible matching to handle format variations
          const formattedTimeSlots = timeSlots.map(timeString => {
            const timeStr = typeof timeString === 'string' ? timeString.trim() : String(timeString).trim();
            const timeNormalized = timeStr.toLowerCase();
            
            // Check if this slot is booked (try multiple format variations)
            let isBooked = bookedSlots.has(timeStr);
            if (!isBooked) {
              // Try variations: with/without spaces, padded/unpadded hour
              isBooked = Array.from(bookedSlots).some(booked => {
                const bookedStr = String(booked).trim().toLowerCase();
                const timeNoSpace = timeNormalized.replace(/\s+/g, '');
                const bookedNoSpace = bookedStr.replace(/\s+/g, '');
                // Exact match
                if (timeNormalized === bookedStr || timeNoSpace === bookedNoSpace) return true;
                // Match time portion (e.g., "9:00" from "9:00 PM" or "21:00")
                const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
                const bookedMatch = String(booked).match(/(\d{1,2}):(\d{2})/);
                if (timeMatch && bookedMatch) {
                  // Convert both to 24-hour for comparison
                  const timeHour = parseInt(timeMatch[1], 10);
                  const timeMin = timeMatch[2];
                  const bookedHour = parseInt(bookedMatch[1], 10);
                  const bookedMin = bookedMatch[2];
                  
                  const timePeriod = timeStr.match(/\s*(AM|PM)/i)?.[1]?.toUpperCase();
                  const bookedPeriod = String(booked).match(/\s*(AM|PM)/i)?.[1]?.toUpperCase();
                  
                  let timeHour24 = timeHour;
                  let bookedHour24 = bookedHour;
                  
                  // Convert to 24-hour
                  if (timePeriod === 'PM' && timeHour !== 12) timeHour24 = timeHour + 12;
                  else if (timePeriod === 'AM' && timeHour === 12) timeHour24 = 0;
                  
                  if (bookedPeriod === 'PM' && bookedHour !== 12) bookedHour24 = bookedHour + 12;
                  else if (bookedPeriod === 'AM' && bookedHour === 12) bookedHour24 = 0;
                  
                  // If booked is already 24-hour (no period), use it directly
                  if (!bookedPeriod && bookedHour >= 0 && bookedHour <= 23) bookedHour24 = bookedHour;
                  
                  return timeHour24 === bookedHour24 && timeMin === bookedMin;
                }
                return false;
              });
            }
            
            const isGoogleCalendarBlocked = googleCalendarSlots.has(timeStr);
            const isBlocked = isBooked || isGoogleCalendarBlocked;
            
            let reason = 'available';
            if (isBooked) reason = 'booked';
            else if (isGoogleCalendarBlocked) reason = 'google_calendar_blocked';
            
            return {
              time: timeString,
              available: !isBlocked,
              displayTime: timeString,
              status: reason,
              reason: reason
            };
          });
          
          const availableTimeSlots = formattedTimeSlots.filter(slot => slot.available);
          const blockedTimeSlots = formattedTimeSlots.filter(slot => !slot.available);
          
          // Debug: Log booked slots for this date
          const bookedForDate = bookedSlotsByDate[dateStr];
          if (bookedForDate && bookedForDate.size > 0) {
            console.log(`   🔍 Debug ${dateStr}: Booked slots in Set:`, Array.from(bookedForDate));
            console.log(`   🔍 Debug ${dateStr}: Available slots from DB:`, timeSlots);
            const blockedSlots = formattedTimeSlots.filter(s => !s.available);
            if (blockedSlots.length > 0) {
              console.log(`   🔍 Debug ${dateStr}: Blocked slots found:`, blockedSlots.map(s => s.time));
            } else {
              console.log(`   ⚠️  Debug ${dateStr}: No blocked slots found, but booked sessions exist!`);
            }
          }
          
          const dayData = {
            date: dateStr,
            psychologistId,
            timeSlots: formattedTimeSlots,
            totalSlots: timeSlots.length,
            availableSlots: availableTimeSlots.length,
            blockedSlots: blockedTimeSlots.length,
            googleCalendarBlocked: blockedTimeSlots.filter(slot => slot.reason === 'google_calendar_blocked').length
          };
          
          console.log(`📅 ${dateStr}: ${timeSlots.length} total, ${availableTimeSlots.length} available, ${dayData.blockedSlots} blocked (${dayData.googleCalendarBlocked} from Google Calendar)`);
          availability.push(dayData);
        } else {
          // No availability record - skip this date entirely
          // Only show dates that actually have availability records
          console.log(`📅 ${dateStr}: No availability record - skipping`);
          // Don't add this date to availability array
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      const endTime = Date.now();
      console.log(`✅ Generated availability for ${availability.length} days in ${endTime - startTime}ms`);
      return availability;
      
    } catch (error) {
      console.error('Error getting availability range:', error);
      throw error;
    }
  }

  /**
   * Update availability when a session is booked
   */
  async updateAvailabilityOnBooking(psychologistId, date, time) {
    try {
      console.log(`🔄 Updating availability for psychologist ${psychologistId} on ${date} at ${time}`);
      
      // Convert 24-hour format to 12-hour format for comparison
      // Handle both "08:00:00" and "08:00" formats
      let timeToMatch = time;
      let timeToMatchAlt = null; // Alternative format (e.g., "8:00 AM" vs "08:00 AM")
      
      if (time.includes(':')) {
        const timeParts = time.split(':');
        const hour = parseInt(timeParts[0]);
        const minute = timeParts[1] || '00';
        const minuteOnly = minute.split(' ')[0]; // Remove AM/PM if present
        
        const hourNum = parseInt(hour);
        
        // Create both formats: "8:00 AM" and "08:00 AM" to handle variations
        if (hourNum === 0) {
          timeToMatch = `12:${minuteOnly} AM`;
          timeToMatchAlt = `12:${minuteOnly.padStart(2, '0')} AM`;
        } else if (hourNum === 12) {
          timeToMatch = `12:${minuteOnly} PM`;
          timeToMatchAlt = `12:${minuteOnly.padStart(2, '0')} PM`;
        } else if (hourNum > 12) {
          timeToMatch = `${hourNum - 12}:${minuteOnly} PM`;
          timeToMatchAlt = `${String(hourNum - 12).padStart(2, '0')}:${minuteOnly.padStart(2, '0')} PM`;
        } else {
          timeToMatch = `${hourNum}:${minuteOnly} AM`;
          timeToMatchAlt = `${String(hourNum).padStart(2, '0')}:${minuteOnly.padStart(2, '0')} AM`;
        }
      }
      
      console.log(`🔄 Converting ${time} to ${timeToMatch} (alt: ${timeToMatchAlt}) for availability update`);
      
      // Get current availability for this date
      const { data: availabilityData, error: availabilityError } = await supabase
        .from('availability')
        .select('*')
        .eq('psychologist_id', psychologistId)
        .eq('date', date)
        .single();
      
      if (availabilityError) {
        console.error('Error fetching availability for update:', availabilityError);
        return false;
      }
      
      if (!availabilityData) {
        console.log('No availability record found for this date');
        return false;
      }
      
      // Remove the booked time slot from time_slots array
      // Try to match both formats to handle variations in slot format
      const currentTimeSlots = availabilityData.time_slots || [];
      let slotRemoved = false;
      const updatedTimeSlots = currentTimeSlots.filter(slot => {
        const slotStr = typeof slot === 'string' ? slot.trim() : String(slot).trim();
        const normalizedSlot = slotStr.toLowerCase().replace(/\s+/g, ' ');
        
        // Normalize both time formats for comparison
        const normalizedMatch = timeToMatch.toLowerCase().replace(/\s+/g, ' ');
        const normalizedMatchAlt = timeToMatchAlt ? timeToMatchAlt.toLowerCase().replace(/\s+/g, ' ') : null;
        
        // Also try matching by extracting just the time part (e.g., "8:00" from "8:00 AM")
        // But we need to also check AM/PM to avoid matching "8:00 PM" with "8:00 AM"
        const slotTimeOnly = slotStr.match(/(\d{1,2}):(\d{2})/)?.[0];
        const matchTimeOnly = timeToMatch.match(/(\d{1,2}):(\d{2})/)?.[0];
        const slotPeriod = slotStr.match(/\s*(AM|PM)/i)?.[1]?.toUpperCase();
        const matchPeriod = timeToMatch.match(/\s*(AM|PM)/i)?.[1]?.toUpperCase();
        
        // Match if:
        // 1. Exact normalized match (handles format variations)
        // 2. Time matches AND period matches (to avoid matching 8:00 PM with 8:00 AM)
        const timeMatches = slotTimeOnly && matchTimeOnly && slotTimeOnly === matchTimeOnly;
        const periodMatches = slotPeriod && matchPeriod && slotPeriod === matchPeriod;
        
        const matches = normalizedSlot === normalizedMatch || 
                       (normalizedMatchAlt && normalizedSlot === normalizedMatchAlt) ||
                       (timeMatches && periodMatches);
        
        if (matches) {
          slotRemoved = true;
          console.log(`   🗑️  Removing slot: "${slotStr}" (matched with ${timeToMatch})`);
        }
        
        return !matches;
      });
      
      console.log(`📅 Current slots: ${currentTimeSlots.length}, After booking: ${updatedTimeSlots.length}`);
      if (!slotRemoved && currentTimeSlots.length > 0) {
        console.warn(`⚠️  Warning: Could not find matching slot format. Looking for "${timeToMatch}" in slots:`, currentTimeSlots);
      }
      
      // Update the availability record
      const { error: updateError } = await supabase
        .from('availability')
        .update({
          time_slots: updatedTimeSlots,
          is_available: updatedTimeSlots.length > 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', availabilityData.id);
      
      if (updateError) {
        console.error('Error updating availability:', updateError);
        return false;
      }
      
      console.log('✅ Availability updated successfully - time slot blocked');
      return true;
    } catch (error) {
      console.error('Error updating availability:', error);
      throw error;
    }
  }

  /**
   * Get psychologist's working hours and preferences
   */
  async getPsychologistWorkingHours(psychologistId) {
    try {
      // Default working hours (can be customized per psychologist)
      return {
        startHour: 9, // 9 AM
        endHour: 18, // 6 PM
        slotDuration: 60, // 60 minutes
        workingDays: [1, 2, 3, 4, 5], // Monday to Friday
        timezone: 'Asia/Kolkata'
      };
    } catch (error) {
      console.error('Error getting working hours:', error);
      // Return default working hours
      return {
        startHour: 9,
        endHour: 18,
        slotDuration: 60,
        workingDays: [1, 2, 3, 4, 5],
        timezone: 'Asia/Kolkata'
      };
    }
  }
}

module.exports = new AvailabilityCalendarService();
