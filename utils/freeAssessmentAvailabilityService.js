const { supabaseAdmin } = require('../config/supabase');

/**
 * Generate default time slots for free assessments
 * Slots: 10 AM, 11 AM, 12 PM, (break 1-2 PM), 2 PM, 3 PM, 4 PM
 * Returns array of time strings in HH:MM:SS format (e.g. "10:00:00", "14:00:00")
 */
const generateDefaultTimeSlots = () => {
  // Time slots: 10 AM, 11 AM, 12 PM, 2 PM, 3 PM, 4 PM
  // Stored in HH:MM:SS format (24-hour)
  return [
    '10:00:00', // 10:00 AM
    '11:00:00', // 11:00 AM
    '12:00:00', // 12:00 PM
    '14:00:00', // 2:00 PM
    '15:00:00', // 3:00 PM
    '16:00:00'  // 4:00 PM
  ];
};

/**
 * Generate date config records for a date range
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (inclusive)
 * @returns {Array} Array of date config records
 */
const generateDateConfigRecords = (startDate, endDate) => {
  const records = [];
  const timeSlots = generateDefaultTimeSlots();
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    records.push({
      date: dateString,
      time_slots: timeSlots,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return records;
};

/**
 * Get today's date in IST (Asia/Kolkata) as YYYY-MM-DD string
 * @returns {string} Date string in YYYY-MM-DD format
 */
const getTodayIST = () => {
  const now = new Date();
  // Convert to IST timezone
  const istString = now.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // Parse MM/DD/YYYY format to YYYY-MM-DD
  const [month, day, year] = istString.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

/**
 * Set default availability for free assessments (3 weeks from today)
 * @returns {Promise<Object>} Result object with success status and message
 */
const setDefaultAvailability = async () => {
  try {
    // Get today's date in IST
    const todayStr = getTodayIST();
    const today = new Date(todayStr + 'T00:00:00+05:30'); // IST timezone
    
    // Calculate end date (3 weeks from today)
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 21); // 3 weeks = 21 days
    
    // Generate date config records
    const dateConfigRecords = generateDateConfigRecords(today, endDate);
    
    if (dateConfigRecords.length === 0) {
      return { success: false, message: 'No date config records to create' };
    }
    
    // Check which dates already exist
    const existingDates = new Set();
    // Format end date as YYYY-MM-DD (IST)
    const endDateIST = endDate.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const [endMonth, endDay, endYear] = endDateIST.split('/');
    const endDateStr = `${endYear}-${endMonth.padStart(2, '0')}-${endDay.padStart(2, '0')}`;
    
    const { data: existingConfigs } = await supabaseAdmin
      .from('free_assessment_date_configs')
      .select('date')
      .gte('date', todayStr)
      .lte('date', endDateStr);
    
    if (existingConfigs) {
      existingConfigs.forEach(config => {
        existingDates.add(config.date);
      });
    }
    
    // Filter out dates that already exist
    const newRecords = dateConfigRecords.filter(record => !existingDates.has(record.date));
    
    if (newRecords.length === 0) {
      return { success: true, message: 'All dates already have configurations', created: 0 };
    }
    
    // Insert new date config records
    const { error: insertError } = await supabaseAdmin
      .from('free_assessment_date_configs')
      .insert(newRecords);
    
    if (insertError) {
      console.error('Error inserting default free assessment availability:', insertError);
      return { success: false, message: 'Failed to create default availability', error: insertError };
    }
    
    console.log(`✅ Created ${newRecords.length} default free assessment date configs`);
    return { success: true, message: `Created ${newRecords.length} date configs`, created: newRecords.length };
    
  } catch (error) {
    console.error('Error setting default free assessment availability:', error);
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
    // Get today's date in IST
    const todayStr = getTodayIST();
    const today = new Date(todayStr + 'T00:00:00+05:30'); // IST timezone
    
    // Calculate the date that is 3 weeks from today
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 21);
    
    // Get date string in YYYY-MM-DD format (IST)
    const targetDateIST = targetDate.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const [targetMonth, targetDay, targetYear] = targetDateIST.split('/');
    const dateString = `${targetYear}-${targetMonth.padStart(2, '0')}-${targetDay.padStart(2, '0')}`;
    
    const timeSlots = generateDefaultTimeSlots();
    
    // Check if date config already exists for this date
    const { data: existing } = await supabaseAdmin
      .from('free_assessment_date_configs')
      .select('id')
      .eq('date', dateString)
      .single();
    
    if (existing) {
      console.log(`⏭️  Free assessment date config already exists for ${dateString}, skipping...`);
      return { 
        success: true, 
        message: `Date config already exists for ${dateString}`,
        updated: 0,
        skipped: 1
      };
    }
    
    // Insert new date config
    const { error: insertError } = await supabaseAdmin
      .from('free_assessment_date_configs')
      .insert({
        date: dateString,
        time_slots: timeSlots,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    
    if (insertError) {
      console.error(`Error adding free assessment date config for ${dateString}:`, insertError);
      return { success: false, message: 'Error adding date config', error: insertError };
    }
    
    console.log(`✅ Added free assessment date config for ${dateString}`);
    return { 
      success: true, 
      message: `Added date config for ${dateString}`,
      updated: 1,
      skipped: 0
    };
    
  } catch (error) {
    console.error('Error in addNextDayAvailability for free assessments:', error);
    return { success: false, message: 'Error adding next day availability', error: error.message };
  }
};

/**
 * Clean up past date config records
 * Removes all date config records for dates before today
 * This should be run daily to prevent database bloat
 * @returns {Promise<Object>} Result object with deletion count
 */
const cleanupPastAvailability = async () => {
  try {
    // Get today's date in IST (Asia/Kolkata) as YYYY-MM-DD string
    const todayStr = getTodayIST();
    
    console.log(`🧹 Starting cleanup of past free assessment date configs (before ${todayStr})...`);
    
    // Count records before deletion (for logging)
    const { count: totalCount, error: countError } = await supabaseAdmin
      .from('free_assessment_date_configs')
      .select('id', { count: 'exact', head: true })
      .lt('date', todayStr);
    
    if (countError) {
      console.error('Error counting past date configs:', countError);
      console.log('⚠️  Could not count records, proceeding with deletion...');
    }
    
    if (totalCount === 0) {
      console.log('✅ No past free assessment date configs to clean up');
      return { 
        success: true, 
        message: 'No past date configs found',
        deleted: 0 
      };
    }
    
    console.log(`   Found ${totalCount} past date configs to delete`);
    
    // Delete records in batches to avoid timeout with large datasets
    const batchSize = 500;
    let deletedCount = 0;
    let hasMore = true;
    let offset = 0;
    
    while (hasMore) {
      // Get batch of IDs to delete
      const { data: batch, error: fetchError } = await supabaseAdmin
        .from('free_assessment_date_configs')
        .select('id')
        .lt('date', todayStr)
        .range(offset, offset + batchSize - 1);
      
      if (fetchError) {
        console.error('Error fetching batch for deletion:', fetchError);
        return { success: false, message: 'Failed to fetch records for deletion', error: fetchError };
      }
      
      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }
      
      // Delete this batch
      const idsToDelete = batch.map(record => record.id);
      const { error: deleteError } = await supabaseAdmin
        .from('free_assessment_date_configs')
        .delete()
        .in('id', idsToDelete);
      
      if (deleteError) {
        console.error('Error deleting batch:', deleteError);
        return { success: false, message: 'Failed to delete batch', error: deleteError };
      }
      
      deletedCount += batch.length;
      offset += batchSize;
      
      // Log progress every 500 records
      if (deletedCount % 500 === 0) {
        console.log(`   🧹 Deleted ${deletedCount} records...`);
      }
      
      // If batch is smaller than batchSize, we're done
      if (batch.length < batchSize) {
        hasMore = false;
      }
    }
    
    console.log(`✅ Cleanup completed: Deleted ${deletedCount} past free assessment date configs`);
    return {
      success: true,
      message: `Successfully deleted ${deletedCount} past date configs`,
      deleted: deletedCount
    };
    
  } catch (error) {
    console.error('Error in cleanupPastAvailability for free assessments:', error);
    return { 
      success: false, 
      message: 'Error cleaning up past date configs', 
      error: error.message 
    };
  }
};

module.exports = {
  generateDefaultTimeSlots,
  generateDateConfigRecords,
  setDefaultAvailability,
  addNextDayAvailability,
  cleanupPastAvailability
};

