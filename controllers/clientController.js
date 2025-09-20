const supabase = require('../config/supabase');
const { 
  successResponse, 
  errorResponse,
  formatDate,
  formatTime,
  addMinutesToTime
} = require('../utils/helpers');
const availabilityService = require('../utils/availabilityCalendarService');
const meetLinkService = require('../utils/meetLinkService');

// Get client profile
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Get client profile error:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch client profile')
      );
    }

    res.json(
      successResponse(client)
    );

  } catch (error) {
    console.error('Get client profile error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching profile')
    );
  }
};

// Update client profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = req.body;

    // Remove user_id from update data if present
    delete updateData.user_id;

    const { data: client, error } = await supabase
      .from('clients')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      console.error('Update client profile error:', error);
      return res.status(500).json(
        errorResponse('Failed to update client profile')
      );
    }

    res.json(
      successResponse(client, 'Profile updated successfully')
    );

  } catch (error) {
    console.error('Update client profile error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating profile')
    );
  }
};

// Get client sessions
const getSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    // req.user.id is already the client ID, no need to lookup
    const clientId = userId;

    // Check if sessions table exists and has proper relationships
    try {
      let query = supabase
        .from('sessions')
        .select(`
          *,
          psychologist:psychologists(
            id,
            first_name,
            last_name,
            area_of_expertise
          )
        `)
        .eq('client_id', clientId);

      // Filter by status if provided
      if (status) {
        query = query.eq('status', status);
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1).order('scheduled_date', { ascending: false });

      const { data: sessions, error, count } = await query;

      if (error) {
        // If there's a database relationship error, return empty sessions
        if (error.code === 'PGRST200' || error.message.includes('relationship') || error.message.includes('schema cache')) {
          console.log('Database relationships not fully established, returning empty sessions for new client');
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
        
        console.error('Get client sessions error:', error);
        return res.status(500).json(
          errorResponse('Failed to fetch sessions')
        );
      }

      res.json(
        successResponse({
          sessions: sessions || [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || (sessions ? sessions.length : 0)
          }
        })
      );

    } catch (dbError) {
      // If there's any database error, return empty sessions for new clients
      console.log('Database error in sessions query, returning empty sessions for new client:', dbError.message);
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
    console.error('Get client sessions error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching sessions')
    );
  }
};

// Book a new session
const bookSession = async (req, res) => {
  try {
    console.log('🚀 Starting session booking process...');
    const { psychologist_id, package_id, scheduled_date, scheduled_time, price } = req.body;

    // Validate required fields
    if (!psychologist_id || !scheduled_date || !scheduled_time) {
      return res.status(400).json(
        errorResponse('Missing required fields: psychologist_id, scheduled_date, scheduled_time')
      );
    }

    // Get client_id from authenticated user
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user is a client
    if (userRole !== 'client') {
      return res.status(403).json(
        errorResponse('Only clients can book sessions')
      );
    }

    // Get client profile from clients table
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      console.error('Client profile not found:', clientError);
      return res.status(404).json(
        errorResponse('Client profile not found. Please complete your profile first.')
      );
    }

    const clientId = client.id;

    console.log('🔍 Step 1: Client validation');
    console.log('   - Client ID:', clientId);
    console.log('   - User ID:', userId);
    console.log('   - User Role:', userRole);

    // Step 2: Package validation
    console.log('🔍 Step 2: Package validation');
    console.log('📦 Package ID provided:', package_id);
    console.log('📦 Package ID type:', typeof package_id);
    console.log('📦 Package ID truthiness:', !!package_id);

    let package = null;

    // Only validate package if package_id is provided and not null/undefined (and not individual)
    if (package_id && package_id !== 'null' && package_id !== 'undefined' && package_id !== 'individual') {
      console.log('📦 Validating package...');
      const { data: packageData, error: packageError } = await supabase
        .from('packages')
        .select('*')
        .eq('id', package_id)
        .eq('psychologist_id', psychologist_id)
        .single();

      console.log('📦 Package lookup result:', packageData);
      console.log('📦 Package lookup error:', packageError);

      if (!packageData) {
        console.log('❌ Package validation failed');
        return res.status(400).json(
          errorResponse('Package not found or does not belong to this psychologist')
        );
      }

      package = packageData;
      console.log('✅ Package validation passed');
    } else {
      console.log('📦 No package validation needed (package_id not provided)');
    }

    // Step 3: Check if the time slot is available using availability service
    console.log('🔍 Step 3: Checking time slot availability...');
    const isAvailable = await availabilityService.isTimeSlotAvailable(
      psychologist_id, 
      scheduled_date, 
      scheduled_time
    );

    if (!isAvailable) {
      return res.status(400).json(
        errorResponse('This time slot is not available. Please select another time.')
      );
    }

    console.log('✅ Time slot is available');

    // Step 4: Get client and psychologist details for Google Calendar
    console.log('🔍 Step 4: Fetching user details for Google Calendar...');
    const { data: clientDetails, error: clientDetailsError } = await supabase
      .from('clients')
      .select(`
        first_name, 
        last_name, 
        child_name,
        user:users(email)
      `)
      .eq('id', clientId)
      .single();

    if (clientDetailsError || !clientDetails) {
      console.error('Error fetching client details:', clientDetailsError);
      return res.status(500).json(
        errorResponse('Failed to fetch client details')
      );
    }

    const { data: psychologistDetails, error: psychologistDetailsError } = await supabase
      .from('psychologists')
      .select('first_name, last_name, email')
      .eq('id', psychologist_id)
      .single();

    if (psychologistDetailsError || !psychologistDetails) {
      console.error('Error fetching psychologist details:', psychologistDetailsError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologist details')
      );
    }

    console.log('✅ User details fetched successfully');

    // Step 5: Create Google Calendar event with OAuth2 Meet service
    console.log('🔍 Step 5: Creating Google Calendar event...');
    let meetData = null;
    try {
      const sessionData = {
        summary: `Therapy Session - ${clientDetails?.child_name || 'Client'} with ${psychologistDetails?.first_name || 'Psychologist'}`,
        description: `Therapy session between ${clientDetails?.child_name || 'Client'} and ${psychologistDetails?.first_name || 'Psychologist'}`,
        startDate: scheduled_date,
        startTime: scheduled_time,
        endTime: addMinutesToTime(scheduled_time, 50) // 50-minute session
      };

      const meetResult = await meetLinkService.generateSessionMeetLink(sessionData);
      
      if (meetResult.success) {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || null,
          method: meetResult.method
        };
        console.log('✅ Real Meet link created successfully:', meetResult);
      } else {
        meetData = {
          meetLink: meetResult.meetLink, // Fallback link
          eventId: null,
          calendarLink: null,
          method: 'fallback'
        };
        console.log('⚠️ Using fallback Meet link:', meetResult.meetLink);
      }
    } catch (meetError) {
      console.error('❌ Meet link creation failed:', meetError);
      // Continue without Meet link if it fails
      meetData = {
        meetLink: 'https://meet.google.com/new?hs=122&authuser=0',
        eventId: null,
        calendarLink: null,
        method: 'error'
      };
    }

    // Step 6: Create session record
    console.log('🔍 Step 6: Creating session record...');
    const sessionData = {
      client_id: clientId,
      psychologist_id,
      scheduled_date: formatDate(scheduled_date),
      scheduled_time: formatTime(scheduled_time),
      status: 'booked',
      google_calendar_event_id: meetData.eventId,
      google_meet_link: meetData.meetLink,
      google_calendar_link: meetData.calendarLink,
      price: price || (package?.price || 100) // Default to $100 for individual sessions
    };

    // Only add package_id if it's provided and valid (not individual)
    if (package_id && package_id !== 'null' && package_id !== 'undefined' && package_id !== 'individual') {
      sessionData.package_id = package_id;
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      console.error('❌ Session creation failed:', sessionError);
      return res.status(500).json(
        errorResponse('Failed to create session')
      );
    }

    console.log('✅ Session record created successfully');
    console.log('   - Session ID:', session.id);
    console.log('   - Status:', session.status);
    console.log('   - Price:', session.price);

    // Step 7: If this is a package purchase, create client package record
    if (package && package.session_count > 1 && package.id !== 'individual') {
      console.log('🔍 Step 7: Creating client package record...');
      console.log('📦 Package details:', package);
      
      try {
        const clientPackageData = {
          client_id: clientId,
          psychologist_id,
          package_id: package.id,
          package_type: package.package_type,
          total_sessions: package.session_count,
          remaining_sessions: package.session_count - 1, // First session already booked
          total_amount: package.price,
          amount_paid: package.price,
          status: 'active',
          purchased_at: new Date().toISOString(),
          first_session_id: session.id
        };

        const { error: clientPackageError } = await supabase
          .from('client_packages')
          .insert([clientPackageData]);

        if (clientPackageError) {
          console.error('❌ Client package creation failed:', clientPackageError);
          // Continue even if client package creation fails
        } else {
          console.log('✅ Client package record created successfully');
          console.log('   - Remaining sessions:', package.session_count - 1);
        }
      } catch (packageError) {
        console.error('❌ Exception while creating client package:', packageError);
        // Continue even if client package creation fails
      }
    }

    // Step 8: Send email notifications
    console.log('🔍 Step 8: Sending email notifications...');
    try {
      const emailService = require('../utils/emailService');
      
      const clientName = clientDetails.child_name || 
                        `${clientDetails.first_name} ${clientDetails.last_name}`.trim();
      const psychologistName = `${psychologistDetails.first_name} ${psychologistDetails.last_name}`.trim();

      await emailService.sendSessionConfirmation({
        clientEmail: clientDetails.user?.email || 'client@placeholder.com',
        psychologistEmail: psychologistDetails?.email || 'psychologist@placeholder.com',
        clientName,
        psychologistName,
        sessionId: session.id,
        scheduledDate: scheduled_date,
        scheduledTime: scheduled_time,
        meetLink: meetData.meetLink,
        price: session.price
      });

      console.log('✅ Email notifications sent successfully');
    } catch (emailError) {
      console.error('❌ Error sending email notifications:', emailError);
      // Continue even if email fails
    }

    console.log('✅ Session booking completed successfully with Meet link and email notifications');
    res.status(201).json(
      successResponse({
        session,
        meetLink: meetData.meetLink,
        calendarLink: meetData.calendarLink,
        package: package && package.id !== 'individual' ? {
          type: package.package_type,
          remaining_sessions: package.session_count - 1,
          total_amount: package.price
        } : null
      }, 'Session booked successfully')
    );

  } catch (error) {
    console.error('❌ Session booking error:', error);
    res.status(500).json(
      errorResponse('Internal server error while booking session')
    );
  }
};

// Cancel a session
const cancelSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    // Get client ID
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (!client) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    // Check if session exists and belongs to client
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('client_id', client.id)
      .single();

    if (!session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Check if session can be cancelled
    if (session.status !== 'booked') {
      return res.status(400).json(
        errorResponse('Only booked sessions can be cancelled')
      );
    }

    // Check if session is in the future
    const sessionDate = new Date(session.scheduled_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (sessionDate <= today) {
      return res.status(400).json(
        errorResponse('Cannot cancel sessions on or before today')
      );
    }

    // Update session status
    const { data: updatedSession, error } = await supabase
      .from('sessions')
      .update({
        status: 'canceled',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (error) {
      console.error('Cancel session error:', error);
      return res.status(500).json(
        errorResponse('Failed to cancel session')
      );
    }

    res.json(
      successResponse(updatedSession, 'Session cancelled successfully')
    );

  } catch (error) {
    console.error('Cancel session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while cancelling session')
    );
  }
};

// Request reschedule for a session
const requestReschedule = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    // Get client ID
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (!client) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    // Check if session exists and belongs to client
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('client_id', client.id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Check if session can be rescheduled (only booked sessions)
    if (session.status !== 'booked') {
      return res.status(400).json(
        errorResponse('Only booked sessions can be rescheduled')
      );
    }

    // For now, just change the status to indicate reschedule request
    // TODO: Add reschedule_request field to database schema
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({
        status: 'reschedule_requested',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Update session status error:', updateError);
      return res.status(500).json(
        errorResponse('Failed to create reschedule request')
      );
    }

    res.json(
      successResponse(updatedSession, 'Reschedule request sent successfully')
    );

  } catch (error) {
    console.error('Request reschedule error:', error);
    res.status(500).json(
      errorResponse('Internal server error while requesting reschedule')
    );
  }
};

// Get available psychologists
const getAvailablePsychologists = async (req, res) => {
  try {
    const { expertise, date } = req.query;

    let query = supabase
      .from('psychologists')
      .select(`
        id,
        first_name,
        last_name,
        area_of_expertise,
        description,
        experience_years,
        cover_image_url,
        packages(id, package_type, price, description)
      `);

    // Filter by expertise if provided
    if (expertise) {
      query = query.contains('area_of_expertise', [expertise]);
    }

    const { data: psychologists, error } = await query;

    if (error) {
      console.error('Get psychologists error:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologists')
      );
    }

    // Filter by availability if date is provided
    if (date) {
      const availablePsychologists = [];
      
      for (const psychologist of psychologists) {
        const { data: availability } = await supabase
          .from('availability')
          .select('time_slots')
          .eq('psychologist_id', psychologist.id)
          .eq('date', date)
          .eq('is_available', true)
          .single();

        if (availability && availability.time_slots.length > 0) {
          psychologist.available_slots = availability.time_slots;
          availablePsychologists.push(psychologist);
        }
      }

      res.json(
        successResponse(availablePsychologists)
      );
    } else {
      res.json(
        successResponse(psychologists)
      );
    }

  } catch (error) {
    console.error('Get psychologists error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching psychologists')
    );
  }
};

// Reschedule session with new date/time selection
const rescheduleSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { new_date, new_time, psychologist_id } = req.body;
    const userId = req.user.id;

    console.log('🔄 Starting session reschedule process');
    console.log('   - Session ID:', sessionId);
    console.log('   - New Date:', new_date);
    console.log('   - New Time:', new_time);
    console.log('   - Psychologist ID:', psychologist_id);

    // Validate required fields
    if (!new_date || !new_time || !psychologist_id) {
      return res.status(400).json(
        errorResponse('Missing required fields: new_date, new_time, psychologist_id')
      );
    }

    // Get client ID
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (!client) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    // Get existing session and verify ownership
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('client_id', client.id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json(
        errorResponse('Session not found or access denied')
      );
    }

    // Check if session can be rescheduled
    if (session.status === 'completed' || session.status === 'cancelled') {
      return res.status(400).json(
        errorResponse('Cannot reschedule completed or cancelled sessions')
      );
    }

    // Check if new time slot is available
    const { data: conflictingSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('psychologist_id', psychologist_id)
      .eq('scheduled_date', formatDate(new_date))
      .eq('scheduled_time', formatTime(new_time))
      .in('status', ['booked', 'rescheduled', 'confirmed'])
      .neq('id', sessionId); // Exclude current session

    if (conflictingSessions && conflictingSessions.length > 0) {
      return res.status(400).json(
        errorResponse('Selected time slot is already booked')
      );
    }

    // Update session with new date/time
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({
        scheduled_date: formatDate(new_date),
        scheduled_time: formatTime(new_time),
        status: 'rescheduled',
        reschedule_count: (session.reschedule_count || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Error updating session:', updateError);
      return res.status(500).json(
        errorResponse('Failed to reschedule session')
      );
    }

    // Create notification for psychologist
    await createRescheduleNotification(session, updatedSession, client.id);

    // Send email notifications (keeping this functionality)
    try {
      await sendRescheduleEmails(session, updatedSession, psychologist_id);
    } catch (emailError) {
      console.error('Error sending reschedule emails:', emailError);
      // Continue even if email fails
    }

    console.log('✅ Session rescheduled successfully');
    res.json(
      successResponse(updatedSession, 'Session rescheduled successfully')
    );

  } catch (error) {
    console.error('Reschedule session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while rescheduling session')
    );
  }
};

// Helper function to get reschedule count for a session
const getRescheduleCount = async (sessionId) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('reschedule_count')
      .eq('id', sessionId)
      .single();
    
    return session?.reschedule_count || 0;
  } catch (error) {
    console.error('Error getting reschedule count:', error);
    return 0;
  }
};

// Helper function to create reschedule request
const createRescheduleRequest = async (session, newDate, newTime, clientId, reason) => {
  try {
    // Get client details
    const { data: clientDetails } = await supabase
      .from('clients')
      .select('first_name, last_name, child_name')
      .eq('id', clientId)
      .single();

    const clientName = clientDetails?.child_name || 
                      `${clientDetails?.first_name || 'Client'} ${clientDetails?.last_name || ''}`.trim();

    // Create reschedule request notification
    const notificationData = {
      psychologist_id: session.psychologist_id,
      type: 'reschedule_request',
      title: 'Reschedule Request',
      message: `${clientName} has requested to reschedule their session from ${session.scheduled_date} at ${session.scheduled_time} to ${newDate} at ${newTime}. Reason: ${reason}`,
      session_id: session.id,
      client_id: clientId,
      is_read: false,
      created_at: new Date().toISOString(),
      metadata: {
        request_type: 'reschedule',
        new_date: newDate,
        new_time: newTime,
        reason: reason,
        original_date: session.scheduled_date,
        original_time: session.scheduled_time
      }
    };

    const { error: notificationError } = await supabase
      .from('notifications')
      .insert([notificationData]);

    if (notificationError) {
      console.error('Error creating reschedule request notification:', notificationError);
      return { success: false, error: notificationError };
    }

    console.log('✅ Reschedule request notification created');
    return { 
      success: true, 
      data: { 
        message: 'Reschedule request sent to psychologist',
        notification: notificationData 
      } 
    };

  } catch (error) {
    console.error('Error creating reschedule request:', error);
    return { success: false, error };
  }
};

// Helper function to create reschedule notification
const createRescheduleNotification = async (originalSession, updatedSession, clientId) => {
  try {
    // Get client and psychologist details
    const { data: clientDetails } = await supabase
      .from('clients')
      .select('first_name, last_name, child_name')
      .eq('id', clientId)
      .single();

    const clientName = clientDetails?.child_name || 
                      `${clientDetails?.first_name || 'Client'} ${clientDetails?.last_name || ''}`.trim();

    // Format dates for notification
    const originalDate = new Date(originalSession.scheduled_date);
    const newDate = new Date(updatedSession.scheduled_date);
    
    const formatDateForNotification = (date, time) => {
      return new Date(`${date}T${time}+05:30`).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
    };

    const formatTimeForNotification = (time) => {
      const [hours, minutes] = time.split(':');
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata'
      });
    };

    // Create notification record
    const notificationData = {
      psychologist_id: updatedSession.psychologist_id,
      type: 'session_rescheduled',
      title: 'Session Rescheduled',
      message: `${clientName} has rescheduled their session from ${formatDateForNotification(originalSession.scheduled_date, originalSession.scheduled_time)} at ${formatTimeForNotification(originalSession.scheduled_time)} to ${formatDateForNotification(updatedSession.scheduled_date, updatedSession.scheduled_time)} at ${formatTimeForNotification(updatedSession.scheduled_time)}`,
      session_id: updatedSession.id,
      client_id: clientId,
      is_read: false,
      created_at: new Date().toISOString()
    };

    const { error: notificationError } = await supabase
      .from('notifications')
      .insert([notificationData]);

    if (notificationError) {
      console.error('Error creating notification:', notificationError);
    } else {
      console.log('✅ Reschedule notification created');
    }

  } catch (error) {
    console.error('Error creating reschedule notification:', error);
  }
};

// Helper function to send reschedule emails
const sendRescheduleEmails = async (originalSession, updatedSession, psychologistId) => {
  try {
    console.log('📧 Sending reschedule email notifications...');
    
    // Get client and psychologist details for email
    const { data: clientDetails } = await supabase
      .from('clients')
      .select('first_name, last_name, child_name, user:users(email)')
      .eq('id', originalSession.client_id)
      .single();

    const { data: psychologistDetails } = await supabase
      .from('psychologists')
      .select('first_name, last_name, email')
      .eq('id', psychologistId)
      .single();

    if (clientDetails && psychologistDetails) {
      const emailService = require('../utils/emailService');
      
      const clientName = clientDetails.child_name || 
                        `${clientDetails.first_name} ${clientDetails.last_name}`.trim();
      const psychologistName = `${psychologistDetails.first_name} ${psychologistDetails.last_name}`.trim();

      await emailService.sendRescheduleNotification({
        clientEmail: clientDetails.user?.email,
        psychologistEmail: psychologistDetails.email,
        clientName,
        psychologistName,
        sessionId: updatedSession.id,
        originalDate: originalSession.scheduled_date,
        originalTime: originalSession.scheduled_time,
        newDate: updatedSession.scheduled_date,
        newTime: updatedSession.scheduled_time,
        meetLink: updatedSession.google_meet_link
      });

      console.log('✅ Reschedule emails sent successfully');
    }
  } catch (error) {
    console.error('Error sending reschedule emails:', error);
    // Don't throw - let the reschedule complete even if email fails
  }
};

// Get single session with summary (visible to client)
const getSession = async (req, res) => {
  try {
    const clientId = req.user.id;
    const { sessionId } = req.params;

    console.log(`📋 Getting session ${sessionId} for client ${clientId}`);

    // Get session with psychologist details, but exclude session_notes
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        status,
        summary,
        report,
        feedback,
        price,
        created_at,
        updated_at,
        psychologist:psychologists(
          id,
          first_name,
          last_name,
          area_of_expertise
        )
      `)
      .eq('id', sessionId)
      .eq('client_id', clientId)
      .single();

    if (sessionError) {
      console.error('Error fetching session:', sessionError);
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    console.log(`✅ Session ${sessionId} retrieved successfully for client ${clientId}`);
    res.json(
      successResponse(session)
    );

  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching session')
    );
  }
};

// Get psychologist packages for client viewing
const getPsychologistPackages = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    console.log(`📦 Getting packages for psychologist ${psychologistId}`);

    // Get packages for this psychologist
    const { data: packages, error: packagesError } = await supabase
      .from('packages')
      .select('*')
      .eq('psychologist_id', psychologistId)
      .order('session_count', { ascending: true });

    if (packagesError) {
      console.error('Error fetching packages:', packagesError);
      return res.status(500).json(
        errorResponse('Failed to fetch packages')
      );
    }

    console.log(`✅ Found ${packages?.length || 0} packages for psychologist ${psychologistId}`);
    res.json(
      successResponse({ packages: packages || [] })
    );

  } catch (error) {
    console.error('Error getting psychologist packages:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching packages')
    );
  }
};

// Submit session feedback
const submitSessionFeedback = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const { feedback, rating } = req.body;

    console.log(`📝 User ${userId} submitting feedback for session ${sessionId}`);

    // Validate required fields
    if (!feedback || !rating) {
      return res.status(400).json(
        errorResponse('Feedback and rating are required')
      );
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      return res.status(400).json(
        errorResponse('Rating must be between 1 and 5')
      );
    }

    // Get client ID from user_id
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      console.error('Error finding client:', clientError);
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = client.id;
    console.log(`📝 Client ${clientId} submitting feedback for session ${sessionId}`);

    // Check if session exists and belongs to this client
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, status, client_id')
      .eq('id', sessionId)
      .eq('client_id', clientId)
      .single();

    if (sessionError || !session) {
      console.error('Error finding session:', sessionError);
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Check if session is completed
    if (session.status !== 'completed') {
      return res.status(400).json(
        errorResponse('Feedback can only be submitted for completed sessions')
      );
    }

    // Check if feedback already exists
    const { data: existingFeedback } = await supabase
      .from('sessions')
      .select('feedback')
      .eq('id', sessionId)
      .single();

    if (existingFeedback?.feedback) {
      return res.status(400).json(
        errorResponse('Feedback has already been submitted for this session')
      );
    }

    // Update session with feedback
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({
        feedback: feedback,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('id, feedback, updated_at')
      .single();

    if (updateError) {
      console.error('Error updating session with feedback:', updateError);
      return res.status(500).json(
        errorResponse('Failed to submit feedback')
      );
    }

    console.log(`✅ Feedback submitted successfully for session ${sessionId}`);
    res.json(
      successResponse(updatedSession, 'Feedback submitted successfully')
    );

  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json(
      errorResponse('Internal server error while submitting feedback')
    );
  }
};

// Get client packages
const getClientPackages = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get client ID
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = client.id;

    // Get client packages with package details
    const { data: clientPackages, error: packagesError } = await supabase
      .from('client_packages')
      .select(`
        *,
        package:packages(
          id,
          package_type,
          description,
          session_count,
          price
        ),
        psychologist:psychologists(
          id,
          first_name,
          last_name,
          area_of_expertise
        )
      `)
      .eq('client_id', clientId)
      .order('purchased_at', { ascending: false });

    if (packagesError) {
      console.error('Error fetching client packages:', packagesError);
      return res.status(500).json(
        errorResponse('Failed to fetch client packages')
      );
    }

    res.json(
      successResponse({
        packages: clientPackages || []
      })
    );

  } catch (error) {
    console.error('Error getting client packages:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching client packages')
    );
  }
};

// Book remaining session from package
const bookRemainingSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { package_id, scheduled_date, scheduled_time } = req.body;

    console.log('🚀 Starting remaining session booking process...');
    console.log('   - Package ID:', package_id);
    console.log('   - Scheduled Date:', scheduled_date);
    console.log('   - Scheduled Time:', scheduled_time);

    // Validate required fields
    if (!package_id || !scheduled_date || !scheduled_time) {
      return res.status(400).json(
        errorResponse('Missing required fields: package_id, scheduled_date, scheduled_time')
      );
    }

    // Get client ID
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = client.id;

    // Get client package and verify ownership
    const { data: clientPackage, error: packageError } = await supabase
      .from('client_packages')
      .select(`
        *,
        package:packages(
          id,
          package_type,
          description,
          session_count,
          price,
          psychologist_id
        )
      `)
      .eq('id', package_id)
      .eq('client_id', clientId)
      .single();

    if (packageError || !clientPackage) {
      return res.status(404).json(
        errorResponse('Package not found or access denied')
      );
    }

    // Check if package has remaining sessions
    if (clientPackage.remaining_sessions <= 0) {
      return res.status(400).json(
        errorResponse('No remaining sessions in this package')
      );
    }

    const psychologistId = clientPackage.package.psychologist_id;

    // Check if the time slot is available
    const isAvailable = await availabilityService.isTimeSlotAvailable(
      psychologistId, 
      scheduled_date, 
      scheduled_time
    );

    if (!isAvailable) {
      return res.status(400).json(
        errorResponse('This time slot is not available. Please select another time.')
      );
    }

    // Get client and psychologist details for Google Calendar
    const { data: clientDetails, error: clientDetailsError } = await supabase
      .from('clients')
      .select(`
        first_name, 
        last_name, 
        child_name,
        user:users(email)
      `)
      .eq('id', clientId)
      .single();

    if (clientDetailsError || !clientDetails) {
      console.error('Error fetching client details:', clientDetailsError);
      return res.status(500).json(
        errorResponse('Failed to fetch client details')
      );
    }

    const { data: psychologistDetails, error: psychologistDetailsError } = await supabase
      .from('psychologists')
      .select('first_name, last_name, email')
      .eq('id', psychologistId)
      .single();

    if (psychologistDetailsError || !psychologistDetails) {
      console.error('Error fetching psychologist details:', psychologistDetailsError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologist details')
      );
    }

    // Create Google Calendar event with real Meet link
    let meetData = null;
    try {
      console.log('🔄 Creating real Google Meet link for package session...');
      
      const sessionData = {
        summary: `Therapy Session - ${clientDetails?.child_name || 'Client'} with ${psychologistDetails?.first_name || 'Psychologist'}`,
        description: `Therapy session between ${clientDetails?.child_name || 'Client'} and ${psychologistDetails?.first_name || 'Psychologist'}`,
        startDate: scheduled_date,
        startTime: scheduled_time,
        endTime: addMinutesToTime(scheduled_time, 50) // 50-minute session
      };

      const meetResult = await meetLinkService.generateSessionMeetLink(sessionData);
      
      if (meetResult.success) {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || null,
          method: meetResult.method
        };
        console.log('✅ Real Meet link created successfully:', meetResult);
      } else {
        meetData = {
          meetLink: meetResult.meetLink, // Fallback link
          eventId: null,
          calendarLink: null,
          method: 'fallback'
        };
        console.log('⚠️ Using fallback Meet link:', meetResult.meetLink);
      }
    } catch (meetError) {
      console.error('❌ Meet link creation failed:', meetError);
      meetData = {
        meetLink: 'https://meet.google.com/new?hs=122&authuser=0',
        eventId: null,
        calendarLink: null,
        method: 'error'
      };
    }

    // Create session record
    const sessionData = {
      client_id: clientId,
      psychologist_id: psychologistId,
      package_id: clientPackage.package.id,
      scheduled_date: formatDate(scheduled_date),
      scheduled_time: formatTime(scheduled_time),
      status: 'booked',
      google_calendar_event_id: meetData.eventId,
      google_meet_link: meetData.meetLink,
      google_calendar_link: meetData.calendarLink,
      price: 0 // Free since it's from a package
    };

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      console.error('Session creation failed:', sessionError);
      return res.status(500).json(
        errorResponse('Failed to create session')
      );
    }

    // Update remaining sessions in client package
    const { error: updateError } = await supabase
      .from('client_packages')
      .update({
        remaining_sessions: clientPackage.remaining_sessions - 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', package_id);

    if (updateError) {
      console.error('Failed to update remaining sessions:', updateError);
      // Continue even if update fails
    }

    // Send email notifications
    try {
      const emailService = require('../utils/emailService');
      
      const clientName = clientDetails.child_name || 
                        `${clientDetails.first_name} ${clientDetails.last_name}`.trim();
      const psychologistName = `${psychologistDetails.first_name} ${psychologistDetails.last_name}`.trim();

      await emailService.sendSessionConfirmation({
        clientEmail: clientDetails.user?.email || 'client@placeholder.com',
        psychologistEmail: psychologistDetails?.email || 'psychologist@placeholder.com',
        clientName,
        psychologistName,
        sessionId: session.id,
        scheduledDate: scheduled_date,
        scheduledTime: scheduled_time,
        meetLink: meetData.meetLink,
        price: 0
      });
    } catch (emailError) {
      console.error('Error sending email notifications:', emailError);
      // Continue even if email fails
    }

    console.log('✅ Remaining session booked successfully');
    res.status(201).json(
      successResponse({
        session,
        meetLink: meetData.meetLink,
        calendarLink: meetData.calendarLink,
        remaining_sessions: clientPackage.remaining_sessions - 1
      }, 'Session booked successfully from package')
    );

  } catch (error) {
    console.error('Error booking remaining session:', error);
    res.status(500).json(
      errorResponse('Internal server error while booking session')
    );
  }
};

// Reserve a time slot for payment (without creating session)
const reserveTimeSlot = async (req, res) => {
  try {
    const userId = req.user.id;
    const { psychologist_id, scheduled_date, scheduled_time, package_id } = req.body;

    console.log('🔍 Step 1: Client validation');
    // Get client ID
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      console.log('❌ Client not found');
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = client.id;
    console.log('   - Client ID:', clientId);
    console.log('   - User ID:', userId);
    console.log('   - User Role:', req.user.role);

    // Check if time slot is available
    console.log('🔍 Step 2: Checking time slot availability...');
    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('psychologist_id', psychologist_id)
      .eq('scheduled_date', scheduled_date)
      .eq('scheduled_time', scheduled_time)
      .eq('status', 'booked');

    if (existingSessions && existingSessions.length > 0) {
      console.log('❌ Time slot already booked');
      return res.status(400).json(
        errorResponse('This time slot is already booked')
      );
    }

    console.log('✅ Time slot is available');

    // Get package details for pricing
    let package = null;
    if (package_id && package_id !== 'individual') {
      const { data: packageData } = await supabase
        .from('packages')
        .select('*')
        .eq('id', package_id)
        .single();
      
      if (packageData) {
        package = packageData;
      }
    }

    // Get psychologist details
    const { data: psychologistDetails } = await supabase
      .from('psychologists')
      .select('*')
      .eq('id', psychologist_id)
      .single();

    if (!psychologistDetails) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Extract individual session price from psychologist description
    let individualPrice = 100; // Default fallback
    if (psychologistDetails.description) {
      const priceMatch = psychologistDetails.description.match(/Individual Session Price: ₹(\d+(?:\.\d+)?)/);
      if (priceMatch) {
        individualPrice = parseFloat(priceMatch[1]);
      }
    }

    const price = package ? package.price : individualPrice;

    res.json({
      success: true,
      data: {
        clientId: clientId,
        psychologistId: psychologist_id,
        scheduledDate: scheduled_date,
        scheduledTime: scheduled_time,
        packageId: package_id,
        price: price,
        package: package,
        psychologist: psychologistDetails
      }
    });

  } catch (error) {
    console.error('❌ Reserve time slot error:', error);
    res.status(500).json(
      errorResponse('Internal server error while reserving time slot')
    );
  }
};

// Get free assessment availability for rescheduling
const getFreeAssessmentAvailabilityForReschedule = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    console.log('📅 Fetching free assessment availability for reschedule');
    console.log('   - Session ID:', sessionId);
    console.log('   - User ID:', userId);

    // Get client ID
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (!client) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    // Get existing session and verify ownership
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('client_id', client.id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json(
        errorResponse('Session not found or access denied')
      );
    }

    // Check if this is a free assessment session
    if (session.session_type !== 'free_assessment') {
      return res.status(400).json(
        errorResponse('This endpoint is only for free assessment sessions')
      );
    }

    // Get current date and next 30 days
    const currentDate = new Date();
    const endDate = new Date();
    endDate.setDate(currentDate.getDate() + 30);

    // Fetch free assessment availability for the next 30 days
    const { data: dateConfigs, error: configError } = await supabase
      .from('free_assessment_date_configs')
      .select('date, time_slots')
      .gte('date', currentDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (configError) {
      console.error('Error fetching free assessment configs:', configError);
      return res.status(500).json(
        errorResponse('Failed to fetch free assessment availability')
      );
    }

    console.log('📅 Fetched date configs:', dateConfigs);
    console.log('📅 Sample time_slots structure:', dateConfigs?.[0]?.time_slots);

    // Process availability data
    const availabilityData = {};
    
    for (const config of dateConfigs || []) {
      const date = config.date;
      const timeSlotsObj = config.time_slots || {};
      
      // Convert the object structure to a flat array of time slots
      let allTimeSlots = [];
      
      // Extract time slots from all categories
      Object.values(timeSlotsObj).forEach(categorySlots => {
        if (Array.isArray(categorySlots)) {
          allTimeSlots = allTimeSlots.concat(categorySlots);
        }
      });
      
      console.log(`📅 Date ${date} - All time slots:`, allTimeSlots);
      
      // Skip if no time slots available
      if (allTimeSlots.length === 0) {
        continue;
      }
      
      // Get existing bookings for this date
      const { data: bookedSessions } = await supabase
        .from('sessions')
        .select('scheduled_time')
        .eq('scheduled_date', date)
        .eq('session_type', 'free_assessment')
        .in('status', ['booked', 'rescheduled', 'confirmed']);

      const { data: bookedAssessments } = await supabase
        .from('free_assessments')
        .select('scheduled_time')
        .eq('scheduled_date', date)
        .eq('status', 'booked');

      // Count bookings per time slot
      const bookingCounts = {};
      
      // Count session bookings
      bookedSessions?.forEach(booking => {
        bookingCounts[booking.scheduled_time] = (bookingCounts[booking.scheduled_time] || 0) + 1;
      });

      // Count assessment bookings
      bookedAssessments?.forEach(booking => {
        bookingCounts[booking.scheduled_time] = (bookingCounts[booking.scheduled_time] || 0) + 1;
      });

      // Filter available slots
      const availableSlots = allTimeSlots
        .filter(timeSlot => {
          const currentBookings = bookingCounts[timeSlot] || 0;
          return currentBookings < 20; // Max 20 bookings per slot
        })
        .map(timeSlot => ({
          time: timeSlot,
          displayTime: timeSlot,
          availableBookings: 20 - (bookingCounts[timeSlot] || 0),
          maxBookings: 20,
          currentBookings: bookingCounts[timeSlot] || 0
        }));

      if (availableSlots.length > 0) {
        availabilityData[date] = {
          availableSlots: availableSlots.length,
          totalSlots: allTimeSlots.length,
          slots: availableSlots
        };
      }
    }

    console.log('✅ Free assessment availability fetched successfully');
    
    res.json(
      successResponse({
        session: session,
        availability: availabilityData,
        dateRange: {
          start: currentDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        }
      })
    );

  } catch (error) {
    console.error('Get free assessment availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching availability')
    );
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getSessions,
  getSession,
  bookSession,
  cancelSession,
  getAvailablePsychologists,
  getPsychologistPackages,
  requestReschedule,
  rescheduleSession,
  submitSessionFeedback,
  getClientPackages,
  bookRemainingSession,
  reserveTimeSlot,
  getFreeAssessmentAvailabilityForReschedule
};
