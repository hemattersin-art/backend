const { supabaseAdmin } = require('../config/supabase');
const { 
  successResponse, 
  errorResponse,
  hashPassword,
  formatDate,
  formatTime,
  addMinutesToTime
} = require('../utils/helpers');
const { formatFriendlyTime } = require('../utils/whatsappService');

// Helper function to get availability dates for a day of the week
const getAvailabilityDatesForDay = (dayName, numOccurrences = 1) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayIndex = days.indexOf(dayName);
  if (dayIndex === -1) return [];
  
  // Use local date directly without timezone conversion
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntilNext = dayIndex - currentDay;
  
  // If today is the target day, start from today
  if (daysUntilNext === 0) {
    daysUntilNext = 0;
  } else if (daysUntilNext < 0) {
    // If the day has passed this week, start from next week
    daysUntilNext += 7;
  }
  
  const dates = [];
  for (let occurrence = 0; occurrence < numOccurrences; occurrence++) {
    const date = new Date(today);
    date.setDate(today.getDate() + daysUntilNext + (occurrence * 7));
    dates.push(date);
  }
  
  return dates;
};

// NOTE: This file was partially overwritten. Only createManualBooking function is present.
// Other functions need to be restored from backup or re-implemented.
// Functions needed: getAllUsers, getUserDetails, updateUserRole, deactivateUser, 
// getPlatformStats, searchUsers, getRecentActivities, getRecentUsers, getRecentBookings,
// getAllPsychologists, createPsychologist, updatePsychologist, deletePsychologist,
// addNextDayAvailability, updateAllPsychologistsAvailability, createPsychologistPackages,
// checkMissingPackages, deletePackage, getStuckSlotLocks, createUser, updateUser, deleteUser,
// rescheduleSession, updateSessionPayment, updateSession, getPsychologistAvailabilityForReschedule,
// handleRescheduleRequest, getRescheduleRequests, approveAssessmentRescheduleRequest,
// getPsychologistCalendarEvents, checkCalendarSyncStatus

// Create manual booking (admin only - for edge cases)
// Rebuilt from scratch to match normal booking flow with proper error handling
const createManualBooking = async (req, res) => {
  // Track created resources for rollback on error
  let paymentRecord = null;
  let session = null;
  
  try {
    // ============================================
    // STEP 1: VALIDATE INPUT
    // ============================================
    const { 
      client_id, 
      psychologist_id, 
      package_id, 
      scheduled_date, 
      scheduled_time, 
      amount,
      payment_received_date,
      payment_method,
      notes 
    } = req.body;

    console.log('📝 [MANUAL BOOKING] Starting manual booking process:', {
      client_id,
      psychologist_id,
      package_id,
      scheduled_date,
      scheduled_time,
      amount
    });

    // Validate required fields
    if (!client_id || !psychologist_id || !scheduled_date || !scheduled_time || !amount) {
      return res.status(400).json(
        errorResponse('Missing required fields: client_id, psychologist_id, scheduled_date, scheduled_time, amount')
      );
    }

    if (!payment_received_date) {
      return res.status(400).json(
        errorResponse('payment_received_date is required for manual bookings')
      );
    }

    // ============================================
    // STEP 2: LOOKUP CLIENT (with fallback to user_id)
    // ============================================
    const clientIdForQuery = isNaN(client_id) ? client_id : parseInt(client_id);
    
    let { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*, user:users(email)')
      .eq('id', clientIdForQuery)
      .single();

    // Fallback: try user_id lookup if id lookup fails
    if (clientError || !client) {
      console.log('⚠️ [MANUAL BOOKING] Client not found by id, trying user_id lookup...');
      const { data: clientByUserId, error: userLookupError } = await supabaseAdmin
        .from('clients')
        .select('*, user:users(email)')
        .eq('user_id', clientIdForQuery)
        .single();

      if (clientByUserId && !userLookupError) {
        console.log('✅ [MANUAL BOOKING] Found client by user_id');
        client = clientByUserId;
      } else {
        console.error('❌ [MANUAL BOOKING] Client not found:', { client_id, clientIdForQuery });
        return res.status(404).json(
          errorResponse(`Client not found with id or user_id: ${client_id}`)
        );
      }
    }

    console.log('✅ [MANUAL BOOKING] Client found:', {
      clientId: client.id,
      clientEmail: client.user?.email,
      clientName: `${client.first_name} ${client.last_name}`
    });

    // ============================================
    // STEP 3: VALIDATE PSYCHOLOGIST
    // ============================================
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('*, google_calendar_credentials')
      .eq('id', psychologist_id)
      .single();

    if (psychologistError || !psychologist) {
      console.error('❌ [MANUAL BOOKING] Psychologist not found:', psychologist_id);
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // ============================================
    // STEP 4: VALIDATE PACKAGE (if provided)
    // ============================================
    let packageData = null;
    if (package_id) {
      const { data: pkg, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', package_id)
        .single();

      if (packageError || !pkg) {
        console.error('❌ [MANUAL BOOKING] Package not found:', package_id);
        return res.status(404).json(
          errorResponse('Package not found')
        );
      }
      packageData = pkg;
    }

    // ============================================
    // STEP 5: CHECK SLOT AVAILABILITY
    // ============================================
    const availabilityService = require('../utils/availabilityCalendarService');
    console.log('🔍 [MANUAL BOOKING] Checking slot availability...');
    
    const isAvailable = await availabilityService.isTimeSlotAvailable(
      psychologist_id, 
      scheduled_date, 
      scheduled_time
    );

    if (!isAvailable) {
      console.log(`⚠️ [MANUAL BOOKING] Slot not available: ${psychologist_id} @ ${scheduled_date} ${scheduled_time}`);
      return res.status(400).json(
        errorResponse('This time slot is not available. Please select another time.')
      );
    }

    console.log('✅ [MANUAL BOOKING] Slot is available');

    // ============================================
    // STEP 6: CREATE PAYMENT RECORD
    // ============================================
    const transactionId = `MANUAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const normalizedPaymentMethod = (payment_method || 'cash').toLowerCase();

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        transaction_id: transactionId,
        session_id: null, // Will be set after session creation
        psychologist_id: psychologist_id,
        client_id: client.id,
        package_id: package_id || null,
        amount: amount,
        session_type: packageData ? 'package' : 'individual',
        status: 'success',
        payment_method: normalizedPaymentMethod,
        razorpay_params: {
          notes: {
            manual: true,
            payment_method: normalizedPaymentMethod,
            admin_created: true,
            created_by: req.user.id,
            created_at: new Date().toISOString(),
            payment_received_date: payment_received_date
          }
        },
        completed_at: payment_received_date,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (paymentError) {
      console.error('❌ [MANUAL BOOKING] Payment creation failed:', paymentError);
      return res.status(500).json(
        errorResponse('Failed to create payment record')
      );
    }

    paymentRecord = payment;
    console.log('✅ [MANUAL BOOKING] Payment record created:', payment.id);

    // ============================================
    // STEP 7: CREATE GOOGLE MEET LINK
    // ============================================
    const meetLinkService = require('../utils/meetLinkService');
    const { addMinutesToTime } = require('../utils/helpers');
    let meetData = null;

    try {
      console.log('🔄 [MANUAL BOOKING] Creating Google Meet link...');
      
      const sessionData = {
        summary: `Therapy Session - ${client.child_name || client.first_name} with ${psychologist.first_name}`,
        description: `Online therapy session between ${client.child_name || client.first_name} and ${psychologist.first_name} ${psychologist.last_name}`,
        startDate: scheduled_date,
        startTime: scheduled_time,
        endTime: addMinutesToTime(scheduled_time, 50)
      };
      
      // Try to use psychologist's OAuth credentials
      let userAuth = null;
      if (psychologist.google_calendar_credentials) {
        try {
          const credentials = typeof psychologist.google_calendar_credentials === 'string' 
            ? JSON.parse(psychologist.google_calendar_credentials) 
            : psychologist.google_calendar_credentials;
          
          const now = Date.now();
          const expiryDate = credentials.expiry_date;
          const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
          
          if (credentials.access_token) {
            if (!expiryDate || expiryDate > (now + bufferTime)) {
              userAuth = {
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token,
                expiry_date: credentials.expiry_date
              };
              console.log('✅ [MANUAL BOOKING] Using valid OAuth credentials');
            } else if (credentials.refresh_token) {
              userAuth = {
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token,
                expiry_date: credentials.expiry_date
              };
              console.log('⚠️ [MANUAL BOOKING] OAuth token expired, will attempt refresh');
            }
          }
        } catch (credError) {
          console.warn('⚠️ [MANUAL BOOKING] Error parsing OAuth credentials:', credError.message);
        }
      }
      
      const meetResult = await meetLinkService.generateSessionMeetLink(sessionData, userAuth);
      
      if (meetResult.success && meetResult.meetLink && !meetResult.meetLink.includes('meet.google.com/new')) {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || meetResult.calendarLink || null,
          method: meetResult.method
        };
        console.log('✅ [MANUAL BOOKING] Real Meet link created:', meetResult.method);
      } else {
        meetData = {
          meetLink: meetResult.meetLink || null,
          eventId: meetResult.eventId || null,
          calendarLink: meetResult.eventLink || meetResult.calendarLink || null,
          method: meetResult.method || 'fallback',
          requiresOAuth: meetResult.requiresOAuth || false
        };
        console.log('⚠️ [MANUAL BOOKING] Using fallback Meet link or OAuth required');
      }
    } catch (meetError) {
      console.error('❌ [MANUAL BOOKING] Meet link creation failed:', meetError);
      meetData = {
        meetLink: null,
        eventId: null,
        calendarLink: null,
        method: 'error'
      };
    }

    // ============================================
    // STEP 8: CREATE SESSION
    // ============================================
    const sessionData = {
      client_id: client.id,
      psychologist_id: psychologist_id,
      package_id: package_id || null,
      scheduled_date: scheduled_date,
      scheduled_time: scheduled_time,
      status: 'booked',
      payment_id: payment.id,
      price: amount,
      session_notes: notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      original_scheduled_date: scheduled_date
    };

    // Add Meet data if available
          if (meetData && meetData.eventId) {
            sessionData.google_calendar_event_id = meetData.eventId;
            if (meetData.meetLink && !meetData.meetLink.includes('meet.google.com/new')) {
              sessionData.google_meet_link = meetData.meetLink;
              sessionData.google_meet_join_url = meetData.meetLink;
              sessionData.google_meet_start_url = meetData.meetLink;
            }
            if (meetData.calendarLink) {
              sessionData.google_calendar_link = meetData.calendarLink;
            }
          }

    const { data: createdSession, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      console.error('❌ [MANUAL BOOKING] Session creation failed:', sessionError);
      
      // Check for unique constraint violation (double booking)
        const isUniqueViolation = 
          sessionError.code === '23505' || 
          sessionError.message?.toLowerCase().includes('unique') || 
          sessionError.message?.toLowerCase().includes('duplicate') ||
          sessionError.hint?.toLowerCase().includes('unique');
        
        if (isUniqueViolation) {
        console.log('⚠️ [MANUAL BOOKING] Double booking detected');
        // Rollback payment
        if (paymentRecord) {
          await supabaseAdmin.from('payments').delete().eq('id', paymentRecord.id);
        }
          return res.status(409).json(
            errorResponse('This time slot was just booked by another user. Please select another time.')
          );
        }
        
      // Rollback payment on other errors
      if (paymentRecord) {
      await supabaseAdmin.from('payments').delete().eq('id', paymentRecord.id);
      }
      return res.status(500).json(
        errorResponse('Failed to create session')
      );
    }

    session = createdSession;
    console.log('✅ [MANUAL BOOKING] Session created:', session.id);

    // ============================================
    // STEP 9: UPDATE AVAILABILITY
    // ============================================
    try {
      await availabilityService.updateAvailabilityOnBooking(
        psychologist_id,
        scheduled_date,
        scheduled_time
      );
      console.log('✅ [MANUAL BOOKING] Availability updated');
    } catch (blockErr) {
      console.warn('⚠️ [MANUAL BOOKING] Failed to update availability:', blockErr?.message);
      // Continue - availability update failure is not critical
    }

    // ============================================
    // STEP 10: UPDATE PAYMENT WITH SESSION ID
    // ============================================
    await supabaseAdmin
      .from('payments')
      .update({ session_id: session.id })
      .eq('id', payment.id);

    // ============================================
    // STEP 11: HANDLE CLIENT PACKAGE (if package booking)
    // ============================================
    if (package_id && packageData) {
      try {
        const { data: existingClientPackage } = await supabaseAdmin
          .from('client_packages')
          .select('*')
          .eq('client_id', client.id)
          .eq('package_id', package_id)
          .eq('status', 'active')
          .single();

        if (existingClientPackage) {
          await supabaseAdmin
            .from('client_packages')
            .update({
              remaining_sessions: existingClientPackage.remaining_sessions - 1
            })
            .eq('id', existingClientPackage.id);
          console.log('✅ [MANUAL BOOKING] Updated existing client package');
        } else {
          const clientPackageData = {
            client_id: client.id,
            psychologist_id: psychologist_id,
            package_id: package_id,
            package_type: packageData.package_type,
            total_sessions: packageData.session_count,
            remaining_sessions: packageData.session_count - 1,
            total_amount: packageData.price,
            amount_paid: packageData.price,
            status: 'active',
            purchased_at: payment_received_date,
            first_session_id: session.id
          };

          await supabaseAdmin
            .from('client_packages')
            .insert([clientPackageData]);
          console.log('✅ [MANUAL BOOKING] Created new client package');
        }
      } catch (packageError) {
        console.error('❌ [MANUAL BOOKING] Error handling client package:', packageError);
        // Continue - package handling failure is not critical
      }
    }

    // ============================================
    // STEP 12: SEND NOTIFICATIONS (non-blocking)
    // ============================================
    // Send notifications asynchronously - don't block response
    (async () => {
      try {
        // Email notifications
        const emailService = require('../utils/emailService');
      const emailClientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
      const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`.trim();

      await emailService.sendSessionConfirmation({
        clientName: emailClientName,
        psychologistName: psychologistName,
        sessionDate: scheduled_date,
        sessionTime: scheduled_time,
        sessionDuration: '60 minutes',
        clientEmail: client.user?.email,
        psychologistEmail: psychologist.email,
        googleMeetLink: meetData?.meetLink,
        meetLink: meetData?.meetLink,
        sessionId: session.id,
        transactionId: transactionId,
        amount: amount,
        price: amount,
          status: 'booked',
        psychologistId: psychologist_id,
        clientId: client.id
      });
        console.log('✅ [MANUAL BOOKING] Email notifications sent');
    } catch (emailError) {
        console.error('❌ [MANUAL BOOKING] Email notification failed:', emailError);
    }

    try {
        // WhatsApp notifications
      const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
      
      const clientName = (client.child_name && 
        client.child_name.trim() !== '' && 
        client.child_name.toLowerCase() !== 'pending')
        ? client.child_name
        : `${client.first_name || ''} ${client.last_name || ''}`.trim();
      const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`.trim();

        // Send to client
      if (client.phone_number) {
        if (meetData?.meetLink && !meetData.meetLink.includes('meet.google.com/new')) {
          const childName = client.child_name && 
            client.child_name.trim() !== '' && 
            client.child_name.toLowerCase() !== 'pending'
            ? client.child_name 
            : null;
          
            await sendBookingConfirmation(client.phone_number, {
            childName: childName,
            date: scheduled_date,
            time: scheduled_time,
            meetLink: meetData.meetLink,
            psychologistName: psychologistName,
            clientName: clientName
            });
        } else {
            const sessionDateTime = new Date(`${scheduled_date}T${scheduled_time}`).toLocaleString('en-IN', { 
              timeZone: 'Asia/Kolkata',
              dateStyle: 'long',
              timeStyle: 'short'
            });
            const message = `🎉 Your session with Dr. ${psychologistName} is confirmed!\n\n` +
              `📅 Date: ${sessionDateTime}\n\n` +
            `We look forward to seeing you!`;
            await sendWhatsAppTextWithRetry(client.phone_number, message);
        }
          console.log('✅ [MANUAL BOOKING] WhatsApp sent to client');
      }

        // Send to psychologist
      if (psychologist.phone) {
        const { formatFriendlyTime } = require('../utils/whatsappService');
        const formatBookingDateShort = (dateStr) => {
          if (!dateStr) return '';
          try {
            const d = new Date(`${dateStr}T00:00:00+05:30`);
            return d.toLocaleDateString('en-IN', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              timeZone: 'Asia/Kolkata'
            });
          } catch {
            return dateStr;
          }
        };
        
        const bullet = '•⁠  ⁠';
        const formattedDate = formatBookingDateShort(scheduled_date);
        const formattedTime = formatFriendlyTime(scheduled_time);
        const supportPhone = process.env.SUPPORT_PHONE || process.env.COMPANY_PHONE || '+91 95390 07766';
        
        const meetLinkLine = meetData?.meetLink && !meetData.meetLink.includes('meet.google.com/new')
          ? `Join link:\n${meetData.meetLink}\n\n`
            : `Join link: Will be shared shortly\n\n`;
        
          const message =
          `Hey 👋\n\n` +
          `New session booked with Little Care.\n\n` +
          `${bullet}Client: ${clientName}\n` +
          `${bullet}Date: ${formattedDate}\n` +
          `${bullet}Time: ${formattedTime} (IST)\n\n` +
          meetLinkLine +
          `Please be ready 5 mins early.\n\n` +
          `For help: ${supportPhone}\n\n` +
          `— Little Care 💜`;
        
          await sendWhatsAppTextWithRetry(psychologist.phone, message);
          console.log('✅ [MANUAL BOOKING] WhatsApp sent to psychologist');
      }
    } catch (whatsappError) {
        console.error('❌ [MANUAL BOOKING] WhatsApp notification failed:', whatsappError);
      }

      // Check for immediate reminder
      try {
        const sessionReminderService = require('../services/sessionReminderService');
        sessionReminderService.checkAndSendReminderForSessionId(session.id).catch(err => {
          console.error('❌ [MANUAL BOOKING] Reminder check failed:', err);
        });
      } catch (reminderError) {
        console.error('❌ [MANUAL BOOKING] Reminder check error:', reminderError);
      }
    })();

    // ============================================
    // STEP 13: FETCH COMPLETE SESSION FOR RESPONSE
    // ============================================
    const { data: completeSession } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        client:clients(
          id,
          first_name,
          last_name,
          child_name,
          phone_number,
          user:users(email)
        ),
        psychologist:psychologists(
          id,
          first_name,
          last_name,
          email
        ),
        package:packages(*)
      `)
      .eq('id', session.id)
      .single();

    console.log('✅ [MANUAL BOOKING] Manual booking created successfully');

    // Return success response
    return res.status(201).json(
      successResponse(completeSession || session, 'Manual booking created successfully')
    );

  } catch (error) {
    console.error('❌ [MANUAL BOOKING] Unexpected error:', error);
    
    // Rollback any created resources
    if (session) {
      try {
        await supabaseAdmin.from('sessions').delete().eq('id', session.id);
        console.log('🔄 [MANUAL BOOKING] Rolled back session');
      } catch (rollbackError) {
        console.error('❌ [MANUAL BOOKING] Failed to rollback session:', rollbackError);
      }
    }
    
    if (paymentRecord) {
      try {
        await supabaseAdmin.from('payments').delete().eq('id', paymentRecord.id);
        console.log('🔄 [MANUAL BOOKING] Rolled back payment');
      } catch (rollbackError) {
        console.error('❌ [MANUAL BOOKING] Failed to rollback payment:', rollbackError);
      }
    }
    
    return res.status(500).json(
      errorResponse('Internal server error while creating manual booking')
    );
  }
};

// ============================================
// STUB FUNCTIONS - Need to be restored from backup
// ============================================
// These are minimal implementations to allow server to start
// Full implementations need to be restored

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, role, search } = req.query;
    const offset = (page - 1) * limit;
    
    // For clients, we need to join with the clients table to get name information
    if (role === 'client') {
      // Query clients table and join with users table
    let query = supabaseAdmin
        .from('clients')
        .select(`
          id,
          first_name,
          last_name,
          phone_number,
          child_name,
          child_age,
          created_at,
          user_id,
          users:user_id (
            id,
            email,
            role,
            profile_picture_url,
            created_at
          )
        `, { count: 'exact' });
      
      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,child_name.ilike.%${search}%`);
      }
      
      query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });
      
      const { data, error, count } = await query;
      
      if (error) {
        console.error('Error fetching clients:', error);
        return res.status(500).json(errorResponse('Failed to fetch users'));
      }
      
      // Transform the data to match expected format
      const transformedUsers = (data || []).map(client => {
        const user = client.users || {};
        return {
          id: user.id || client.user_id,
          email: user.email || '',
          role: user.role || 'client',
          profile_picture_url: user.profile_picture_url || null,
          created_at: user.created_at || client.created_at,
          profile: {
            first_name: client.first_name || '',
            last_name: client.last_name || '',
            phone_number: client.phone_number || null,
            child_name: client.child_name || null,
            child_age: client.child_age || null
          },
          // Add name field for easy access
          name: client.first_name && client.last_name 
            ? `${client.first_name} ${client.last_name}`.trim()
            : client.first_name || client.child_name || 'No Name'
        };
      });
      
      return res.json(successResponse({ 
        users: transformedUsers, 
        total: count, 
        page: parseInt(page), 
        limit: parseInt(limit),
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil((count || 0) / parseInt(limit))
        }
      }));
    } else {
      // For non-client roles, query users table directly
      let query = supabaseAdmin.from('users').select('*', { count: 'exact' });
      
      if (role) query = query.eq('role', role);
      if (search) {
        query = query.or(`email.ilike.%${search}%`);
      }
      
      query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });
      
      const { data, error, count } = await query;
      
      if (error) {
        return res.status(500).json(errorResponse('Failed to fetch users'));
      }
      
      // Transform users to include name field
      const transformedUsers = (data || []).map(user => ({
        ...user,
        name: user.first_name && user.last_name 
          ? `${user.first_name} ${user.last_name}`.trim()
          : user.first_name || user.email?.split('@')[0] || 'No Name'
      }));
      
      return res.json(successResponse({ 
        users: transformedUsers, 
        total: count, 
        page: parseInt(page), 
        limit: parseInt(limit),
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil((count || 0) / parseInt(limit))
        }
      }));
    }
  } catch (error) {
    console.error('Get all users error:', error);
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
    if (error || !data) {
      return res.status(404).json(errorResponse('User not found'));
    }
    return res.json(successResponse(data));
  } catch (error) {
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_role } = req.body;

    if (!new_role || !['client', 'psychologist', 'admin', 'superadmin', 'finance'].includes(new_role)) {
      return res.status(400).json(
        errorResponse('Valid new role is required')
      );
    }

    // CRITICAL FIX: TOCTOU protection - Re-verify admin role from DB before operation
    const { data: freshAdminUser } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!freshAdminUser || (freshAdminUser.role !== 'admin' && freshAdminUser.role !== 'superadmin')) {
      return res.status(403).json(
        errorResponse('Privilege revoked. Admin access required.')
      );
    }

    // Check if user exists
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('role, email')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json(
        errorResponse('User not found')
      );
    }

    // Prevent changing superadmin role
    if (user.role === 'superadmin') {
      return res.status(403).json(
        errorResponse('Cannot change superadmin role')
      );
    }

    // Update user role
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update({
        role: new_role,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('id, email, role, updated_at')
      .single();

    if (error) {
      console.error('Update user role error:', error);
      return res.status(500).json(
        errorResponse('Failed to update user role')
      );
    }

    // Audit log the role change
    const auditLogger = require('../utils/auditLogger');
    await auditLogger.logRequest(req, 'UPDATE_USER_ROLE', 'user', userId, {
      oldRole: user.role,
      newRole: new_role,
      targetUserEmail: user.email
    });

    // If role is being changed to/from admin, revoke all user tokens for security
    if (user.role === 'admin' || new_role === 'admin' || user.role === 'superadmin' || new_role === 'superadmin') {
      const tokenRevocationService = require('../utils/tokenRevocation');
      await tokenRevocationService.revokeUserTokens(userId);
      console.log(`🔒 Revoked all tokens for user ${userId} due to role change`);
    }

    res.json(
      successResponse(updatedUser, 'User role updated successfully')
    );

  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating user role')
    );
  }
};

const deactivateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const auditLogger = require('../utils/auditLogger');
    const tokenRevocationService = require('../utils/tokenRevocation');

    // CRITICAL FIX: TOCTOU protection - Re-verify admin role from DB before operation
    const { data: freshAdminUser } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!freshAdminUser || (freshAdminUser.role !== 'admin' && freshAdminUser.role !== 'superadmin')) {
      return res.status(403).json(
        errorResponse('Privilege revoked. Admin access required.')
      );
    }

    // Check if user exists
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('role, email')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json(
        errorResponse('User not found')
      );
    }

    // Prevent deactivating superadmin
    if (user.role === 'superadmin') {
      return res.status(403).json(
        errorResponse('Cannot deactivate superadmin')
      );
    }

    // Revoke all tokens for the deactivated user
    await tokenRevocationService.revokeUserTokens(userId);

    // For now, we'll just update the user to indicate deactivation
    // In a real system, you might want to add a status field or move to archive table
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update({
        updated_at: new Date().toISOString()
        // Add deactivation logic here
      })
      .eq('id', userId)
      .select('id, email, role, updated_at')
      .single();

    if (error) {
      console.error('Deactivate user error:', error);
      return res.status(500).json(
        errorResponse('Failed to deactivate user')
      );
    }

    // Audit log the deactivation
    await auditLogger.logRequest(req, 'DEACTIVATE_USER', 'user', userId, {
      reason: reason || 'No reason provided',
      targetUserEmail: user.email,
      targetUserRole: user.role
    });

    res.json(
      successResponse(updatedUser, 'User deactivated successfully')
    );

  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deactivating user')
    );
  }
};

const getPlatformStats = async (req, res) => {
  try {
    // Count only clients (users with role 'client' or users that exist in clients table)
    const [clientsCount, psychologistsCount, sessionsCount] = await Promise.all([
      supabaseAdmin.from('clients').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('psychologists').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('sessions').select('id', { count: 'exact', head: true })
    ]);
    
    return res.json(successResponse({
      totalUsers: clientsCount.count || 0, // Changed to count only clients
      totalClients: clientsCount.count || 0, // Added explicit totalClients field
      totalPsychologists: psychologistsCount.count || 0,
      totalSessions: sessionsCount.count || 0
    }));
  } catch (error) {
    console.error('Error getting platform stats:', error);
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

const searchUsers = async (req, res) => {
  try {
    // HIGH-RISK FIX: Parameter pollution defense - normalize query params (reject arrays)
    const normalizeParam = (param) => {
      if (Array.isArray(param)) {
        return null; // Reject arrays
      }
      return param;
    };

    const searchQuery = normalizeParam(req.query.query);
    const page = normalizeParam(req.query.page) || 1;
    const limit = normalizeParam(req.query.limit) || 10;
    const role = normalizeParam(req.query.role);

    if (Array.isArray(req.query.query) || Array.isArray(req.query.role)) {
      return res.status(400).json(
        errorResponse('Invalid query parameters. Arrays not allowed.')
      );
    }

    if (!searchQuery) {
      return res.status(400).json(
        errorResponse('Search query is required')
      );
    }

    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    let supabaseQuery = supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        role,
        profile_picture_url,
        created_at,
        updated_at
      `);

    // Filter by role if provided
    if (role) {
      supabaseQuery = supabaseQuery.eq('role', role);
    }

    const { data: users, error } = await supabaseQuery;

    if (error) {
      console.error('Search users error:', error);
      return res.status(500).json(
        errorResponse('Failed to search users')
      );
    }

    // Filter by search query
    const query = searchQuery.toLowerCase();
    const filteredUsers = users.filter(user => 
      user.email.toLowerCase().includes(query) ||
      user.role.toLowerCase().includes(query)
    );

    // Add pagination
    const offset = (page - 1) * limit;
    const paginatedUsers = filteredUsers.slice(offset, offset + limit);

    res.json(
      successResponse({
        users: paginatedUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: filteredUsers.length
        }
      })
    );

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json(
      errorResponse('Internal server error while searching users')
    );
  }
};

const getRecentActivities = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const getRecentUsers = async (req, res) => {
  try {
    const { data } = await supabaseAdmin.from('users').select('*').order('created_at', { ascending: false }).limit(10);
    return res.json(successResponse(data || []));
  } catch (error) {
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

const getRecentBookings = async (req, res) => {
  try {
    const { data } = await supabaseAdmin.from('sessions').select('*').order('created_at', { ascending: false }).limit(10);
    return res.json(successResponse(data || []));
  } catch (error) {
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

const getAllPsychologists = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('psychologists').select('*').order('display_order', { ascending: true, nullsLast: true });
    
    if (error) {
      console.error('Error fetching psychologists:', error);
      return res.status(500).json(errorResponse('Failed to fetch psychologists'));
    }
    
    // Transform data to include name field for easier frontend consumption
    const transformedData = (data || []).map(psychologist => {
      const firstName = psychologist.first_name || '';
      const lastName = psychologist.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim() || psychologist.email?.split('@')[0] || 'No Name';
      
      return {
        ...psychologist,
        name: fullName,
        psychologist_id: psychologist.id, // Add psychologist_id for compatibility
        id: psychologist.id
      };
    });
    
    console.log(`✅ [ADMIN] Fetched ${transformedData.length} psychologists`);
    return res.json(successResponse(transformedData));
  } catch (error) {
    console.error('Error in getAllPsychologists:', error);
    return res.status(500).json(errorResponse('Internal server error'));
  }
};

const createPsychologist = async (req, res) => {
  try {
    console.log('=== createPsychologist function called ===');
    console.log('Request body:', req.body);
    let { 
      email, 
      password, 
      first_name, 
      last_name, 
      phone, 
      ug_college, 
      pg_college, 
      mphil_college,
      phd_college, 
      area_of_expertise, 
      description, 
      experience_years, 
      availability,
      packages, // New field for dynamic packages
      price, // Individual session price
      cover_image_url, // Doctor's profile image
      personality_traits, // NEW: array of strings like ['Happy','Energetic']
      display_order, // Display order for sorting
      faq_question_1,
      faq_answer_1,
      faq_question_2,
      faq_answer_2,
      faq_question_3,
      faq_answer_3
    } = req.body;

    // Keep email as-is (don't normalize dots away)
    if (typeof email === 'string') {
      email = email.trim().toLowerCase();
    }

    // Check if psychologist already exists with this email
    const { data: existingPsychologist } = await supabaseAdmin
      .from('psychologists')
      .select('id')
      .eq('email', email)
      .single();

    if (existingPsychologist) {
      return res.status(400).json(
        errorResponse('Psychologist with this email already exists')
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create psychologist directly in psychologists table (standalone)
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .insert([{
        email,
        password_hash: hashedPassword,
        first_name,
        last_name,
        phone,
        ug_college,
        pg_college,
        mphil_college,
        phd_college,
        area_of_expertise,
        personality_traits, // NEW
        description,
        experience_years: experience_years || 0,
        individual_session_price: price ? parseInt(price) : null,
        cover_image_url: cover_image_url || null,
        display_order: display_order ? parseInt(display_order) : null,
        faq_question_1: faq_question_1 || null,
        faq_answer_1: faq_answer_1 || null,
        faq_question_2: faq_question_2 || null,
        faq_answer_2: faq_answer_2 || null,
        faq_question_3: faq_question_3 || null,
        faq_answer_3: faq_answer_3 || null,
        active: true // New psychologists are active by default
      }])
      .select('*')
      .single();

    if (psychologistError) {
      console.error('Psychologist creation error:', psychologistError);
      return res.status(500).json(
        errorResponse('Failed to create psychologist')
      );
    }

    // Always create individual session option first
    const individualSession = {
      psychologist_id: psychologist.id,
      package_type: 'individual',
      name: 'Single Session',
      description: 'One therapy session',
      session_count: 1,
      price: 100, // Default price, can be customized
      discount_percentage: 0
    };

    // Create dynamic packages for the psychologist based on admin selection
    if (packages && Array.isArray(packages) && packages.length > 0) {
      try {
        console.log('📦 Creating custom packages:', packages);
        
        const packageData = packages.map(pkg => ({
          psychologist_id: psychologist.id,
          package_type: pkg.package_type || `package_${pkg.session_count}`,
          name: pkg.name || `Package of ${pkg.session_count} Sessions`,
          description: pkg.description || `${pkg.session_count} therapy sessions${pkg.discount_percentage > 0 ? ` with ${pkg.discount_percentage}% discount` : ''}`,
          session_count: pkg.session_count,
          price: pkg.price,
          discount_percentage: pkg.discount_percentage || 0
        }));

        const { error: packagesError } = await supabaseAdmin
          .from('packages')
          .insert(packageData);

        if (packagesError) {
          console.error('Custom packages creation error:', packagesError);
          // Continue without packages if it fails
        } else {
          console.log('✅ Custom packages created successfully');
          console.log('   - Packages created:', packageData.length);
          packageData.forEach(pkg => {
            console.log(`     • ${pkg.name}: ${pkg.session_count} sessions, $${pkg.price}`);
          });
        }
      } catch (packagesError) {
        console.error('Exception while creating custom packages:', packagesError);
        // Continue without packages if it fails
      }
    } else {
      console.log('📦 No packages specified - psychologist will have no packages initially');
    }

    // Set default availability (10 AM to 12 PM and 2 PM to 5 PM for 3 weeks)
    // This will only add dates that don't already exist
    try {
      const defaultAvailabilityService = require('../utils/defaultAvailabilityService');
      const defaultAvailResult = await defaultAvailabilityService.setDefaultAvailability(psychologist.id);
      if (defaultAvailResult.success) {
        console.log(`✅ Default availability set for psychologist ${psychologist.id}: ${defaultAvailResult.message}`);
      } else {
        console.warn(`⚠️ Failed to set default availability: ${defaultAvailResult.message}`);
      }
    } catch (defaultAvailError) {
      console.error('Error setting default availability:', defaultAvailError);
      // Continue even if default availability fails
    }

    // Handle custom availability if provided (allows doctors to remove/block slots)
    if (availability && availability.length > 0) {
      try {
        const availabilityRecords = [];
        availability.forEach(item => {
          // Only create availability for the next occurrence of the selected day (not 2 weeks)
          const dates = getAvailabilityDatesForDay(item.day, 1); // Create availability for only 1 occurrence
          dates.forEach(date => {
            // Only save if there are actual time slots
            if (item.slots && item.slots.length > 0) {
              // Use local date formatting to avoid timezone conversion issues
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const dateString = `${year}-${month}-${day}`;
              
              // Update existing availability or create new one
              availabilityRecords.push({
                psychologist_id: psychologist.id,
                date: dateString, // Use local date formatting
                time_slots: item.slots // Direct array of time strings as expected by validation
              });
            }
          });
        });

        if (availabilityRecords.length > 0) {
          // Use upsert to update existing or create new
          for (const record of availabilityRecords) {
            const { data: existing } = await supabaseAdmin
            .from('availability')
              .select('id')
              .eq('psychologist_id', record.psychologist_id)
              .eq('date', record.date)
              .single();

            if (existing) {
              // Update existing
              await supabaseAdmin
                .from('availability')
                .update({
                  time_slots: record.time_slots,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);
            } else {
              // Insert new
              await supabaseAdmin
                .from('availability')
                .insert(record);
            }
          }
        }
      } catch (availabilityError) {
        console.error('Exception while creating custom availability:', availabilityError);
        // Continue without custom availability if it fails
      }
    }

    res.status(201).json(
      successResponse({
        psychologist: {
          id: psychologist.id,
          email: psychologist.email,
          first_name: psychologist.first_name,
          last_name: psychologist.last_name,
          phone: psychologist.phone,
          ug_college: psychologist.ug_college,
          pg_college: psychologist.pg_college,
          mphil_college: psychologist.mphil_college,
          phd_college: psychologist.phd_college,
          area_of_expertise: psychologist.area_of_expertise,
          description: psychologist.description,
          experience_years: psychologist.experience_years
        }
      }, 'Psychologist created successfully')
    );

  } catch (error) {
    console.error('Create psychologist error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating psychologist')
    );
  }
};

const updatePsychologist = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const updateData = req.body;

    console.log('📝 [ADMIN] Updating psychologist:', psychologistId);
    console.log('📦 [ADMIN] Update data keys:', Object.keys(updateData));

    // Get psychologist profile
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('*')
      .eq('id', psychologistId)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Remove fields that are not in the psychologists table
    // Capture password separately so we can update the linked user record
    // Also remove deletePackages flag (it's not a database column, just a control flag)
    const { price, availability, packages, password, deletePackages, ...psychologistUpdateData } = updateData;
    
    // Explicitly remove deletePackages if it somehow got through (safety check)
    delete psychologistUpdateData.deletePackages;
    
    // Convert display_order to integer if provided
    if (psychologistUpdateData.display_order !== undefined) {
      psychologistUpdateData.display_order = psychologistUpdateData.display_order ? parseInt(psychologistUpdateData.display_order) : null;
    }

    // Remove undefined/null values from update data
    Object.keys(psychologistUpdateData).forEach(key => {
      if (psychologistUpdateData[key] === undefined || psychologistUpdateData[key] === null) {
        delete psychologistUpdateData[key];
      }
    });

    // Only update fields that have actually changed (compare with existing values)
    const optimizedUpdateData = {};
    Object.keys(psychologistUpdateData).forEach(key => {
      const newValue = psychologistUpdateData[key];
      const existingValue = psychologist[key];
      
      // Compare values (handle different types)
      if (newValue !== existingValue) {
        // Special handling for arrays/objects (convert to JSON for comparison)
        if (Array.isArray(newValue) || Array.isArray(existingValue)) {
          if (JSON.stringify(newValue) !== JSON.stringify(existingValue)) {
            optimizedUpdateData[key] = newValue;
          }
        } else if (typeof newValue === 'object' && typeof existingValue === 'object' && newValue !== null && existingValue !== null) {
          if (JSON.stringify(newValue) !== JSON.stringify(existingValue)) {
            optimizedUpdateData[key] = newValue;
          }
        } else {
          optimizedUpdateData[key] = newValue;
        }
      }
    });

    // Only update psychologist profile if there are fields to update
    let updatedPsychologist = psychologist; // Default to existing psychologist data
    
    // Check if there are any fields to update (besides updated_at)
    const hasFieldsToUpdate = Object.keys(optimizedUpdateData).length > 0;

    if (hasFieldsToUpdate) {
      // Add updated_at timestamp
      optimizedUpdateData.updated_at = new Date().toISOString();
      
      // Update psychologist profile
      const { data: updatedData, error: updateError } = await supabaseAdmin
        .from('psychologists')
        .update(optimizedUpdateData)
        .eq('id', psychologistId)
        .select('*')
        .single();

      if (updateError) {
        console.error('Update psychologist error:', updateError);
        // If error is PGRST116 (0 rows), it means the update didn't affect any rows
        // This can happen if the update data is invalid or the row doesn't exist
        if (updateError.code === 'PGRST116') {
          console.error('Update returned 0 rows - psychologist may not exist or update data is invalid');
          return res.status(404).json(
            errorResponse('Psychologist not found or update data is invalid')
          );
        }
        return res.status(500).json(
          errorResponse('Failed to update psychologist profile')
        );
      }
      
      if (updatedData) {
        updatedPsychologist = updatedData;
      }
    } else {
      console.log('No psychologist profile fields to update, skipping profile update');
    }

    // If admin requested a password change, update the linked user password
    if (password && typeof password === 'string' && password.trim().length > 0) {
      try {
        let targetUserId = psychologist.user_id;

        if (password.length < 6) {
          return res.status(400).json(
            errorResponse('New password must be at least 6 characters long')
          );
        }

        // If no linked user_id, try to resolve by email
        if (!targetUserId) {
          const latestEmail = psychologistUpdateData.email || updatedPsychologist.email || psychologist.email;
          if (!latestEmail) {
            console.error('Password update requested but no email available to resolve user');
            // Skip password update but continue with other updates
          } else {
            const { data: userByEmail, error: userLookupError } = await supabaseAdmin
              .from('users')
              .select('id, email')
              .eq('email', latestEmail)
              .single();

            if (userLookupError || !userByEmail) {
              // Create a new user for this psychologist using the provided password
              const hashedPasswordForCreate = await hashPassword(password);
              const { data: newUser, error: createUserError } = await supabaseAdmin
                .from('users')
                .insert([{ email: latestEmail, password_hash: hashedPasswordForCreate, role: 'psychologist' }])
                .select('id')
                .single();

              if (createUserError || !newUser) {
                console.warn('Password update requested but user not found and could not create user. Skipping password update:', latestEmail, createUserError);
              } else {
                targetUserId = newUser.id;
                // Backfill psychologists.user_id for future updates
                await supabaseAdmin
                  .from('psychologists')
                  .update({ user_id: targetUserId, updated_at: new Date().toISOString() })
                  .eq('id', psychologistId);
              }
            } else {
              targetUserId = userByEmail.id;
              // Backfill psychologists.user_id for future updates
              await supabaseAdmin
                .from('psychologists')
                .update({ user_id: targetUserId, updated_at: new Date().toISOString() })
                .eq('id', psychologistId);
            }
          }
        }

        if (targetUserId) {
          const hashedPassword = await hashPassword(password);
          // Update linked user account (if present)
          const { error: userPasswordUpdateError } = await supabaseAdmin
            .from('users')
            .update({ password_hash: hashedPassword, updated_at: new Date().toISOString() })
            .eq('id', targetUserId);

          if (userPasswordUpdateError) {
            console.error('❌ Error updating user password:', userPasswordUpdateError);
          }

          // Ensure psychologist can login with the new password as well
          const { error: psychPwUpdateError } = await supabaseAdmin
            .from('psychologists')
            .update({ password_hash: hashedPassword, updated_at: new Date().toISOString() })
            .eq('id', psychologistId);

          if (psychPwUpdateError) {
            console.error('❌ Error updating psychologist password_hash:', psychPwUpdateError);
          }
        }
      } catch (pwError) {
        console.error('❌ Exception during password update:', pwError);
        // Skip password update exception but continue with profile update
      }
    }

    // Handle individual price by storing it in the dedicated field
    if (price !== undefined) {
      console.log('💰 Individual price provided:', price);
      console.log('💰 Psychologist ID:', psychologistId);
      console.log('💰 Price type:', typeof price);
      console.log('💰 Parsed price:', parseInt(price));
      
      try {
        // Store price in the dedicated individual_session_price field (as integer)
        const { error: priceUpdateError } = await supabaseAdmin
          .from('psychologists')
          .update({ individual_session_price: parseInt(price) })
          .eq('id', psychologistId);

        if (priceUpdateError) {
          console.error('❌ Error updating individual_session_price:', priceUpdateError);
        } else {
          console.log('✅ Individual session price updated successfully');
          // Update the local copy for response
          updatedPsychologist.individual_session_price = parseInt(price);
        }
      } catch (priceError) {
        console.error('❌ Exception during price update:', priceError);
        // Continue even if price update fails
      }
    }

    // Handle packages if provided
    if (updateData.packages && Array.isArray(updateData.packages)) {
      try {
        // Get existing packages for this psychologist
        const { data: existingPackages } = await supabaseAdmin
          .from('packages')
          .select('id')
          .eq('psychologist_id', psychologistId);

        const existingPackageIds = (existingPackages || []).map(p => p.id);

        // Delete packages if deletePackages flag is set
        if (updateData.deletePackages) {
          const packagesToKeep = updateData.packages
            .filter(pkg => pkg.id && !pkg.id.toString().startsWith('pkg-'))
            .map(pkg => pkg.id);
          
          const packagesToDelete = existingPackageIds.filter(id => !packagesToKeep.includes(id));
          
          if (packagesToDelete.length > 0) {
            await supabaseAdmin
              .from('packages')
              .delete()
              .eq('psychologist_id', psychologistId)
              .in('id', packagesToDelete);
            console.log(`✅ [ADMIN] Deleted ${packagesToDelete.length} packages`);
          }
        }

        // Process each package (create or update)
        for (const pkg of updateData.packages) {
          if (!pkg.name || !pkg.price || !pkg.sessions) continue;

          const packageData = {
            psychologist_id: psychologistId,
            package_type: pkg.sessions > 1 ? 'multi_session' : 'individual',
            session_count: pkg.sessions,
            price: parseFloat(pkg.price),
            name: pkg.name,
            updated_at: new Date().toISOString()
          };

          // If package has an ID (not a temp ID), update it
          if (pkg.id && !pkg.id.toString().startsWith('pkg-')) {
            const { error: packageUpdateError } = await supabaseAdmin
              .from('packages')
              .update(packageData)
              .eq('id', pkg.id)
              .eq('psychologist_id', psychologistId);

            if (packageUpdateError) {
              console.error('❌ [ADMIN] Error updating package:', packageUpdateError);
            } else {
              console.log(`✅ [ADMIN] Updated package: ${pkg.id}`);
            }
          } else {
            // Create new package
            packageData.created_at = new Date().toISOString();
            const { error: packageCreateError } = await supabaseAdmin
              .from('packages')
              .insert([packageData]);

            if (packageCreateError) {
              console.error('❌ [ADMIN] Error creating package:', packageCreateError);
            } else {
              console.log(`✅ [ADMIN] Created new package for psychologist`);
            }
          }
        }
      } catch (packageError) {
        console.error('❌ [ADMIN] Error handling packages:', packageError);
        // Continue - package errors shouldn't block psychologist update
      }
    }

    // Handle availability if provided
    if (updateData.availability && Array.isArray(updateData.availability)) {
      try {
        for (const avail of updateData.availability) {
          if (!avail.date || !avail.timeSlots) continue;

          // Convert timeSlots object to array format
          const timeSlotsArray = [
            ...(avail.timeSlots.morning || []),
            ...(avail.timeSlots.noon || []),
            ...(avail.timeSlots.evening || []),
            ...(avail.timeSlots.night || [])
          ];

          if (timeSlotsArray.length === 0) continue;

          // Check if availability already exists for this date
          const { data: existingAvailability } = await supabaseAdmin
            .from('availability')
            .select('id')
            .eq('psychologist_id', psychologistId)
            .eq('date', avail.date)
            .single();

          if (existingAvailability) {
            // Update existing availability
            await supabaseAdmin
              .from('availability')
              .update({
                time_slots: timeSlotsArray,
                is_available: true,
                updated_at: new Date().toISOString()
              })
              .eq('id', existingAvailability.id);
          } else {
            // Create new availability
            await supabaseAdmin
              .from('availability')
              .insert({
                psychologist_id: psychologistId,
                date: avail.date,
                time_slots: timeSlotsArray,
                is_available: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
          }
        }
        console.log(`✅ [ADMIN] Updated availability for ${updateData.availability.length} dates`);
      } catch (availabilityError) {
        console.error('❌ [ADMIN] Error handling availability:', availabilityError);
        // Continue - availability errors shouldn't block psychologist update
      }
    }

    console.log('✅ [ADMIN] Psychologist updated successfully');
    return res.json(successResponse(updatedPsychologist, 'Psychologist updated successfully'));

  } catch (error) {
    console.error('❌ [ADMIN] Error in updatePsychologist:', error);
    return res.status(500).json(errorResponse('Internal server error while updating psychologist'));
  }
};

const deletePsychologist = async (req, res) => {
  try {
    const { psychologistId } = req.params;

    // Check if psychologist exists
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('id')
      .eq('id', psychologistId)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Delete availability records first
    const { error: deleteAvailabilityError } = await supabaseAdmin
      .from('availability')
      .delete()
      .eq('psychologist_id', psychologistId);

    if (deleteAvailabilityError) {
      console.error('Delete availability error:', deleteAvailabilityError);
      // Continue with deletion even if availability deletion fails
    }

    // Delete psychologist profile
    const { error: deleteProfileError } = await supabaseAdmin
      .from('psychologists')
      .delete()
      .eq('id', psychologistId);

    if (deleteProfileError) {
      console.error('Delete psychologist profile error:', deleteProfileError);
      return res.status(500).json(
        errorResponse('Failed to delete psychologist profile')
      );
    }

    // Invalidate frontend cache when psychologist is deleted
    const cacheInvalidationTimestamp = Date.now();
    console.log('🔄 Cache invalidation triggered for psychologist deletion:', cacheInvalidationTimestamp);

    res.json(
      successResponse({
        deleted: true,
        cache_invalidated: true,
        cache_timestamp: cacheInvalidationTimestamp
      }, 'Psychologist deleted successfully')
    );

  } catch (error) {
    console.error('Delete psychologist error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting psychologist')
    );
  }
};

const addNextDayAvailability = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const updateAllPsychologistsAvailability = async (req, res) => {
  try {
    const defaultAvailabilityService = require('../utils/defaultAvailabilityService');
    const result = await defaultAvailabilityService.updateAllPsychologistsAvailability();
    if (result.success) {
      res.json(successResponse(result, `Updated ${result.updated} psychologists with default availability`));
    } else {
      res.status(500).json(errorResponse(result.message || 'Failed to update psychologists availability'));
    }
  } catch (error) {
    console.error('Error in updateAllPsychologistsAvailability endpoint:', error);
    res.status(500).json(errorResponse('Internal server error while updating psychologists availability'));
  }
};

const createPsychologistPackages = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const checkMissingPackages = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const deletePackage = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const getStuckSlotLocks = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const createUser = async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone_number, child_name, child_age } = req.body;

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json(
        errorResponse('User with this email already exists')
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user (use admin client to bypass RLS)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert([{
        email,
        password_hash: hashedPassword,
        role: 'client'
      }])
      .select('id, email, role, created_at')
      .single();

    if (userError) {
      console.error('User creation error:', userError);
      return res.status(500).json(
        errorResponse('Failed to create user account')
      );
    }

    // Create client profile (use admin client to bypass RLS)
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .insert([{
        user_id: user.id,
        first_name,
        last_name,
        phone_number,
        child_name,
        child_age
      }])
      .select('*')
      .single();

    if (clientError) {
      console.error('Client profile creation error:', clientError);
      // Delete user if profile creation fails
      await supabaseAdmin.from('users').delete().eq('id', user.id);
      return res.status(500).json(
        errorResponse('Failed to create client profile')
      );
    }

    console.log('✅ Client created:', {
      userId: user.id,
      clientId: client.id,
      email: user.email
    });

    res.status(201).json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          profile: client  // Contains client.id
        }
      }, 'Client created successfully')
    );

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating user')
    );
  }
};

const updateUser = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // CRITICAL FIX: TOCTOU protection - Re-verify admin role from DB before operation
    const { data: freshAdminUser } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!freshAdminUser || (freshAdminUser.role !== 'admin' && freshAdminUser.role !== 'superadmin')) {
      return res.status(403).json(
        errorResponse('Privilege revoked. Admin access required.')
      );
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json(
        errorResponse('User not found')
      );
    }

    // If client, delete all related data first
    if (user.role === 'client') {
      // Find client record (for new system, client.id != user.id)
      const { data: clientRecord } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      const clientId = clientRecord?.id || userId; // Fallback to userId for old system

      console.log(`🗑️  Deleting all related data for client_id: ${clientId}`);

      // 1. Delete messages (via conversations)
      const { data: conversations } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('client_id', clientId);

      if (conversations && conversations.length > 0) {
        const conversationIds = conversations.map(c => c.id);
        await supabaseAdmin
          .from('messages')
          .delete()
          .in('conversation_id', conversationIds);
        console.log(`   ✅ Deleted messages from ${conversations.length} conversation(s)`);
      }

      // 2. Delete conversations
      await supabaseAdmin
        .from('conversations')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted conversations`);

      // 3. Delete receipts (via sessions)
      const { data: sessions } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('client_id', clientId);

      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map(s => s.id);
        await supabaseAdmin
          .from('receipts')
          .delete()
          .in('session_id', sessionIds);
        console.log(`   ✅ Deleted receipts for ${sessions.length} session(s)`);
      }

      // 4. Delete payments
      await supabaseAdmin
        .from('payments')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted payments`);

      // 5. Delete sessions
      await supabaseAdmin
        .from('sessions')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted sessions`);

      // 6. Delete assessment sessions
      await supabaseAdmin
        .from('assessment_sessions')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted assessment sessions`);

      // 7. Delete free assessments
      await supabaseAdmin
        .from('free_assessments')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted free assessments`);

      // 8. Delete client packages
      await supabaseAdmin
        .from('client_packages')
        .delete()
        .eq('client_id', clientId);
      console.log(`   ✅ Deleted client packages`);

      // 9. Delete client profile
      const { error: deleteProfileError } = await supabaseAdmin
        .from('clients')
        .delete()
        .or(`id.eq.${clientId},user_id.eq.${userId}`); // Delete by either id or user_id

      if (deleteProfileError) {
        console.error('Delete client profile error:', deleteProfileError);
        return res.status(500).json(
          errorResponse('Failed to delete client profile')
        );
      }
      console.log(`   ✅ Deleted client profile`);
    }

    // Delete user account
    const { error: deleteUserError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteUserError) {
      console.error('Delete user error:', deleteUserError);
      return res.status(500).json(
        errorResponse('Failed to delete user account')
      );
    }

    console.log(`   ✅ Deleted user account`);

    res.json(
      successResponse(null, 'User and all related data deleted successfully')
    );

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json(
      errorResponse('Internal server error while deleting user')
    );
  }
};

const rescheduleSession = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const updateSessionPayment = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      psychologist_id,
      client_id,
      scheduled_date,
      scheduled_time,
      original_scheduled_date,
      status,
      price,
      payment_method,
      transaction_id,
      razorpay_order_id,
      razorpay_payment_id,
      notify_doctor
    } = req.body;

    if (!sessionId) {
      return res.status(400).json(errorResponse('Session ID is required'));
    }

    // Get current session to check if doctor changed
    const { data: currentSession, error: fetchError } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        psychologist:psychologists(id, first_name, last_name, email, phone),
        client:clients(id, first_name, last_name, child_name, phone_number)
      `)
      .eq('id', sessionId)
      .single();

    if (fetchError || !currentSession) {
      return res.status(404).json(errorResponse('Session not found'));
    }

    const originalPsychId = currentSession.psychologist_id;
    const doctorChanged = notify_doctor && psychologist_id && psychologist_id !== originalPsychId;

    // Prepare update data
    const updateData = {};
    if (psychologist_id) updateData.psychologist_id = psychologist_id;
    if (client_id) updateData.client_id = client_id; // Keep original client (read-only on frontend)
    if (scheduled_date) updateData.scheduled_date = scheduled_date;
    if (scheduled_time) updateData.scheduled_time = scheduled_time;
    if (original_scheduled_date !== undefined) {
      // Allow setting original_scheduled_date explicitly (for finance calculations)
      // If empty string, use scheduled_date as fallback
      updateData.original_scheduled_date = original_scheduled_date || scheduled_date || null;
    }
    if (status) updateData.status = status;
    if (price !== undefined) updateData.price = price ? parseFloat(price) : null;

    // Update session
    const { data: updatedSession, error: updateError } = await supabaseAdmin
      .from('sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select(`
        *,
        psychologist:psychologists(id, first_name, last_name, email, phone),
        client:clients(id, first_name, last_name, child_name, phone_number)
      `)
      .single();

    if (updateError) {
      console.error('Error updating session:', updateError);
      return res.status(500).json(errorResponse('Failed to update session'));
    }

    // Update payment details if provided
    if (payment_method || transaction_id || razorpay_order_id || razorpay_payment_id) {
      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (payment) {
        const paymentUpdate = {};
        if (payment_method) paymentUpdate.payment_method = payment_method;
        if (transaction_id !== undefined) paymentUpdate.transaction_id = transaction_id || null;
        if (razorpay_order_id !== undefined) paymentUpdate.razorpay_order_id = razorpay_order_id || null;
        if (razorpay_payment_id !== undefined) paymentUpdate.razorpay_payment_id = razorpay_payment_id || null;

        await supabaseAdmin
          .from('payments')
          .update(paymentUpdate)
          .eq('id', payment.id);
      }
    }

    // If doctor was changed, send notification to new doctor (async, don't wait)
    if (doctorChanged && updatedSession.psychologist) {
      (async () => {
        try {
          const { sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
          
          // Get meeting link from session
          const meetLink = updatedSession.google_meet_link || 
                          updatedSession.google_meet_join_url || 
                          updatedSession.google_calendar_link || 
                          null;

          // Get client name
          const clientName = updatedSession.client?.child_name || 
                            `${updatedSession.client?.first_name || ''} ${updatedSession.client?.last_name || ''}`.trim() ||
                            'Client';

          // Format date and time
          const formatBookingDateShort = (dateStr) => {
            if (!dateStr) return '';
            try {
              const d = new Date(`${dateStr}T00:00:00+05:30`);
              return d.toLocaleDateString('en-IN', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                timeZone: 'Asia/Kolkata'
              });
            } catch {
              return dateStr;
            }
          };

          const formatFriendlyTime = (timeStr) => {
            if (!timeStr) return '';
            try {
              const [hours, minutes] = timeStr.split(':');
              const hour24 = parseInt(hours, 10);
              const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
              const ampm = hour24 >= 12 ? 'PM' : 'AM';
              return `${hour12}:${minutes} ${ampm}`;
            } catch {
              return timeStr;
            }
          };

          const bullet = '•⁠  ⁠';
          const formattedDate = formatBookingDateShort(updatedSession.scheduled_date);
          const formattedTime = formatFriendlyTime(updatedSession.scheduled_time);
          const supportPhone = process.env.SUPPORT_PHONE || process.env.COMPANY_PHONE || '+91 95390 07766';

          const psychologistMessage =
            `Hey 👋\n\n` +
            `You have been assigned to a session with Little Care.\n\n` +
            `${bullet}Client: ${clientName}\n` +
            `${bullet}Date: ${formattedDate}\n` +
            `${bullet}Time: ${formattedTime} (IST)\n\n` +
            (meetLink ? `Join link:\n${meetLink}\n\n` : '') +
            `Please be ready 5 mins early.\n\n` +
            `For help: ${supportPhone}\n\n`;

          const psychologistPhone = updatedSession.psychologist?.phone;
          if (psychologistPhone) {
            await sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
            console.log('✅ Notification sent to new psychologist:', updatedSession.psychologist.email);
          } else {
            console.log('ℹ️ No phone number found for psychologist, skipping WhatsApp notification');
          }
        } catch (notifError) {
          console.error('❌ Error sending notification to new psychologist:', notifError);
          // Don't fail the request if notification fails
        }
      })();
    }

    return res.json(successResponse(updatedSession, 'Session updated successfully'));

  } catch (error) {
    console.error('Update session error:', error);
    return res.status(500).json(errorResponse('Internal server error while updating session'));
  }
};

const getPsychologistAvailabilityForReschedule = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const { startDate, endDate } = req.query;

    if (!psychologistId) {
      return res.status(400).json(
        errorResponse('Psychologist ID is required')
      );
    }

    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Both startDate and endDate are required (YYYY-MM-DD format)')
      );
    }

    console.log(`📅 [ADMIN] Getting availability for psychologist ${psychologistId} from ${startDate} to ${endDate}`);

    // Use the availability service to get availability range
    const availabilityService = require('../utils/availabilityCalendarService');
    const availability = await availabilityService.getPsychologistAvailabilityRange(
      psychologistId,
      startDate,
      endDate
    );

    // Format the response to match what the frontend expects
    // Frontend expects: { success: true, data: { availability: [...] } }
    // Each item should have: { date, available_slots (array of time strings), time_slots, booked_times, is_available }
    const formattedAvailability = availability.map(day => {
      // The availability service returns: { date, timeSlots: [{time, available, displayTime, reason}], ... }
      // Extract available slots from timeSlots array - these are the slots that can be booked
      const availableSlots = (day.timeSlots || [])
        .filter(slot => slot.available !== false && slot.reason !== 'booked' && slot.reason !== 'google_calendar_blocked')
        .map(slot => {
          // Return the time string in 12-hour format (e.g., "9:00 PM")
          return slot.displayTime || slot.time || String(slot);
        });
      
      // Extract all time slots (for reference)
      const allTimeSlots = (day.timeSlots || []).map(slot => slot.displayTime || slot.time || String(slot));
      
      // Extract booked times
      const bookedTimes = (day.timeSlots || [])
        .filter(slot => slot.available === false && slot.reason === 'booked')
        .map(slot => slot.displayTime || slot.time || String(slot));

      const formattedDay = {
        date: day.date,
        is_available: day.is_available !== false && availableSlots.length > 0,
        time_slots: allTimeSlots,
        available_slots: availableSlots, // This is what the frontend uses to display available times
        booked_times: bookedTimes
      };

      console.log(`📅 [ADMIN] Formatted day ${day.date}: ${availableSlots.length} available slots out of ${allTimeSlots.length} total`);
      
      return formattedDay;
    });

    console.log(`✅ [ADMIN] Availability fetched: ${formattedAvailability.length} days`);

      return res.json(
      successResponse({
        availability: formattedAvailability
      })
    );

  } catch (error) {
    console.error('❌ [ADMIN] Error getting psychologist availability:', error);
      return res.status(500).json(
      errorResponse('Failed to fetch psychologist availability')
    );
  }
};

const handleRescheduleRequest = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const getRescheduleRequests = async (req, res) => {
  try {
    const { status } = req.query; // 'pending', 'approved', 'rejected', or undefined for all

    // Get all notifications that are reschedule requests
    // Filter by type='warning' and message contains 'reschedule' or title contains 'Reschedule'
    let query = supabaseAdmin
      .from('notifications')
      .select('*')
      .or('type.eq.warning,type.eq.info')
      .order('created_at', { ascending: false });

    const { data: allNotifications, error: fetchError } = await query;

    if (fetchError) {
      console.error('Get reschedule requests error:', fetchError);
      return res.status(500).json(
        errorResponse('Failed to fetch reschedule requests')
      );
    }

    // Filter for reschedule-related notifications
    let rescheduleRequests = (allNotifications || []).filter(notif => 
      (notif.message?.toLowerCase().includes('reschedule') || 
       notif.title?.toLowerCase().includes('reschedule')) &&
      notif.related_type === 'session'
    );

    // Filter by status
    if (status === 'pending') {
      rescheduleRequests = rescheduleRequests.filter(req => !req.is_read);
    } else if (status === 'approved') {
      rescheduleRequests = rescheduleRequests.filter(req => req.is_read);
    }

    // Enrich with session, client, and psychologist data
    const enrichedRequests = await Promise.all(
      rescheduleRequests.map(async (request) => {
        const sessionId = request.related_id;
        
        // Get session details with client user email
        const { data: session } = await supabaseAdmin
          .from('sessions')
          .select(`
            *,
            client:clients(
              *,
              user:users(email)
            ),
            psychologist:psychologists(*)
          `)
          .eq('id', sessionId)
          .single();

        return {
          ...request,
          session: session || null,
          client: session?.client || null,
          psychologist: session?.psychologist || null
        };
      })
    );

    res.json(successResponse(enrichedRequests || [], 'Reschedule requests fetched successfully'));

  } catch (error) {
    console.error('Get reschedule requests error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching reschedule requests')
    );
  }
};

const approveAssessmentRescheduleRequest = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

const getPsychologistCalendarEvents = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Start date and end date are required')
      );
    }

    // Get psychologist details with Google Calendar credentials
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .eq('id', psychologistId)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Get internal sessions (Little Care sessions)
    const { data: internalSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select(`
        scheduled_date,
        scheduled_time,
        status,
        session_type,
        client:clients(
          first_name,
          last_name,
          child_name
        )
      `)
      .eq('psychologist_id', psychologistId)
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .in('status', ['booked', 'rescheduled', 'confirmed', 'completed'])
      .order('scheduled_date', { ascending: true });

    if (sessionsError) {
      console.error('Error fetching internal sessions:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to fetch internal sessions')
      );
    }

    // Get external calendar events if Google Calendar is connected
    let externalEvents = [];
    if (psychologist.google_calendar_credentials) {
      try {
        const googleCalendarService = require('../utils/googleCalendarService');
        
        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);
        
        // Get external events from Google Calendar
        const calendarEvents = await googleCalendarService.getCalendarEvents(
          psychologist.google_calendar_credentials,
          'primary',
          startDateObj,
          endDateObj
        );

        // Filter out events created by our own system
        externalEvents = calendarEvents.filter(event => 
          !event.summary?.includes('LittleMinds') && 
          !event.summary?.includes('Session') &&
          !event.summary?.includes('Therapy')
        ).map(event => ({
          id: event.id,
          summary: event.summary || 'Untitled Event',
          start: event.start,
          end: event.end,
          location: event.location,
          description: event.description,
          source: 'external'
        }));
      } catch (calendarError) {
        console.error('Error fetching Google Calendar events:', calendarError);
        // Continue without external events if Google Calendar fails
      }
    }

    // Format internal sessions as events
    const internalEvents = internalSessions?.map(session => ({
      id: `internal-${session.scheduled_date}-${session.scheduled_time}`,
      summary: session.client ? 
        `Session with ${session.client.first_name} ${session.client.last_name}${session.client.child_name ? ` (${session.client.child_name})` : ''}` :
        'Session',
      start: {
        dateTime: `${session.scheduled_date}T${session.scheduled_time}:00`
      },
      end: {
        dateTime: `${session.scheduled_date}T${session.scheduled_time}:00`
      },
      status: session.status,
      session_type: session.session_type,
      source: 'little_care'
    })) || [];

    // Combine and sort all events
    const allEvents = [...internalEvents, ...externalEvents].sort((a, b) => {
      const dateA = new Date(a.start.dateTime || a.start.date);
      const dateB = new Date(b.start.dateTime || b.start.date);
      return dateA - dateB;
    });

    res.json(
      successResponse({
        psychologist: {
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`,
          email: psychologist.email
        },
        events: allEvents,
        hasGoogleCalendar: !!psychologist.google_calendar_credentials,
        dateRange: { startDate, endDate }
      }, 'Calendar events fetched successfully')
    );

  } catch (error) {
    console.error('Get psychologist calendar events error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching calendar events')
    );
  }
};

const checkCalendarSyncStatus = async (req, res) => {
  return res.status(501).json(errorResponse('Function needs to be restored from backup'));
};

module.exports = {
  getAllUsers,
  getUserDetails,
  updateUserRole,
  deactivateUser,
  getPlatformStats,
  searchUsers,
  getRecentActivities,
  getRecentUsers,
  getRecentBookings,
  getAllPsychologists,
  createPsychologist,
  updatePsychologist,
  deletePsychologist,
  addNextDayAvailability,
  updateAllPsychologistsAvailability,
  createPsychologistPackages,
  checkMissingPackages,
  deletePackage,
  getStuckSlotLocks,
  createUser,
  updateUser,
  deleteUser,
  rescheduleSession,
  updateSessionPayment,
  updateSession,
  getPsychologistAvailabilityForReschedule,
  createManualBooking,
  handleRescheduleRequest,
  getRescheduleRequests,
  approveAssessmentRescheduleRequest,
  getPsychologistCalendarEvents,
  checkCalendarSyncStatus
};
