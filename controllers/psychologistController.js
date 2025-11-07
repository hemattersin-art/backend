const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { 
  successResponse, 
  errorResponse,
  formatDate,
  formatTime
} = require('../utils/helpers');

// Get psychologist profile
const getProfile = async (req, res) => {
  try {
    const psychologistId = req.user.id;

    // Check if psychologist profile exists in psychologists table
    try {
      const { data: psychologist, error } = await supabase
        .from('psychologists')
        .select('*')
        .eq('id', psychologistId)
        .single();

      if (error) {
        // If psychologist profile doesn't exist, return a default profile
        if (error.code === 'PGRST116' || error.message.includes('No rows returned')) {
          console.log('Psychologist profile not found, returning default profile');
          return res.json(
            successResponse({
              id: psychologistId,
              email: req.user.email || 'pending@example.com',
              first_name: 'Pending',
              last_name: 'Profile',
              ug_college: 'Pending',
              pg_college: 'Pending',
              phd_college: null,
              area_of_expertise: [],
              description: 'Profile setup pending',
              experience_years: 0,
              cover_image_url: null,
              phone: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
          );
        }
        
        // If there's a database relationship error, return default profile
        if (error.code === 'PGRST200' || error.message.includes('relationship') || error.message.includes('schema cache')) {
          console.log('Database relationships not fully established, returning default psychologist profile');
          return res.json(
            successResponse({
              id: psychologistId,
              email: req.user.email || 'pending@example.com',
              first_name: 'Pending',
              last_name: 'Profile',
              ug_college: 'Pending',
              pg_college: 'Pending',
              phd_college: null,
              area_of_expertise: [],
              description: 'Profile setup pending',
              experience_years: 0,
              cover_image_url: null,
              phone: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
          );
        }
        
        console.error('Get psychologist profile error:', error);
        return res.status(500).json(
          errorResponse('Failed to fetch psychologist profile')
        );
      }

      res.json(
        successResponse(psychologist)
      );

    } catch (dbError) {
      // If there's any database error, return default profile
      console.log('Database error in psychologist profile query, returning default profile:', dbError.message);
      return res.json(
        successResponse({
          id: psychologistId,
          email: req.user.email || 'pending@example.com',
          first_name: 'Pending',
          last_name: 'Profile',
          ug_college: 'Pending',
          pg_college: 'Pending',
          phd_college: null,
          area_of_expertise: [],
          description: 'Profile setup pending',
          experience_years: 0,
          cover_image_url: null,
          phone: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      );
    }

  } catch (error) {
    console.error('Get psychologist profile error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching profile')
    );
  }
};

// Update psychologist profile
const updateProfile = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const updateData = req.body;

    // Remove user_id from update data if present
    delete updateData.user_id;

    const { data: psychologist, error } = await supabase
      .from('psychologists')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', psychologistId)
      .select('*')
      .single();

    if (error) {
      console.error('Update psychologist profile error:', error);
      return res.status(500).json(
        errorResponse('Failed to update psychologist profile')
      );
    }

    res.json(
      successResponse(psychologist, 'Profile updated successfully')
    );

  } catch (error) {
    console.error('Update psychologist profile error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating profile')
    );
  }
};

// Get psychologist sessions
const getSessions = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { page = 1, limit = 10, status, date } = req.query;

    // Check if sessions table exists and has proper relationships
    try {
      let query = supabase
        .from('sessions')
        .select(`
          *,
          client:clients(
            id,
            first_name,
            last_name,
            child_name,
            child_age,
            phone_number,
            user:users(
              email
            )
          )
        `)
        .eq('psychologist_id', psychologistId);

      // Filter by status if provided
      if (status) {
        query = query.eq('status', status);
      }

      // Filter by date if provided
      if (date) {
        query = query.eq('scheduled_date', date);
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1).order('scheduled_date', { ascending: false });

      const { data: sessions, error, count } = await query;

      // Also fetch assessment sessions assigned to this psychologist
      let assessmentSessions = [];
      try {
        let assessQuery = supabaseAdmin
          .from('assessment_sessions')
          .select(`
            id,
            assessment_id,
            assessment_slug,
            client_id,
            psychologist_id,
            scheduled_date,
            scheduled_time,
            status,
            amount,
            payment_id,
            session_number,
            created_at,
            updated_at,
            client:clients(
              id,
              first_name,
              last_name,
              child_name,
              child_age,
              phone_number,
              user:users(
                email
              )
            ),
            assessment:assessments(
              id,
              slug,
              hero_title,
              seo_title,
              assigned_doctor_ids
            )
          `)
          .eq('psychologist_id', psychologistId);
        
        // Filter by status if provided (but don't filter if status is not provided)
        if (status) {
          assessQuery = assessQuery.eq('status', status);
        }
        
        // Filter by date if provided (but allow null dates for pending sessions)
        if (date) {
          assessQuery = assessQuery.or(`scheduled_date.eq.${date},scheduled_date.is.null`);
        }
        
        let { data: assessData, error: assessError } = await assessQuery.order('created_at', { ascending: false });
        
        if (assessError) {
          console.error('❌ Error fetching assessment sessions:', assessError);
        } else {
          console.log(`✅ Found ${assessData?.length || 0} assessment sessions for psychologist ${psychologistId}`);
          console.log('🔍 Assessment sessions details:', assessData?.map(a => ({
            id: a.id,
            status: a.status,
            psychologist_id: a.psychologist_id,
            scheduled_date: a.scheduled_date,
            scheduled_time: a.scheduled_time,
            assessment_id: a.assessment_id
          })) || []);
          
          // Backfill missing pending assessment sessions so each package has 3 total
          try {
            // Group by stable key (assessment_id + client_id + psychologist_id + payment_id)
            const groups = new Map();
            (assessData || []).forEach(s => {
              const key = `${s.assessment_id}_${s.client_id}_${s.psychologist_id}_${s.payment_id || 'nopay'}`;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key).push(s);
            });

            for (const [key, sessions] of groups.entries()) {
              const any = sessions[0];
              // Only consider booked packages (must have a booked session or a payment_id)
              const hasBooked = sessions.some(s => s.status === 'booked');
              if (!hasBooked) continue;

              const existingNumbers = new Set(sessions.map(s => s.session_number).filter(n => typeof n === 'number'));
              const inserts = [];
              // Ensure first session has session_number 1
              const first = sessions.find(s => s.status === 'booked');
              if (first && (first.session_number == null)) {
                await supabaseAdmin
                  .from('assessment_sessions')
                  .update({ session_number: 1, updated_at: new Date().toISOString() })
                  .eq('id', first.id);
                existingNumbers.add(1);
              }
              // Create missing 2 and 3
              [2,3].forEach(n => {
                if (!existingNumbers.has(n)) {
                  inserts.push({
                    user_id: any.user_id,
                    client_id: any.client_id,
                    assessment_id: any.assessment_id,
                    assessment_slug: any.assessment_slug,
                    psychologist_id: any.psychologist_id,
                    scheduled_date: null,
                    scheduled_time: null,
                    amount: any.amount,
                    currency: any.currency || 'INR',
                    status: 'pending',
                    payment_id: any.payment_id,
                    session_number: n,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  });
                }
              });

              if (inserts.length > 0) {
                const { error: insertErr } = await supabaseAdmin
                  .from('assessment_sessions')
                  .insert(inserts);
                if (insertErr) {
                  console.warn('⚠️ Failed to backfill pending assessment sessions:', insertErr);
                } else {
                  // Refresh assessData for this group on success
                  const { data: refreshed } = await supabaseAdmin
                    .from('assessment_sessions')
                    .select('*')
                    .eq('assessment_id', any.assessment_id)
                    .eq('client_id', any.client_id)
                    .eq('psychologist_id', any.psychologist_id)
                    .eq('payment_id', any.payment_id)
                    .order('created_at', { ascending: false });
                  // Replace entries in assessData by filtering out old group and adding refreshed
                  assessData = (assessData || []).filter(s => s.assessment_id !== any.assessment_id || s.client_id !== any.client_id || s.psychologist_id !== any.psychologist_id || s.payment_id !== any.payment_id).concat(refreshed || []);
                }
              }
            }
          } catch (bfErr) {
            console.warn('⚠️ Error during assessment sessions backfill:', bfErr);
          }

          // Transform assessment sessions to match session format
          assessmentSessions = (assessData || []).map(a => ({
            ...a,
            session_type: 'assessment',
            type: 'assessment',
            // Add client_name for frontend compatibility
            client_name: a.client ? `${a.client.first_name || ''} ${a.client.last_name || ''}`.trim() : 'Client',
            // Add assessment title
            assessment_title: a.assessment?.hero_title || a.assessment?.seo_title || 'Assessment'
          }));
          
          console.log('🔍 Transformed assessment sessions:', assessmentSessions.map(a => ({
            id: a.id,
            status: a.status,
            session_type: a.session_type,
            type: a.type,
            scheduled_date: a.scheduled_date
          })));
        }
      } catch (assessError) {
        console.error('❌ Assessment sessions fetch error:', assessError);
      }

      // Combine regular sessions and assessment sessions
      // Sort: pending sessions first (for scheduling), then by date
      const allSessions = [...(sessions || []), ...assessmentSessions]
        .sort((a, b) => {
          // Pending sessions (null dates) come first
          if (!a.scheduled_date && b.scheduled_date) return -1;
          if (a.scheduled_date && !b.scheduled_date) return 1;
          if (!a.scheduled_date && !b.scheduled_date) {
            // Both pending, sort by created_at
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
          }
          // Both have dates, sort by date descending
          return new Date(b.scheduled_date) - new Date(a.scheduled_date);
        });

      console.log(`🔍 Total sessions returned: ${allSessions.length} (regular: ${sessions?.length || 0}, assessment: ${assessmentSessions.length})`);
      console.log(`🔍 Pending assessment sessions in response:`, allSessions.filter(s => 
        (s.session_type === 'assessment' || s.type === 'assessment') && s.status === 'pending'
      ).map(s => ({
        id: s.id,
        status: s.status,
        psychologist_id: s.psychologist_id,
        scheduled_date: s.scheduled_date
      })));

      res.json(
        successResponse({
          sessions: allSessions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: (count || 0) + assessmentSessions.length
          }
        })
      );

    } catch (dbError) {
      // If there's any database error, return empty sessions
      console.log('Database error in sessions query, returning empty sessions for psychologist:', dbError.message);
      return res.json(
        successResponse({
          sessions: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0
          }
        })
      );
    }

  } catch (error) {
    console.error('Get psychologist sessions error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching sessions')
    );
  }
};

// Update session (for session notes, summary, etc.)
const updateSession = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { sessionId } = req.params;
    const updateData = req.body;

    // Check if session exists and belongs to psychologist
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (!session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Only allow updating certain fields
    const allowedUpdates = {
      session_notes: updateData.session_notes,
      session_summary: updateData.session_summary,
      status: updateData.status
    };

    // Remove undefined values
    Object.keys(allowedUpdates).forEach(key => 
      allowedUpdates[key] === undefined && delete allowedUpdates[key]
    );

    const { data: updatedSession, error } = await supabase
      .from('sessions')
      .update({
        ...allowedUpdates,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (error) {
      console.error('Update session error:', error);
      return res.status(500).json(
        errorResponse('Failed to update session')
      );
    }

    res.json(
      successResponse(updatedSession, 'Session updated successfully')
    );

  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating session')
    );
  }
};

// Get availability
const getAvailability = async (req, res) => {
  try {
    const { date, start_date, end_date, psychologist_id, target_psychologist_id } = req.query;
    const psychologistId = psychologist_id || target_psychologist_id || req.user.id;

    // Check if availability table exists and has proper relationships
    try {
      let query = supabase
        .from('availability')
        .select('*')
        .eq('psychologist_id', psychologistId);

      if (date) {
        query = query.eq('date', date);
      } else if (start_date && end_date) {
        query = query.gte('date', start_date).lte('date', end_date);
      }

      const { data: availability, error } = await query;

      if (error) {
        // If there's a database relationship error, return empty availability
        if (error.code === 'PGRST200' || error.message.includes('relationship') || error.message.includes('schema cache')) {
          console.log('Database relationships not fully established, returning empty availability for psychologist');
          return res.json(
            successResponse([])
          );
        }
        
        console.error('Get availability error:', error);
        return res.status(500).json(
          errorResponse('Failed to fetch availability')
        );
      }

      // Get psychologist's Google Calendar credentials to check for blocked slots
      const { data: psychologist, error: psychError } = await supabase
        .from('psychologists')
        .select('google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (psychError || !psychologist) {
        console.log('Psychologist not found or no Google Calendar credentials');
        return res.json(
          successResponse(availability || [])
        );
      }

      // If Google Calendar is connected, check for blocked slots
      if (psychologist.google_calendar_credentials) {
        try {
          const googleCalendarService = require('../utils/googleCalendarService');
          
          // Determine date range for Google Calendar check
          let calendarStartDate, calendarEndDate;
          if (date) {
            calendarStartDate = new Date(date);
            calendarEndDate = new Date(date);
          } else if (start_date && end_date) {
            calendarStartDate = new Date(start_date);
            calendarEndDate = new Date(end_date);
          } else {
            // Default to current month if no date range specified
            const now = new Date();
            calendarStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
            calendarEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          }

          // Get Google Calendar busy slots
          const busySlots = await googleCalendarService.getBusyTimeSlots(
            psychologist.google_calendar_credentials,
            calendarStartDate,
            calendarEndDate
          );

          // Filter for blocked slots (events with "🚫 BLOCKED" in title)
          const blockedSlots = busySlots.filter(slot => 
            slot.title && (slot.title.includes('🚫 BLOCKED') || slot.title.includes('BLOCKED'))
          );

          console.log(`📅 Found ${blockedSlots.length} blocked slots from Google Calendar`);

          // Process availability data to mark blocked slots
          const processedAvailability = (availability || []).map(dayAvailability => {
            const dayBlockedSlots = blockedSlots.filter(slot => {
              const slotDate = new Date(slot.start).toISOString().split('T')[0];
              return slotDate === dayAvailability.date;
            });

            // Convert blocked slots to time format and remove from available slots
            const blockedTimes = dayBlockedSlots.map(slot => {
              const slotTime = new Date(slot.start).toTimeString().split(' ')[0].substring(0, 5);
              return slotTime;
            });

            // Remove blocked time slots from availability
            const availableSlots = (dayAvailability.time_slots || []).filter(slot => 
              !blockedTimes.includes(slot)
            );

            return {
              ...dayAvailability,
              time_slots: availableSlots,
              blocked_slots: blockedTimes,
              total_blocked: blockedTimes.length
            };
          });

          res.json(
            successResponse(processedAvailability)
          );

        } catch (calendarError) {
          console.error('Error checking Google Calendar for blocked slots:', calendarError);
          // Return availability without Google Calendar data if it fails
          res.json(
            successResponse(availability || [])
          );
        }
      } else {
        // No Google Calendar connected, return availability as-is
        res.json(
          successResponse(availability || [])
        );
      }

    } catch (dbError) {
      // If there's any database error, return empty availability
      console.log('Database error in availability query, returning empty availability for psychologist:', dbError.message);
      return res.json(
        successResponse([])
      );
      }
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching availability')
    );
  }
};

// Update availability
const updateAvailability = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { date, time_slots } = req.body;

    // Check for conflicts with Google Calendar
    let filteredTimeSlots = time_slots;
    let blockedSlots = [];
    
    try {
      const { data: psychologist } = await supabase
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (psychologist && psychologist.google_calendar_credentials) {
        const googleCalendarService = require('../utils/googleCalendarService');
        const conflictingSlots = [];
        
        for (const timeSlot of time_slots) {
          const [hours, minutes] = timeSlot.split(':');
          const slotStart = new Date(date);
          slotStart.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setHours(slotEnd.getHours() + 1); // Assuming 1-hour sessions
          
          const hasConflict = await googleCalendarService.hasTimeConflict(
            psychologist.google_calendar_credentials,
            slotStart,
            slotEnd
          );
          
          if (hasConflict) {
            conflictingSlots.push(timeSlot);
          }
        }
        
        // Filter out conflicting time slots
        filteredTimeSlots = time_slots.filter(slot => !conflictingSlots.includes(slot));
        blockedSlots = conflictingSlots;
        
        if (conflictingSlots.length > 0) {
          console.log(`⚠️  Blocked ${conflictingSlots.length} conflicting slots: ${conflictingSlots.join(', ')}`);
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
      .eq('psychologist_id', psychologistId)
      .eq('date', date)
      .single();

    let result;
    if (existingAvailability) {
      // Update existing availability with filtered slots
      const { data: updatedAvailability, error } = await supabase
        .from('availability')
        .update({
          time_slots: filteredTimeSlots,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAvailability.id)
        .select('*')
        .single();

      if (error) {
        console.error('Update availability error:', error);
        return res.status(500).json(
          errorResponse('Failed to update availability')
        );
      }
      result = updatedAvailability;
    } else {
      // Create new availability with filtered slots
      const { data: newAvailability, error } = await supabase
        .from('availability')
        .insert([{
          psychologist_id: psychologistId,
          date,
          time_slots: filteredTimeSlots
        }])
        .select('*')
        .single();

      if (error) {
        console.error('Create availability error:', error);
        return res.status(500).json(
          errorResponse('Failed to create availability')
        );
      }
      result = newAvailability;
    }

    const message = blockedSlots.length > 0 
      ? `Availability updated. ${blockedSlots.length} slot(s) blocked due to Google Calendar conflicts: ${blockedSlots.join(', ')}`
      : 'Availability updated successfully';

    res.json(
      successResponse({
        ...result,
        blocked_slots: blockedSlots,
        blocked_count: blockedSlots.length
      }, message)
    );

  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating availability')
    );
  }
};

// Add new availability
const addAvailability = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { date, time_slots, is_available = true } = req.body;

    // Validate required fields
    if (!date || !time_slots || time_slots.length === 0) {
      return res.status(400).json(
        errorResponse('Date and time slots are required')
      );
    }

    // Check if availability already exists for this date
    const { data: existingAvailability } = await supabase
      .from('availability')
      .select('id')
      .eq('psychologist_id', psychologistId)
      .eq('date', date)
      .single();

    if (existingAvailability) {
      return res.status(400).json(
        errorResponse('Availability already exists for this date. Use update instead.')
      );
    }

    // Check for conflicts with Google Calendar
    let filteredTimeSlots = time_slots;
    let blockedSlots = [];
    
    try {
      const { data: psychologist } = await supabase
        .from('psychologists')
        .select('id, first_name, last_name, google_calendar_credentials')
        .eq('id', psychologistId)
        .single();

      if (psychologist && psychologist.google_calendar_credentials) {
        const googleCalendarService = require('../utils/googleCalendarService');
        const conflictingSlots = [];
        
        for (const timeSlot of time_slots) {
          const [hours, minutes] = timeSlot.split(':');
          const slotStart = new Date(date);
          slotStart.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setHours(slotEnd.getHours() + 1); // Assuming 1-hour sessions
          
          const hasConflict = await googleCalendarService.hasTimeConflict(
            psychologist.google_calendar_credentials,
            slotStart,
            slotEnd
          );
          
          if (hasConflict) {
            conflictingSlots.push(timeSlot);
          }
        }
        
        // Filter out conflicting time slots
        filteredTimeSlots = time_slots.filter(slot => !conflictingSlots.includes(slot));
        blockedSlots = conflictingSlots;
        
        if (conflictingSlots.length > 0) {
          console.log(`⚠️  Blocked ${conflictingSlots.length} conflicting slots: ${conflictingSlots.join(', ')}`);
        }
      }
    } catch (googleError) {
      console.error('Error checking Google Calendar conflicts:', googleError);
      // Continue without blocking if Google Calendar check fails
    }

    // Create new availability with filtered slots
    const { data: newAvailability, error } = await supabase
      .from('availability')
      .insert([{
        psychologist_id: psychologistId,
        date,
        time_slots: filteredTimeSlots,
        is_available,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('*')
      .single();

    if (error) {
      console.error('Create availability error:', error);
      return res.status(500).json(
        errorResponse('Failed to create availability')
      );
    }

    const message = blockedSlots.length > 0 
      ? `Availability created. ${blockedSlots.length} slot(s) blocked due to Google Calendar conflicts: ${blockedSlots.join(', ')}`
      : 'Availability created successfully';

    res.status(201).json(
      successResponse({
        ...newAvailability,
        blocked_slots: blockedSlots,
        blocked_count: blockedSlots.length
      }, message)
    );

  } catch (error) {
    console.error('Add availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating availability')
    );
  }
};

// Delete availability
const deleteAvailability = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const availabilityId = req.params.availabilityId;

    // Check if availability exists and belongs to this psychologist
    const { data: existingAvailability, error: checkError } = await supabase
      .from('availability')
      .select('id')
      .eq('id', availabilityId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (checkError || !existingAvailability) {
      return res.status(404).json(
        errorResponse('Availability not found or access denied')
      );
    }

    // Delete the availability
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

// Get packages
const getPackages = async (req, res) => {
  try {
    const psychologistId = req.user.id;

    // Check if packages table exists and has proper relationships
    try {
      const { data: packages, error } = await supabase
        .from('packages')
        .select('*')
        .eq('psychologist_id', psychologistId);

      if (error) {
        // If there's a database relationship error, return empty packages
        if (error.code === 'PGRST200' || error.message.includes('relationship') || error.message.includes('schema cache')) {
          console.log('Database relationships not fully established, returning empty packages for psychologist');
          return res.json(
            successResponse([])
          );
        }
        
        console.error('Get packages error:', error);
        return res.status(500).json(
          errorResponse('Failed to fetch packages')
        );
      }

      res.json(
        successResponse(packages || [])
      );

    } catch (dbError) {
      // If there's any database error, return empty packages
      console.log('Database error in packages query, returning empty packages for psychologist:', dbError.message);
      return res.json(
        successResponse([])
      );
    }

  } catch (error) {
    console.error('Get packages error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching packages')
    );
  }
};

// Create package
const createPackage = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { package_type, price, description } = req.body;

    const { data: package, error } = await supabase
      .from('packages')
      .insert([{
        psychologist_id: psychologistId,
        package_type,
        price,
        description
      }])
      .select('*')
      .single();

    if (error) {
      console.error('Create package error:', error);
      return res.status(500).json(
        errorResponse('Failed to create package')
      );
    }

    res.status(201).json(
      successResponse(package, 'Package created successfully')
    );

  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating package')
    );
  }
};

// Update package
const updatePackage = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { packageId } = req.params;
    const updateData = req.body;

    // Check if package exists and belongs to psychologist
    const { data: package } = await supabase
      .from('packages')
      .select('*')
      .eq('id', packageId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (!package) {
      return res.status(404).json(
        errorResponse('Package not found')
      );
    }

    const { data: updatedPackage, error } = await supabase
      .from('packages')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', packageId)
      .select('*')
      .single();

    if (error) {
      console.error('Update package error:', error);
      return res.status(500).json(
        errorResponse('Failed to update package')
      );
    }

    res.json(
      successResponse(updatedPackage, 'Package updated successfully')
    );

  } catch (error) {
    console.error('Update package error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating package')
    );
  }
};

// Delete package
const deletePackage = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { packageId } = req.params;

    // Check if package exists and belongs to psychologist
    const { data: package } = await supabase
      .from('packages')
      .select('*')
      .eq('id', packageId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (!package) {
      return res.status(404).json(
        errorResponse('Package not found')
      );
    }

    // Check if package is being used in any sessions
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('package_id', packageId)
      .limit(1);

    if (sessions && sessions.length > 0) {
      return res.status(400).json(
        errorResponse('Cannot delete package that is being used in sessions')
      );
    }

    const { error } = await supabase
      .from('packages')
      .delete()
      .eq('id', packageId);

    if (error) {
      console.error('Delete package error:', error);
      return res.status(500).json(
        errorResponse('Failed to delete package')
      );
    }

    res.json(
      successResponse(null, 'Package deleted successfully')
    );

  } catch (error) {
    console.error('Delete package error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting package')
    );
  }
};

// Complete session with summary and notes
const completeSession = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { sessionId } = req.params;
    const { session_summary, session_notes, status = 'completed' } = req.body;

    // Validate required fields
    if (!session_summary || session_summary.trim().length === 0) {
      return res.status(400).json(
        errorResponse('Session summary is required')
      );
    }

    // Prepare update data
    const updateData = {
      status: status,
      session_summary: session_summary.trim(),
      updated_at: new Date().toISOString()
    };

    // Add session notes if provided (optional)
    if (session_notes && session_notes.trim().length > 0) {
      updateData.session_notes = session_notes.trim();
    }

    // First, try to find it as a regular session
    const { data: regularSession } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (regularSession) {
      // Update regular session
      const { data: updatedSession, error } = await supabase
        .from('sessions')
        .update(updateData)
        .eq('id', sessionId)
        .eq('psychologist_id', psychologistId)
        .select('*')
        .single();

      if (error) {
        console.error('Complete session error:', error);
        return res.status(500).json(
          errorResponse('Failed to complete session')
        );
      }

      return res.json(
        successResponse(updatedSession, 'Session completed successfully with summary and notes')
      );
    }

    // If not found in regular sessions, check assessment sessions
    const { data: assessmentSession, error: assessCheckError } = await supabaseAdmin
      .from('assessment_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (assessCheckError || !assessmentSession) {
      return res.status(404).json(
        errorResponse('Session not found or you do not have permission to complete this session')
      );
    }

    // Update assessment session
    const { data: updatedAssessmentSession, error: assessUpdateError } = await supabaseAdmin
      .from('assessment_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .eq('psychologist_id', psychologistId)
      .select('*')
      .single();

    if (assessUpdateError) {
      console.error('Complete assessment session error:', assessUpdateError);
      return res.status(500).json(
        errorResponse('Failed to complete assessment session')
      );
    }

    console.log('✅ Assessment session completed successfully:', updatedAssessmentSession.id);

    res.json(
      successResponse(updatedAssessmentSession, 'Assessment session completed successfully with summary and notes')
    );

  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while completing session')
    );
  }
};

// Respond to reschedule request
const respondToRescheduleRequest = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { sessionId } = req.params;
    const { action, newDate, newTime, reason } = req.body; // action: 'approve' or 'reject'

    // Check if session exists and belongs to psychologist
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (!session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Check if session has reschedule request
    if (session.status !== 'reschedule_requested') {
      return res.status(400).json(
        errorResponse('No reschedule request found for this session')
      );
    }

    let updateData = {
      updated_at: new Date().toISOString()
    };

    if (action === 'approve') {
      // Validate new date and time
      if (!newDate || !newTime) {
        return res.status(400).json(
          errorResponse('New date and time are required when approving reschedule')
        );
      }

      // Update session date and time and change status back to booked
      updateData.scheduled_date = newDate;
      updateData.scheduled_time = newTime;
      updateData.status = 'booked';

    } else if (action === 'reject') {
      // Change status back to booked (rejected)
      updateData.status = 'booked';
    } else {
      return res.status(400).json(
        errorResponse('Invalid action. Must be "approve" or "reject"')
      );
    }

    // Update session
    const { data: updatedSession, error } = await supabase
      .from('sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select('*')
      .single();

    if (error) {
      console.error('Update session error:', error);
      return res.status(500).json(
        errorResponse('Failed to update session')
      );
    }

    res.json(
      successResponse(updatedSession, `Reschedule request ${action}ed successfully`)
    );

  } catch (error) {
    console.error('Respond to reschedule request error:', error);
    res.status(500).json(
      errorResponse('Internal server error while responding to reschedule request')
    );
  }
};

// Schedule pending assessment session (for psychologists)
const scheduleAssessmentSession = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { assessmentSessionId } = req.params;
    const { scheduled_date, scheduled_time, target_psychologist_id } = req.body;

    if (!scheduled_date || !scheduled_time) {
      return res.status(400).json(
        errorResponse('Missing required fields: scheduled_date, scheduled_time')
      );
    }

    // Fetch assessment session by ID (allow reassignment to another psychologist)
    const { data: assessmentSession, error: fetchError } = await supabaseAdmin
      .from('assessment_sessions')
      .select('*')
      .eq('id', assessmentSessionId)
      .single();

    if (fetchError || !assessmentSession) {
      return res.status(404).json(
        errorResponse('Assessment session not found')
      );
    }

    // Check if session is in pending status
    if (assessmentSession.status !== 'pending') {
      return res.status(400).json(
        errorResponse(`Cannot schedule session. Current status: ${assessmentSession.status}`)
      );
    }

    // Decide which psychologist's availability to use
    const targetPsychologistId = target_psychologist_id || assessmentSession.psychologist_id || psychologistId;

    // Check conflicts for TARGET psychologist
    const { data: conflictingAssessmentSessions } = await supabaseAdmin
      .from('assessment_sessions')
      .select('id')
      .eq('psychologist_id', targetPsychologistId)
      .eq('scheduled_date', scheduled_date)
      .eq('scheduled_time', scheduled_time)
      .in('status', ['reserved', 'booked']);

    // Also check regular therapy sessions for target psychologist
    const { data: conflictingRegularSessions } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('psychologist_id', targetPsychologistId)
      .eq('scheduled_date', scheduled_date)
      .eq('scheduled_time', scheduled_time)
      .in('status', ['booked', 'rescheduled', 'confirmed']);

    const hasConflict = (conflictingAssessmentSessions && conflictingAssessmentSessions.length > 0) ||
                       (conflictingRegularSessions && conflictingRegularSessions.length > 0);

    if (hasConflict) {
      return res.status(400).json(
        errorResponse('This time slot is already booked for you. Please select another time.')
      );
    }

    // Update the assessment session with scheduled date/time and change status to booked
    const { data: updatedSession, error: updateError } = await supabaseAdmin
      .from('assessment_sessions')
      .update({
        scheduled_date,
        scheduled_time,
        status: 'booked',
        psychologist_id: targetPsychologistId,
        updated_at: new Date().toISOString()
      })
      .eq('id', assessmentSessionId)
      .eq('status', 'pending')
      .select('*')
      .single();

    if (updateError || !updatedSession) {
      console.error('Error scheduling assessment session:', updateError);
      return res.status(500).json(
        errorResponse('Failed to schedule assessment session')
      );
    }

    console.log('✅ Assessment session scheduled successfully by psychologist:', updatedSession.id);

    // Block the booked slot from availability (best-effort)
    try {
      const hhmm = (scheduled_time || '').substring(0,5);
      const { data: avail } = await supabaseAdmin
        .from('availability')
        .select('id, time_slots')
        .eq('psychologist_id', psychologistId)
        .eq('date', scheduled_date)
        .single();
      if (avail && Array.isArray(avail.time_slots)) {
        const filtered = avail.time_slots.filter(t => (typeof t === 'string' ? t.substring(0,5) : String(t).substring(0,5)) !== hhmm);
        if (filtered.length !== avail.time_slots.length) {
          await supabaseAdmin
            .from('availability')
            .update({ time_slots: filtered, updated_at: new Date().toISOString() })
            .eq('id', avail.id);
          console.log('✅ Availability updated to block scheduled assessment slot', { date: scheduled_date, time: hhmm });
        }
      }
    } catch (blockErr) {
      console.warn('⚠️ Failed to update availability after scheduling:', blockErr?.message);
    }

    res.json(
      successResponse(updatedSession, 'Assessment session scheduled successfully')
    );

  } catch (error) {
    console.error('Schedule assessment session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while scheduling assessment session')
    );
  }
};

// Delete a regular therapy session (owned by psychologist)
const deleteSession = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { sessionId } = req.params;

    const { data: existing, error: fetchError } = await supabase
      .from('sessions')
      .select('id, payment_id')
      .eq('id', sessionId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json(
        errorResponse('Session not found or access denied')
      );
    }

    // Delete related payment records (if any)
    try {
      await supabase
        .from('payments')
        .delete()
        .eq('session_id', sessionId);
    } catch (payErr) {
      console.warn('⚠️  Failed to delete related payments for session:', sessionId, payErr?.message);
    }

    const { error: delError } = await supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId);

    if (delError) {
      console.error('Delete session error:', delError);
      return res.status(500).json(
        errorResponse('Failed to delete session')
      );
    }

    res.json(successResponse(null, 'Session deleted successfully'));
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting session')
    );
  }
};

// Delete an assessment session (owned by psychologist)
const deleteAssessmentSession = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { assessmentSessionId } = req.params;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('assessment_sessions')
      .select('id')
      .eq('id', assessmentSessionId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json(
        errorResponse('Assessment session not found or access denied')
      );
    }

    // Delete related payment records (if any)
    try {
      await supabase
        .from('payments')
        .delete()
        .eq('assessment_session_id', assessmentSessionId);
    } catch (payErr) {
      console.warn('⚠️  Failed to delete related payments for assessment session:', assessmentSessionId, payErr?.message);
    }

    const { error: delError } = await supabaseAdmin
      .from('assessment_sessions')
      .delete()
      .eq('id', assessmentSessionId);

    if (delError) {
      console.error('Delete assessment session error:', delError);
      return res.status(500).json(
        errorResponse('Failed to delete assessment session')
      );
    }

    res.json(successResponse(null, 'Assessment session deleted successfully'));
  } catch (error) {
    console.error('Delete assessment session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting assessment session')
    );
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getSessions,
  updateSession,
  completeSession,
  scheduleAssessmentSession,
  getAvailability,
  addAvailability,
  updateAvailability,
  deleteAvailability,
  getPackages,
  createPackage,
  updatePackage,
  deletePackage,
  respondToRescheduleRequest,
  deleteSession,
  deleteAssessmentSession
};
