const supabase = require('../config/supabase');
const { successResponse, errorResponse, addMinutesToTime } = require('../utils/helpers');
const { createRealMeetLink } = require('../utils/meetEventHelper'); // Use real Meet link creation
const meetLinkService = require('../utils/meetLinkService'); // New Meet Link Service
const emailService = require('../utils/emailService');

// Get client's free assessment status
const getFreeAssessmentStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔍 Getting free assessment status for user:', userId);

    // Get or create client details (auto-provision if missing)
    let { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, user_id, free_assessment_count, free_assessment_available')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      console.warn('Client profile missing, attempting auto-provision from users table:', { userId, clientError });
      const { data: userRow, error: userFetchError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', userId)
        .single();

      if (userFetchError || !userRow) {
        return res.status(404).json(
          errorResponse('Client profile not found')
        );
      }

      const { data: createdClient, error: createClientError } = await supabase
        .from('clients')
        .insert({
          user_id: userRow.id,
          free_assessment_count: 0,
          free_assessment_available: true
        })
        .select('id, user_id, free_assessment_count, free_assessment_available')
        .single();

      if (createClientError) {
        console.error('Failed to auto-provision client profile:', createClientError);
        return res.status(404).json(
          errorResponse('Client profile not found')
        );
      }

      client = createdClient;
    }

    // Get existing free assessments
    const { data: assessments, error: assessmentsError } = await supabase
      .from('free_assessments')
      .select(`
        id,
        assessment_number,
        scheduled_date,
        scheduled_time,
        status,
        psychologist:psychologists(
          first_name,
          last_name
        )
      `)
      .eq('id', userId)
      .order('assessment_number', { ascending: true });

    if (assessmentsError) {
      console.error('Error fetching assessments:', assessmentsError);
      return res.status(500).json(
        errorResponse('Failed to fetch assessment status')
      );
    }

    const availableAssessments = 20 - client.free_assessment_count;
    const nextAssessmentNumber = client.free_assessment_count + 1;

    res.json(
      successResponse({
        totalAssessments: 20,
        usedAssessments: client.free_assessment_count,
        availableAssessments,
        canBook: availableAssessments > 0,
        nextAssessmentNumber: availableAssessments > 0 ? nextAssessmentNumber : null,
        assessments: assessments || []
      }, 'Free assessment status retrieved successfully')
    );

  } catch (error) {
    console.error('Get free assessment status error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Get free assessment availability range for calendar
const getFreeAssessmentAvailabilityRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Start date and end date are required')
      );
    }

    console.log('🔍 Getting free assessment availability range:', startDate, 'to', endDate);

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

    console.log('🔍 Found global timeslots:', timeslots?.length || 0);
    console.log('🔍 Sample global timeslots:', timeslots?.slice(0, 3) || []);

    // Get date-specific configurations for the range
    const { data: dateConfigs, error: dateConfigsError } = await supabase
      .from('free_assessment_date_configs')
      .select('date, time_slots')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('is_active', true);

    if (dateConfigsError) {
      console.error('Error fetching date configs:', dateConfigsError);
      return res.status(500).json(
        errorResponse('Failed to fetch date configurations')
      );
    }

    console.log('🔍 Found date-specific configs:', dateConfigs?.length || 0);

    // Convert date configs to object for easier lookup
    const dateConfigsByDate = {};
    dateConfigs.forEach(config => {
      dateConfigsByDate[config.date] = config.time_slots;
    });

    console.log('🔍 Date configs by date:', dateConfigsByDate);
    console.log('🔍 Available dates in configs:', Object.keys(dateConfigsByDate));

    // If no global timeslots exist, check if we have date-specific configurations
    if (!timeslots || timeslots.length === 0) {
      console.log('⚠️ No global timeslots found, checking date-specific configurations...');
      
      // If we have date-specific configurations, use them
      if (dateConfigs && dateConfigs.length > 0) {
        console.log('✅ Found date-specific configurations, processing them...');
        
        // Generate availability for each date in range using date-specific configs
        const availability = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${d}`;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          // Only show future dates
          if (date >= today) {
            const dateConfig = dateConfigsByDate[dateStr];
            
            if (dateConfig) {
              console.log(`🔍 Processing configured date ${dateStr}:`, dateConfig);
              const allSlots = [
                ...(dateConfig.morning || []),
                ...(dateConfig.noon || []),
                ...(dateConfig.evening || []),
                ...(dateConfig.night || [])
              ];
              
              availability.push({
                date: dateStr,
                availableSlots: allSlots.length,
                totalSlots: allSlots.length,
                isConfigured: true
              });
            } else {
              availability.push({
                date: dateStr,
                availableSlots: 0,
                totalSlots: 0,
                isConfigured: false
              });
            }
          }
        }
        
        return res.json(successResponse(availability, 'Free assessment availability fetched successfully'));
      } else {
        console.log('⚠️ No date-specific configurations found either');
        
        // Generate empty availability for each date in range
        const availability = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${d}`;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          // Only show future dates
          if (date >= today) {
            availability.push({
              date: dateStr,
              availableSlots: 0,
              totalSlots: 0,
              isConfigured: false
            });
          }
        }
        
        return res.json(
          successResponse(availability, 'No timeslots configured. Please contact admin.')
        );
      }
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
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Only show future dates
      if (date >= today) {
        let availableSlots = 0;
        let totalSlots = 0;
        let isConfigured = false;
        
        // Check if this date has specific configuration
        const dateConfig = dateConfigsByDate[dateStr];
        console.log(`🔍 Processing date ${dateStr}:`, { hasConfig: !!dateConfig, config: dateConfig });
        
        if (dateConfig) {
          isConfigured = true;
          console.log(`🔍 Date ${dateStr} has config:`, dateConfig);
          
          // Use date-specific timeslots (support both grouped object and flat array)
          const extractAllSlots = (ts) => {
            if (Array.isArray(ts)) return ts;
            if (ts && typeof ts === 'object') {
              return [
                ...(ts.morning || []),
                ...(ts.noon || []),
                ...(ts.evening || []),
                ...(ts.night || [])
              ];
            }
            return [];
          };
          const allSlots = extractAllSlots(dateConfig);
          
          console.log(`🔍 Date ${dateStr} allSlots:`, allSlots);
          totalSlots = allSlots.length;
          
          // Check availability for each configured slot
          allSlots.forEach(slot => {
            // Convert to HH:MM:SS for comparison
            const time24Hour = toHms24(slot);
            const bookingKey = `${dateStr}_${time24Hour}`;
            const currentBookings = bookingCounts[bookingKey] || 0;
            
            if (currentBookings < 3) { // Default max bookings per slot
              availableSlots++;
            }
          });
          
          console.log(`🔍 Date ${dateStr} final: availableSlots=${availableSlots}, totalSlots=${totalSlots}`);
        } else {
          // Use global timeslots
          totalSlots = timeslots.length;
          
          // Check each timeslot for availability
          timeslots.forEach(timeslot => {
            const bookingKey = `${dateStr}_${timeslot.time_slot}`;
            const currentBookings = bookingCounts[bookingKey] || 0;
            
            if (currentBookings < timeslot.max_bookings_per_slot) {
              availableSlots++;
            }
          });
        }
        
        console.log(`🔍 Date ${dateStr}: configured=${isConfigured}, availableSlots=${availableSlots}, totalSlots=${totalSlots}`);
        
        availability.push({
          date: dateStr,
          availableSlots,
          totalSlots,
          isConfigured
        });
      }
    }

    res.json(
      successResponse(availability, 'Free assessment availability retrieved successfully')
    );

  } catch (error) {
    console.error('Get free assessment availability range error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Helper function to convert 12-hour format to 24-hour
const convertTo24Hour = (time12Hour) => {
  try {
    // Handle different time formats
    if (!time12Hour || typeof time12Hour !== 'string') {
      console.warn('Invalid time format:', time12Hour);
      return '00:00:00';
    }
    
    // If already in 24-hour format, return as is
    if (time12Hour.includes(':') && !time12Hour.includes('AM') && !time12Hour.includes('PM')) {
      const [hours, minutes] = time12Hour.split(':');
      return `${hours.padStart(2, '0')}:${minutes}:00`;
    }
    
    // Handle 12-hour format with AM/PM
    const [time, period] = time12Hour.split(' ');
    if (!time || !period) {
      console.warn('Invalid 12-hour format:', time12Hour);
      return '00:00:00';
    }
    
    const [hours, minutes] = time.split(':');
    let hour24 = parseInt(hours);
    
    if (period === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    return `${hour24.toString().padStart(2, '0')}:${minutes}:00`;
  } catch (error) {
    console.error('Error converting time format:', time12Hour, error);
    return '00:00:00';
  }
};

// Normalize any time string to HH:MM:SS (supports HH:MM, HH:MM:SS, and 12-hour with AM/PM)
const toHms24 = (t) => {
  try {
    if (!t || typeof t !== 'string') return '00:00:00';
    const s = t.trim();
    const hmsMatch = /^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(s);
    const hmMatch = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
    const ampmMatch = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(s);
    if (hmsMatch) return `${hmsMatch[1].padStart(2,'0')}:${hmsMatch[2].padStart(2,'0')}:${hmsMatch[3].padStart(2,'0')}`;
    if (hmMatch) return `${hmMatch[1].padStart(2,'0')}:${hmMatch[2].padStart(2,'0')}:00`;
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = ampmMatch[2];
      const meridiem = ampmMatch[3].toUpperCase();
      if (meridiem === 'AM') {
        if (hours === 12) hours = 0;
      } else if (meridiem === 'PM') {
        if (hours !== 12) hours += 12;
      }
      return `${String(hours).padStart(2,'0')}:${minutes}:00`;
    }
    return '00:00:00';
  } catch (e) {
    return '00:00:00';
  }
};

// Get available time slots for free assessments
const getAvailableTimeSlots = async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json(
        errorResponse('Date parameter is required')
      );
    }

    console.log('🔍 Getting available time slots for date:', date);

    // First check if there's a date-specific configuration
    const { data: dateConfig, error: dateConfigError } = await supabase
      .from('free_assessment_date_configs')
      .select('time_slots')
      .eq('date', date)
      .eq('is_active', true)
      .single();

    if (dateConfigError && dateConfigError.code !== 'PGRST116') {
      console.error('Error fetching date config:', dateConfigError);
      return res.status(500).json(
        errorResponse('Failed to fetch date configuration')
      );
    }

    let availableSlots = [];

    if (dateConfig) {
      // Use date-specific configuration
      console.log('🔍 Using date-specific configuration for:', date);
      
      // Get booked free assessments for this date
      const { data: bookedAssessments, error: assessmentsError } = await supabase
        .from('free_assessments')
        .select('scheduled_time')
        .eq('scheduled_date', date)
        .eq('status', 'booked');

      if (assessmentsError) {
        console.error('Error fetching booked assessments:', assessmentsError);
        return res.status(500).json(
          errorResponse('Failed to fetch booked assessments')
        );
      }

      // Get booked regular sessions for this date (to account for total bookings)
      const { data: bookedSessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('scheduled_time')
        .eq('scheduled_date', date)
        .eq('status', 'booked');

      if (sessionsError) {
        console.error('Error fetching booked sessions:', sessionsError);
        return res.status(500).json(
          errorResponse('Failed to fetch booked sessions')
        );
      }

      // Count total bookings per time (both assessments and sessions)
      const bookingCounts = {};
      
      // Count free assessment bookings
      bookedAssessments.forEach(booking => {
        bookingCounts[booking.scheduled_time] = (bookingCounts[booking.scheduled_time] || 0) + 1;
      });
      
      // Count regular session bookings
      bookedSessions.forEach(booking => {
        bookingCounts[booking.scheduled_time] = (bookingCounts[booking.scheduled_time] || 0) + 1;
      });

      console.log('🔍 Booking counts for date:', date, bookingCounts);

      // Process date-specific timeslots (support grouped or flat array)
      const flattenSlots = (ts) => {
        if (Array.isArray(ts)) return ts;
        if (ts && typeof ts === 'object') {
          return [
            ...(ts.morning || []),
            ...(ts.noon || []),
            ...(ts.evening || []),
            ...(ts.night || [])
          ];
        }
        return [];
      };
      const allSlots = flattenSlots(dateConfig.time_slots);

      allSlots.forEach(slot => {
        // Normalize to HH:MM:SS for comparison
        const time24Hour = toHms24(slot);
        const currentBookings = bookingCounts[time24Hour] || 0;
        
        console.log(`🔍 Processing slot ${slot} (${time24Hour}): ${currentBookings} bookings`);
        
        if (currentBookings < 20) { // Changed from 3 to 20 for testing
          availableSlots.push({
            time: time24Hour,
            displayTime: (() => { try { const [hh,mm] = time24Hour.split(':'); const h = parseInt(hh,10); const m = parseInt(mm,10)||0; const ampm = h>=12?'PM':'AM'; const h12 = h%12||12; return `${h12}:${m.toString().padStart(2,'0')} ${ampm}`;} catch { return slot; } })(),
            availableBookings: 20 - currentBookings,
            maxBookings: 20,
            currentBookings
          });
        } else {
          console.log(`❌ Slot ${slot} (${time24Hour}) is fully booked (${currentBookings}/20)`);
        }
      });
    } else {
      // Use global timeslots (fallback)
      console.log('🔍 Using global timeslots for:', date);
      
      // Get all psychologists who have availability on this date
      const { data: availability, error: availabilityError } = await supabase
        .from('availability')
        .select(`
          psychologist_id,
          time_slots,
          psychologist:psychologists(
            id,
            first_name,
            last_name
          )
        `)
        .eq('date', date)
        .eq('is_available', true);

      if (availabilityError) {
        console.error('Error fetching availability:', availabilityError);
        return res.status(500).json(
          errorResponse('Failed to fetch availability')
        );
      }

      // Get booked sessions for this date
      const { data: bookedSessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('scheduled_time, psychologist_id')
        .eq('scheduled_date', date);

      if (sessionsError) {
        console.error('Error fetching booked sessions:', sessionsError);
        return res.status(500).json(
          errorResponse('Failed to fetch booked sessions')
        );
      }

      // Get booked free assessments for this date
      const { data: bookedAssessments, error: assessmentsError } = await supabase
        .from('free_assessments')
        .select('scheduled_time, psychologist_id')
        .eq('scheduled_date', date)
        .eq('status', 'booked');

      if (assessmentsError) {
        console.error('Error fetching booked assessments:', assessmentsError);
        return res.status(500).json(
          errorResponse('Failed to fetch booked assessments')
        );
      }

      // Combine all booked times
      const allBookedTimes = [
        ...bookedSessions.map(s => ({ time: s.scheduled_time, psychologistId: s.psychologist_id })),
        ...bookedAssessments.map(a => ({ time: a.scheduled_time, psychologistId: a.psychologist_id }))
      ];

      // Get active timeslots from the timeslots table
      const { data: timeslots, error: timeslotsError } = await supabase
        .from('free_assessment_timeslots')
        .select('time_slot, max_bookings_per_slot')
        .eq('is_active', true)
        .order('time_slot', { ascending: true });

      if (timeslotsError) {
        console.error('Error fetching timeslots:', timeslotsError);
        return res.status(500).json(
          errorResponse('Failed to fetch timeslots')
        );
      }

      // For each active timeslot, check if any psychologist is available
      timeslots.forEach(timeslot => {
        const bookedPsychologists = allBookedTimes
          .filter(booked => booked.time === timeslot.time_slot)
          .map(booked => booked.psychologistId);

        // Find psychologists who are available at this time
        const availablePsychologists = availability.filter(avail => {
          const hasTimeSlot = avail.time_slots.includes(timeslot.time_slot);
          const isNotBooked = !bookedPsychologists.includes(avail.psychologist_id);
          return hasTimeSlot && isNotBooked;
        });

        // Check if we haven't reached the maximum bookings for this slot
        if (availablePsychologists.length > 0 && bookedPsychologists.length < 20) { // Changed from timeslot.max_bookings_per_slot to 20
          availableSlots.push({
            time: timeslot.time_slot,
            displayTime: (() => { try { const [hh,mm] = timeslot.time_slot.split(':'); const h = parseInt(hh,10); const m = parseInt(mm,10)||0; const ampm = h>=12?'PM':'AM'; const h12 = h%12||12; return `${h12}:${m.toString().padStart(2,'0')} ${ampm}`;} catch { return timeslot.time_slot; } })(),
            availablePsychologists: availablePsychologists.length,
            maxBookings: 20,
            currentBookings: bookedPsychologists.length,
            psychologists: availablePsychologists.map(p => ({
              id: p.psychologist.id,
              name: `${p.psychologist.first_name} ${p.psychologist.last_name}`
            }))
          });
        }
      });
    }

    res.json(
      successResponse({
        date,
        availableSlots,
        totalSlots: availableSlots.length,
        isConfigured: !!dateConfig
      }, 'Available time slots retrieved successfully')
    );

  } catch (error) {
    console.error('Get available time slots error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Book a free assessment
const bookFreeAssessment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { scheduledDate, scheduledTime } = req.body;

    if (!scheduledDate || !scheduledTime) {
      return res.status(400).json(
        errorResponse('Scheduled date and time are required')
      );
    }

    console.log('🔍 Booking free assessment for user:', userId, 'on', scheduledDate, 'at', scheduledTime);

    // Get or create client details (auto-provision if missing)
    let { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, user_id, free_assessment_count, free_assessment_available')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      console.warn('Client profile missing, attempting auto-provision from users table:', { userId, clientError });
      const { data: userRow, error: userFetchError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', userId)
        .single();

      if (userFetchError || !userRow) {
        return res.status(404).json(
          errorResponse('Client profile not found')
        );
      }

      const { data: createdClient, error: createClientError } = await supabase
        .from('clients')
        .insert({
          user_id: userRow.id,
          free_assessment_count: 0,
          free_assessment_available: true
        })
        .select('id, user_id, free_assessment_count, free_assessment_available')
        .single();

      if (createClientError) {
        console.error('Failed to auto-provision client profile:', createClientError);
        return res.status(404).json(
          errorResponse('Client profile not found')
        );
      }

      client = createdClient;
    }

    // Check if client can book free assessment
    if (client.free_assessment_count >= 20) {
      return res.status(400).json(
        errorResponse('No free assessments available')
      );
    }

    // Ensure a linked users.id exists for FK (free_assessments.user_id NOT NULL)
    let userAccountId = client.user_id || null;
    try {
      if (!userAccountId) {
        // Try to find a users row by client email (clients table usually has email)
        if (!client.email) {
          const { data: clientWithEmail } = await supabase
            .from('clients')
            .select('email')
            .eq('id', userId)
            .single();
          client.email = clientWithEmail?.email || client.email;
        }

        if (client.email) {
          const { data: existingUserByEmail } = await supabase
            .from('users')
            .select('id')
            .eq('email', client.email)
            .single();
          if (existingUserByEmail) {
            userAccountId = existingUserByEmail.id;
            // Link it back to client for future
            await supabase
              .from('clients')
              .update({ user_id: userAccountId })
              .eq('id', userId);
          }
        }

        // If still missing, create a minimal users row and link
        if (!userAccountId) {
          const { hashPassword } = require('../utils/helpers');
          const tempPassword = `Temp@${Math.random().toString(36).slice(-8)}`;
          const passwordHash = await hashPassword(tempPassword);

          const { data: createdUser, error: createUserError } = await supabase.supabaseAdmin
            .from('users')
            .insert({
              email: client.email || `client_${userId}@placeholder.local`,
              role: 'client',
              password_hash: passwordHash,
              created_at: new Date().toISOString()
            })
            .select('id, email')
            .single();

          if (createUserError) {
            console.error('Error auto-creating users row for client:', createUserError);
            return res.status(500).json(
              errorResponse('Failed to prepare client account for booking')
            );
          }

          userAccountId = createdUser.id;
          await supabase
            .from('clients')
            .update({ user_id: userAccountId })
            .eq('id', userId);
        }
      }
    } catch (linkError) {
      console.error('Error ensuring users linkage for client:', linkError);
      return res.status(500).json(
        errorResponse('Failed to prepare client account')
      );
    }

    // Get the next available assessment number by checking existing assessments
    const { data: existingAssessments, error: existingError } = await supabase.supabaseAdmin
      .from('free_assessments')
      .select('assessment_number')
      .eq('client_id', userId)
      .order('assessment_number', { ascending: true });

    if (existingError) {
      console.error('Error fetching existing assessments:', existingError);
      return res.status(500).json(
        errorResponse('Failed to check existing assessments')
      );
    }

    // Find the next available assessment number (1..20) skipping used numbers
    let nextAssessmentNumber = 1;
    const usedNumbers = (existingAssessments || []).map(a => a.assessment_number);
    
    console.log('🔍 Raw existing assessments:', existingAssessments);
    console.log('🔍 Used numbers:', usedNumbers);
    
    for (let i = 1; i <= 20; i++) {
      if (!usedNumbers.includes(i)) {
        nextAssessmentNumber = i;
        break;
      }
    }

    console.log('🔍 Assessment number calculation:', {
      existingNumbers: usedNumbers,
      nextNumber: nextAssessmentNumber,
      clientCount: client.free_assessment_count,
      totalExisting: existingAssessments.length
    });

    // Check if user has already used all 20 assessments
    if (usedNumbers.length >= 20) {
      return res.status(400).json(
        errorResponse('You have already used all 20 free assessments')
      );
    }

    // If no next number found (shouldn't happen), return error
    if (nextAssessmentNumber > 20) {
      return res.status(400).json(
        errorResponse('No free assessments available')
      );
    }

    // Do not assign to a specific psychologist; mark as unassigned for admin triage
    console.log('🔄 Creating free assessment record (unassigned)...');
    const { data: assessment, error: assessmentError } = await supabase.supabaseAdmin
      .from('free_assessments')
      .insert({
        // Use linked users.id (ensured above); client_id remains the client (req.user.id)
        user_id: userAccountId,
        client_id: userId,
        assessment_number: nextAssessmentNumber,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        psychologist_id: null,
        status: 'booked'
      })
      .select()
      .single();

    if (assessmentError) {
      console.error('❌ Error creating free assessment:', assessmentError);
      return res.status(500).json(
        errorResponse('Failed to book free assessment')
      );
    }
    
    console.log('✅ Free assessment record created:', assessment.id);

    // Create a session placeholder (no doctor), with a Meet link ready for admin assignment
    console.log('🔄 Creating session placeholder for free assessment...');
    const sessionData = {
      client_id: userId,
      psychologist_id: null, // unassigned
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      status: 'booked',
      price: 0,
      session_type: 'free_assessment'
    };

    try {
      const meetSessionData = {
        summary: `Free Assessment` ,
        description: `Free 20-minute assessment session (doctor to be assigned)`,
        startDate: scheduledDate,
        startTime: scheduledTime,
        endTime: addMinutesToTime(scheduledTime, 20),
        attendees: []
      };

      // If the client has a linked users row, try to fetch their email for attendee
      try {
        const { data: userEmailRow } = await supabase
          .from('users')
          .select('email')
          .eq('id', userAccountId)
          .single();
        if (userEmailRow?.email) {
          meetSessionData.attendees = [userEmailRow.email];
        }
      } catch (_) {}

      // Create meet link (OAuth preferred; will add attendee to client calendar)
      const meetResult = await meetLinkService.generateSessionMeetLink(meetSessionData);
      if (meetResult.success) {
        sessionData.google_calendar_event_id = meetResult.eventId;
        sessionData.google_meet_link = meetResult.meetLink;
        sessionData.google_meet_join_url = meetResult.meetLink;
        sessionData.google_meet_start_url = meetResult.meetLink;
        console.log('✅ Meet link created for free assessment (unassigned)');
      } else {
        console.log('⚠️ Meet link creation failed; continuing without link');
      }
    } catch (e) {
      console.error('❌ Error creating meet link placeholder:', e);
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([sessionData])
      .select()
      .single();

    if (sessionError) {
      console.error('❌ Error creating session placeholder:', sessionError);
      // proceed without session, admin can create later
    } else {
      await supabase.supabaseAdmin
        .from('free_assessments')
        .update({ session_id: session.id })
        .eq('id', assessment.id);
      console.log('✅ Session placeholder created:', session.id);
    }

    // Update client's free assessment count
    await supabase.supabaseAdmin
      .from('clients')
      .update({ 
        free_assessment_count: nextAssessmentNumber
      })
      .eq('id', userId);

    // Fetch user details for email (clients table may not have name/email columns)
    let userRowForEmail = null;
    let userEmailError = null;
    if (userAccountId) {
      const result = await supabase
        .from('users')
        .select('email')
        .eq('id', userAccountId)
        .single();
      userRowForEmail = result.data;
      userEmailError = result.error;
    }

    if (userEmailError) {
      console.error('Error fetching user email:', userEmailError);
    }

    console.log('📧 User email details:', {
      email: userRowForEmail?.email,
      userId: userId
    });

    // Send confirmation email (generic, without doctor or meet link)
    try {
      await emailService.sendFreeAssessmentConfirmation({
        clientName: 'Client',
        psychologistName: 'To be assigned',
        assessmentDate: scheduledDate,
        assessmentTime: scheduledTime,
        assessmentNumber: nextAssessmentNumber,
        clientEmail: userRowForEmail?.email,
        psychologistEmail: null,
        googleMeetLink: session?.google_meet_link || null
      });
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
    }

    res.json(
      successResponse({
        assessmentId: assessment.id,
        assessmentNumber: nextAssessmentNumber,
        psychologist: null,
        scheduledDate,
        scheduledTime,
        meetLink: null
      }, 'Free assessment booked successfully')
    );

  } catch (error) {
    console.error('Book free assessment error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Cancel a free assessment
const cancelFreeAssessment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { assessmentId } = req.params;

    console.log('🔍 Cancelling free assessment:', assessmentId, 'for user:', userId);

    // Get the assessment
    const { data: assessment, error: assessmentError } = await supabase
      .from('free_assessments')
      .select('*')
      .eq('id', assessmentId)
      .eq('id', userId)
      .single();

    if (assessmentError || !assessment) {
      return res.status(404).json(
        errorResponse('Free assessment not found')
      );
    }

    if (assessment.status !== 'booked') {
      return res.status(400).json(
        errorResponse('Assessment cannot be cancelled')
      );
    }

    // Update assessment status
    await supabase
      .from('free_assessments')
      .update({ status: 'cancelled' })
      .eq('id', assessmentId);

    // Update session status if exists
    if (assessment.session_id) {
      await supabase
        .from('sessions')
        .update({ status: 'cancelled' })
        .eq('id', assessment.session_id);
    }

    // Decrease client's free assessment count
    const { data: client } = await supabase
      .from('clients')
      .select('free_assessment_count')
      .eq('id', userId)
      .single();

    if (client) {
      const newCount = Math.max(0, client.free_assessment_count - 1);
              await supabase
          .from('clients')
          .update({ 
            free_assessment_count: newCount
          })
          .eq('id', userId);
    }

    res.json(
      successResponse(null, 'Free assessment cancelled successfully')
    );

  } catch (error) {
    console.error('Cancel free assessment error:', error);
    res.status(500).json(
      errorResponse('Internal server error')
    );
  }
};

// Admin: List free assessments with optional status filter
const adminListFreeAssessments = async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase.supabaseAdmin
      .from('free_assessments')
      .select(`
        id,
        assessment_number,
        scheduled_date,
        scheduled_time,
        status,
        client:clients(id, first_name, last_name, email),
        psychologist:psychologists(id, first_name, last_name, email),
        session:sessions(google_meet_link)
      `)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Admin list free assessments error:', error);
      return res.status(500).json(errorResponse('Failed to fetch free assessments'));
    }

    // Normalize payload and ensure a meet link is available (generate on the fly if missing)
    const meetLinkService = require('../utils/meetLinkService');
    const assessments = [];
    for (const a of (data || [])) {
      let meetLink = a.session?.google_meet_link || null;
      if (!meetLink) {
        try {
          const result = await meetLinkService.generateSessionMeetLink({
            summary: 'Free Assessment',
            description: 'Free 20-minute assessment session (doctor to be assigned)',
            startDate: a.scheduled_date,
            startTime: a.scheduled_time,
            endTime: require('../utils/helpers').addMinutesToTime(a.scheduled_time, 20)
          });
          if (result.success && result.meetLink) {
            meetLink = result.meetLink;
          }
        } catch (e) {
          // ignore, leave meetLink null
        }
      }
      assessments.push({
        id: a.id,
        assessmentNumber: a.assessment_number,
        scheduledDate: a.scheduled_date,
        scheduledTime: a.scheduled_time,
        status: a.status,
        client: a.client || null,
        psychologist: a.psychologist || null,
        meetLink
      });
    }

    return res.json(successResponse({ assessments }));
  } catch (error) {
    console.error('Admin list free assessments exception:', error);
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

// Test endpoint to check date-specific configurations
const testDateConfigs = async (req, res) => {
  try {
    console.log('🔍 Testing date-specific configurations...');
    
    // Query all date-specific configurations
    const { data: dateConfigs, error: dateConfigsError } = await supabase
      .from('free_assessment_date_configs')
      .select('*')
      .eq('is_active', true);

    if (dateConfigsError) {
      console.error('❌ Error querying date configs:', dateConfigsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to query date configurations',
        details: dateConfigsError.message
      });
    }

    console.log('✅ Found date configs:', dateConfigs?.length || 0);
    console.log('🔍 Date configs:', dateConfigs);
    
    res.json({
      success: true,
      message: 'Date configurations check completed',
      count: dateConfigs?.length || 0,
      configs: dateConfigs || []
    });

  } catch (error) {
    console.error('Test date configs error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
};

// Test endpoint to check global timeslots
const testGlobalTimeslots = async (req, res) => {
  try {
    console.log('🔍 Testing global timeslots...');
    
    // Check if table exists by trying to query it
    const { data: timeslots, error: timeslotsError } = await supabase
      .from('free_assessment_timeslots')
      .select('*')
      .limit(5);

    if (timeslotsError) {
      console.error('❌ Error querying free_assessment_timeslots:', timeslotsError);
      return res.status(500).json({
        success: false,
        error: 'Table does not exist or query failed',
        details: timeslotsError.message
      });
    }

    console.log('✅ Found timeslots:', timeslots?.length || 0);
    
    res.json({
      success: true,
      message: 'Global timeslots check completed',
      count: timeslots?.length || 0,
      sample: timeslots?.slice(0, 3) || []
    });

  } catch (error) {
    console.error('Test global timeslots error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
};

module.exports = {
  getFreeAssessmentStatus,
  getAvailableTimeSlots,
  getFreeAssessmentAvailabilityRange,
  bookFreeAssessment,
  cancelFreeAssessment,
  testGlobalTimeslots,
  testDateConfigs,
  adminListFreeAssessments
};
