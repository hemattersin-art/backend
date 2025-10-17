const { calendar } = require('./googleOAuthClient');
const supabase = require('../config/supabase');
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

      // Combine database sessions and calendar events
      const blockedSlots = new Set();
      
      // Add database sessions
      console.log(`📊 Found ${existingSessions.length} existing sessions for ${date}`);
      existingSessions.forEach(session => {
        const timeSlot = session.scheduled_time;
        blockedSlots.add(timeSlot);
        console.log(`   🚫 Blocked slot from DB: ${timeSlot} (${session.status}, ID: ${session.id})`);
      });

      // Add calendar events (if available)
      if (calendarEvents && calendarEvents.items) {
        calendarEvents.items.forEach(event => {
          if (event.start && event.start.dateTime) {
            const eventTime = new Date(event.start.dateTime);
            const timeSlot = eventTime.toTimeString().split(' ')[0]; // HH:MM:SS
            blockedSlots.add(timeSlot);
            console.log(`   🚫 Blocked slot from Calendar: ${timeSlot}`);
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

      console.log(`🔒 Found ${bookedSessions?.length || 0} booked sessions in date range`);

      // Check Google Calendar for external bookings if credentials exist
      let googleCalendarEvents = [];
      if (psychologist.google_calendar_credentials) {
        try {
          console.log(`📅 Checking Google Calendar for external bookings...`);
          const busySlots = await googleCalendarService.getBusyTimeSlots(
            psychologist.google_calendar_credentials,
            new Date(startDate),
            new Date(endDate)
          );
          
          // Filter out events created by our own system to avoid circular blocking
          googleCalendarEvents = busySlots.filter(slot => 
            !slot.title.toLowerCase().includes('littleminds') && 
            !slot.title.toLowerCase().includes('session') &&
            !slot.title.toLowerCase().includes('therapy') &&
            !slot.title.toLowerCase().includes('kuttikal')
          );
          
          console.log(`📅 Found ${googleCalendarEvents.length} external Google Calendar events`);
        } catch (calendarError) {
          console.error('Error checking Google Calendar:', calendarError);
          // Continue without Google Calendar data if it fails
        }
      } else {
        console.log(`📅 No Google Calendar credentials found for psychologist ${psychologistId}`);
      }

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
      const bookedSlotsByDate = {};
      (bookedSessions || []).forEach(session => {
        if (!bookedSlotsByDate[session.scheduled_date]) {
          bookedSlotsByDate[session.scheduled_date] = new Set();
        }
        
        const time12Hour = convertTo12Hour(session.scheduled_time);
        bookedSlotsByDate[session.scheduled_date].add(time12Hour);
        console.log(`   🚫 Blocked: ${session.scheduled_date} at ${session.scheduled_time} → ${time12Hour} (${session.status})`);
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
          const formattedTimeSlots = timeSlots.map(timeString => {
            const isBooked = bookedSlots.has(timeString);
            const isGoogleCalendarBlocked = googleCalendarSlots.has(timeString);
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
      
      console.log(`🔄 Converting ${time} to ${timeToMatch} for availability update`);
      
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
      const currentTimeSlots = availabilityData.time_slots || [];
      const updatedTimeSlots = currentTimeSlots.filter(slot => slot !== timeToMatch);
      
      console.log(`📅 Current slots: ${currentTimeSlots.length}, After booking: ${updatedTimeSlots.length}`);
      
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
