const supabase = require('../config/supabase');

/**
 * Generate default time slots from 8 AM to 10 PM (1 hour each)
 * Returns array of time strings in 12-hour format
 */
const generateDefaultTimeSlots = () => {
  const slots = [];
  for (let hour = 8; hour <= 22; hour++) {
    if (hour === 12) {
      slots.push('12:00 PM');
    } else if (hour < 12) {
      slots.push(`${hour}:00 AM`);
    } else {
      slots.push(`${hour - 12}:00 PM`);
    }
  }
  return slots;
};

/**
 * Generate availability records for a date range
 * @param {string} psychologistId - The psychologist ID
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (inclusive)
 * @returns {Array} Array of availability records
 */
const generateAvailabilityRecords = (psychologistId, startDate, endDate) => {
  const records = [];
  const timeSlots = generateDefaultTimeSlots();
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    records.push({
      psychologist_id: psychologistId,
      date: dateString,
      time_slots: timeSlots,
      is_available: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return records;
};

/**
 * Set default availability for a psychologist (3 weeks from today)
 * @param {string} psychologistId - The psychologist ID
 * @returns {Promise<Object>} Result object with success status and message
 */
const setDefaultAvailability = async (psychologistId) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate end date (3 weeks from today)
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 21); // 3 weeks = 21 days
    
    // Generate availability records
    const availabilityRecords = generateAvailabilityRecords(psychologistId, today, endDate);
    
    if (availabilityRecords.length === 0) {
      return { success: false, message: 'No availability records to create' };
    }
    
    // Check which dates already exist
    const existingDates = new Set();
    const { data: existingAvailability } = await supabase
      .from('availability')
      .select('date')
      .eq('psychologist_id', psychologistId)
      .gte('date', today.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);
    
    if (existingAvailability) {
      existingAvailability.forEach(avail => {
        existingDates.add(avail.date);
      });
    }
    
    // Filter out dates that already exist
    const newRecords = availabilityRecords.filter(record => !existingDates.has(record.date));
    
    if (newRecords.length === 0) {
      return { success: true, message: 'All dates already have availability', created: 0 };
    }
    
    // Insert new availability records
    const { error: insertError } = await supabase
      .from('availability')
      .insert(newRecords);
    
    if (insertError) {
      console.error('Error inserting default availability:', insertError);
      return { success: false, message: 'Failed to create default availability', error: insertError };
    }
    
    console.log(`✅ Created ${newRecords.length} default availability records for psychologist ${psychologistId}`);
    return { success: true, message: `Created ${newRecords.length} availability records`, created: newRecords.length };
    
  } catch (error) {
    console.error('Error setting default availability:', error);
    return { success: false, message: 'Error setting default availability', error: error.message };
  }
};

/**
 * Add next day availability (called daily at 12 AM)
 * Adds availability for the day that is 3 weeks from today
 * @returns {Promise<Object>} Result object
 */
const addNextDayAvailability = async () => {
  try {
    // Get all active psychologists
    const { data: psychologists, error: psychError } = await supabase
      .from('psychologists')
      .select('id');
    
    if (psychError) {
      console.error('Error fetching psychologists:', psychError);
      return { success: false, message: 'Failed to fetch psychologists' };
    }
    
    if (!psychologists || psychologists.length === 0) {
      return { success: true, message: 'No psychologists found', updated: 0 };
    }
    
    // Calculate the date that is 3 weeks from today
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 21);
    targetDate.setHours(0, 0, 0, 0);
    
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    const timeSlots = generateDefaultTimeSlots();
    let successCount = 0;
    let skipCount = 0;
    
    // Add availability for each psychologist
    for (const psych of psychologists) {
      // Check if availability already exists for this date
      const { data: existing } = await supabase
        .from('availability')
        .select('id')
        .eq('psychologist_id', psych.id)
        .eq('date', dateString)
        .single();
      
      if (existing) {
        skipCount++;
        continue;
      }
      
      // Insert new availability
      const { error: insertError } = await supabase
        .from('availability')
        .insert({
          psychologist_id: psych.id,
          date: dateString,
          time_slots: timeSlots,
          is_available: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error(`Error adding availability for psychologist ${psych.id}:`, insertError);
      } else {
        successCount++;
      }
    }
    
    console.log(`✅ Daily availability update: ${successCount} added, ${skipCount} skipped`);
    return { 
      success: true, 
      message: `Updated ${successCount} psychologists, ${skipCount} already had availability`,
      updated: successCount,
      skipped: skipCount
    };
    
  } catch (error) {
    console.error('Error in addNextDayAvailability:', error);
    return { success: false, message: 'Error adding next day availability', error: error.message };
  }
};

/**
 * Update all existing psychologists with default availability
 * @returns {Promise<Object>} Result object
 */
const updateAllPsychologistsAvailability = async () => {
  try {
    const { data: psychologists, error: psychError } = await supabase
      .from('psychologists')
      .select('id');
    
    if (psychError) {
      console.error('Error fetching psychologists:', psychError);
      return { success: false, message: 'Failed to fetch psychologists' };
    }
    
    if (!psychologists || psychologists.length === 0) {
      return { success: true, message: 'No psychologists found', updated: 0 };
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const psych of psychologists) {
      const result = await setDefaultAvailability(psych.id);
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
        console.error(`Failed to set availability for psychologist ${psych.id}:`, result.message);
      }
    }
    
    return {
      success: true,
      message: `Updated ${successCount} psychologists, ${errorCount} errors`,
      updated: successCount,
      errors: errorCount
    };
    
  } catch (error) {
    console.error('Error updating all psychologists availability:', error);
    return { success: false, message: 'Error updating all psychologists', error: error.message };
  }
};

module.exports = {
  generateDefaultTimeSlots,
  generateAvailabilityRecords,
  setDefaultAvailability,
  addNextDayAvailability,
  updateAllPsychologistsAvailability
};

