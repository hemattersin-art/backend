const supabase = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

// Get availability range for admin calendar
const getAvailabilityRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Start date and end date are required')
      );
    }

    console.log('🔍 Getting availability range for admin:', startDate, 'to', endDate);

    // Get all active free assessment timeslots
    const { data: timeslots, error: timeslotsError } = await supabase
      .from('free_assessment_timeslots')
      .select('time_slot, is_active, max_bookings_per_slot')
      .eq('is_active', true);

    if (timeslotsError) {
      console.error('Error fetching timeslots:', timeslotsError);
      return res.status(500).json(
        errorResponse('Failed to fetch timeslots')
      );
    }

    // If no timeslots exist, return empty availability
    if (!timeslots || timeslots.length === 0) {
      console.log('⚠️ No free assessment timeslots found.');
      
      // Generate empty availability for each date in range
      const availability = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        const dateStr = date.toISOString().split('T')[0];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Only show future dates
        if (date >= today) {
          availability.push({
            date: dateStr,
            availableSlots: 0,
            totalSlots: 0
          });
        }
      }
      
      return res.json(
        successResponse(availability, 'No timeslots configured')
      );
    }

    // Get existing bookings for the date range
    const { data: existingBookings, error: bookingsError } = await supabase
      .from('free_assessments')
      .select('scheduled_date, scheduled_time')
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .eq('status', 'booked');

    if (bookingsError) {
      console.error('Error fetching existing bookings:', bookingsError);
      return res.status(500).json(
        errorResponse('Failed to fetch existing bookings')
      );
    }

    // Count bookings per date and time
    const bookingCounts = {};
    existingBookings.forEach(booking => {
      const key = `${booking.scheduled_date}_${booking.scheduled_time}`;
      bookingCounts[key] = (bookingCounts[key] || 0) + 1;
    });

    // Generate availability for each date in range
    const availability = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const dateStr = date.toISOString().split('T')[0];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Only show future dates
      if (date >= today) {
        // For admin dashboard, we need to check if this date has been configured
        // Since we don't have date-specific storage yet, we'll show all dates as available
        // but with a flag to indicate they're not yet configured
        let availableSlots = 0;
        let configuredSlots = 0;
        
        // Check each timeslot for availability
        timeslots.forEach(timeslot => {
          const bookingKey = `${dateStr}_${timeslot.time_slot}`;
          const currentBookings = bookingCounts[bookingKey] || 0;
          
          if (currentBookings < timeslot.max_bookings_per_slot) {
            availableSlots++;
          }
          
          // For now, assume all timeslots are configured globally
          configuredSlots++;
        });
        
        availability.push({
          date: dateStr,
          availableSlots,
          totalSlots: timeslots.length,
          configuredSlots: configuredSlots,
          isConfigured: configuredSlots > 0 // This will be true for all dates since timeslots are global
        });
      }
    }

    res.json(
      successResponse(availability, 'Availability range retrieved successfully')
    );

  } catch (error) {
    console.error('Get availability range error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Get all free assessment timeslots
const getFreeAssessmentTimeslots = async (req, res) => {
  try {
    console.log('🔍 Getting all free assessment timeslots');

    const { data: timeslots, error } = await supabase
      .from('free_assessment_timeslots')
      .select('*')
      .order('time_slot', { ascending: true });

    if (error) {
      console.error('Error fetching timeslots:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch timeslots')
      );
    }

    res.json(
      successResponse(timeslots, 'Timeslots fetched successfully')
    );

  } catch (error) {
    console.error('Get timeslots error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Add multiple timeslots in bulk
const addMultipleTimeslots = async (req, res) => {
  try {
    const { timeslots } = req.body;

    if (!timeslots || !Array.isArray(timeslots) || timeslots.length === 0) {
      return res.status(400).json(
        errorResponse('Timeslots array is required')
      );
    }

    console.log('🔍 Adding multiple timeslots:', timeslots.length);

    // Validate all timeslots
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    for (const timeslot of timeslots) {
      if (!timeslot.time_slot || !timeRegex.test(timeslot.time_slot)) {
        return res.status(400).json(
          errorResponse(`Invalid time format for slot: ${timeslot.time_slot}. Use HH:MM:SS`)
        );
      }
    }

    // Check for existing timeslots to avoid duplicates
    const timeSlotsToCheck = timeslots.map(slot => slot.time_slot);
    const { data: existingTimeslots, error: checkError } = await supabase
      .from('free_assessment_timeslots')
      .select('time_slot')
      .in('time_slot', timeSlotsToCheck);

    if (checkError) {
      console.error('Error checking existing timeslots:', checkError);
      return res.status(500).json(
        errorResponse('Failed to check existing timeslots')
      );
    }

    // Filter out existing timeslots
    const existingTimeSlots = existingTimeslots.map(slot => slot.time_slot);
    const newTimeslots = timeslots.filter(slot => !existingTimeSlots.includes(slot.time_slot));

    if (newTimeslots.length === 0) {
      return res.json(
        successResponse([], 'All timeslots already exist')
      );
    }

    // Prepare data for insertion
    const timeslotsToInsert = newTimeslots.map(slot => ({
      time_slot: slot.time_slot,
      is_active: slot.is_active !== undefined ? slot.is_active : true,
      max_bookings_per_slot: slot.max_bookings_per_slot || 3
    }));

    const { data: insertedTimeslots, error } = await supabase
      .from('free_assessment_timeslots')
      .insert(timeslotsToInsert)
      .select();

    if (error) {
      console.error('Error adding multiple timeslots:', error);
      return res.status(500).json(
        errorResponse('Failed to add timeslots')
      );
    }

    res.json(
      successResponse(insertedTimeslots, `${insertedTimeslots.length} new timeslots added successfully`)
    );

  } catch (error) {
    console.error('Add multiple timeslots error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Add new timeslot
const addTimeslot = async (req, res) => {
  try {
    const { timeSlot, isActive = true, maxBookingsPerSlot = 3 } = req.body;

    if (!timeSlot) {
      return res.status(400).json(
        errorResponse('Time slot is required')
      );
    }

    // Validate time format (HH:MM:SS)
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    if (!timeRegex.test(timeSlot)) {
      return res.status(400).json(
        errorResponse('Invalid time format. Use HH:MM:SS')
      );
    }

    console.log('🔍 Adding new timeslot:', timeSlot);

    const { data: timeslot, error } = await supabase
      .from('free_assessment_timeslots')
      .insert({
        time_slot: timeSlot,
        is_active: isActive,
        max_bookings_per_slot: maxBookingsPerSlot
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding timeslot:', error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json(
          errorResponse('Time slot already exists')
        );
      }
      return res.status(500).json(
        errorResponse('Failed to add timeslot')
      );
    }

    res.json(
      successResponse(timeslot, 'Timeslot added successfully')
    );

  } catch (error) {
    console.error('Add timeslot error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Update timeslot
const updateTimeslot = async (req, res) => {
  try {
    const { id } = req.params;
    const { timeSlot, isActive, maxBookingsPerSlot } = req.body;

    console.log('🔍 Updating timeslot:', id);

    const updateData = {};
    if (timeSlot !== undefined) {
      // Validate time format
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
      if (!timeRegex.test(timeSlot)) {
        return res.status(400).json(
          errorResponse('Invalid time format. Use HH:MM:SS')
        );
      }
      updateData.time_slot = timeSlot;
    }
    if (isActive !== undefined) updateData.is_active = isActive;
    if (maxBookingsPerSlot !== undefined) updateData.max_bookings_per_slot = maxBookingsPerSlot;

    const { data: timeslot, error } = await supabase
      .from('free_assessment_timeslots')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating timeslot:', error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json(
          errorResponse('Time slot already exists')
        );
      }
      return res.status(500).json(
        errorResponse('Failed to update timeslot')
      );
    }

    if (!timeslot) {
      return res.status(404).json(
        errorResponse('Timeslot not found')
      );
    }

    res.json(
      successResponse(timeslot, 'Timeslot updated successfully')
    );

  } catch (error) {
    console.error('Update timeslot error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Delete timeslot
const deleteTimeslot = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🔍 Deleting timeslot:', id);

    // Check if timeslot exists
    const { data: existingTimeslot, error: checkError } = await supabase
      .from('free_assessment_timeslots')
      .select('id, time_slot')
      .eq('id', id)
      .single();

    if (checkError || !existingTimeslot) {
      return res.status(404).json(
        errorResponse('Timeslot not found')
      );
    }

    // Check if there are any active bookings for this timeslot
    const { data: activeBookings, error: bookingError } = await supabase
      .from('free_assessments')
      .select('id')
      .eq('scheduled_time', existingTimeslot.time_slot)
      .eq('status', 'booked');

    if (bookingError) {
      console.error('Error checking active bookings:', bookingError);
      return res.status(500).json(
        errorResponse('Failed to check active bookings')
      );
    }

    if (activeBookings && activeBookings.length > 0) {
      return res.status(400).json(
        errorResponse('Cannot delete timeslot with active bookings')
      );
    }

    // Delete the timeslot
    const { error } = await supabase
      .from('free_assessment_timeslots')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting timeslot:', error);
      return res.status(500).json(
        errorResponse('Failed to delete timeslot')
      );
    }

    res.json(
      successResponse(null, 'Timeslot deleted successfully')
    );

  } catch (error) {
    console.error('Delete timeslot error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Bulk update timeslots (enable/disable multiple)
const bulkUpdateTimeslots = async (req, res) => {
  try {
    const { timeslotIds, isActive } = req.body;

    if (!Array.isArray(timeslotIds) || timeslotIds.length === 0) {
      return res.status(400).json(
        errorResponse('Timeslot IDs array is required')
      );
    }

    if (isActive === undefined) {
      return res.status(400).json(
        errorResponse('isActive status is required')
      );
    }

    console.log('🔍 Bulk updating timeslots:', timeslotIds, 'to active:', isActive);

    const { data: updatedTimeslots, error } = await supabase
      .from('free_assessment_timeslots')
      .update({ is_active: isActive })
      .in('id', timeslotIds)
      .select();

    if (error) {
      console.error('Error bulk updating timeslots:', error);
      return res.status(500).json(
        errorResponse('Failed to update timeslots')
      );
    }

    res.json(
      successResponse(updatedTimeslots, `${updatedTimeslots.length} timeslots updated successfully`)
    );

  } catch (error) {
    console.error('Bulk update timeslots error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Save date-specific configuration
const saveDateConfig = async (req, res) => {
  try {
    const { date, timeSlots } = req.body;

    if (!date || !timeSlots) {
      return res.status(400).json(
        errorResponse('Date and timeSlots are required')
      );
    }

    console.log('🔍 Saving date config for:', date);

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json(
        errorResponse('Invalid date format. Use YYYY-MM-DD')
      );
    }

    // Check if date is in the future
    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
      return res.status(400).json(
        errorResponse('Cannot configure dates in the past')
      );
    }

    // Upsert the date configuration
    const { data: config, error } = await supabase
      .from('free_assessment_date_configs')
      .upsert({
        date: date,
        time_slots: timeSlots,
        is_active: true
      }, {
        onConflict: 'date'
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving date config:', error);
      return res.status(500).json(
        errorResponse('Failed to save date configuration')
      );
    }

    res.json(
      successResponse(config, 'Date configuration saved successfully')
    );

  } catch (error) {
    console.error('Save date config error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Get date-specific configuration
const getDateConfig = async (req, res) => {
  try {
    const { date } = req.params;

    if (!date) {
      return res.status(400).json(
        errorResponse('Date parameter is required')
      );
    }

    console.log('🔍 Getting date config for:', date);

    const { data: config, error } = await supabase
      .from('free_assessment_date_configs')
      .select('*')
      .eq('date', date)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Error fetching date config:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch date configuration')
      );
    }

    res.json(
      successResponse(config || null, config ? 'Date configuration found' : 'No configuration found for this date')
    );

  } catch (error) {
    console.error('Get date config error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Delete date-specific configuration
const deleteDateConfig = async (req, res) => {
  try {
    const { date } = req.params;

    if (!date) {
      return res.status(400).json(
        errorResponse('Date parameter is required')
      );
    }

    console.log('🔍 Deleting date config for:', date);

    const { error } = await supabase
      .from('free_assessment_date_configs')
      .delete()
      .eq('date', date);

    if (error) {
      console.error('Error deleting date config:', error);
      return res.status(500).json(
        errorResponse('Failed to delete date configuration')
      );
    }

    res.json(
      successResponse(null, 'Date configuration deleted successfully')
    );

  } catch (error) {
    console.error('Delete date config error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Get all date configurations for a range
const getDateConfigsRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Start date and end date are required')
      );
    }

    console.log('🔍 Getting date configs range:', startDate, 'to', endDate);

    const { data: configs, error } = await supabase
      .from('free_assessment_date_configs')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('is_active', true)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching date configs range:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch date configurations')
      );
    }

    // Convert to object with date keys for easier frontend consumption
    const configsByDate = {};
    configs.forEach(config => {
      configsByDate[config.date] = {
        timeSlots: config.time_slots,
        isConfigured: true
      };
    });

    res.json(
      successResponse(configsByDate, 'Date configurations fetched successfully')
    );

  } catch (error) {
    console.error('Get date configs range error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

module.exports = {
  getFreeAssessmentTimeslots,
  getAvailabilityRange,
  addTimeslot,
  addMultipleTimeslots,
  updateTimeslot,
  deleteTimeslot,
  bulkUpdateTimeslots,
  saveDateConfig,
  getDateConfig,
  deleteDateConfig,
  getDateConfigsRange
};
