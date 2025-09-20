const supabase = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');
const googleCalendarService = require('../utils/googleCalendarService');

// Set psychologist availability
const setAvailability = async (req, res) => {
  try {
    const { psychologist_id, date, time_slots, is_available = true } = req.body;

    // Validate required fields
    if (!psychologist_id || !date || !time_slots || !Array.isArray(time_slots)) {
      return res.status(400).json(
        errorResponse('Missing required fields: psychologist_id, date, time_slots (array)')
      );
    }

    // Check if psychologist exists
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('id, first_name, last_name')
      .eq('id', psychologist_id)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Check if date is in the future
    const availabilityDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (availabilityDate <= today) {
      return res.status(400).json(
        errorResponse('Availability date must be in the future')
      );
    }

    // Check for conflicts with existing sessions
    const { data: conflictingSessions } = await supabase
      .from('sessions')
      .select('id, scheduled_time')
      .eq('psychologist_id', psychologist_id)
      .eq('scheduled_date', date)
      .in('status', ['booked', 'rescheduled']);

    if (conflictingSessions && conflictingSessions.length > 0) {
      const bookedTimes = conflictingSessions.map(s => s.scheduled_time);
      const conflictingSlots = time_slots.filter(slot => bookedTimes.includes(slot));
      
      if (conflictingSlots.length > 0) {
        return res.status(400).json(
          errorResponse(`Time slots ${conflictingSlots.join(', ')} are already booked`)
        );
      }
    }

    // Check Google Calendar for external conflicts
    try {
      const { data: psychologist } = await supabase
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .eq('id', psychologist_id)
        .single();

      if (psychologist && psychologist.google_calendar_credentials) {
        const googleConflicts = [];
        
        for (const timeSlot of time_slots) {
          const [hours, minutes] = timeSlot.split(':');
          const slotStart = new Date(date);
          slotStart.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + 60); // Assuming 1-hour sessions
          
          const hasConflict = await googleCalendarService.hasTimeConflict(
            psychologist.google_calendar_credentials,
            slotStart,
            slotEnd
          );
          
          if (hasConflict) {
            googleConflicts.push(timeSlot);
          }
        }
        
        if (googleConflicts.length > 0) {
          return res.status(400).json(
            errorResponse(`Time slots ${googleConflicts.join(', ')} conflict with Google Calendar events`)
          );
        }
      }
    } catch (googleError) {
      console.error('Error checking Google Calendar conflicts:', googleError);
      // Continue without blocking if Google Calendar check fails
    }

    // Check if availability already exists for this date
    const { data: existingAvailability } = await supabase
      .from('availability')
      .select('id')
      .eq('psychologist_id', psychologist_id)
      .eq('date', date)
      .single();

    let availability;
    if (existingAvailability) {
      // Update existing availability
      const { data: updatedAvailability, error: updateError } = await supabase
        .from('availability')
        .update({
          time_slots,
          is_available,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAvailability.id)
        .select()
        .single();

      if (updateError) {
        console.error('Update availability error:', updateError);
        return res.status(500).json(
          errorResponse('Failed to update availability')
        );
      }
      availability = updatedAvailability;
    } else {
      // Create new availability
      const { data: newAvailability, error: createError } = await supabase
        .from('availability')
        .insert({
          psychologist_id,
          date,
          time_slots,
          is_available,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.error('Create availability error:', createError);
        return res.status(500).json(
          errorResponse('Failed to create availability')
        );
      }
      availability = newAvailability;
    }

    // COMMENTED OUT: Google Calendar sync (optional - for blocking time)
    /*
    try {
      // This could create "busy" blocks in Google Calendar
      // Implementation depends on your specific requirements
    } catch (googleError) {
      console.error('Error syncing with Google Calendar:', googleError);
      // Continue even if Google Calendar sync fails
    }
    */
    console.log('ℹ️  Google Calendar sync disabled - availability set without calendar sync');

    res.json(
      successResponse(availability, 'Availability set successfully')
    );

  } catch (error) {
    console.error('Set availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while setting availability')
    );
  }
};

// Get psychologist availability
const getAvailability = async (req, res) => {
  try {
    const { psychologist_id, start_date, end_date } = req.query;

    if (!psychologist_id) {
      return res.status(400).json(
        errorResponse('psychologist_id is required')
      );
    }

    let query = supabase
      .from('availability')
      .select('*')
      .eq('psychologist_id', psychologist_id)
      .eq('is_available', true);

    if (start_date) {
      query = query.gte('date', start_date);
    }
    if (end_date) {
      query = query.lte('date', end_date);
    }

    query = query.order('date', { ascending: true });

    const { data: availability, error } = await query;

    if (error) {
      console.error('Get availability error:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch availability')
      );
    }

    // Get booked sessions for the same period (exclude cancelled sessions)
    let sessionsQuery = supabase
      .from('sessions')
      .select('scheduled_date, scheduled_time, status, id')
      .eq('psychologist_id', psychologist_id)
      .in('status', ['booked', 'rescheduled', 'confirmed']);

    if (start_date) {
      sessionsQuery = sessionsQuery.gte('scheduled_date', start_date);
    }
    if (end_date) {
      sessionsQuery = sessionsQuery.lte('scheduled_date', end_date);
    }

    const { data: bookedSessions, error: sessionsError } = await sessionsQuery;
    
    if (sessionsError) {
      console.error('Error fetching booked sessions:', sessionsError);
    }

    console.log(`📅 Found ${bookedSessions?.length || 0} booked sessions for psychologist ${psychologist_id}`);

    // Combine availability with booked sessions - remove booked slots in real-time
    const availabilityWithBookings = availability.map(avail => {
      const bookedTimes = (bookedSessions || [])
        .filter(session => session.scheduled_date === avail.date)
        .map(session => session.scheduled_time);

      // Filter out booked time slots from available slots
      const availableSlots = avail.time_slots.filter(slot => 
        !bookedTimes.includes(slot)
      );

      console.log(`📅 Date ${avail.date}: ${avail.time_slots.length} total slots, ${bookedTimes.length} booked, ${availableSlots.length} available`);

      return {
        ...avail,
        available_slots: availableSlots,
        booked_slots: bookedTimes,
        total_slots: avail.time_slots.length,
        available_count: availableSlots.length
      };
    });

    res.json(
      successResponse(availabilityWithBookings)
    );

  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching availability')
    );
  }
};

// Get available time slots for a specific date
const getAvailableTimeSlots = async (req, res) => {
  try {
    const { psychologist_id, date } = req.query;

    if (!psychologist_id || !date) {
      return res.status(400).json(
        errorResponse('psychologist_id and date are required')
      );
    }

    // Get availability for the specific date
    const { data: availability, error: availabilityError } = await supabase
      .from('availability')
      .select('time_slots')
      .eq('psychologist_id', psychologist_id)
      .eq('date', date)
      .eq('is_available', true)
      .single();

    if (availabilityError || !availability) {
      return res.json(
        successResponse({ available_slots: [], booked_slots: [] })
      );
    }

    // Get booked sessions for the date
    const { data: bookedSessions } = await supabase
      .from('sessions')
      .select('scheduled_time')
      .eq('psychologist_id', psychologist_id)
      .eq('scheduled_date', date)
      .in('status', ['booked', 'rescheduled']);

    const bookedTimes = bookedSessions.map(session => session.scheduled_time);
    const availableSlots = availability.time_slots.filter(slot => 
      !bookedTimes.includes(slot)
    );

    res.json(
      successResponse({
        available_slots: availableSlots,
        booked_slots: bookedTimes,
        all_slots: availability.time_slots
      })
    );

  } catch (error) {
    console.error('Get available time slots error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching time slots')
    );
  }
};

// Delete availability
const deleteAvailability = async (req, res) => {
  try {
    const { availabilityId } = req.params;

    // Check if availability exists
    const { data: availability, error: availabilityError } = await supabase
      .from('availability')
      .select('*')
      .eq('id', availabilityId)
      .single();

    if (availabilityError || !availability) {
      return res.status(404).json(
        errorResponse('Availability not found')
      );
    }

    // Check if there are any sessions on this date
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('psychologist_id', availability.psychologist_id)
      .eq('scheduled_date', availability.date)
      .in('status', ['booked', 'rescheduled']);

    if (sessions && sessions.length > 0) {
      return res.status(400).json(
        errorResponse('Cannot delete availability with existing sessions')
      );
    }

    // Delete availability
    const { error: deleteError } = await supabase
      .from('availability')
      .delete()
      .eq('id', availabilityId);

    if (deleteError) {
      console.error('Delete availability error:', deleteError);
      return res.status(500).json(
        errorResponse('Failed to delete availability')
      );
    }

    res.json(
      successResponse(null, 'Availability deleted successfully')
    );

  } catch (error) {
    console.error('Delete availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting availability')
    );
  }
};

// Bulk set availability for multiple dates
const setBulkAvailability = async (req, res) => {
  try {
    const { psychologist_id, availability_data } = req.body;

    if (!psychologist_id || !availability_data || !Array.isArray(availability_data)) {
      return res.status(400).json(
        errorResponse('Missing required fields: psychologist_id, availability_data (array)')
      );
    }

    // Validate each availability entry
    for (const entry of availability_data) {
      if (!entry.date || !entry.time_slots || !Array.isArray(entry.time_slots)) {
        return res.status(400).json(
          errorResponse('Each availability entry must have date and time_slots')
        );
      }
    }

    // Check if psychologist exists
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('id')
      .eq('id', psychologist_id)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    const results = [];
    const errors = [];

    for (const entry of availability_data) {
      try {
        // Check for conflicts
        const { data: conflictingSessions } = await supabase
          .from('sessions')
          .select('id')
          .eq('psychologist_id', psychologist_id)
          .eq('scheduled_date', entry.date)
          .in('status', ['booked', 'rescheduled']);

        if (conflictingSessions && conflictingSessions.length > 0) {
          errors.push({
            date: entry.date,
            error: 'Date has conflicting sessions'
          });
          continue;
        }

        // Set availability for this date
        const { data: availability, error: availabilityError } = await supabase
          .from('availability')
          .upsert({
            psychologist_id,
            date: entry.date,
            time_slots: entry.time_slots,
            is_available: true,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'psychologist_id,date'
          })
          .select()
          .single();

        if (availabilityError) {
          errors.push({
            date: entry.date,
            error: availabilityError.message
          });
        } else {
          results.push(availability);
        }
      } catch (error) {
        errors.push({
          date: entry.date,
          error: error.message
        });
      }
    }

    res.json(
      successResponse({
        successful: results,
        errors: errors
      }, `Bulk availability set. ${results.length} successful, ${errors.length} errors.`)
    );

  } catch (error) {
    console.error('Set bulk availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while setting bulk availability')
    );
  }
};

// Sync Google Calendar events and block conflicting times
const syncGoogleCalendar = async (req, res) => {
  try {
    const { psychologist_id, start_date, end_date } = req.body;

    if (!psychologist_id || !start_date || !end_date) {
      return res.status(400).json(
        errorResponse('Missing required fields: psychologist_id, start_date, end_date')
      );
    }

    // Get psychologist with Google Calendar credentials
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('id, first_name, last_name, google_calendar_credentials')
      .eq('id', psychologist_id)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    if (!psychologist.google_calendar_credentials) {
      return res.status(400).json(
        errorResponse('Psychologist has no Google Calendar credentials')
      );
    }

    // Sync calendar events
    const syncResult = await googleCalendarService.syncCalendarEvents(
      psychologist,
      new Date(start_date),
      new Date(end_date)
    );

    if (!syncResult.success) {
      return res.status(500).json(
        errorResponse(`Failed to sync calendar: ${syncResult.error}`)
      );
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
          .eq('psychologist_id', psychologist_id)
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

    res.json(
      successResponse({
        syncedAt: syncResult.syncedAt,
        totalExternalEvents: syncResult.externalEvents.length,
        blockedSlots: blockedSlots,
        errors: errors
      }, 'Google Calendar synced successfully')
    );

  } catch (error) {
    console.error('Sync Google Calendar error:', error);
    res.status(500).json(
      errorResponse('Internal server error while syncing calendar')
    );
  }
};

// Get Google Calendar busy times for a psychologist
const getGoogleCalendarBusyTimes = async (req, res) => {
  try {
    const { psychologist_id, start_date, end_date } = req.query;

    if (!psychologist_id || !start_date || !end_date) {
      return res.status(400).json(
        errorResponse('Missing required query parameters: psychologist_id, start_date, end_date')
      );
    }

    // Get psychologist with Google Calendar credentials
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('id, first_name, last_name, google_calendar_credentials')
      .eq('id', psychologist_id)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    if (!psychologist.google_calendar_credentials) {
      return res.status(400).json(
        errorResponse('Psychologist has no Google Calendar credentials')
      );
    }

    // Get busy time slots from Google Calendar
    const busySlots = await googleCalendarService.getBusyTimeSlots(
      psychologist.google_calendar_credentials,
      new Date(start_date),
      new Date(end_date)
    );

    res.json(
      successResponse(busySlots, 'Google Calendar busy times retrieved successfully')
    );

  } catch (error) {
    console.error('Get Google Calendar busy times error:', error);
    res.status(500).json(
      errorResponse('Internal server error while getting busy times')
    );
  }
};

module.exports = {
  setAvailability,
  getAvailability,
  getAvailableTimeSlots,
  deleteAvailability,
  setBulkAvailability,
  syncGoogleCalendar,
  getGoogleCalendarBusyTimes
};
