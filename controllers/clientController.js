const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { deriveSessionCount, ensureClientPackageRecord } = require('../services/packageService');
const { 
  successResponse, 
  errorResponse,
  formatDate,
  formatTime,
  addMinutesToTime
} = require('../utils/helpers');
const availabilityService = require('../utils/availabilityCalendarService');
const meetLinkService = require('../utils/meetLinkService');
const userInteractionLogger = require('../utils/userInteractionLogger');
const { reserveAssessmentSlot, bookAssessment, getAssessmentSessions } = require('./assessmentBookingController');

// Get client profile
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let client = null;
    let error = null;

    // New system: client has user_id reference to users table
    if (userRole === 'client' && req.user.user_id) {
      // User ID in token is from users table, client has user_id
      // This means client profile is already loaded in req.user from middleware
      client = req.user;
    } else if (userRole === 'client') {
      // Try new system: lookup by user_id
      const { data: clientByUserId, error: errorByUserId } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', req.user.user_id)
        .single();

      if (clientByUserId && !errorByUserId) {
        client = clientByUserId;
      } else {
        // Fallback to old system: lookup by id (backward compatibility)
        const { data: clientById, error: errorById } = await supabase
          .from('clients')
          .select('*')
          .eq('id', userId)
          .single();

        if (clientById && !errorById) {
          client = clientById;
        } else {
          error = errorByUserId || errorById;
        }
      }
    } else {
      error = { message: 'User is not a client' };
    }

    if (error || !client) {
      console.error('Get client profile error:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch client profile')
      );
    }

    // Merge with user data if available
    const userData = {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      profile_picture_url: req.user.profile_picture_url,
      google_id: req.user.google_id
    };

    res.json(
      successResponse({ ...userData, ...client })
    );

  } catch (error) {
    console.error('Get client profile error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching profile')
    );
  }
};

/**
 * Get a usable payment credit for the authenticated client by transaction ID.
 * Used when a payment succeeded but the original slot was taken by someone else.
 */
const getPaymentCredit = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json(
        errorResponse('Transaction ID is required')
      );
    }

    if (userRole !== 'client') {
      return res.status(403).json(
        errorResponse('Only clients can access payment credits')
      );
    }

    // In the clients table, id is the client_id used in payments
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      console.error('Client profile not found for credit lookup:', clientError);
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = client.id;

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, client_id, psychologist_id, amount, status, transaction_id, session_id, session_type, razorpay_payment_id')
      .eq('transaction_id', transactionId)
      .eq('client_id', clientId)
      .single();

    if (paymentError || !payment) {
      console.error('Payment credit not found:', paymentError);
      return res.status(404).json(
        errorResponse('Payment credit not found')
      );
    }

    // Treat as credit only if payment is still pending, has a Razorpay payment id and no session yet
    if (payment.status !== 'pending' || !payment.razorpay_payment_id || payment.session_id) {
      return res.status(400).json(
        errorResponse('This payment cannot be used as a session credit')
      );
    }

    return res.json(
      successResponse(
        {
          payment_id: payment.id,
          transaction_id: payment.transaction_id,
          psychologist_id: payment.psychologist_id,
          amount: payment.amount,
          session_type: payment.session_type || 'Individual Session',
          status: payment.status
        },
        'Payment credit fetched successfully'
      )
    );
  } catch (error) {
    console.error('Get payment credit error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching payment credit')
    );
  }
};

// Update client profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const updateData = req.body;

    // Remove user_id from update data if present (shouldn't be updated)
    delete updateData.user_id;

    // Handle optional last_name - allow clearing it
    if (updateData.last_name !== undefined) {
      if (updateData.last_name === null || updateData.last_name === '' || updateData.last_name.trim() === '') {
        // User wants to clear it - set to empty string
        updateData.last_name = '';
      } else {
        // Trim whitespace if provided
        updateData.last_name = updateData.last_name.trim();
      }
    }
    // If last_name is not in updateData, preserve existing value (don't update it)

    // Handle optional child fields - allow clearing them
    // If child_name is explicitly set to empty string, try to use empty string (database may allow it)
    // If database has NOT NULL constraint and doesn't allow empty string, it will error and we can handle it
    if (updateData.child_name !== undefined) {
      if (updateData.child_name === null || updateData.child_name === '' || updateData.child_name.trim() === '') {
        // User wants to clear it - try empty string first, database will reject if NOT NULL doesn't allow it
        // In that case, we'll get an error and can handle it
        updateData.child_name = '';
      } else {
        // Trim whitespace if provided
        updateData.child_name = updateData.child_name.trim();
      }
    }
    // If child_name is not in updateData, preserve existing value (don't update it)
    
    // Handle optional child_age - allow clearing by setting to null or default
    if (updateData.child_age !== undefined) {
      if (updateData.child_age === null || updateData.child_age === '' || updateData.child_age === 0) {
        // User wants to clear it - try null first, if database rejects it, use default value 1
        updateData.child_age = null;
      } else {
        updateData.child_age = Number(updateData.child_age);
      }
    }
    // If child_age is not in updateData, preserve existing value (don't update it)

    // Use supabaseAdmin to bypass RLS
    const { supabaseAdmin } = require('../config/supabase');

    let client = null;
    let error = null;
    let lastErrorDetails = null;

    if (userRole === 'client') {
      // Attempt updates using different identifiers
      // Priority: 1) user_id (new system), 2) client_id (if available), 3) id as fallback for old system
      const updateAttempts = [
        // New system: client has user_id that references users table
        { column: 'user_id', value: userId },
        // If client_id is available, use it
        req.user.client_id ? { column: 'id', value: req.user.client_id } : null,
        // Old system fallback: try by id (for backward compatibility with old clients)
        { column: 'id', value: userId }
      ].filter(Boolean);

      console.log('Update attempts:', updateAttempts);
      console.log('Update data:', updateData);

      for (const attempt of updateAttempts) {
        try {
          // First check if client exists
          const { data: existingClient, error: checkError } = await supabaseAdmin
            .from('clients')
            .select('*')
            .eq(attempt.column, attempt.value)
            .single();

          if (checkError && checkError.code !== 'PGRST116') {
            console.error(`Error checking client existence (${attempt.column}=${attempt.value}):`, checkError);
            lastErrorDetails = { attempt, error: checkError };
            continue;
          }

          if (!existingClient) {
            console.log(`Client not found with ${attempt.column}=${attempt.value}`);
            lastErrorDetails = { attempt, error: { message: 'Client not found' } };
            continue;
          }

          // Prepare update payload - child_name is already handled above if null/empty
          const updatePayload = {
              ...updateData,
              updated_at: new Date().toISOString()
          };

          // Now attempt the update
          let updatePayloadToUse = { ...updatePayload };
          
          // Handle special cases for child_age and child_name that might need fallback values
          let needsRetry = false;
          let retryPayload = null;
          
          // Check if we need to handle child_age null -> default fallback
          if (updatePayloadToUse.child_age === null && updatePayloadToUse.child_age !== undefined) {
            needsRetry = true;
            retryPayload = { ...updatePayloadToUse, child_age: 1 }; // Default fallback
          }
          
          // Check if we need to handle child_name empty -> default fallback
          if (updatePayloadToUse.child_name === '' && updatePayloadToUse.child_name !== undefined) {
            needsRetry = true;
            retryPayload = retryPayload || { ...updatePayloadToUse };
            retryPayload.child_name = 'Pending'; // Default fallback
          }
          
          if (needsRetry) {
            // Try with original values first
            let { data: updatedClient, error: updateError } = await supabaseAdmin
              .from('clients')
              .update(updatePayloadToUse)
            .eq(attempt.column, attempt.value)
            .select('*')
            .single();

            // If update fails due to NOT NULL constraint, try with default values
            if (updateError && updateError.code === '23502') {
              if (updateError.message?.includes('child_age')) {
                console.log('Null child_age rejected, using default value 1');
              }
              if (updateError.message?.includes('child_name')) {
                console.log('Empty child_name rejected, using default "Pending"');
              }
              
              const retryResult = await supabaseAdmin
                .from('clients')
                .update(retryPayload)
                .eq(attempt.column, attempt.value)
                .select('*')
                .single();
              updatedClient = retryResult.data;
              updateError = retryResult.error;
            }

          if (!updateError && updatedClient) {
            client = updatedClient;
            error = null;
              lastErrorDetails = null;
            break;
          }

          // Record the last error but continue trying other identifiers
          if (updateError) {
            error = updateError;
              lastErrorDetails = { attempt, error: updateError };
              console.error(`Update error (${attempt.column}=${attempt.value}):`, updateError);
            }
          } else {
            // Normal update path (no special handling needed for child fields)
            const { data: updatedClient, error: updateError } = await supabaseAdmin
              .from('clients')
              .update(updatePayloadToUse)
              .eq(attempt.column, attempt.value)
              .select('*')
              .single();

            if (!updateError && updatedClient) {
              client = updatedClient;
              error = null;
              lastErrorDetails = null;
              break;
            }

            // Record the last error but continue trying other identifiers
            if (updateError) {
              error = updateError;
              lastErrorDetails = { attempt, error: updateError };
              console.error(`Update error (${attempt.column}=${attempt.value}):`, updateError);
            }
          }
        } catch (attemptError) {
          error = attemptError;
          lastErrorDetails = { attempt, error: attemptError };
          console.error(`Exception during update attempt (${attempt.column}=${attempt.value}):`, attemptError);
        }
      }
    } else {
      error = { message: 'User is not a client' };
    }

    if (error || !client) {
      const errorMessage = error?.message || 'Unknown error';
      const errorCode = error?.code || 'UNKNOWN_ERROR';
      const errorDetails = lastErrorDetails 
        ? `Failed with ${lastErrorDetails.attempt?.column}=${lastErrorDetails.attempt?.value}: ${lastErrorDetails.error?.message || errorMessage}`
        : errorMessage;
      
      console.error('Update client profile error:', {
        error,
        errorCode,
        errorMessage,
        lastErrorDetails,
        userId,
        userRole,
        updateData
      });
      
      return res.status(500).json(
        errorResponse(
          'Failed to update client profile',
          {
            message: errorMessage,
            code: errorCode,
            details: errorDetails
          }
        )
      );
    }

    res.json(
      successResponse(client, 'Profile updated successfully')
    );

  } catch (error) {
    console.error('Update client profile exception:', error);
    res.status(500).json(
      errorResponse(
        'Internal server error while updating profile',
        {
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      )
    );
  }
};

// Get client sessions
const getSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { page = 1, limit = 10, status } = req.query;

    // Determine client ID based on system (new or old)
    // For new system: req.user.id is users.id, use req.user.client_id (set by middleware)
    // For old system: req.user.id is already clients.id
    let clientId = req.user.client_id || userId;

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
            area_of_expertise,
            cover_image_url
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
        console.error('Error fetching sessions:', error);
        // If package relationship fails, try without it
        if (error.message && (error.message.includes('package') || error.message.includes('relation') || error.code === 'PGRST116')) {
          console.log('Retrying query without package relationship...');
          let fallbackQuery = supabase
            .from('sessions')
            .select(`
              *,
              psychologist:psychologists(
                id,
                first_name,
                last_name,
                area_of_expertise,
                cover_image_url
              )
            `)
            .eq('client_id', clientId);

          if (status) {
            fallbackQuery = fallbackQuery.eq('status', status);
          }

          const offset = (page - 1) * limit;
          fallbackQuery = fallbackQuery.range(offset, offset + limit - 1).order('scheduled_date', { ascending: false });

          const { data: fallbackSessions, error: fallbackError } = await fallbackQuery;
          
          if (fallbackError) {
            console.error('Fallback query also failed:', fallbackError);
            return res.status(500).json(
              errorResponse('Failed to fetch sessions: ' + fallbackError.message)
            );
          }

          // Also fetch assessment sessions for fallback
          let assessmentSessions = [];
          try {
            const assessQuery = supabaseAdmin
              .from('assessment_sessions')
              .select(`
                id,
                assessment_id,
                assessment_slug,
                psychologist_id,
                scheduled_date,
                scheduled_time,
                status,
                amount,
                payment_id,
                created_at,
                assessment:assessments(
                  id,
                  slug,
                  hero_title,
                  seo_title
                ),
                psychologist:psychologists(
                  id,
                  first_name,
                  last_name,
                  area_of_expertise,
                  cover_image_url
                )
              `)
              .eq('client_id', clientId);
            
            if (status) {
              assessQuery.eq('status', status);
            }
            
            const { data: assessData } = await assessQuery.order('scheduled_date', { ascending: false });
            
            assessmentSessions = (assessData || []).map(a => ({
              ...a,
              session_type: 'assessment',
              type: 'assessment'
            }));
          } catch (assessError) {
            console.log('Assessment sessions fetch error (non-blocking):', assessError);
          }

          // Fetch package information for fallback sessions that have package_id
          const fallbackSessionsWithPackages = await Promise.all((fallbackSessions || []).map(async (session) => {
            if (session.package_id) {
              try {
                const { data: packageData, error: packageError } = await supabase
                  .from('packages')
                  .select('id, package_type, price, description, session_count')
                  .eq('id', session.package_id)
                  .single();
                
                if (!packageError && packageData) {
                  // Calculate package progress: count completed sessions for this package
                  const { data: packageSessions, error: sessionsError } = await supabase
                    .from('sessions')
                    .select('id, status')
                    .eq('package_id', session.package_id)
                    .eq('client_id', clientId);
                  
                  if (!sessionsError && packageSessions) {
                    const totalSessions = packageData.session_count || 0;
                    const completedSessions = packageSessions.filter(
                      s => s.status === 'completed'
                    ).length;
                    
                    packageData.completed_sessions = completedSessions;
                    packageData.total_sessions = totalSessions;
                    packageData.remaining_sessions = Math.max(totalSessions - completedSessions, 0);
                  }
                  
                  session.package = packageData;
                }
              } catch (err) {
                console.log('Error fetching package for session:', session.id, err);
              }
            }
            return session;
          }));

          // Combine with assessment sessions
          const allSessions = [...(fallbackSessionsWithPackages || []), ...assessmentSessions]
            .sort((a, b) => new Date(b.scheduled_date) - new Date(a.scheduled_date));

          return res.json(
            successResponse({
              sessions: allSessions,
              pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: (fallbackSessionsWithPackages?.length || 0) + assessmentSessions.length
              }
            })
          );
        }
        
        return res.status(500).json(
          errorResponse('Failed to fetch sessions: ' + error.message)
        );
      }

      // Also fetch assessment sessions
      let assessmentSessions = [];
      try {
        const assessQuery = supabaseAdmin
          .from('assessment_sessions')
          .select(`
            id,
            assessment_id,
            assessment_slug,
            psychologist_id,
            scheduled_date,
            scheduled_time,
            status,
            amount,
            payment_id,
            created_at,
            assessment:assessments(
              id,
              slug,
              hero_title,
              seo_title
            ),
            psychologist:psychologists(
              id,
              first_name,
              last_name,
              area_of_expertise,
              cover_image_url
            )
          `)
          .eq('client_id', clientId);
        
        if (status) {
          assessQuery.eq('status', status);
        }
        
        const { data: assessData } = await assessQuery.order('scheduled_date', { ascending: false });
        
        // Transform assessment sessions to match session format
        assessmentSessions = (assessData || []).map(a => ({
          ...a,
          session_type: 'assessment',
          type: 'assessment'
        }));
      } catch (assessError) {
        console.log('Assessment sessions fetch error (non-blocking):', assessError);
      }

      // Fetch package information for sessions that have package_id
      const sessionsWithPackages = await Promise.all((sessions || []).map(async (session) => {
        if (session.package_id) {
          try {
            const { data: packageData, error: packageError } = await supabase
              .from('packages')
              .select('id, package_type, price, description, session_count')
              .eq('id', session.package_id)
              .single();
            
            if (!packageError && packageData) {
              // Calculate package progress: count completed sessions for this package
              const { data: packageSessions, error: sessionsError } = await supabase
                .from('sessions')
                .select('id, status')
                .eq('package_id', session.package_id)
                .eq('client_id', clientId);
              
              if (!sessionsError && packageSessions) {
                const totalSessions = packageData.session_count || 0;
                const completedSessions = packageSessions.filter(
                  s => s.status === 'completed'
                ).length;
                
                packageData.completed_sessions = completedSessions;
                packageData.total_sessions = totalSessions;
                packageData.remaining_sessions = Math.max(totalSessions - completedSessions, 0);
              }
              
              session.package = packageData;
            }
          } catch (err) {
            console.log('Error fetching package for session:', session.id, err);
          }
        }
        return session;
      }));

      // Combine regular sessions and assessment sessions
      const allSessions = [...(sessionsWithPackages || []), ...assessmentSessions]
        .sort((a, b) => new Date(b.scheduled_date) - new Date(a.scheduled_date));

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
      // Log booking failure
      await userInteractionLogger.logBooking({
        userId: req.user.id,
        userRole: req.user.role,
        psychologistId,
        packageId: package_id,
        scheduledDate: scheduled_date,
        scheduledTime: scheduled_time,
        price,
        status: 'failure',
        error: new Error('Missing required fields')
      });
      
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
        phone_number,
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
      .select('first_name, last_name, email, phone')
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
      
      // Log booking failure
      await userInteractionLogger.logBooking({
        userId,
        userRole,
        psychologistId: psychologist_id,
        packageId: package_id,
        scheduledDate: scheduled_date,
        scheduledTime: scheduled_time,
        price,
        status: 'failure',
        error: sessionError
      });
      
      // Check if it's a unique constraint violation (double booking)
      if (sessionError.code === '23505' || 
          sessionError.message?.includes('unique') || 
          sessionError.message?.includes('duplicate')) {
        console.log('⚠️ Double booking detected - slot was just booked by another user');
        return res.status(409).json(
          errorResponse('This time slot was just booked by another user. Please select another time.')
        );
      }
      
      return res.status(500).json(
        errorResponse('Failed to create session')
      );
    }

    console.log('✅ Session record created successfully');
    console.log('   - Session ID:', session.id);
    console.log('   - Status:', session.status);
    console.log('   - Price:', session.price);

    // Block the booked slot from availability using the availability service
    try {
      const availabilityService = require('../utils/availabilityCalendarService');
      await availabilityService.updateAvailabilityOnBooking(
        psychologist_id,
        session.scheduled_date,
        session.scheduled_time
      );
      console.log('✅ Availability updated to block booked slot');
    } catch (blockErr) {
      console.warn('⚠️ Failed to update availability after booking:', blockErr?.message);
    }

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

    // Step 8: Send email + WhatsApp notifications
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

      // WhatsApp notifications via Business API (best-effort, non-blocking)
      try {
        console.log('📱 Sending WhatsApp notifications via UltraMsg API...');
        const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
        
        // Send WhatsApp to client
        const clientPhone = clientDetails.phone_number || null;
        if (clientPhone && meetData?.meetLink) {
          // Only include childName if child_name exists and is not empty/null/'Pending'
          const childName = clientDetails.child_name && 
            clientDetails.child_name.trim() !== '' && 
            clientDetails.child_name.toLowerCase() !== 'pending'
            ? clientDetails.child_name 
            : null;
          
          const clientDetails_wa = {
            childName: childName,
            date: scheduled_date,
            time: scheduled_time,
            meetLink: meetData.meetLink,
            psychologistName: psychologistName, // Add psychologist name to WhatsApp message
          };
          const clientWaResult = await sendBookingConfirmation(clientPhone, clientDetails_wa);
          if (clientWaResult?.success) {
            console.log('✅ WhatsApp confirmation sent to client via UltraMsg');
            
            // Log WhatsApp success
            await userInteractionLogger.logInteraction({
              userId,
              userRole,
              action: 'whatsapp_client_booking',
              status: 'success',
              details: {
                sessionId: session.id,
                clientPhone: clientPhone,
                messageId: clientWaResult.data?.msgId
              }
            });
          } else if (clientWaResult?.skipped) {
            const skipReason = clientWaResult.reason || 'Unknown reason';
            console.log('ℹ️ Client WhatsApp skipped:', skipReason);
            
            // Log WhatsApp skip with reason
            await userInteractionLogger.logInteraction({
              userId,
              userRole,
              action: 'whatsapp_client_booking',
              status: 'skipped',
              details: {
                sessionId: session.id,
                clientPhone: clientPhone,
                skipReason: skipReason
              }
            });
          } else {
            const failureReason = clientWaResult?.error?.message || 
                                 clientWaResult?.error || 
                                 clientWaResult?.reason || 
                                 'Unknown WhatsApp API error';
            console.warn('⚠️ Client WhatsApp send failed:', failureReason);
            
            // Log WhatsApp failure with detailed reason
            await userInteractionLogger.logInteraction({
              userId,
              userRole,
              action: 'whatsapp_client_booking',
              status: 'failure',
              details: {
                sessionId: session.id,
                clientPhone: clientPhone,
                failureReason: failureReason,
                errorDetails: clientWaResult?.error || clientWaResult
              },
              error: clientWaResult?.error || new Error(failureReason)
            });
          }
        } else {
          const skipReason = !clientPhone ? 'No client phone number' : 'No Google Meet link available';
          console.log('ℹ️ No client phone or meet link; skipping client WhatsApp');
          
          // Log WhatsApp skip with reason
          await userInteractionLogger.logInteraction({
            userId,
            userRole,
            action: 'whatsapp_client_booking',
            status: 'skipped',
            details: {
              sessionId: session.id,
              clientPhone: clientPhone,
              hasMeetLink: !!meetData?.meetLink,
              skipReason: skipReason
            }
          });
        }

        // Send WhatsApp to psychologist (single detailed message)
        const psychologistPhone = psychologistDetails.phone || null;
        if (psychologistPhone && meetData?.meetLink) {
          const supportPhone = process.env.SUPPORT_PHONE || process.env.COMPANY_PHONE || '+91 95390 07766';
          const psychologistMessage =
            `🧸 New session booked.\n\n` +
            `Session details:\n\n` +
            `👧 Client: ${clientName}\n\n` +
            `📅 Date: ${scheduled_date}\n\n` +
            `⏰ Time: ${scheduled_time} (IST)\n\n` +
            `🔗 Google Meet: ${meetData.meetLink}\n\n` +
            `🆔 Session ID: ${session.id}\n\n` +
            `📞 For support or scheduling issues, contact Little Care support:\n` +
            `WhatsApp / Call: ${supportPhone}`;
          
          const psychologistWaResult = await sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
          if (psychologistWaResult?.success) {
            console.log('✅ WhatsApp notification sent to psychologist via WhatsApp API');
            
            // Log WhatsApp success
            await userInteractionLogger.logInteraction({
              userId,
              userRole,
              action: 'whatsapp_psychologist_booking',
              status: 'success',
              details: {
                sessionId: session.id,
                psychologistPhone: psychologistPhone,
                psychologistId: psychologist_id,
                messageId: psychologistWaResult.data?.msgId
              }
            });
          } else if (psychologistWaResult?.skipped) {
            const skipReason = psychologistWaResult.reason || 'Unknown reason';
            console.log('ℹ️ Psychologist WhatsApp skipped:', skipReason);
            
            // Log WhatsApp skip with reason
            await userInteractionLogger.logInteraction({
              userId,
              userRole,
              action: 'whatsapp_psychologist_booking',
              status: 'skipped',
              details: {
                sessionId: session.id,
                psychologistPhone: psychologistPhone,
                psychologistId: psychologist_id,
                skipReason: skipReason
              }
            });
          } else {
            const failureReason = psychologistWaResult?.error?.message || 
                                 psychologistWaResult?.error || 
                                 psychologistWaResult?.reason || 
                                 'Unknown WhatsApp API error';
            console.warn('⚠️ Psychologist WhatsApp send failed:', failureReason);
            
            // Log WhatsApp failure with detailed reason
            await userInteractionLogger.logInteraction({
              userId,
              userRole,
              action: 'whatsapp_psychologist_booking',
              status: 'failure',
              details: {
                sessionId: session.id,
                psychologistPhone: psychologistPhone,
                psychologistId: psychologist_id,
                failureReason: failureReason,
                errorDetails: psychologistWaResult?.error || psychologistWaResult
              },
              error: psychologistWaResult?.error || new Error(failureReason)
            });
          }
        } else {
          const skipReason = !psychologistPhone ? 'No psychologist phone number' : 'No Google Meet link available';
          console.log('ℹ️ No psychologist phone or meet link; skipping psychologist WhatsApp');
          
          // Log WhatsApp skip with reason
          await userInteractionLogger.logInteraction({
            userId,
            userRole,
            action: 'whatsapp_psychologist_booking',
            status: 'skipped',
            details: {
              sessionId: session.id,
              psychologistPhone: psychologistPhone,
              psychologistId: psychologist_id,
              hasMeetLink: !!meetData?.meetLink,
              skipReason: skipReason
            }
          });
        }
      } catch (waError) {
        const failureReason = waError?.message || 
                             waError?.response?.data?.message || 
                             waError?.code || 
                             'Unknown WhatsApp service error';
        console.error('❌ WhatsApp notification error:', failureReason);
        console.error('   Full error:', waError);
        
        // Log WhatsApp failure with detailed reason
        await userInteractionLogger.logInteraction({
          userId,
          userRole,
          action: 'whatsapp_notifications',
          status: 'failure',
          details: {
            sessionId: session.id,
            failureReason: failureReason,
            errorCode: waError?.code,
            errorResponse: waError?.response?.data,
            fullError: waError
          },
          error: waError
        });
      }
    } catch (emailError) {
      const failureReason = emailError?.message || 
                           emailError?.response?.data?.message || 
                           emailError?.code || 
                           'Unknown email service error';
      console.error('❌ Error sending email notifications:', failureReason);
      console.error('   Full error:', emailError);
      
      // Log email sending failure with detailed reason
      await userInteractionLogger.logInteraction({
        userId,
        userRole,
        action: 'email_confirmation',
        status: 'failure',
        details: {
          sessionId: session.id,
          clientEmail: clientDetails?.user?.email || clientDetails?.email,
          psychologistEmail: psychologistDetails?.email,
          failureReason: failureReason,
          errorCode: emailError?.code,
          errorResponse: emailError?.response?.data,
          smtpError: emailError?.smtpError,
          fullError: emailError
        },
        error: emailError
      });
      // Continue even if email fails
    }

    console.log('✅ Session booking completed successfully with Meet link and email notifications');
    
    // Log successful booking
    await userInteractionLogger.logBooking({
      userId,
      userRole,
      psychologistId: psychologist_id,
      packageId: package_id,
      scheduledDate: scheduled_date,
      scheduledTime: scheduled_time,
      price: session.price,
      status: 'success',
      sessionId: session.id
    });
    
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

    // PRIORITY: Check and send reminder immediately if session is 2 hours away
    // This gives new bookings priority over batch reminder processing
    try {
      const sessionReminderService = require('../services/sessionReminderService');
      // Run asynchronously to not block the response
      sessionReminderService.checkAndSendReminderForSessionId(session.id).catch(err => {
        console.error('❌ Error in priority reminder check:', err);
        // Don't block response - reminder will be sent in next hourly check
      });
    } catch (reminderError) {
      console.error('❌ Error initiating priority reminder check:', reminderError);
      // Don't block response
    }

  } catch (error) {
    console.error('❌ Session booking error:', error);
    
    // Log booking failure
    await userInteractionLogger.logBooking({
      userId: req.user?.id,
      userRole: req.user?.role,
      psychologistId: req.body?.psychologist_id,
      packageId: req.body?.package_id,
      scheduledDate: req.body?.scheduled_date,
      scheduledTime: req.body?.scheduled_time,
      price: req.body?.price,
      status: 'failure',
      error
    });
    
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

    // Get client and psychologist details for notifications
    const { data: clientDetails } = await supabase
      .from('clients')
      .select('first_name, last_name, child_name, phone_number, email')
      .eq('id', client.id)
      .single();

    const { data: psychologistDetails } = await supabase
      .from('psychologists')
      .select('first_name, last_name, phone, email')
      .eq('id', session.psychologist_id)
      .single();

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

    // Send email notifications for cancellation
    try {
      console.log('📧 Sending cancellation email notifications...');
      const emailService = require('../utils/emailService');
      
      const clientName = clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim();
      const psychologistName = `${psychologistDetails?.first_name || ''} ${psychologistDetails?.last_name || ''}`.trim();
      const sessionDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short'
      });

      // Send cancellation email to client
      if (clientDetails?.email) {
        await emailService.sendCancellationNotification({
          to: clientDetails.email,
          clientName,
          psychologistName,
          sessionDate: session.scheduled_date,
          sessionTime: session.scheduled_time,
          sessionId: session.id
        });
      }

      // Send cancellation email to psychologist
      if (psychologistDetails?.email) {
        await emailService.sendCancellationNotification({
          to: psychologistDetails.email,
          clientName,
          psychologistName,
          sessionDate: session.scheduled_date,
          sessionTime: session.scheduled_time,
          sessionId: session.id,
          isPsychologist: true
        });
      }

      console.log('✅ Cancellation emails sent successfully');
    } catch (emailError) {
      console.error('❌ Error sending cancellation emails:', emailError);
      // Continue even if email fails
    }

    // Send WhatsApp notifications for cancellation
    try {
      console.log('📱 Sending WhatsApp notifications for cancellation...');
      const { sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
      
      const clientName = clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim();
      const psychologistName = `${psychologistDetails?.first_name || ''} ${psychologistDetails?.last_name || ''}`.trim();
      const sessionDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short'
      });

      // Send WhatsApp to client
      if (clientDetails?.phone_number) {
        const clientMessage = `❌ Your therapy session has been cancelled.\n\n` +
          `📅 Date: ${sessionDateTime}\n` +
          `👤 Psychologist: Dr. ${psychologistName}\n\n` +
          `If you need to reschedule, please book a new session. Thank you!`;

        const clientResult = await sendWhatsAppTextWithRetry(clientDetails.phone_number, clientMessage);
        if (clientResult?.success) {
          console.log('✅ Cancellation WhatsApp sent to client');
        } else {
          console.warn('⚠️ Failed to send cancellation WhatsApp to client');
        }
      }

      // Send WhatsApp to psychologist
      if (psychologistDetails?.phone) {
        const psychologistMessage = `❌ Session cancelled with ${clientName}.\n\n` +
          `📅 Date: ${sessionDateTime}\n` +
          `👤 Client: ${clientName}\n` +
          `Session ID: ${session.id}`;

        const psychologistResult = await sendWhatsAppTextWithRetry(psychologistDetails.phone, psychologistMessage);
        if (psychologistResult?.success) {
          console.log('✅ Cancellation WhatsApp sent to psychologist');
        } else {
          console.warn('⚠️ Failed to send cancellation WhatsApp to psychologist');
        }
      }
      
      console.log('✅ WhatsApp notifications sent for cancellation');
    } catch (waError) {
      console.error('❌ Error sending cancellation WhatsApp:', waError);
      // Continue even if WhatsApp fails
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

    // Check if session can be rescheduled (allow both booked and rescheduled sessions)
    if (!['booked', 'rescheduled'].includes(session.status)) {
      return res.status(400).json(
        errorResponse('Only booked or rescheduled sessions can be rescheduled')
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
      
      // Log reschedule failure
      await userInteractionLogger.logReschedule({
        userId,
        userRole: req.user.role,
        sessionId,
        oldDate: session.scheduled_date,
        oldTime: session.scheduled_time,
        newDate: null,
        newTime: null,
        status: 'failure',
        error: updateError
      });
      
      return res.status(500).json(
        errorResponse('Failed to create reschedule request')
      );
    }

    // Log reschedule request
    await userInteractionLogger.logReschedule({
      userId,
      userRole: req.user.role,
      sessionId,
      oldDate: session.scheduled_date,
      oldTime: session.scheduled_time,
      newDate: null,
      newTime: null,
      status: 'success'
    });

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

    // Get client ID (userId is from users.id, so we need to query clients.user_id)
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
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
        errorResponse('Session not found')
      );
    }

    // Validate psychologist_id matches the session
    if (session.psychologist_id !== psychologist_id) {
      return res.status(400).json(
        errorResponse('Psychologist ID does not match the session')
      );
    }

    // Check if session can be rescheduled
    // Allow both 'booked' and 'rescheduled' sessions to be rescheduled again
    // Free assessment sessions can also be rescheduled if they're booked or already rescheduled
    const allowedStatuses = ['booked', 'rescheduled'];
    if (!allowedStatuses.includes(session.status) && session.session_type !== 'free_assessment') {
      return res.status(400).json(
        errorResponse('Only booked or rescheduled sessions can be rescheduled')
      );
    }
    
    // For free assessment sessions, allow rescheduling even if status is not exactly 'booked'
    if (session.session_type === 'free_assessment' && !['booked', 'rescheduled'].includes(session.status)) {
      return res.status(400).json(
        errorResponse('This free assessment session cannot be rescheduled')
      );
    }

    // Validate that new date/time is in the future
    const dayjs = require('dayjs');
    const utc = require('dayjs/plugin/utc');
    const timezone = require('dayjs/plugin/timezone');
    dayjs.extend(utc);
    dayjs.extend(timezone);

    const newSessionDateTime = dayjs(
      `${new_date} ${new_time}`,
      'YYYY-MM-DD HH:mm:ss'
    ).tz('Asia/Kolkata');
    const now = dayjs().tz('Asia/Kolkata');

    if (newSessionDateTime.isBefore(now)) {
      return res.status(400).json(
        errorResponse('New session date and time must be in the future')
      );
    }

    // Check 24-hour rule: if session is within 24 hours (IST), require admin approval
    const sessionDateTime = dayjs(
      `${session.scheduled_date} ${session.scheduled_time}`,
      'YYYY-MM-DD HH:mm:ss'
    ).tz('Asia/Kolkata');
    const hoursUntilSession = sessionDateTime.diff(now, 'hour', true);
    const rescheduleCount = session.reschedule_count || 0;
    
    console.log('🕐 24-hour rule check (IST):', {
      sessionDateTime: sessionDateTime.format('YYYY-MM-DD HH:mm:ss'),
      now: now.format('YYYY-MM-DD HH:mm:ss'),
      hoursUntilSession: hoursUntilSession.toFixed(2),
      rescheduleCount
    });

    // Decide if this reschedule needs admin approval:
    // - Always if within 24 hours
    // - Always from the second reschedule onwards (reschedule_count >= 1),
    //   even if it's still beyond 24 hours
    const requiresApproval = hoursUntilSession <= 24 || rescheduleCount >= 1;

    if (requiresApproval) {
      console.log('⚠️ Session requires admin approval for reschedule', {
        reason: hoursUntilSession <= 24 ? 'within_24_hours' : 'multiple_reschedules',
        hoursUntilSession: hoursUntilSession.toFixed(2),
        rescheduleCount
      });
      
      // Create reschedule request for admin approval
      
      try {
        // Create reschedule request notification for admin
        const { data: clientDetails } = await supabase
          .from('clients')
          .select('first_name, last_name, child_name, email')
          .eq('id', client.id)
          .single();

        const { data: psychologistDetails } = await supabase
          .from('psychologists')
          .select('first_name, last_name, email')
          .eq('id', session.psychologist_id)
          .single();

        const clientName = clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim();
        const psychologistName = `${psychologistDetails?.first_name || ''} ${psychologistDetails?.last_name || ''}`.trim();

        // Get all admin users to send notifications to
        // user_id is NOT NULL in notifications table, so we must have admin users
        const { data: adminUsers, error: adminUsersError } = await supabase
          .from('users')
          .select('id')
          .in('role', ['admin', 'superadmin']);

        if (adminUsersError || !adminUsers || adminUsers.length === 0) {
          console.error('Error fetching admin users or no admin users found:', adminUsersError);
          // Cannot create notification without user_id (NOT NULL constraint)
          // Log error but don't fail the reschedule request - session status is still updated
          console.warn('⚠️ Cannot create admin notification: No admin users found. Reschedule request will be created but admin may not be notified.');
        }

        // Create admin notifications for reschedule request
        // Schema: user_id (NOT NULL), title, message, type, is_read, related_id, related_type, created_at, updated_at
        // Note: user_role and metadata columns don't exist in the schema, so we store extra info in message
        const adminNotifications = [];
        
        if (adminUsers && adminUsers.length > 0) {
          // Create notification for each admin user
          adminUsers.forEach(admin => {
            // Include all relevant info in the message since metadata column doesn't exist
            const detailedMessage = `${clientName} has requested to reschedule their session from ${session.scheduled_date} at ${session.scheduled_time} to ${new_date} at ${new_time}. This requires admin approval as it's within 24 hours. Session ID: ${session.id}, Client ID: ${client.id}, Psychologist ID: ${session.psychologist_id}`;
            
            adminNotifications.push({
              user_id: admin.id, // NOT NULL - required
          title: 'Reschedule Request (Within 24 Hours)',
              message: detailedMessage,
              type: 'warning', // Must be one of: 'info', 'success', 'warning', 'error' per schema constraint
              related_id: session.id,
              related_type: 'session',
          is_read: false,
              created_at: new Date().toISOString()
            });
          });
        }

        // Only insert notifications if we have admin users
        if (adminNotifications.length > 0) {
        const { error: notificationError } = await supabase
          .from('notifications')
            .insert(adminNotifications);

        if (notificationError) {
          console.error('Error creating admin notification:', notificationError);
            // Don't fail the reschedule request if notification fails - session status is still updated
            console.warn('⚠️ Failed to create admin notifications, but reschedule request status is updated');
          } else {
            console.log(`✅ Created ${adminNotifications.length} admin notification(s) for reschedule request`);
          }
        }

        // Also create informational notification for psychologist (not for approval - admin approves)
        // Get psychologist user_id
        const { data: psychologistUser } = await supabase
          .from('psychologists')
          .select('user_id')
          .eq('id', session.psychologist_id)
          .single();

        if (psychologistUser?.user_id) {
          const psychologistNotification = {
            user_id: psychologistUser.user_id,
            title: 'Reschedule Request (Within 24 Hours)',
            message: `${clientName} has requested to reschedule their session from ${session.scheduled_date} at ${session.scheduled_time} to ${new_date} at ${new_time}. This request is pending admin approval as it's within 24 hours. You will be notified once admin makes a decision.`,
            type: 'info', // Informational only - not for approval
            related_id: session.id,
            related_type: 'session',
            is_read: false,
            created_at: new Date().toISOString()
          };

          const { error: psychNotificationError } = await supabase
            .from('notifications')
            .insert([psychologistNotification]);

          if (psychNotificationError) {
            console.error('Error creating psychologist notification:', psychNotificationError);
          } else {
            console.log('✅ Created informational notification for psychologist');
          }
        }

        // Update session status to indicate reschedule request
        const { error: updateError } = await supabase
          .from('sessions')
          .update({
            status: 'reschedule_requested',
            updated_at: new Date().toISOString()
          })
          .eq('id', sessionId);

        if (updateError) {
          console.error('Error updating session status:', updateError);
          return res.status(500).json(
            errorResponse('Failed to update session status')
          );
        }

        return res.json(
          successResponse(
            { 
              session: session,
              requiresApproval: true,
              hoursUntilSession: Math.round(hoursUntilSession * 100) / 100
            },
            'Reschedule request sent to admin for approval'
          )
        );

      } catch (error) {
        console.error('Error creating reschedule request:', error);
        return res.status(500).json(
          errorResponse('Failed to create reschedule request')
        );
      }
    }

    // Beyond 24 hours - proceed with direct reschedule
    console.log('✅ Session is beyond 24 hours, proceeding with direct reschedule');

    // Check if session can be rescheduled (redundant check but catches status changes)
    if (session.status === 'completed' || session.status === 'cancelled') {
      return res.status(400).json(
        errorResponse('Cannot reschedule completed or cancelled sessions')
      );
    }

    // CRITICAL FIX: Check if new time slot is available using availability service
    console.log('🔍 Checking time slot availability using availability service...');
    const isAvailable = await availabilityService.isTimeSlotAvailable(
      psychologist_id, 
      formatDate(new_date), 
      formatTime(new_time)
    );

    if (!isAvailable) {
      return res.status(400).json(
        errorResponse('Selected time slot is not available in psychologist schedule')
      );
    }
    console.log('✅ Time slot is available in psychologist schedule');

    // Check if new time slot is already booked by another session
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
        errorResponse('Selected time slot is already booked by another session')
      );
    }
    console.log('✅ No conflicting sessions found');

    // Get client and psychologist details for Meet link and notifications
    const { data: clientDetails } = await supabase
      .from('clients')
      .select('first_name, last_name, child_name, phone_number, email')
      .eq('id', client.id)
      .single();

    const { data: psychologistDetails } = await supabase
      .from('psychologists')
      .select('first_name, last_name, phone, email, google_calendar_credentials')
      .eq('id', psychologist_id)
      .single();

    // Update session with new date/time (Meet link will be added later in background)
    const updateData = {
      scheduled_date: formatDate(new_date),
      scheduled_time: formatTime(new_time),
      status: 'rescheduled',
      reschedule_count: (session.reschedule_count || 0) + 1,
      updated_at: new Date().toISOString()
    };

    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Error updating session:', updateError);
      return res.status(500).json(
        errorResponse('Failed to reschedule session')
      );
    }

    // CRITICAL: Return response IMMEDIATELY after session update
    // All heavy operations (Meet link, emails, WhatsApp, availability) will run async
    res.json(
      successResponse(updatedSession, 'Session rescheduled successfully')
    );

    // Continue with background tasks (don't await - let them run async)
    (async () => {
      try {
        // Create new Google Meet link for rescheduled session (async)
        // NOTE: We create a NEW Meet link (not reuse old one) because:
        // 1. The old Meet link is tied to the old calendar event with old date/time
        // 2. Google Calendar events are immutable - can't change date/time of existing event
        // 3. New Meet link ensures calendar event matches the new rescheduled date/time
        // If creation fails, we fall back to the old link (which will still work)
        let meetData = null;
        const meetLinkService = require('../utils/meetLinkService');
        try {
          console.log('🔄 Creating new Google Meet link for rescheduled session...');
          
          // Check if this is a free assessment session
          const isFreeAssessment = session.session_type === 'free_assessment';
          
          const sessionDataForMeet = {
            summary: isFreeAssessment 
              ? `Free Assessment - ${clientDetails?.child_name || clientDetails?.first_name}`
              : `Therapy Session - ${clientDetails?.child_name || clientDetails?.first_name} with ${psychologistDetails?.first_name}`,
            description: isFreeAssessment
              ? `Rescheduled free 20-minute assessment session`
              : `Rescheduled therapy session between ${clientDetails?.child_name || clientDetails?.first_name} and ${psychologistDetails?.first_name} ${psychologistDetails?.last_name}`,
            startDate: new_date,
            startTime: new_time,
            endTime: isFreeAssessment 
              ? addMinutesToTime(formatTime(new_time), 20)
              : addMinutesToTime(formatTime(new_time), 60),
            clientEmail: clientDetails?.email,
            psychologistEmail: psychologistDetails?.email,
            attendees: []
          };

          // Add attendees
          if (clientDetails?.email) {
            sessionDataForMeet.attendees.push(clientDetails.email);
          }
          if (psychologistDetails?.email) {
            sessionDataForMeet.attendees.push(psychologistDetails.email);
          }

          // Get OAuth credentials for Meet link creation
          let userAuth = null;
          if (isFreeAssessment) {
            // For free assessments, use assessment psychologist's OAuth credentials
            const { ensureAssessmentPsychologist } = require('./freeAssessmentController');
            const defaultPsychologist = await ensureAssessmentPsychologist();
            
            if (defaultPsychologist?.id) {
              const { data: assessmentPsychologist } = await supabase
                .from('psychologists')
                .select('id, email, google_calendar_credentials')
                .eq('id', defaultPsychologist.id)
                .single();
              
              if (assessmentPsychologist?.google_calendar_credentials) {
                const credentials = assessmentPsychologist.google_calendar_credentials;
                const now = Date.now();
                const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
                
                if (credentials.access_token) {
                  const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date).getTime() : null;
                  if (!expiryDate || expiryDate > (now + bufferTime)) {
                    userAuth = {
                      access_token: credentials.access_token,
                      refresh_token: credentials.refresh_token,
                      expiry_date: credentials.expiry_date
                    };
                    console.log('✅ Using assessment psychologist OAuth credentials for Meet link');
                  } else if (credentials.refresh_token) {
                    userAuth = {
                      access_token: credentials.access_token,
                      refresh_token: credentials.refresh_token,
                      expiry_date: credentials.expiry_date
                    };
                    console.log('⚠️ Assessment psychologist OAuth token expired, but refresh token available');
                  }
                }
              }
            }
          } else {
            // For regular therapy sessions, use the session's psychologist OAuth credentials
            if (psychologistDetails?.google_calendar_credentials) {
              try {
                const credentials = psychologistDetails.google_calendar_credentials;
                const now = Date.now();
                const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
                
                if (credentials.access_token) {
                  const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date).getTime() : null;
                  if (!expiryDate || expiryDate > (now + bufferTime)) {
                    // Token is valid
                    userAuth = {
                      access_token: credentials.access_token,
                      refresh_token: credentials.refresh_token,
                      expiry_date: credentials.expiry_date
                    };
                    console.log('✅ Using psychologist OAuth credentials for Meet link creation (token valid)');
                  } else if (credentials.refresh_token) {
                    // Token expired but we have refresh token - pass both to service for auto-refresh
                    userAuth = {
                      access_token: credentials.access_token, // May be expired, service will refresh
                      refresh_token: credentials.refresh_token,
                      expiry_date: credentials.expiry_date
                    };
                    console.log('⚠️ Psychologist OAuth token expired, but refresh token available - service will attempt refresh');
                  } else {
                    console.log('⚠️ Psychologist OAuth credentials expired and no refresh token - will use fallback method');
                  }
                }
              } catch (credError) {
                console.warn('⚠️ Error parsing psychologist OAuth credentials:', credError.message);
              }
            } else {
              console.log('ℹ️ Psychologist does not have Google Calendar connected - will use service account method (may not create real Meet link)');
            }
          }

          const meetResult = await meetLinkService.generateSessionMeetLink(sessionDataForMeet, userAuth);
          
          if (meetResult.success && meetResult.meetLink) {
            meetData = {
              meetLink: meetResult.meetLink,
              eventId: meetResult.eventId,
              calendarLink: meetResult.eventLink || null,
            };
            console.log('✅ New Google Meet link created for rescheduled session');
            
            // Update session with new Meet link
            await supabase
              .from('sessions')
              .update({
                google_meet_link: meetResult.meetLink,
                google_calendar_event_id: meetResult.eventId || null,
                google_meet_join_url: meetResult.meetLink,
                google_meet_start_url: meetResult.meetLink,
                ...(meetResult.eventLink && { google_calendar_link: meetResult.eventLink })
              })
              .eq('id', sessionId);
          } else {
            console.log('⚠️ Using existing Meet link as fallback');
            meetData = {
              meetLink: session.google_meet_link || null,
              eventId: session.google_calendar_event_id || null,
              calendarLink: null,
            };
          }
        } catch (meetError) {
          console.error('❌ Meet link creation failed:', meetError);
          // Use existing meet link as fallback
          meetData = {
            meetLink: session.google_meet_link || null,
            eventId: session.google_calendar_event_id || null,
            calendarLink: null,
          };
        }

        // CRITICAL FIX: Update availability table - release old slot and block new slot
        // Do this for regular sessions (free assessments handled separately below)
        if (session.session_type !== 'free_assessment') {
      try {
        console.log('🔄 Updating availability table for rescheduled session...');
        
        // Helper function to convert 24-hour time to 12-hour format
        const convertTo12Hour = (time24) => {
          if (!time24) return null;
          // Handle if already in 12-hour format
          if (time24.includes('AM') || time24.includes('PM')) {
            return time24;
          }
          const timeOnly = time24.split(' ')[0]; // Remove any timezone suffix
          const [hours, minutes] = timeOnly.split(':');
          const hour = parseInt(hours, 10);
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

        // Release old slot - add it back to availability
        const oldDate = session.scheduled_date;
        const oldTime = session.scheduled_time;
        const oldTime12Hour = convertTo12Hour(oldTime);
        
        if (oldTime12Hour) {
          // Use limit(1) instead of single() to handle cases where multiple records exist
          const { data: oldAvailRecords } = await supabase
            .from('availability')
            .select('id, time_slots')
            .eq('psychologist_id', psychologist_id)
            .eq('date', oldDate)
            .limit(1);
          
          const oldAvail = oldAvailRecords && oldAvailRecords.length > 0 ? oldAvailRecords[0] : null;
          
          if (oldAvailRecords && oldAvailRecords.length > 1) {
            console.warn(`⚠️ Multiple availability records found for psychologist ${psychologist_id} on ${oldDate}, using first one`);
          }

          if (oldAvail && oldAvail.time_slots) {
            const oldSlots = Array.isArray(oldAvail.time_slots) ? oldAvail.time_slots : [];
            // Check if slot is not already in the list (to avoid duplicates)
            const slotExists = oldSlots.some(slot => {
              const slotStr = typeof slot === 'string' ? slot.trim() : String(slot).trim();
              return slotStr.toLowerCase() === oldTime12Hour.toLowerCase();
            });
            
            if (!slotExists) {
              const updatedSlots = [...oldSlots, oldTime12Hour].sort();
              await supabase
                .from('availability')
                .update({ 
                  time_slots: updatedSlots,
                  updated_at: new Date().toISOString()
                })
                .eq('id', oldAvail.id);
              console.log(`✅ Released old slot ${oldTime12Hour} on ${oldDate}`);
            }
          }
        }

        // Block new slot - remove it from availability using the service
        await availabilityService.updateAvailabilityOnBooking(
          psychologist_id,
          formatDate(new_date),
          formatTime(new_time)
        );
          console.log(`✅ Blocked new slot ${formatTime(new_time)} on ${formatDate(new_date)}`);
        } catch (availabilityError) {
          console.error('⚠️ Error updating availability table:', availabilityError);
          // Don't fail the reschedule if availability update fails, but log it
          // The session is already updated, so we continue
        }
        }

        // For free assessment sessions, update the timeslot availability
        if (session.session_type === 'free_assessment') {
      try {
        const oldDate = session.scheduled_date;
        const oldTime = session.scheduled_time;
        const newDate = formatDate(new_date);
        const newTime = formatTime(new_time);

        // Add back the old slot
        const { data: oldDateConfig } = await supabase
          .from('free_assessment_date_configs')
          .select('time_slots')
          .eq('date', oldDate)
          .single();

        if (oldDateConfig && oldDateConfig.time_slots) {
          const oldSlots = Array.isArray(oldDateConfig.time_slots) ? oldDateConfig.time_slots : [];
          if (!oldSlots.includes(oldTime)) {
            oldSlots.push(oldTime);
            oldSlots.sort();
            await supabase
              .from('free_assessment_date_configs')
              .update({ time_slots: oldSlots })
              .eq('date', oldDate);
            console.log(`✅ Added back old slot ${oldTime} on ${oldDate}`);
          }
        }

        // Remove the new slot
        const { data: newDateConfig } = await supabase
          .from('free_assessment_date_configs')
          .select('time_slots')
          .eq('date', newDate)
          .single();

        if (newDateConfig && newDateConfig.time_slots) {
          const newSlots = Array.isArray(newDateConfig.time_slots) ? newDateConfig.time_slots : [];
          const index = newSlots.indexOf(newTime);
          if (index > -1) {
            newSlots.splice(index, 1);
            await supabase
              .from('free_assessment_date_configs')
              .update({ time_slots: newSlots })
              .eq('date', newDate);
            console.log(`✅ Removed booked slot ${newTime} from free assessment config on ${newDate}`);
          }
        }
        } catch (slotError) {
          console.error('⚠️ Error updating free assessment timeslots:', slotError);
          // Don't fail the reschedule if timeslot update fails
        }
        }

        // Create notification for psychologist
        await createRescheduleNotification(session, updatedSession, client.id);

        // Send email notifications
        try {
          const emailService = require('../utils/emailService');
          await emailService.sendRescheduleNotification(
        {
          clientName: clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim(),
          psychologistName: `${psychologistDetails?.first_name || ''} ${psychologistDetails?.last_name || ''}`.trim(),
          clientEmail: clientDetails?.email,
          psychologistEmail: psychologistDetails?.email,
          scheduledDate: updatedSession.scheduled_date,
          scheduledTime: updatedSession.scheduled_time,
          sessionId: updatedSession.id,
          meetLink: meetData?.meetLink,
          isFreeAssessment: session.session_type === 'free_assessment'
        },
        session.scheduled_date,
        session.scheduled_time
      );
          console.log('✅ Reschedule emails sent successfully');
        } catch (emailError) {
          console.error('Error sending reschedule emails:', emailError);
          // Continue even if email fails
        }

        // Send WhatsApp notifications for reschedule
        try {
          console.log('📱 Sending WhatsApp notifications for reschedule...');
      const { sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
      
      const clientName = clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim();
      const psychologistName = `${psychologistDetails?.first_name || ''} ${psychologistDetails?.last_name || ''}`.trim();
      
      const originalDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short'
      });
      const newDateTime = new Date(`${updatedSession.scheduled_date}T${updatedSession.scheduled_time}`).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short'
      });

      // Check if this is a free assessment session
      const isFreeAssessment = session.session_type === 'free_assessment';
      const sessionType = isFreeAssessment ? 'free assessment' : 'therapy session';

      // Send WhatsApp to client
      if (clientDetails?.phone_number) {
        const clientMessage = `🔄 Your ${sessionType} has been rescheduled.\n\n` +
          `❌ Old: ${originalDateTime}\n` +
          `✅ New: ${newDateTime}\n\n` +
          (meetData?.meetLink 
            ? `🔗 New Google Meet Link: ${meetData.meetLink}\n\n`
            : '') +
          `Please update your calendar. We look forward to seeing you at the new time!`;

        const clientResult = await sendWhatsAppTextWithRetry(clientDetails.phone_number, clientMessage);
        if (clientResult?.success) {
          console.log(`✅ Reschedule WhatsApp sent to client (${sessionType})`);
        } else {
          console.warn('⚠️ Failed to send reschedule WhatsApp to client');
        }
      }

      // Send WhatsApp to psychologist
      if (psychologistDetails?.phone) {
        const psychologistMessage = `🔄 ${isFreeAssessment ? 'Free assessment' : 'Session'} rescheduled with ${clientName}.\n\n` +
          `❌ Old: ${originalDateTime}\n` +
          `✅ New: ${newDateTime}\n\n` +
          `👤 Client: ${clientName}\n` +
          (meetData?.meetLink 
            ? `🔗 New Google Meet Link: ${meetData.meetLink}\n\n`
            : '\n') +
          `Session ID: ${session.id}`;

        const psychologistResult = await sendWhatsAppTextWithRetry(psychologistDetails.phone, psychologistMessage);
        if (psychologistResult?.success) {
          console.log(`✅ Reschedule WhatsApp sent to psychologist (${sessionType})`);
        } else {
          console.warn('⚠️ Failed to send reschedule WhatsApp to psychologist');
        }
      }
      
          console.log('✅ WhatsApp notifications sent for reschedule');
        } catch (waError) {
          console.error('❌ Error sending reschedule WhatsApp:', waError);
          // Continue even if WhatsApp fails
        }

        console.log('✅ Session rescheduled successfully');
        
        // PRIORITY: Check and send reminder immediately if rescheduled session is 2 hours away
        // This gives rescheduled bookings priority over batch reminder processing
        try {
          const sessionReminderService = require('../services/sessionReminderService');
          // Run asynchronously to not block the response
          sessionReminderService.checkAndSendReminderForSessionId(updatedSession.id).catch(err => {
            console.error('❌ Error in priority reminder check:', err);
            // Don't block response - reminder will be sent in next hourly check
          });
        } catch (reminderError) {
          console.error('❌ Error initiating priority reminder check:', reminderError);
          // Don't block response
        }
        
        // Log successful reschedule
        await userInteractionLogger.logReschedule({
          userId,
          userRole: req.user.role,
          sessionId,
          oldDate: session.scheduled_date,
          oldTime: session.scheduled_time,
          newDate: formatDate(new_date),
          newTime: formatTime(new_time),
          status: 'success'
        });
      } catch (backgroundError) {
        console.error('❌ Error in background reschedule tasks:', backgroundError);
        // Don't throw - background tasks shouldn't affect the response
      }
    })();

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

    // Get psychologist user_id (required for notifications table)
    const { data: psychologistUser } = await supabase
      .from('psychologists')
      .select('user_id')
      .eq('id', updatedSession.psychologist_id)
      .single();

    if (!psychologistUser?.user_id) {
      console.warn('⚠️ Cannot create psychologist notification: No user_id found for psychologist');
      return;
    }

    // Format dates for notification message
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

    // Create notification record using correct schema
    // Schema: user_id (NOT NULL), title, message, type, is_read, related_id, related_type, created_at, updated_at
    const notificationData = {
      user_id: psychologistUser.user_id, // NOT NULL - required
      title: 'Session Rescheduled',
      message: `${clientName} has rescheduled their session from ${originalSession.scheduled_date} at ${originalSession.scheduled_time} to ${updatedSession.scheduled_date} at ${updatedSession.scheduled_time}`,
      type: 'info', // Must be one of: 'info', 'success', 'warning', 'error' per schema constraint
      related_id: updatedSession.id,
      related_type: 'session',
      is_read: false,
      created_at: new Date().toISOString()
    };

    const { error: notificationError } = await supabase
      .from('notifications')
      .insert([notificationData]);

    if (notificationError) {
      console.error('Error creating reschedule notification:', notificationError);
    } else {
      console.log('✅ Reschedule notification created for psychologist');
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
    // Use client_id if available (new system), otherwise fall back to req.user.id (old system)
    const clientId = req.user.client_id || req.user.id;
    const { sessionId } = req.params;

    console.log(`📋 Getting session ${sessionId} for client ${clientId} (user.id: ${req.user.id}, client_id: ${req.user.client_id})`);

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
    let clientId = null;

    // Try multiple lookup strategies (same pattern as updateProfile)
    // Priority: 1) client_id (from middleware), 2) user_id (new system), 3) id (old system fallback)
    if (req.user.client_id) {
      clientId = req.user.client_id;
    } else {
      // Try new system: lookup by user_id
      const { data: clientByUserId, error: errorByUserId } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (clientByUserId && !errorByUserId) {
        clientId = clientByUserId.id;
      } else {
        // Fallback to old system: lookup by id (backward compatibility)
        const { data: clientById, error: errorById } = await supabase
          .from('clients')
          .select('id')
          .eq('id', userId)
          .single();

        if (clientById && !errorById) {
          clientId = clientById.id;
        }
      }
    }

    if (!clientId) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const fetchClientPackages = async () => {
      return await supabase
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
    };

    let { data: clientPackages, error: packagesError } = await fetchClientPackages();

    if (packagesError) {
      console.error('Error fetching client packages:', packagesError);
      return res.status(500).json(
        errorResponse('Failed to fetch client packages')
      );
    }

    const existingPackageIds = new Set(
      (clientPackages || []).map(pkg => pkg.package_id || pkg.id).filter(Boolean)
    );

    const { data: packageSessions, error: packageSessionsError } = await supabase
      .from('sessions')
      .select('id, package_id, psychologist_id, status, scheduled_date, created_at')
      .eq('client_id', clientId)
      .not('package_id', 'is', null);

    if (packageSessionsError) {
      console.error('Error fetching package sessions:', packageSessionsError);
    } else if (packageSessions && packageSessions.length > 0) {
      let backfillAdded = false;
      const sessionsByPackage = packageSessions.reduce((acc, session) => {
        if (!session.package_id) return acc;
        if (!acc.has(session.package_id)) {
          acc.set(session.package_id, []);
        }
        acc.get(session.package_id).push(session);
        return acc;
      }, new Map());

      for (const [packageId, sessionsForPackage] of sessionsByPackage.entries()) {
        if (existingPackageIds.has(packageId)) continue;

        try {
          const { data: packageRecord } = await supabase
            .from('packages')
            .select('*')
            .eq('id', packageId)
            .single();

          if (!packageRecord) continue;

          const completedSessions = sessionsForPackage.filter(
            (session) => !['cancelled'].includes(session.status)
          ).length;
          const earliestSession = sessionsForPackage.reduce((earliest, session) => {
            if (!earliest) return session;
            const earliestDate = new Date(earliest.scheduled_date || earliest.created_at || 0);
            const sessionDate = new Date(session.scheduled_date || session.created_at || 0);
            return sessionDate < earliestDate ? session : earliest;
          }, null);

          const psychologistId = earliestSession?.psychologist_id || packageRecord.psychologist_id;

          const { created, error: backfillError } = await ensureClientPackageRecord({
            clientId,
            psychologistId,
            packageId,
            sessionId: earliestSession?.id || null,
            purchasedAt: earliestSession?.created_at || new Date().toISOString(),
            packageData: packageRecord,
            consumedSessions: Math.max(completedSessions, 1)
          });

          if (backfillError) {
            console.error('Failed to backfill client package:', backfillError);
          } else if (created) {
            console.log('✅ Backfilled client package for package_id:', packageId);
            backfillAdded = true;
          }
        } catch (backfillException) {
          console.error('Exception while backfilling client package:', backfillException);
        }
      }

      if (backfillAdded) {
        const refetch = await fetchClientPackages();
        if (!refetch.error && refetch.data) {
          clientPackages = refetch.data;
        }
      }
    }

    const normalizedPackages = (clientPackages || []).map(pkg => {
      const totalSessions = deriveSessionCount(pkg);

      const remainingSessions = Number.isFinite(pkg.remaining_sessions) && pkg.remaining_sessions >= 0
        ? pkg.remaining_sessions
        : Math.max(totalSessions - 1, 0);

      return {
        ...pkg,
        total_sessions: totalSessions,
        remaining_sessions: remainingSessions,
        status: remainingSessions === 0 ? 'completed' : (pkg.status || 'active')
      };
    });

    res.json(
      successResponse({
        clientPackages: normalizedPackages
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

    // Get client ID - use multi-strategy lookup (same pattern as getClientPackages)
    let clientId = null;

    // Priority: 1) client_id (from middleware), 2) user_id (new system), 3) id (old system fallback)
    if (req.user.client_id) {
      clientId = req.user.client_id;
    } else {
      // Try new system: lookup by user_id
      const { data: clientByUserId, error: errorByUserId } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (clientByUserId && !errorByUserId) {
        clientId = clientByUserId.id;
      } else {
        // Fallback to old system: lookup by id (backward compatibility)
        const { data: clientById, error: errorById } = await supabase
          .from('clients')
          .select('id')
          .eq('id', userId)
          .single();

        if (clientById && !errorById) {
          clientId = clientById.id;
        }
      }
    }

    if (!clientId) {
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

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

    const totalSessions = deriveSessionCount(clientPackage);
    const currentRemaining = Number.isFinite(clientPackage.remaining_sessions)
      ? clientPackage.remaining_sessions
      : Math.max(totalSessions - 1, 0);
    const updatedRemaining = Math.max(currentRemaining - 1, 0);

    // Calculate completed sessions (total - remaining after this booking)
    const completedSessions = totalSessions - updatedRemaining;

    // Update remaining sessions in client package
    const { error: updateError } = await supabase
      .from('client_packages')
      .update({
        remaining_sessions: updatedRemaining,
        updated_at: new Date().toISOString()
      })
      .eq('id', package_id);

    if (updateError) {
      console.error('Failed to update remaining sessions:', updateError);
      // Continue even if update fails
    }

    // Prepare names for notifications
    const clientName = clientDetails.child_name || 
                      `${clientDetails.first_name} ${clientDetails.last_name}`.trim();
    const psychologistName = `${psychologistDetails.first_name} ${psychologistDetails.last_name}`.trim();

    // Package information for notifications
    const packageInfo = {
      totalSessions: totalSessions,
      completedSessions: completedSessions,
      remainingSessions: updatedRemaining,
      packageType: clientPackage.package?.package_type || null
    };

    // Send email notifications
    try {
      const emailService = require('../utils/emailService');

      await emailService.sendSessionConfirmation({
        clientEmail: clientDetails.email || 'client@placeholder.com',
        psychologistEmail: psychologistDetails?.email || 'psychologist@placeholder.com',
        clientName,
        psychologistName,
        sessionId: session.id,
        scheduledDate: scheduled_date,
        scheduledTime: scheduled_time,
        meetLink: meetData.meetLink,
        price: 0,
        packageInfo: packageInfo
      });
      console.log('✅ Email notifications sent successfully');
    } catch (emailError) {
      console.error('❌ Error sending email notifications:', emailError);
      // Continue even if email fails
    }

    // Send WhatsApp messages to client and psychologist via UltraMsg
    try {
      console.log('📱 Sending WhatsApp notifications via UltraMsg API...');
      const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/whatsappService');

      // Send WhatsApp to client
      const clientPhone = clientDetails.phone_number || null;
      if (clientPhone && meetData?.meetLink) {
        // Only include childName if child_name exists and is not empty/null/'Pending'
        const childName = clientDetails.child_name && 
          clientDetails.child_name.trim() !== '' && 
          clientDetails.child_name.toLowerCase() !== 'pending'
          ? clientDetails.child_name 
          : null;
        
        const clientDetails_wa = {
          childName: childName,
          date: scheduled_date,
          time: scheduled_time,
          meetLink: meetData.meetLink,
          psychologistName: psychologistName, // Add psychologist name to WhatsApp message
          packageInfo: packageInfo
        };
        const clientWaResult = await sendBookingConfirmation(clientPhone, clientDetails_wa);
        if (clientWaResult?.success) {
          console.log('✅ WhatsApp confirmation sent to client via UltraMsg');
        } else if (clientWaResult?.skipped) {
          console.log('ℹ️ Client WhatsApp skipped:', clientWaResult.reason);
        } else {
          console.warn('⚠️ Client WhatsApp send failed');
        }
      } else {
        console.log('ℹ️ No client phone or meet link; skipping client WhatsApp');
      }

      // Send WhatsApp to psychologist
      const psychologistPhone = psychologistDetails.phone || null;
      if (psychologistPhone && meetData?.meetLink) {
        let psychologistMessage = `New session booked with ${clientName}.\n\nDate: ${scheduled_date}\nTime: ${scheduled_time}\n\n`;
        
        // Add package information if it's a package session
        if (packageInfo && packageInfo.totalSessions) {
          psychologistMessage += `📦 Package Session: ${packageInfo.completedSessions || 0}/${packageInfo.totalSessions} completed, ${packageInfo.remainingSessions || 0} remaining\n\n`;
        }
        
        psychologistMessage += `Join via Google Meet: ${meetData.meetLink}\n\nClient: ${clientName}\nSession ID: ${session.id}`;
        
        const psychologistWaResult = await sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
        if (psychologistWaResult?.success) {
          console.log('✅ WhatsApp notification sent to psychologist via UltraMsg');
        } else if (psychologistWaResult?.skipped) {
          console.log('ℹ️ Psychologist WhatsApp skipped:', psychologistWaResult.reason);
        } else {
          console.warn('⚠️ Psychologist WhatsApp send failed');
        }
      } else {
        console.log('ℹ️ No psychologist phone or meet link; skipping psychologist WhatsApp');
      }
      
      console.log('✅ WhatsApp messages sent successfully via UltraMsg');
    } catch (waError) {
      console.error('❌ Error sending WhatsApp messages:', waError);
      // Continue even if WhatsApp sending fails
    }

    console.log('✅ Remaining session booked successfully');
    
    // PRIORITY: Check and send reminder immediately if remaining session booking is 2 hours away
    // This gives new bookings priority over batch reminder processing
    try {
      const sessionReminderService = require('../services/sessionReminderService');
      // Run asynchronously to not block the response
      sessionReminderService.checkAndSendReminderForSessionId(session.id).catch(err => {
        console.error('❌ Error in priority reminder check:', err);
        // Don't block response - reminder will be sent in next hourly check
      });
    } catch (reminderError) {
      console.error('❌ Error initiating priority reminder check:', reminderError);
      // Don't block response
    }
    
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
    // Get client by user_id (new system); fallback to id (legacy)
    let { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (clientError || !client) {
      const fallback = await supabase
        .from('clients')
        .select('*')
        .eq('id', userId)
        .single();
      client = fallback.data;
      clientError = fallback.error;
    }

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
      console.log('🔍 Looking up package with ID:', package_id);
      const { data: packageData, error: packageError } = await supabase
        .from('packages')
        .select('*')
        .eq('id', package_id)
        .single();
      
      if (packageError) {
        console.error('❌ Package lookup error:', packageError);
        return res.status(404).json(
          errorResponse(`Package not found: ${packageError.message || 'Invalid package ID'}`)
        );
      }
      
      if (!packageData) {
        console.error('❌ Package not found for ID:', package_id);
        return res.status(404).json(
          errorResponse('Selected package not found. Please select a valid package.')
        );
      }
      
        package = packageData;
      console.log('✅ Package found:', {
        id: package.id,
        name: package.name,
        price: package.price,
        session_count: package.session_count
      });
      
      // Validate package has a price
      if (!package.price || package.price <= 0) {
        console.error('❌ Package price is missing or invalid:', package.price);
        return res.status(400).json(
          errorResponse('Selected package has an invalid price. Please contact support.')
        );
      }
    } else {
      console.log('ℹ️ Individual session selected');
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

    // Determine price - no fallback, must be explicit
    let price = null;
    
    if (package) {
      // Package booking - use package price
      price = package.price;
      console.log('💰 Using package price:', price);
    } else {
      // Individual session - use individual_session_price field first, then fallback to description
      if (psychologistDetails.individual_session_price) {
        // Use dedicated individual_session_price field
        price = parseFloat(psychologistDetails.individual_session_price);
        console.log('✅ Using individual_session_price field:', price);
      } else if (psychologistDetails.description) {
        // Fallback: Try to extract from description
        const priceMatch = psychologistDetails.description.match(/Individual Session Price: [₹\$](\d+(?:\.\d+)?)/);
      if (priceMatch) {
          price = parseFloat(priceMatch[1]);
          console.log('✅ Extracted individual price from description:', price);
      }
    }

      // Validate individual session price
      if (!price || price <= 0 || isNaN(price)) {
        console.error('❌ Individual session price is missing or invalid:', {
          individual_session_price: psychologistDetails.individual_session_price,
          hasDescription: !!psychologistDetails.description
        });
        return res.status(400).json(
          errorResponse('Individual session price is not configured. Please select a package or contact support.')
        );
      }
    }
    
    // Final validation - price must be valid
    if (!price || price <= 0 || isNaN(price)) {
      console.error('❌ Final price validation failed:', price);
      return res.status(400).json(
        errorResponse('Unable to determine session price. Please contact support.')
      );
    }
    
    console.log('💰 Final price:', price);

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

    // Get client ID - userId is from users.id, so we need to query clients.user_id
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
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

/**
 * Book a session using an existing payment credit (no new payment).
 * Expects: transaction_id, scheduled_date, scheduled_time, psychologist_id (must match credit).
 */
const bookSessionWithCredit = async (req, res) => {
  try {
    const { psychologist_id, scheduled_date, scheduled_time, transaction_id } = req.body;

    if (!psychologist_id || !scheduled_date || !scheduled_time || !transaction_id) {
      return res.status(400).json(
        errorResponse('Missing required fields: psychologist_id, scheduled_date, scheduled_time, transaction_id')
      );
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== 'client') {
      return res.status(403).json(
        errorResponse('Only clients can book sessions')
      );
    }

    // Get client profile
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

    // Look up the payment credit
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', transaction_id)
      .eq('client_id', clientId)
      .single();

    if (paymentError || !payment) {
      console.error('Payment credit not found:', paymentError);
      return res.status(404).json(
        errorResponse('Payment credit not found')
      );
    }

    // Credit is valid only if payment is still pending, has a Razorpay payment id and no session yet
    if (payment.status !== 'pending' || !payment.razorpay_payment_id || payment.session_id) {
      return res.status(400).json(
        errorResponse('This payment credit has already been used or is not available')
      );
    }

    if (payment.psychologist_id !== psychologist_id) {
      return res.status(400).json(
        errorResponse('This payment credit is not valid for the selected psychologist')
      );
    }

    // Check time slot availability
    console.log('🔍 Checking time slot availability for credit booking...');
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

    console.log('✅ Time slot is available for credit booking');

    // Fetch client and psychologist details for meet link
    const { data: clientDetails, error: clientDetailsError } = await supabase
      .from('clients')
      .select(`
        first_name, 
        last_name, 
        child_name,
        phone_number,
        user:users(email)
      `)
      .eq('id', clientId)
      .single();

    if (clientDetailsError || !clientDetails) {
      console.error('Error fetching client details for credit booking:', clientDetailsError);
      return res.status(500).json(
        errorResponse('Failed to fetch client details')
      );
    }

    const { data: psychologistDetails, error: psychologistDetailsError } = await supabase
      .from('psychologists')
      .select('first_name, last_name, email, phone')
      .eq('id', psychologist_id)
      .single();

    if (psychologistDetailsError || !psychologistDetails) {
      console.error('Error fetching psychologist details for credit booking:', psychologistDetailsError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologist details')
      );
    }

    // Create Google Meet link (same as normal booking)
    let meetData = null;
    try {
      const sessionData = {
        summary: `Therapy Session - ${clientDetails?.child_name || 'Client'} with ${psychologistDetails?.first_name || 'Psychologist'}`,
        description: `Therapy session between ${clientDetails?.child_name || 'Client'} and ${psychologistDetails?.first_name || 'Psychologist'}`,
        startDate: scheduled_date,
        startTime: scheduled_time,
        endTime: addMinutesToTime(scheduled_time, 50)
      };

      const meetResult = await meetLinkService.generateSessionMeetLink(sessionData);
      if (meetResult.success) {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || null,
          method: meetResult.method
        };
      } else {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: null,
          calendarLink: null,
          method: meetResult.method || 'fallback'
        };
      }
    } catch (meetError) {
      console.error('⚠️ Error creating Google Meet link for credit booking:', meetError);
    }

    // Create session using the existing payment
    const sessionInsert = {
      client_id: clientId,
      psychologist_id: psychologist_id,
      scheduled_date,
      scheduled_time,
      status: 'booked',
      price: payment.amount,
      payment_id: payment.id
    };

    if (meetData) {
      sessionInsert.google_meet_link = meetData.meetLink;
      // Some deployments may not have a separate google_meet_event_id column; 
      // we only store the meet link here to keep compatibility.
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([sessionInsert])
      .select('*')
      .single();

    if (sessionError) {
      console.error('❌ Session creation failed for credit booking:', sessionError);
      return res.status(500).json(
        errorResponse('Failed to create session with existing payment. Please contact support.')
      );
    }

    // Mark payment as fully used
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'success',
        session_id: session.id
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error('⚠️ Failed to update payment status after credit booking:', updateError);
    }

    return res.json(
      successResponse(
        {
          sessionId: session.id,
          paymentId: payment.id
        },
        'Session booked successfully using existing payment'
      )
    );
  } catch (error) {
    console.error('Book session with credit error:', error);
    res.status(500).json(
      errorResponse('Internal server error while booking session with existing payment')
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
  getFreeAssessmentAvailabilityForReschedule,
  reserveAssessmentSlot,
  bookAssessment,
  getAssessmentSessions,
  getPaymentCredit,
  bookSessionWithCredit
};
