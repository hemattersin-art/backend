const { supabaseAdmin } = require('../config/supabase');
const { 
  successResponse, 
  errorResponse,
  hashPassword,
  formatDate,
  formatTime,
  addMinutesToTime
} = require('../utils/helpers');

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

// Get all users
const getAllUsers = async (req, res) => {
  try {
    console.log('=== getAllUsers function called ===');
    console.log('Query params:', req.query);
    
    // HIGH-RISK FIX: Parameter pollution defense - normalize query params (reject arrays)
    const normalizeParam = (param) => {
      if (Array.isArray(param)) {
        return null; // Reject arrays
      }
      return param;
    };

    const page = normalizeParam(req.query.page) || 1;
    const limit = normalizeParam(req.query.limit) || 10;
    const role = normalizeParam(req.query.role);
    const search = normalizeParam(req.query.search);
    const sort = normalizeParam(req.query.sort) || 'created_at';
    const order = normalizeParam(req.query.order) || 'desc';

    if (Array.isArray(req.query.page) || Array.isArray(req.query.limit) || 
        Array.isArray(req.query.role) || Array.isArray(req.query.search) ||
        Array.isArray(req.query.sort) || Array.isArray(req.query.order)) {
      return res.status(400).json(
        errorResponse('Invalid query parameters. Arrays not allowed.')
      );
    }

    // If fetching psychologists, get them directly from psychologists table
    if (role === 'psychologist') {
      console.log('=== Fetching psychologists directly from psychologists table ===');
      
      // Filter out assessment psychologist from admin view
      const assessmentEmail = (process.env.FREE_ASSESSMENT_PSYCHOLOGIST_EMAIL || 'assessment.koott@gmail.com').toLowerCase();
      
      // Fetch psychologists directly from psychologists table with pagination
      const offset = (page - 1) * limit;
      // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
      const { data: psychologists, error: psychError } = await supabaseAdmin
        .from('psychologists')
        .select('*')
        .neq('email', assessmentEmail)
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: order === 'asc' });

      if (psychError) {
        console.error('Error fetching psychologists:', psychError);
        return res.status(500).json(
          errorResponse('Failed to fetch psychologists')
        );
      }

      // Sort by display_order first (ascending, nulls last), then by created_at (descending)
      if (psychologists && psychologists.length > 0) {
        psychologists.sort((a, b) => {
          // Handle null/undefined display_order values
          const aOrder = a.display_order !== null && a.display_order !== undefined ? a.display_order : null;
          const bOrder = b.display_order !== null && b.display_order !== undefined ? b.display_order : null;
          
          // If only one has display_order, the one with display_order comes first
          if (aOrder !== null && bOrder === null) {
            return -1; // a comes before b
          }
          if (aOrder === null && bOrder !== null) {
            return 1; // b comes before a
          }
          
          // If both have display_order, sort by display_order ascending
          if (aOrder !== null && bOrder !== null) {
            if (aOrder !== bOrder) {
              return aOrder - bOrder;
            }
            // If display_order is equal, sort by created_at descending
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            return dateB - dateA;
          }
          
          // If both are null (no display_order), sort by created_at descending
          const dateA = new Date(a.created_at);
          const dateB = new Date(b.created_at);
          return dateB - dateA;
        });
      }

      console.log('Successfully fetched psychologists:', psychologists?.length || 0);
      if (psychologists && psychologists.length > 0) {
        console.log('Psychologists IDs:', psychologists.map(p => ({ id: p.id, name: `${p.first_name} ${p.last_name}` })));
      }
      
      // Convert psychologists to the expected format
      const enrichedPsychologists = psychologists.map(psych => ({
        id: psych.id, // Use psychologist ID as the main ID
        email: psych.email,
        role: 'psychologist',
        profile_picture_url: null,
        created_at: psych.created_at,
        updated_at: psych.updated_at,
        psychologist_id: psych.id, // For delete operations
        first_name: psych.first_name || '',
        last_name: psych.last_name || '',
        name: psych ? `${psych.first_name} ${psych.last_name}`.trim() : '',
        phone: psych.phone || '',
        ug_college: psych.ug_college || '',
        pg_college: psych.pg_college || '',
        phd_college: psych.phd_college || '',
        description: psych.description || '',
        experience_years: psych.experience_years || 0,
        designation: psych.designation || '',
        languages_json: psych.languages_json || null,
        area_of_expertise: psych.area_of_expertise || [],
        personality_traits: psych.personality_traits || [], // NEW
        availability: [], // Will be populated below
        cover_image_url: psych.cover_image_url || null,
        display_order: psych.display_order || null // Display order for sorting
      }));

      // Fetch availability data for all psychologists
      if (enrichedPsychologists.length > 0) {
        try {
          const psychologistIds = enrichedPsychologists
            .map(user => user.psychologist_id)
            .filter(Boolean);

          if (psychologistIds.length > 0) {
            // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
            const { data: availabilityData, error: availabilityError } = await supabaseAdmin
              .from('availability')
              .select('*')
              .in('psychologist_id', psychologistIds);

            if (!availabilityError && availabilityData) {
              console.log('Availability data fetched - count:', availabilityData?.length || 0);
              
              // Group availability by psychologist_id
              const availabilityMap = {};
              availabilityData.forEach(avail => {
                if (!availabilityMap[avail.psychologist_id]) {
                  availabilityMap[avail.psychologist_id] = [];
                }
                
                // Format time_slots to match frontend expectations
                const formattedTimeSlots = avail.time_slots.map(timeString => ({
                  time: timeString,
                  available: true,
                  displayTime: timeString
                }));
                
                availabilityMap[avail.psychologist_id].push({
                  date: avail.date,
                  time_slots: formattedTimeSlots,
                  is_available: avail.is_available
                });
              });

              // Add availability to enriched users
              enrichedPsychologists.forEach(user => {
                user.availability = availabilityMap[user.psychologist_id] || [];
              });
            }
          }
        } catch (availabilityError) {
          console.error('Error fetching availability data:', availabilityError);
          // Continue without availability data
        }
      }

      console.log('Final enriched psychologists:', enrichedPsychologists);
      
      // Return psychologists directly without going through users table logic
      return res.json(
        successResponse({
          users: enrichedPsychologists,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: enrichedPsychologists.length
          }
        })
      );
    }

    // For other roles, fetch from users table as before
    // Test Supabase connection first
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    try {
      const { data: testData, error: testError } = await supabaseAdmin
        .from('users')
        .select('count')
        .limit(1);
      
      if (testError) {
        console.error('Supabase connection test failed:', testError);
        return res.status(500).json(
          errorResponse('Database connection failed')
        );
      }
      console.log('Supabase connection test successful');
    } catch (connectionError) {
      console.error('Supabase connection error:', connectionError);
      return res.status(500).json(
        errorResponse('Database connection failed')
      );
    }

    // Default to 'client' role if not specified (for users page)
    const targetRole = role || 'client';

    // For client role, we need to fetch from both users table and clients table
    // and merge them for proper pagination
    if (targetRole === 'client') {
      // Fetch all client users from users table
      let usersFromTable = null;
      let usersError = null;
      
      try {
        // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
        const result = await supabaseAdmin
          .from('users')
          .select(`
            id,
            email,
            role,
            profile_picture_url,
            created_at,
            updated_at
          `)
          .eq('role', 'client')
          .order('created_at', { ascending: false });
        
        usersFromTable = result.data;
        usersError = result.error;
      } catch (fetchError) {
        console.error('Error in fetch users query:', {
          message: fetchError.message,
          stack: fetchError.stack,
          name: fetchError.name,
          cause: fetchError.cause
        });
        usersError = {
          message: fetchError.message || 'Network error while fetching users',
          details: fetchError.stack || String(fetchError),
          code: fetchError.code || 'FETCH_ERROR'
        };
      }

      if (usersError) {
        console.error('Error fetching users:', {
          message: usersError.message,
          details: usersError.details,
          hint: usersError.hint,
          code: usersError.code
        });
        return res.status(500).json(
          errorResponse(`Failed to fetch users: ${usersError.message || 'Unknown error'}`)
        );
      }

      // Fetch all clients without user_id entries
      // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
      const { data: clientsWithoutUser, error: clientsError } = await supabaseAdmin
        .from('clients')
        .select('*')
        .is('user_id', null)
        .not('email', 'is', null)
        .order('created_at', { ascending: false });

      if (clientsError) {
        console.error('Error fetching clients:', clientsError);
      }

      // Convert users to enriched format
      let enrichedUsers = (usersFromTable || []).map(user => ({
        ...user,
        name: user.email // Will be enriched with client profile data below
      }));

      // Convert clients without user_id to user format
      const clientUsers = (clientsWithoutUser || []).map(client => ({
        id: client.id,
        email: client.email,
        role: 'client',
        profile_picture_url: client.profile_picture_url,
        created_at: client.created_at,
        updated_at: client.updated_at,
        first_name: client.first_name,
        last_name: client.last_name,
        phone_number: client.phone_number,
        child_name: client.child_name,
        child_age: client.child_age,
        name: `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.email
      }));

      // Merge all client users
      let allClientUsers = [...enrichedUsers, ...clientUsers];

      // Fetch client profiles for users from users table to enrich them
      // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
      const userIds = enrichedUsers.map(u => u.id);
      if (userIds.length > 0) {
        const { data: clientProfiles, error: profileError } = await supabaseAdmin
          .from('clients')
          .select('id, user_id, first_name, last_name, phone_number, child_name, child_age')
          .in('user_id', userIds);

        if (!profileError && clientProfiles) {
          // Create a map of user_id to profile
          const profileMap = {};
          clientProfiles.forEach(profile => {
            profileMap[profile.user_id] = profile;
          });

          // Enrich users with profile data
          allClientUsers = allClientUsers.map(user => {
            if (user.id && profileMap[user.id]) {
              const profile = profileMap[user.id];
              return {
                ...user,
                profile: {
                  id: profile.id, // Include client.id for session updates
                  first_name: profile.first_name,
                  last_name: profile.last_name,
                  phone_number: profile.phone_number,
                  child_name: profile.child_name,
                  child_age: profile.child_age
                },
                name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || user.email
              };
            }
            return user;
          });
        }
      }

      // Sort all merged users by created_at descending
      allClientUsers.sort((a, b) => {
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return dateB - dateA;
      });

      // Apply search filter if provided
      let filteredUsers = allClientUsers;
      if (search) {
        const searchLower = search.toLowerCase();
        filteredUsers = allClientUsers.filter(user => 
          user.email.toLowerCase().includes(searchLower) ||
          (user.name && user.name.toLowerCase().includes(searchLower)) ||
          (user.profile?.first_name && user.profile.first_name.toLowerCase().includes(searchLower)) ||
          (user.profile?.last_name && user.profile.last_name.toLowerCase().includes(searchLower)) ||
          (user.profile?.phone_number && user.profile.phone_number.toLowerCase().includes(searchLower)) ||
          (user.profile?.child_name && user.profile.child_name.toLowerCase().includes(searchLower))
        );
      }

      const totalCount = filteredUsers.length;

      // Apply pagination
      const offset = (page - 1) * limit;
      const paginatedUsers = filteredUsers.slice(offset, offset + parseInt(limit));

      console.log('Final client users being returned - count:', paginatedUsers.length, 'of', totalCount);

      res.json(
        successResponse({
          users: paginatedUsers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalCount
          }
        })
      );
    } else {
      // For other roles, fetch from users table only
      // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
      let usersQuery = supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          role,
          profile_picture_url,
          created_at,
          updated_at
        `, { count: 'exact' })
        .eq('role', targetRole);

      if (sort && order) {
        usersQuery = usersQuery.order(sort, { ascending: order === 'asc' });
      } else {
        usersQuery = usersQuery.order('created_at', { ascending: false });
      }

      const offset = (page - 1) * limit;
      const { data: users, error, count } = await usersQuery.range(offset, offset + parseInt(limit) - 1);

      if (error) {
        console.error('Get all users error:', error);
        return res.status(500).json(
          errorResponse('Failed to fetch users')
        );
      }

      let filteredUsers = users || [];
      if (search) {
        const searchLower = search.toLowerCase();
        filteredUsers = (users || []).filter(user => 
          user.email.toLowerCase().includes(searchLower)
        );
      }

      res.json(
        successResponse({
          users: filteredUsers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || filteredUsers.length
          }
        })
      );
    }

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching users')
    );
  }
};

// Get all psychologists directly from psychologists table (admin only)
const getAllPsychologists = async (req, res) => {
  try {
    console.log('=== getAllPsychologists function called ===');
    console.log('Query params:', req.query);
    
    const { page = 1, limit = 100, search, sort = 'created_at', order = 'desc' } = req.query;

    // Filter out assessment psychologist from admin view
    const assessmentEmail = (process.env.FREE_ASSESSMENT_PSYCHOLOGIST_EMAIL || 'assesment.koott@gmail.com').toLowerCase();

    // Fetch psychologists directly from psychologists table with pagination
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { supabaseAdmin } = require('../config/supabase');
    const offset = (page - 1) * limit;
    const { data: psychologists, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('*, individual_session_price')
      .neq('email', assessmentEmail)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: order === 'asc' });

    if (psychError) {
      console.error('Error fetching psychologists:', psychError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologists')
      );
    }

    // Sort by display_order first (ascending, nulls last), then by created_at (descending)
    if (psychologists && psychologists.length > 0) {
      psychologists.sort((a, b) => {
        // Handle null/undefined display_order values
        const aOrder = a.display_order !== null && a.display_order !== undefined ? a.display_order : null;
        const bOrder = b.display_order !== null && b.display_order !== undefined ? b.display_order : null;
        
        // If only one has display_order, the one with display_order comes first
        if (aOrder !== null && bOrder === null) {
          return -1; // a comes before b
        }
        if (aOrder === null && bOrder !== null) {
          return 1; // b comes before a
        }
        
        // If both have display_order, sort by display_order ascending
        if (aOrder !== null && bOrder !== null) {
          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
          // If display_order is equal, sort by created_at descending
          const dateA = new Date(a.created_at);
          const dateB = new Date(b.created_at);
          return dateB - dateA;
        }
        
        // If both are null (no display_order), sort by created_at descending
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB - dateA;
      });
    }

    console.log('Successfully fetched psychologists:', psychologists?.length || 0);
    if (psychologists && psychologists.length > 0) {
      console.log('Psychologists IDs:', psychologists.map(p => ({ id: p.id, name: `${p.first_name} ${p.last_name}` })));
    }
    
    // Convert psychologists to the expected format
    const enrichedPsychologists = psychologists.map(psych => ({
      id: psych.id, // Use psychologist ID as the main ID
      email: psych.email,
      role: 'psychologist',
      profile_picture_url: null,
      created_at: psych.created_at,
      updated_at: psych.updated_at,
      psychologist_id: psych.id, // For delete operations
      first_name: psych.first_name || '',
      last_name: psych.last_name || '',
      name: psych ? `${psych.first_name} ${psych.last_name}`.trim() : '',
      phone: psych.phone || '',
      ug_college: psych.ug_college || '',
      pg_college: psych.pg_college || '',
      phd_college: psych.phd_college || '',
      description: psych.description || '',
      experience_years: psych.experience_years || 0,
      designation: psych.designation || '', // Include designation field
      area_of_expertise: psych.area_of_expertise || [],
      personality_traits: psych.personality_traits || [], // NEW
      availability: [], // Will be populated below
      cover_image_url: psych.cover_image_url || null,
      display_order: psych.display_order || null, // Display order for sorting
      faq_question_1: psych.faq_question_1 || null,
      faq_answer_1: psych.faq_answer_1 || null,
      faq_question_2: psych.faq_question_2 || null,
      faq_answer_2: psych.faq_answer_2 || null,
      faq_question_3: psych.faq_question_3 || null,
      faq_answer_3: psych.faq_answer_3 || null
    }));

    // Extract individual price from dedicated field or description field
    enrichedPsychologists.forEach((user, index) => {
      // Get the original psychologist data to access individual_session_price
      const originalPsych = psychologists[index];
      
      // Use dedicated individual_session_price field, fallback to description extraction
      let extractedPrice = originalPsych?.individual_session_price;
      
      // Fallback: Try to extract price from description if individual_session_price is null
      if (!extractedPrice) {
        const priceMatch = user.description?.match(/Individual Session Price: [₹\$](\d+(?:\.\d+)?)/);
        extractedPrice = priceMatch ? parseInt(priceMatch[1]) : null;
      }
      
      user.price = extractedPrice;
      
      console.log(`🔍 Admin price extraction for ${user.first_name}:`, {
        originalIndividualSessionPrice: originalPsych?.individual_session_price,
        description_length: user.description?.length || 0,
        extractedPrice: user.price
      });
    });

    // Fetch availability data for all psychologists

    // Fetch availability data for all psychologists
    if (enrichedPsychologists.length > 0) {
      try {
        const psychologistIds = enrichedPsychologists
          .map(user => user.psychologist_id)
          .filter(Boolean);

        if (psychologistIds.length > 0) {
          // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
          const { data: availabilityData, error: availabilityError } = await supabaseAdmin
            .from('availability')
            .select('*')
            .in('psychologist_id', psychologistIds);

          if (!availabilityError && availabilityData) {
            console.log('Availability data fetched:', availabilityData);
            
            // Group availability by psychologist_id
            const availabilityMap = {};
            availabilityData.forEach(avail => {
              if (!availabilityMap[avail.psychologist_id]) {
                availabilityMap[avail.psychologist_id] = [];
              }
              
              // Format time_slots to match frontend expectations
              const formattedTimeSlots = avail.time_slots.map(timeString => ({
                time: timeString,
                available: true,
                displayTime: timeString
              }));
              
              availabilityMap[avail.psychologist_id].push({
                date: avail.date,
                time_slots: formattedTimeSlots,
                is_available: avail.is_available
              });
            });

            // Add availability to enriched users
            enrichedPsychologists.forEach(user => {
              user.availability = availabilityMap[user.psychologist_id] || [];
            });
          }
        }
      } catch (availabilityError) {
        console.error('Error fetching availability data:', availabilityError);
        // Continue without availability data
      }
    }

    console.log('Final enriched psychologists:', enrichedPsychologists);
    
    // Return psychologists directly
    return res.json(
      successResponse({
        users: enrichedPsychologists,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: enrichedPsychologists.length
        }
      })
    );

  } catch (error) {
    console.error('Get all psychologists error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching psychologists')
    );
  }
};

// Get user details with profile
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    // First check if it's a psychologist
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { supabaseAdmin } = require('../config/supabase');
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('*')
      .eq('id', userId)
      .single();

    if (psychologist && !psychologistError) {
      return res.json(
        successResponse({
          user: {
            id: psychologist.id,
            email: psychologist.email,
            role: 'psychologist',
            profile_picture_url: null,
            cover_image_url: psychologist.cover_image_url,
            created_at: psychologist.created_at,
            updated_at: psychologist.updated_at,
            profile: psychologist
          }
        })
      );
    }

    // If not a psychologist, check users table
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

    // Get role-specific profile
    let profile = null;
    if (user.role === 'client') {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('*')
        .eq('id', userId)
        .single();
      profile = client;
    }

    res.json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          profile_picture_url: user.profile_picture_url,
          created_at: user.created_at,
          updated_at: user.updated_at,
          profile
        }
      })
    );

  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching user details')
    );
  }
};

// Update user role
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
    const { supabaseAdmin } = require('../config/supabase');
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

// Deactivate user
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
    const { supabaseAdmin } = require('../config/supabase');
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

// Get platform statistics
const getPlatformStats = async (req, res) => {
  try {
    console.log('=== getPlatformStats function called ===');
    
    const { start_date, end_date } = req.query;

    // Test database connection first
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { supabaseAdmin } = require('../config/supabase');
    try {
      const { data: testData, error: testError } = await supabaseAdmin
        .from('users')
        .select('count')
        .limit(1);
      
      if (testError) {
        console.error('Database connection test failed:', testError);
        return res.status(500).json(
          errorResponse('Database connection failed')
        );
      }
      console.log('Database connection test successful');
    } catch (connectionError) {
      console.error('Database connection error:', connectionError);
      return res.status(500).json(
        errorResponse('Database connection failed')
      );
    }

    // Get user counts by role (optimized with count queries)
    // Only count 'client' users (exclude admin, finance, psychologist, superadmin)
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: totalUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'client');

    if (usersError) {
      console.error('Get users error:', usersError);
      return res.status(500).json(
        errorResponse('Failed to fetch user statistics')
      );
    }

    // Get psychologist counts (optimized)
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: totalPsychologists, error: psychologistsError } = await supabaseAdmin
      .from('psychologists')
      .select('*', { count: 'exact', head: true });

    if (psychologistsError) {
      console.error('Get psychologists error:', psychologistsError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologist statistics')
      );
    }

    // Get session counts (optimized with count)
    // Exclude free assessments - only count paid sessions
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: totalSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .neq('session_type', 'free_assessment');

    if (sessionsError) {
      console.error('Get sessions error:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to fetch session statistics')
      );
    }

    // Get client counts (optimized)
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: totalClients, error: clientsError } = await supabaseAdmin
      .from('clients')
      .select('*', { count: 'exact', head: true });

    if (clientsError) {
      console.error('Get clients error:', clientsError);
      return res.status(500).json(
        errorResponse('Failed to fetch client statistics')
      );
    }

    console.log('Data fetched successfully:', {
      totalUsers,
      totalPsychologists,
      totalSessions,
      totalClients,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });

    // Get detailed statistics with 2GB plan (more accurate data)
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { data: userRoles, error: userRolesError } = await supabaseAdmin
      .from('users')
      .select('role')
      .limit(1000); // Reasonable limit for 2GB plan

    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    // Exclude free assessments - only count paid sessions
    const { data: sessionStatuses, error: sessionStatusError } = await supabaseAdmin
      .from('sessions')
      .select('status, price')
      .neq('session_type', 'free_assessment')
      .limit(1000); // Reasonable limit for 2GB plan

    // Calculate accurate statistics
    const stats = {
      totalUsers: totalUsers || 0,
      totalDoctors: totalPsychologists || 0,
      totalBookings: totalSessions || 0,
      totalClients: totalClients || 0,
      totalRevenue: 0,
      users: {
        total: totalUsers || 0,
        by_role: {
          client: 0,
          psychologist: 0,
          admin: 0
        }
      },
      sessions: {
        total: totalSessions || 0,
        by_status: {
          booked: 0,
          completed: 0,
          cancelled: 0,
          rescheduled: 0
        }
      }
    };

    // Calculate accurate user role distribution
    if (userRoles && !userRolesError) {
      userRoles.forEach(user => {
        stats.users.by_role[user.role] = (stats.users.by_role[user.role] || 0) + 1;
      });
    }

    // Calculate accurate session status distribution and revenue
    if (sessionStatuses && !sessionStatusError) {
      sessionStatuses.forEach(session => {
        stats.sessions.by_status[session.status] = (stats.sessions.by_status[session.status] || 0) + 1;
        stats.totalRevenue += parseFloat(session.price || 0);
      });
    }

    // Get payment failure statistics
    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: totalPayments, error: paymentsCountError } = await supabaseAdmin
      .from('payments')
      .select('*', { count: 'exact', head: true });

    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: failedPayments, error: failedPaymentsError } = await supabaseAdmin
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed');

    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: pendingPayments, error: pendingPaymentsError } = await supabaseAdmin
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Use supabaseAdmin to bypass RLS (admin endpoint, proper auth already checked)
    const { count: successfulPayments, error: successfulPaymentsError } = await supabaseAdmin
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success');

    // Get cancelled sessions count (exclude free assessments)
    const { count: cancelledSessions, error: cancelledSessionsError } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .neq('session_type', 'free_assessment');

    // Get no-show sessions count (exclude free assessments)
    const { count: noShowSessions, error: noShowSessionsError } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'no_show')
      .neq('session_type', 'free_assessment');

    // Get booking status metrics (exclude free assessments)
    const { count: rescheduledSessions, error: rescheduledSessionsError } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'rescheduled')
      .neq('session_type', 'free_assessment');

    const { count: rescheduleRequestedSessions, error: rescheduleRequestedSessionsError } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'reschedule_requested')
      .neq('session_type', 'free_assessment');

    const { count: completedSessions, error: completedSessionsError } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .neq('session_type', 'free_assessment');

    // Calculate upcoming sessions (not completed/cancelled/no_show and future date)
    // Exclude free assessments - only count paid sessions
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const { data: upcomingSessionsData, error: upcomingSessionsError } = await supabaseAdmin
      .from('sessions')
      .select('id, scheduled_date, scheduled_time, status')
      .not('status', 'in', '(completed,cancelled,no_show,noshow)')
      .neq('session_type', 'free_assessment')
      .gte('scheduled_date', today);
    
    // Filter upcoming sessions more accurately (check time as well)
    let upcomingSessionsCount = 0;
    if (upcomingSessionsData && !upcomingSessionsError) {
      const now = new Date();
      upcomingSessionsCount = upcomingSessionsData.filter(session => {
        if (!session.scheduled_date || !session.scheduled_time) return false;
        const sessionDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`);
        const sessionEndDateTime = new Date(sessionDateTime.getTime() + 50 * 60 * 1000); // Add 50 minutes
        return sessionEndDateTime > now;
      }).length;
    }

    // Add failure metrics to stats
    stats.failures = {
      paymentFailures: failedPayments || 0,
      pendingPayments: pendingPayments || 0,
      successfulPayments: successfulPayments || 0,
      cancelledSessions: cancelledSessions || 0,
      noShowSessions: noShowSessions || 0,
      totalPayments: totalPayments || 0
    };

    // Add booking status metrics
    stats.bookingStatuses = {
      upcoming: upcomingSessionsCount || 0,
      rescheduled: rescheduledSessions || 0,
      rescheduleRequested: rescheduleRequestedSessions || 0,
      completed: completedSessions || 0,
      noShow: noShowSessions || 0,
      cancelled: cancelledSessions || 0
    };

    // Calculate failure rate
    stats.failureRate = totalPayments > 0 
      ? ((failedPayments || 0) / totalPayments * 100).toFixed(2)
      : 0;

    res.json(
      successResponse(stats, 'Platform statistics retrieved successfully')
    );

  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching platform statistics')
    );
  }
};

// Search users
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

// Create psychologist (admin only)
const defaultAvailabilityService = require('../utils/defaultAvailabilityService');

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
        faq_answer_3: faq_answer_3 || null
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

// Update psychologist (admin only)
const updatePsychologist = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const updateData = { ...req.body };
    if (typeof updateData.email === 'string') {
      updateData.email = updateData.email.trim().toLowerCase();
    }

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

    // Update psychologist profile
    const { data: updatedPsychologist, error: updateError } = await supabaseAdmin
      .from('psychologists')
      .update(psychologistUpdateData)
      .eq('id', psychologistId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Update psychologist error:', updateError);
      return res.status(500).json(
        errorResponse('Failed to update psychologist profile')
      );
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
            latestEmail = null;
          }
          if (latestEmail) {
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
          console.error('❌ Error details:', JSON.stringify(priceUpdateError, null, 2));
        } else {
          console.log('✅ Price stored in individual_session_price field successfully');
        }
      } catch (error) {
        console.error('❌ Error handling individual price:', error);
      }
    }

    // Handle package updates
    if (packages && Array.isArray(packages)) {
      console.log('📦 Packages provided for update:', packages);
      
      try {
        // Get existing packages for this psychologist
        const { data: existingPackagesData, error: fetchError } = await supabaseAdmin
          .from('packages')
          .select('id, name, session_count')
          .eq('psychologist_id', psychologistId);

        let existingPackages = existingPackagesData || [];

        if (fetchError) {
          console.error('Error fetching existing packages:', fetchError);
        } else {
          console.log('📦 Existing packages:', existingPackages);
          
          // Extract valid package IDs from the request
            const updatedPackageIds = packages
              .filter(pkg => pkg.id && !isNaN(parseInt(pkg.id)) && parseInt(pkg.id) > 0)
              .map(pkg => parseInt(pkg.id));
            
          console.log('📦 Updated package IDs from request:', updatedPackageIds);
          console.log('📦 Total packages in request:', packages.length);
          console.log('📦 Packages with valid IDs:', updatedPackageIds.length);
          
          // CRITICAL SAFETY: Only delete packages if explicitly requested via deletePackages flag
          // This prevents accidental deletion when updating other psychologist fields
          // Packages should only be deleted through the dedicated delete endpoint or with explicit flag
          const shouldDeletePackages = req.body.deletePackages === true || req.body.deletePackages === 'true';
          
          if (!shouldDeletePackages) {
            // SAFETY: Never delete packages unless explicitly requested
            console.log('🔒 SAFETY: Package deletion disabled - packages will NOT be deleted unless deletePackages=true flag is set');
            console.log('📦 Existing packages preserved:', existingPackages?.map(p => ({ id: p.id, name: p.name })));
            console.log('💡 To delete packages, use DELETE /api/admin/psychologists/:id/packages/:packageId or set deletePackages=true');
          } else if (existingPackages && existingPackages.length > 0) {
            // Only delete if explicitly requested AND package IDs are provided
            
            // Track which packages were deleted
            const deletedPackageIds = [];
            
            // First, delete packages that are not in the updated list
            for (const existingPkg of existingPackages) {
              if (!updatedPackageIds.includes(existingPkg.id)) {
                console.log(`⚠️  DELETING package ${existingPkg.id} (${existingPkg.name}) - deletePackages flag was set`);
                const { error: deleteError } = await supabaseAdmin
                  .from('packages')
                  .delete()
                  .eq('id', existingPkg.id);
                
                if (deleteError) {
                  console.error(`❌ Error deleting package ${existingPkg.id}:`, deleteError);
                } else {
                  console.log(`✅ Package ${existingPkg.id} deleted successfully`);
                  deletedPackageIds.push(existingPkg.id);
                }
              }
            }
            
            // Refresh existingPackages after deletion to remove deleted packages from cache
            if (deletedPackageIds.length > 0) {
              const { data: refreshedPackages, error: refreshError } = await supabaseAdmin
                .from('packages')
                .select('id, name, session_count')
                .eq('psychologist_id', psychologistId);
              
              if (!refreshError && refreshedPackages) {
                existingPackages = refreshedPackages;
                console.log('📦 Refreshed existing packages after deletion:', existingPackages);
              }
            }
          }
          
          // Process each package
          for (const pkg of packages) {
            // Skip individual session packages (sessions = 1) as they're handled by individual_session_price
            if (pkg.sessions === 1) {
              console.log(`📦 Skipping individual session package: ${pkg.name}`);
              continue;
            }

            // Check if this is an existing package (has numeric ID) or new package (has temp ID)
            const isExistingPackage = pkg.id && !isNaN(parseInt(pkg.id)) && parseInt(pkg.id) > 0;
            
            if (isExistingPackage) {
              // Update existing package - check if it still exists (wasn't deleted)
              const existingPackage = existingPackages.find(ep => ep.id === parseInt(pkg.id));
              
              // Skip if package was deleted
              if (!existingPackage) {
                console.log(`📦 Package ${pkg.id} was deleted or not found, skipping update`);
                continue;
              }
              
                console.log(`📦 Updating existing package ${pkg.id} (${pkg.name}) with price $${pkg.price}`);
                
              const { error: updateError } = await supabaseAdmin
                  .from('packages')
                  .update({ 
                    price: parseInt(pkg.price),
                    name: pkg.name || existingPackage.name,
                    description: pkg.description || `${pkg.sessions} therapy sessions`,
                    session_count: pkg.sessions
                  })
                  .eq('id', pkg.id);

                if (updateError) {
                  console.error(`❌ Error updating package ${pkg.id}:`, updateError);
                // Don't throw - continue with other packages
                } else {
                  console.log(`✅ Package ${pkg.id} updated successfully`);
              }
            } else {
              // Create new package
              console.log(`📦 Creating new package: ${pkg.name} (${pkg.sessions} sessions, $${pkg.price})`);
              
              // Ensure we have valid data
              const sessionCount = parseInt(pkg.sessions) || pkg.sessions;
              const packagePrice = parseInt(pkg.price);
              const packageName = pkg.name || `Package of ${sessionCount} Sessions`;
              const packageDescription = pkg.description || `${sessionCount} therapy sessions`;
              const packageType = `package_${sessionCount}`;
              
              if (!sessionCount || sessionCount < 1) {
                console.error(`❌ Invalid session count for package: ${pkg.sessions}`);
                continue;
              }
              
              if (!packagePrice || packagePrice <= 0) {
                console.error(`❌ Invalid price for package: ${pkg.price}`);
                continue;
              }
              
              const packageData = {
                psychologist_id: psychologistId,
                name: packageName,
                session_count: sessionCount,
                price: packagePrice,
                description: packageDescription,
                package_type: packageType,
                discount_percentage: pkg.discount_percentage || 0
              };
              
              console.log(`📦 Inserting package data - count:`, packageData?.length || 0);
              
              const { data: insertedPackage, error: createError } = await supabaseAdmin
                .from('packages')
                .insert(packageData)
                .select('*');

              if (createError) {
                console.error(`❌ Error creating package ${pkg.name}:`, createError);
                console.error(`❌ Error details:`, JSON.stringify(createError, null, 2));
              } else {
                console.log(`✅ Package ${pkg.name} created successfully`);
                console.log(`✅ Inserted package:`, insertedPackage);
              }
            }
          }
        }
      } catch (error) {
        console.error('❌ Error handling package updates:', error);
        console.error('❌ Package update error stack:', error.stack);
        // Don't throw - allow the psychologist update to continue even if package updates fail
      }
    } else if (packages && Array.isArray(packages) && packages.length === 0) {
      // SAFETY: Empty array could mean "delete all" OR "packages not included in update"
      // We should NOT automatically delete all packages - this is too dangerous
      // Only delete if explicitly requested via a separate flag or endpoint
      console.log('⚠️  Empty packages array sent - SAFETY: NOT deleting packages automatically');
      console.log('⚠️  If you want to delete all packages, use a dedicated delete endpoint or include a flag');
      console.log('⚠️  This prevents accidental deletion when packages are not included in the update request');
    }

    // Ensure default availability exists (3 weeks from today)
    // This will only add dates that don't already exist
    try {
      const defaultAvailResult = await defaultAvailabilityService.setDefaultAvailability(psychologistId);
      if (defaultAvailResult.success) {
        console.log(`✅ Default availability ensured for psychologist ${psychologistId}: ${defaultAvailResult.message}`);
      }
    } catch (defaultAvailError) {
      console.error('Error ensuring default availability:', defaultAvailError);
      // Continue even if default availability fails
    }

    // Handle availability updates (allows doctors to remove/block slots from defaults)
    if (availability && Array.isArray(availability) && availability.length > 0) {
      console.log('📅 Availability provided for update - count:', availability?.length || 0);
      
      try {
        // Convert frontend format to backend format
        const availabilityRecords = [];
        
        for (const avail of availability) {
          // Case 1: New per-date format from admin UI: { date: 'YYYY-MM-DD', timeSlots: {morning,noon,evening,night} }
          if (avail.date && avail.timeSlots && typeof avail.timeSlots === 'object') {
            // Use the provided date string directly (assumed YYYY-MM-DD), no timezone conversions
            try {
              const dateStr = String(avail.date);
              const allSlots = [
                ...(Array.isArray(avail.timeSlots.morning) ? avail.timeSlots.morning : []),
                ...(Array.isArray(avail.timeSlots.noon) ? avail.timeSlots.noon : []),
                ...(Array.isArray(avail.timeSlots.evening) ? avail.timeSlots.evening : []),
                ...(Array.isArray(avail.timeSlots.night) ? avail.timeSlots.night : []),
              ];

              const stringTimeSlots = allSlots.map(slot => {
                if (typeof slot === 'object' && slot !== null) {
                  if (slot.displayTime) return slot.displayTime;
                  if (slot.time) return slot.time;
                  return String(slot);
                }
                return String(slot);
              });

              if (stringTimeSlots.length > 0) {
                availabilityRecords.push({
                  psychologist_id: psychologistId,
                  date: dateStr,
                  time_slots: stringTimeSlots,
                  is_available: true
                });
              }
            } catch (e) {
              console.warn('⚠️ Failed to normalize per-date availability entry:', avail, e);
            }
            continue;
          }

          // Case 2: Existing per-date format from DB passthrough: { date: 'YYYY-MM-DD', time_slots: [...] }
          if (avail.date && Array.isArray(avail.time_slots)) {
            try {
              const dateStr = String(avail.date);
              const stringTimeSlots = avail.time_slots.map(slot => (typeof slot === 'string' ? slot : String(slot)));
              if (stringTimeSlots.length > 0) {
                availabilityRecords.push({
                  psychologist_id: psychologistId,
                  date: dateStr,
                  time_slots: stringTimeSlots,
                  is_available: true
                });
              }
            } catch (e) {
              console.warn('⚠️ Failed to normalize legacy per-date availability entry:', avail, e);
            }
            continue;
          }

          // Case 3: Legacy day-based format: { day: 'Monday', slots: [...] }
          if (avail.day && avail.slots && Array.isArray(avail.slots)) {
            // Generate dates for the next 1 occurrence of this day (preserves previous behavior)
            const dates = getAvailabilityDatesForDay(avail.day, 1);
            if (dates.length > 0) {
              const dateStr = dates[0].toISOString().split('T')[0];
              const stringTimeSlots = avail.slots.map(slot => {
                if (typeof slot === 'object' && slot !== null) {
                  if (slot.displayTime) return slot.displayTime;
                  if (slot.time) return slot.time;
                  console.warn('Time slot object has no displayable time property:', slot);
                  return String(slot);
                }
                return typeof slot === 'string' ? slot : String(slot);
              });
              availabilityRecords.push({
                psychologist_id: psychologistId,
                date: dateStr,
                time_slots: stringTimeSlots,
                is_available: true
              });
            }
          }
        }

        if (availabilityRecords.length > 0) {
          // Update or insert availability records (don't delete all - only update specific dates)
          // This allows doctors to remove slots from defaults without losing other dates
          for (const record of availabilityRecords) {
            const { data: existing } = await supabaseAdmin
            .from('availability')
              .select('id')
              .eq('psychologist_id', record.psychologist_id)
              .eq('date', record.date)
              .single();

            if (existing) {
              // Update existing availability (doctor is removing slots from defaults)
              const { error: updateError } = await supabaseAdmin
                .from('availability')
                .update({
                  time_slots: record.time_slots,
                  is_available: true,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);
              
              if (updateError) {
                console.error(`Error updating availability for ${record.date}:`, updateError);
          } else {
                console.log(`✅ Updated availability for ${record.date}`);
          }
            } else {
              // Insert new availability (for dates not in defaults)
              const { error: insertError } = await supabaseAdmin
            .from('availability')
                .insert({
                  ...record,
                  is_available: true,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                });

          if (insertError) {
                console.error(`Error inserting availability for ${record.date}:`, insertError);
          } else {
                console.log(`✅ Created availability for ${record.date}`);
          }
            }
          }
          console.log(`✅ Updated ${availabilityRecords.length} availability records`);
        } else {
          console.log('⚠️ No valid availability records to update');
        }
      } catch (error) {
        console.error('Error handling availability updates:', error);
      }
    } else if (availability && Array.isArray(availability) && availability.length === 0) {
      // If empty array is sent, delete all availability
      console.log('📅 Empty availability array sent - deleting all availability');
      
      try {
        const { error: deleteError } = await supabaseAdmin
          .from('availability')
          .delete()
          .eq('psychologist_id', psychologistId);

        if (deleteError) {
          console.error('Error deleting all availability:', deleteError);
        } else {
          console.log('✅ All availability deleted');
        }
      } catch (error) {
        console.error('Error deleting all availability:', error);
      }
    }

    // Invalidate frontend cache by updating cache version timestamp
    // This will force frontend to refresh cached psychologist data
    const cacheInvalidationTimestamp = Date.now();
    console.log('🔄 Cache invalidation triggered for psychologist update:', cacheInvalidationTimestamp);

    res.json(
      successResponse({
        ...updatedPsychologist,
        cache_invalidated: true,
        cache_timestamp: cacheInvalidationTimestamp
      }, 'Psychologist updated successfully')
    );

  } catch (error) {
    console.error('Update psychologist error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating psychologist')
    );
  }
};

// Delete psychologist (admin only)
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

// Create user (admin only)
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

// Update user (admin only)
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // HIGH-RISK FIX: Mass assignment protection - explicit allowlist
    const allowedFields = ['first_name', 'last_name', 'phone_number', 'child_name', 'child_age'];
    const updateData = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

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

    // Update user profile based on role
    if (user.role === 'client') {
      const { data: updatedClient, error: updateError } = await supabaseAdmin
        .from('clients')
        .update(updateData)
        .eq('id', userId)
        .select('*')
        .single();

      if (updateError) {
        console.error('Update client error:', updateError);
        return res.status(500).json(
          errorResponse('Failed to update client profile')
        );
      }

      res.json(
        successResponse(updatedClient, 'Client updated successfully')
      );
    } else {
      res.status(400).json(
        errorResponse('Can only update client profiles')
      );
    }

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating user')
    );
  }
};

// Delete user (admin only)
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

// Get recent users for dashboard
const getRecentUsers = async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Get recent users (clients and admins, not psychologists)
    const { data: recentUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, role, created_at')
      .neq('role', 'psychologist') // Exclude psychologists as they're in separate table
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (usersError) {
      console.error('Get recent users error:', usersError);
      return res.status(500).json(
        errorResponse('Failed to fetch recent users')
      );
    }

    // Get client profiles for users
    const userIds = recentUsers.filter(user => user.role === 'client').map(user => user.id);
    let clientProfiles = [];
    
    if (userIds.length > 0) {
      const { data: clients, error: clientsError } = await supabaseAdmin
        .from('clients')
        .select('user_id, first_name, last_name, child_name, child_age')
        .in('user_id', userIds);

      if (!clientsError && clients) {
        clientProfiles = clients;
      }
    }

    // Enrich user data with profile information
    const enrichedUsers = recentUsers.map(user => {
      if (user.role === 'client') {
        const clientProfile = clientProfiles.find(client => client.user_id === user.id);
        return {
          ...user,
          profile: clientProfile || null
        };
      }
      return user;
    });

    res.json(
      successResponse(enrichedUsers)
    );

  } catch (error) {
    console.error('Get recent users error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching recent users')
    );
  }
};

// Get recent bookings for dashboard (last 24 hours)
const getRecentBookings = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Calculate date 24 hours ago
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);
    const oneDayAgoISO = oneDayAgo.toISOString();

    // Get recent sessions from the last 24 hours
    const { data: recentSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select(`
        id,
        status,
        scheduled_date,
        scheduled_time,
        price,
        created_at,
        client:clients(
          id,
          first_name,
          last_name,
          child_name
        ),
        psychologist:psychologists(
          id,
          first_name,
          last_name
        )
      `)
      .gte('created_at', oneDayAgoISO)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (sessionsError) {
      console.error('Get recent sessions error:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to fetch recent sessions')
      );
    }

    res.json(
      successResponse(recentSessions)
    );

  } catch (error) {
    console.error('Get recent bookings error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching recent bookings')
    );
  }
};

// Get recent activities for dashboard
const getRecentActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Get recent users
    const { data: recentUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, role, created_at')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (usersError) {
      console.error('Get recent users error:', usersError);
      return res.status(500).json(
        errorResponse('Failed to fetch recent users')
      );
    }

    // Get recent psychologists
    const { data: recentPsychologists, error: psychologistsError } = await supabaseAdmin
      .from('psychologists')
      .select('id, email, first_name, last_name, created_at')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (psychologistsError) {
      console.error('Get recent psychologists error:', psychologistsError);
      return res.status(500).json(
        errorResponse('Failed to fetch recent psychologists')
      );
    }

    // Get recent sessions
    const { data: recentSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select('id, status, scheduled_date, created_at')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (sessionsError) {
      console.error('Get recent sessions error:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to fetch recent sessions')
      );
    }

    // Combine and format activities
    const activities = [];

    // Add user registrations
    recentUsers.forEach(user => {
      activities.push({
        id: `user_${user.id}`,
        type: 'user_registration',
        title: `New ${user.role} registered`,
        description: `${user.email} joined the platform`,
        timestamp: user.created_at,
        data: user
      });
    });

    // Add psychologist registrations
    recentPsychologists.forEach(psychologist => {
      activities.push({
        id: `psychologist_${psychologist.id}`,
        type: 'psychologist_registration',
        title: 'New psychologist joined',
        description: `Dr. ${psychologist.first_name} ${psychologist.last_name} joined the platform`,
        timestamp: psychologist.created_at,
        data: psychologist
      });
    });

    // Add session bookings
    recentSessions.forEach(session => {
      activities.push({
        id: `session_${session.id}`,
        type: 'session_booking',
        title: 'New session booked',
        description: `Session scheduled for ${session.scheduled_date}`,
        timestamp: session.created_at,
        data: session
      });
    });

    // Sort by timestamp (most recent first)
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Return limited number of activities
    const limitedActivities = activities.slice(0, parseInt(limit));

    res.json(
      successResponse(limitedActivities)
    );

  } catch (error) {
    console.error('Get recent activities error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching recent activities')
    );
  }
};

// Create packages for existing psychologist (admin only)
const createPsychologistPackages = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const { packages } = req.body;

    console.log('=== createPsychologistPackages function called ===');
    console.log('Psychologist ID:', psychologistId);
    console.log('Packages:', packages);

    // Validate packages
    if (!packages || !Array.isArray(packages) || packages.length === 0) {
      return res.status(400).json(
        errorResponse('Packages array is required and must not be empty')
      );
    }

    // Check if psychologist exists
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name')
      .eq('id', psychologistId)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Validate each package
    for (const pkg of packages) {
      if (!pkg.session_count || !pkg.price || pkg.session_count < 1 || pkg.price <= 0) {
        return res.status(400).json(
          errorResponse(`Invalid package: session_count must be > 0, price must be > 0`)
        );
      }
    }

    // Always include individual session option
    const individualSession = {
      psychologist_id: psychologistId,
      package_type: 'individual',
      name: 'Single Session',
      description: 'One therapy session',
      session_count: 1,
      price: 100, // Default price
      discount_percentage: 0
    };

    // Create packages
    const packageData = [individualSession, ...packages.map(pkg => ({
      psychologist_id: psychologistId,
      package_type: pkg.package_type || `package_${pkg.session_count}`,
      name: pkg.name || `Package of ${pkg.session_count} Sessions`,
      description: pkg.description || `${pkg.session_count} therapy sessions${pkg.discount_percentage > 0 ? ` with ${pkg.discount_percentage}% discount` : ''}`,
      session_count: pkg.session_count,
      price: pkg.price,
      discount_percentage: pkg.discount_percentage || 0
    }))];

    const { data: createdPackages, error: packagesError } = await supabaseAdmin
      .from('packages')
      .insert(packageData)
      .select('*');

    if (packagesError) {
      console.error('Packages creation error:', packagesError);
      return res.status(500).json(
        errorResponse('Failed to create packages')
      );
    }

    console.log('✅ Packages created successfully for psychologist:', psychologist.first_name, psychologist.last_name);
    res.status(201).json(
      successResponse(createdPackages, 'Packages created successfully')
    );

  } catch (error) {
    console.error('Create psychologist packages error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating packages')
    );
  }
};

// Approve assessment reschedule request
const approveAssessmentRescheduleRequest = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { new_date, new_time } = req.body;

    // Get the notification
    const { data: notification, error: notificationError } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .eq('type', 'assessment_reschedule_request')
      .single();

    if (notificationError || !notification) {
      return res.status(404).json(
        errorResponse('Reschedule request not found')
      );
    }

    const assessmentSessionId = notification.assessment_session_id;
    const metadata = notification.metadata || {};

    // Use provided date/time or from metadata
    const rescheduleDate = new_date || metadata.new_date;
    const rescheduleTime = new_time || metadata.new_time;

    if (!rescheduleDate || !rescheduleTime) {
      return res.status(400).json(
        errorResponse('New date and time are required')
      );
    }

    // Get assessment session
    const { data: assessmentSession, error: sessionError } = await supabaseAdmin
      .from('assessment_sessions')
      .select('*')
      .eq('id', assessmentSessionId)
      .single();

    if (sessionError || !assessmentSession) {
      return res.status(404).json(
        errorResponse('Assessment session not found')
      );
    }

    // Check if new time slot is available
    const targetPsychologistId = notification.psychologist_id || assessmentSession.psychologist_id;
    
    const { data: conflictingAssessmentSessions } = await supabaseAdmin
      .from('assessment_sessions')
      .select('id')
      .eq('psychologist_id', targetPsychologistId)
      .eq('scheduled_date', rescheduleDate)
      .eq('scheduled_time', rescheduleTime)
      .in('status', ['reserved', 'booked', 'rescheduled'])
      .neq('id', assessmentSessionId);

    const { data: conflictingRegularSessions } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('psychologist_id', targetPsychologistId)
      .eq('scheduled_date', rescheduleDate)
      .eq('scheduled_time', rescheduleTime)
      .in('status', ['booked', 'rescheduled', 'confirmed']);

    if ((conflictingAssessmentSessions && conflictingAssessmentSessions.length > 0) ||
        (conflictingRegularSessions && conflictingRegularSessions.length > 0)) {
      return res.status(400).json(
        errorResponse('Selected time slot is already booked')
      );
    }

    // Update assessment session
    const rescheduleCount = assessmentSession.reschedule_count || 0;
    const updateData = {
      scheduled_date: rescheduleDate,
      scheduled_time: rescheduleTime,
      status: 'rescheduled',
      reschedule_count: rescheduleCount + 1,
      psychologist_id: targetPsychologistId,
      updated_at: new Date().toISOString()
    };

    const { data: updatedSession, error: updateError } = await supabaseAdmin
      .from('assessment_sessions')
      .update(updateData)
      .eq('id', assessmentSessionId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Error updating assessment session:', updateError);
      return res.status(500).json(
        errorResponse('Failed to reschedule assessment session')
      );
    }

    // Unblock old slot and block new slot
    try {
      if (assessmentSession.scheduled_date && assessmentSession.scheduled_time) {
        const oldHhmm = (assessmentSession.scheduled_time || '').substring(0,5);
        const { data: oldAvail } = await supabaseAdmin
          .from('availability')
          .select('id, time_slots')
          .eq('psychologist_id', assessmentSession.psychologist_id)
          .eq('date', assessmentSession.scheduled_date)
          .single();
        
        if (oldAvail && Array.isArray(oldAvail.time_slots) && !oldAvail.time_slots.includes(oldHhmm)) {
          const updatedSlots = [...oldAvail.time_slots, oldHhmm].sort();
          await supabaseAdmin
            .from('availability')
            .update({ time_slots: updatedSlots, updated_at: new Date().toISOString() })
            .eq('id', oldAvail.id);
        }
      }

      const newHhmm = (rescheduleTime || '').substring(0,5);
      const { data: newAvail } = await supabaseAdmin
        .from('availability')
        .select('id, time_slots')
        .eq('psychologist_id', targetPsychologistId)
        .eq('date', rescheduleDate)
        .single();
      
      if (newAvail && Array.isArray(newAvail.time_slots)) {
        const filtered = newAvail.time_slots.filter(t => (typeof t === 'string' ? t.substring(0,5) : String(t).substring(0,5)) !== newHhmm);
        if (filtered.length !== newAvail.time_slots.length) {
          await supabaseAdmin
            .from('availability')
            .update({ time_slots: filtered, updated_at: new Date().toISOString() })
            .eq('id', newAvail.id);
        }
      }
    } catch (availErr) {
      console.warn('⚠️ Failed to update availability:', availErr?.message);
    }

    // Mark notification as read
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    console.log('✅ Assessment reschedule request approved:', updatedSession.id);

    res.json(successResponse(updatedSession, 'Assessment reschedule request approved and session rescheduled successfully'));

  } catch (error) {
    console.error('Approve assessment reschedule request error:', error);
    res.status(500).json(
      errorResponse('Internal server error while approving reschedule request')
    );
  }
};

// Admin reschedule session
const rescheduleSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { new_date, new_time, reason } = req.body;

    console.log('🔄 Admin reschedule request:', {
      sessionId,
      new_date,
      new_time,
      reason
    });

    // Validate input
    if (!new_date || !new_time) {
      return res.status(400).json(
        errorResponse('New date and time are required')
      );
    }

    // Get session details
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        clients!inner(
          id,
          first_name,
          last_name,
          child_name,
          phone_number,
          user_id,
          users!inner(email)
        ),
        psychologists!inner(
          id,
          first_name,
          last_name,
          phone,
          email
        )
      `)
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Check if session can be rescheduled
    if (['completed', 'cancelled', 'no_show'].includes(session.status)) {
      return res.status(400).json(
        errorResponse('Cannot reschedule completed, cancelled, or no-show sessions')
      );
    }

    // Check if new time slot is available
    const { data: conflictingSessions } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('psychologist_id', session.psychologist_id)
      .eq('scheduled_date', formatDate(new_date))
      .eq('scheduled_time', formatTime(new_time))
      .in('status', ['booked', 'rescheduled', 'confirmed'])
      .neq('id', sessionId);

    if (conflictingSessions && conflictingSessions.length > 0) {
      return res.status(400).json(
        errorResponse('Selected time slot is already booked')
      );
    }

    // Store old session data for notifications
    const oldSessionData = {
      date: session.scheduled_date,
      time: session.scheduled_time
    };

    // Update session with new date/time (reset reminder_sent since it's rescheduled)
    const { data: updatedSession, error: updateError } = await supabaseAdmin
      .from('sessions')
      .update({
        scheduled_date: formatDate(new_date),
        scheduled_time: formatTime(new_time),
        status: 'rescheduled',
        reminder_sent: false, // Reset reminder flag when rescheduled
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select(`
        *,
        clients!inner(
          id,
          first_name,
          last_name,
          child_name,
          user_id,
          users!inner(email)
        ),
        psychologists!inner(
          id,
          first_name,
          last_name,
          email
        )
      `)
      .single();

    if (updateError) {
      console.error('Error updating session:', updateError);
      console.error('Update query details:', {
        sessionId,
        new_date,
        new_time,
        formatted_date: formatDate(new_date),
        formatted_time: formatTime(new_time)
      });
      return res.status(500).json(
        errorResponse('Failed to reschedule session')
      );
    }

    // Update receipt with new session date and time
    try {
      const { data: receipt, error: receiptError } = await supabaseAdmin
        .from('receipts')
        .select('id, receipt_details')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (!receiptError && receipt) {
        // Update receipt_details JSON with new session date and time
        const updatedReceiptDetails = {
          ...receipt.receipt_details,
          session_date: formatDate(new_date),
          session_time: formatTime(new_time)
        };

        await supabaseAdmin
          .from('receipts')
          .update({
            receipt_details: updatedReceiptDetails,
            updated_at: new Date().toISOString()
          })
          .eq('id', receipt.id);

        console.log('✅ Receipt updated with new session date and time');
      } else if (receiptError && receiptError.code !== 'PGRST116') {
        console.error('Error fetching receipt:', receiptError);
      }
    } catch (receiptUpdateError) {
      console.error('Error updating receipt:', receiptUpdateError);
      // Continue even if receipt update fails
    }

    // Update Meet link if session has one
    if (session.meet_link && session.meet_link !== 'https://meet.google.com/new?hs=122&authuser=0') {
      try {
        const meetLinkService = require('../utils/meetLinkService');
        
        // Create new session data for Meet link update
        const sessionData = {
          summary: `Therapy Session - ${session.clients.child_name || session.clients.first_name} with ${session.psychologists.first_name}`,
          description: `Online therapy session between ${session.clients.child_name || session.clients.first_name} and ${session.psychologists.first_name} ${session.psychologists.last_name}`,
          startDate: formatDate(new_date),
          startTime: formatTime(new_time),
          endTime: addMinutesToTime(formatTime(new_time), 50)
        };

        // Generate new Meet link
        const meetResult = await meetLinkService.generateSessionMeetLink(sessionData);
        
        if (meetResult.success) {
          // Update session with new Meet link
          await supabaseAdmin
            .from('sessions')
            .update({
              meet_link: meetResult.meetLink,
              google_calendar_event_id: meetResult.eventId,
              updated_at: new Date().toISOString()
            })
            .eq('id', sessionId);

          console.log('✅ Meet link updated for rescheduled session:', meetResult.meetLink);
        } else {
          console.log('⚠️ Failed to update Meet link, keeping original:', meetResult.note);
        }
      } catch (meetError) {
        console.error('Error updating Meet link:', meetError);
        // Continue with reschedule even if Meet link update fails
      }
    }

    // Get updated session with Meet link for notifications
    const { data: sessionWithMeet } = await supabaseAdmin
      .from('sessions')
      .select('google_meet_link')
      .eq('id', sessionId)
      .single();

    const newMeetLink = sessionWithMeet?.google_meet_link || null;

    // Send reschedule notification emails
    try {
      const emailService = require('../utils/emailService');
      
      await emailService.sendRescheduleNotification({
        clientName: session.clients.child_name || `${session.clients.first_name} ${session.clients.last_name}`,
        psychologistName: `${session.psychologists.first_name} ${session.psychologists.last_name}`,
        clientEmail: session.clients.users.email,
        psychologistEmail: session.psychologists.email,
        scheduledDate: new_date,
        scheduledTime: new_time,
        sessionId: session.id,
        meetLink: newMeetLink,
        reason: reason || 'Admin rescheduled'
      }, oldSessionData.date, oldSessionData.time);
      
      console.log('✅ Reschedule notification emails sent successfully');
    } catch (emailError) {
      console.error('Error sending reschedule notification emails:', emailError);
      // Continue even if email sending fails
    }

    // Send WhatsApp notifications for reschedule
    try {
      console.log('📱 Sending WhatsApp notifications for admin reschedule...');
      const whatsappService = require('../utils/whatsappService');
      
      // Use phone numbers already fetched from session query above
      const clientPhone = session.clients.phone_number || null;
      const psychologistPhone = session.psychologists.phone || null;

      const clientName = session.clients.child_name || `${session.clients.first_name} ${session.clients.last_name}`;
      const psychologistName = `${session.psychologists.first_name} ${session.psychologists.last_name}`;
      
      const originalDateTime = new Date(`${oldSessionData.date}T${oldSessionData.time}`).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short'
      });
      const newDateTime = new Date(`${new_date}T${new_time}`).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short'
      });

      // Send WhatsApp to client
      if (clientPhone) {
        const clientMessage = `🔄 Your therapy session has been rescheduled by admin.\n\n` +
          `❌ Old: ${originalDateTime}\n` +
          `✅ New: ${newDateTime}\n\n` +
          (newMeetLink 
            ? `🔗 New Google Meet Link: ${newMeetLink}\n\n`
            : '') +
          `${reason ? `Reason: ${reason}\n\n` : ''}` +
          `Please update your calendar. We look forward to seeing you at the new time!`;

        const clientResult = await whatsappService.sendWhatsAppTextWithRetry(clientPhone, clientMessage);
        if (clientResult?.success) {
          console.log('✅ Reschedule WhatsApp sent to client');
        } else {
          console.warn('⚠️ Failed to send reschedule WhatsApp to client');
        }
      }

      // Send WhatsApp to psychologist
      if (psychologistPhone) {
        const psychologistMessage = `🔄 Session rescheduled by admin with ${clientName}.\n\n` +
          `❌ Old: ${originalDateTime}\n` +
          `✅ New: ${newDateTime}\n\n` +
          `👤 Client: ${clientName}\n` +
          (newMeetLink 
            ? `🔗 New Google Meet Link: ${newMeetLink}\n\n`
            : '\n') +
          `${reason ? `Reason: ${reason}\n\n` : ''}` +
          `Session ID: ${session.id}`;

        const psychologistResult = await whatsappService.sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
        if (psychologistResult?.success) {
          console.log('✅ Reschedule WhatsApp sent to psychologist');
        } else {
          console.warn('⚠️ Failed to send reschedule WhatsApp to psychologist');
        }
      }
      
      console.log('✅ WhatsApp notifications sent for admin reschedule');
    } catch (waError) {
      console.error('❌ Error sending reschedule WhatsApp:', waError);
      // Continue even if WhatsApp fails
    }

    // Create notification for client
    await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: session.clients.user_id,
        type: 'session_rescheduled',
        title: 'Session Rescheduled',
        message: `Your session has been rescheduled to ${formatDate(new_date)} at ${formatTime(new_time)}`,
        metadata: {
          session_id: session.id,
          old_date: oldSessionData.date,
          old_time: oldSessionData.time,
          new_date: formatDate(new_date),
          new_time: formatTime(new_time),
          reason: reason || 'Admin rescheduled'
        }
      });

    // Create notification for psychologist
    await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: session.psychologists.user_id,
        type: 'session_rescheduled',
        title: 'Session Rescheduled',
        message: `Session with ${session.clients.child_name || session.clients.first_name} has been rescheduled to ${formatDate(new_date)} at ${formatTime(new_time)}`,
        metadata: {
          session_id: session.id,
          old_date: oldSessionData.date,
          old_time: oldSessionData.time,
          new_date: formatDate(new_date),
          new_time: formatTime(new_time),
          reason: reason || 'Admin rescheduled'
        }
      });

    console.log('✅ Session rescheduled successfully by admin');
    
    // PRIORITY: Check and send reminder immediately if rescheduled session is 12 hours away
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

    res.json(
      successResponse(updatedSession, 'Session rescheduled successfully')
    );

  } catch (error) {
    console.error('Admin reschedule session error:', error);
    res.status(500).json(
      errorResponse('Internal server error while rescheduling session')
    );
  }
};

// Get psychologist availability for admin reschedule
const getPsychologistAvailabilityForReschedule = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Start date and end date are required')
      );
    }

    // Get psychologist details
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name')
      .eq('id', psychologistId)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Get psychologist availability
    const { data: availability, error: availabilityError } = await supabaseAdmin
      .from('availability')
      .select('*')
      .eq('psychologist_id', psychologistId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (availabilityError) {
      console.error('Error fetching availability:', availabilityError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologist availability')
      );
    }

    // Get existing sessions in the date range
    const { data: existingSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select('scheduled_date, scheduled_time, status')
      .eq('psychologist_id', psychologistId)
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .in('status', ['booked', 'rescheduled', 'confirmed']);

    if (sessionsError) {
      console.error('Error fetching existing sessions:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to fetch existing sessions')
      );
    }

    // Helper function to convert 24-hour format to 12-hour format
    const convertTo12Hour = (time24) => {
      if (!time24) return '';
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

    // Process availability data
    const processedAvailability = availability.map(day => {
      const daySessions = existingSessions?.filter(session => 
        session.scheduled_date === day.date
      ) || [];

      // Convert booked times from 24-hour to 12-hour format for comparison
      const bookedTimes = daySessions.map(session => convertTo12Hour(session.scheduled_time));
      const timeSlots = day.time_slots || [];

      console.log(`📅 Processing availability for ${day.date}:`, {
        timeSlots_count: timeSlots?.length || 0,
        bookedTimes_count: bookedTimes?.length || 0,
        availableSlots_count: timeSlots.filter(slot => !bookedTimes.includes(slot)).length
      });

      return {
        date: day.date,
        is_available: day.is_available,
        time_slots: timeSlots,
        booked_times: bookedTimes,
        available_slots: day.is_available ? 
          timeSlots.filter(slot => 
            !bookedTimes.includes(slot)
          ) : []
      };
    });

    res.json(
      successResponse({
        psychologist,
        availability: processedAvailability
      }, 'Availability fetched successfully')
    );

  } catch (error) {
    console.error('Get psychologist availability error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching availability')
    );
  }
};

// Get psychologist calendar events for admin view
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

// Check calendar sync status for a psychologist
const checkCalendarSyncStatus = async (req, res) => {
  try {
    const { psychologistId } = req.params;
    const { date } = req.query; // Optional: specific date to check, defaults to tomorrow

    // Find psychologist
    const { data: psychologist, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .eq('id', psychologistId)
      .single();

    if (psychError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    if (!psychologist.google_calendar_credentials) {
      return res.json(
        successResponse({
          psychologist: {
            id: psychologist.id,
            name: `${psychologist.first_name} ${psychologist.last_name}`,
            email: psychologist.email
          },
          googleCalendarConnected: false,
          message: 'Google Calendar not connected'
        }, 'Calendar sync check completed')
      );
    }

    // Get target date (tomorrow by default, or specified date)
    const targetDate = date ? new Date(date) : new Date();
    if (!date) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    targetDate.setHours(0, 0, 0, 0);
    
    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);

    const targetDateStr = targetDate.toISOString().split('T')[0];

    const googleCalendarService = require('../utils/googleCalendarService');

    // 1. Get external events from Google Calendar
    const syncResult = await googleCalendarService.syncCalendarEvents(
      psychologist,
      targetDate,
      targetDateEnd
    );

    if (!syncResult.success) {
      return res.status(500).json(
        errorResponse(`Failed to sync calendar: ${syncResult.error}`)
      );
    }

    // 2. Get availability for target date
    const { data: availability, error: availError } = await supabaseAdmin
      .from('availability')
      .select('id, date, time_slots, is_available, updated_at')
      .eq('psychologist_id', psychologist.id)
      .eq('date', targetDateStr)
      .single();

    // Helper function to normalize time format
    const normalizeTimeTo24Hour = (timeStr) => {
      if (!timeStr) return null;
      const hhmmMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
      if (hhmmMatch) {
        return `${hhmmMatch[1].padStart(2, '0')}:${hhmmMatch[2]}`;
      }
      const rangeMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})-/);
      if (rangeMatch) {
        return `${rangeMatch[1].padStart(2, '0')}:${rangeMatch[2]}`;
      }
      const ampmMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (ampmMatch) {
        let hours = parseInt(ampmMatch[1], 10);
        const minutes = ampmMatch[2];
        const period = ampmMatch[3].toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        return `${hours.toString().padStart(2, '0')}:${minutes}`;
      }
      const extractMatch = String(timeStr).match(/(\d{1,2}):(\d{2})/);
      if (extractMatch) {
        return `${extractMatch[1].padStart(2, '0')}:${extractMatch[2]}`;
      }
      return null;
    };

    // 3. Analyze external events
    const externalEvents = syncResult.externalEvents.map(event => {
      const eventTime = event.start.toTimeString().split(' ')[0].substring(0, 5);
      const eventEndTime = event.end.toTimeString().split(' ')[0].substring(0, 5);
      const normalizedEventTime = normalizeTimeTo24Hour(eventTime);
      const hasMeetLink = event.hangoutsLink || (event.conferenceData && event.conferenceData.entryPoints);
      
      let status = 'unknown';
      let inAvailability = false;
      
      if (availability && availability.time_slots) {
        inAvailability = availability.time_slots.some(slot => {
          const normalizedSlot = normalizeTimeTo24Hour(slot);
          return normalizedSlot === normalizedEventTime;
        });
        
        if (inAvailability) {
          status = 'not_blocked';
        } else {
          status = 'blocked';
        }
      } else {
        status = 'no_availability_record';
      }

      return {
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        time: eventTime,
        endTime: eventEndTime,
        normalizedTime: normalizedEventTime,
        hasGoogleMeet: !!hasMeetLink,
        meetLink: event.hangoutsLink || (event.conferenceData?.entryPoints?.[0]?.uri || null),
        status: status,
        inAvailability: inAvailability
      };
    });

    // 4. Summary
    const summary = {
      totalExternalEvents: syncResult.externalEvents.length,
      eventsWithGoogleMeet: externalEvents.filter(e => e.hasGoogleMeet).length,
      blockedEvents: externalEvents.filter(e => e.status === 'blocked').length,
      notBlockedEvents: externalEvents.filter(e => e.status === 'not_blocked').length,
      noAvailabilityRecord: externalEvents.filter(e => e.status === 'no_availability_record').length
    };

    res.json(
      successResponse({
        psychologist: {
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`,
          email: psychologist.email
        },
        date: targetDateStr,
        googleCalendarConnected: true,
        availability: availability ? {
          exists: true,
          totalSlots: availability.time_slots?.length || 0,
          timeSlots: availability.time_slots || [],
          lastUpdated: availability.updated_at
        } : {
          exists: false,
          error: availError?.message || 'No availability record found'
        },
        externalEvents: externalEvents,
        summary: summary,
        issues: summary.notBlockedEvents > 0 ? [
          `${summary.notBlockedEvents} external event(s) are still in availability and should be blocked`
        ] : []
      }, 'Calendar sync status checked successfully')
    );

  } catch (error) {
    console.error('Check calendar sync status error:', error);
    res.status(500).json(
      errorResponse('Internal server error while checking calendar sync status')
    );
  }
};

// Handle reschedule request approval/rejection
const handleRescheduleRequest = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { action, reason } = req.body; // 'approve' or 'reject', and optional reason

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json(
        errorResponse('Action must be either "approve" or "reject"')
      );
    }

    // Get the notification - admin can approve reschedule requests
    // Note: notifications table uses user_id, not psychologist_id
    // Use supabaseAdmin to bypass RLS for admin operations
    const { supabaseAdmin } = require('../config/supabase');
    // Get notification - don't filter by type initially to see what we have
    const { data: notification, error: notificationError } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .single();
    
    // If found, verify it's a reschedule-related notification
    if (notification && !notification.title?.includes('Reschedule') && !notification.message?.includes('reschedule')) {
      console.warn('⚠️ Notification found but not a reschedule request:', {
        id: notification.id,
        title: notification.title,
        type: notification.type
      });
      return res.status(400).json(
        errorResponse('This notification is not a reschedule request')
      );
    }

    if (notificationError || !notification) {
      console.error('❌ Notification lookup failed:', {
        notificationId,
        error: notificationError,
        found: !!notification,
        errorCode: notificationError?.code,
        errorMessage: notificationError?.message
      });
      return res.status(404).json(
        errorResponse('Reschedule request not found')
      );
    }
    
    console.log('✅ Found notification:', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      related_id: notification.related_id
    });

    // Parse session_id from related_id (not session_id column which doesn't exist)
    const sessionId = notification.related_id;
    if (!sessionId) {
      return res.status(400).json(
        errorResponse('Session ID not found in notification')
      );
    }

    // Parse new date/time from message
    // Message format: "...from YYYY-MM-DD at HH:MM:SS to YYYY-MM-DD at HH:MM or H:MM AM/PM..."
    const message = notification.message || '';
    console.log('📝 Parsing notification message:', message);
    
    // Helper function to parse time string (handles multiple formats)
    const parseTimeString = (timeStr) => {
      if (!timeStr) return '00:00:00';
      
      // Check if 12-hour format (contains AM/PM)
      if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (match) {
          let hour24 = parseInt(match[1]);
          const minutes = match[2];
          const period = match[3].toUpperCase();
          
          if (period === 'PM' && hour24 !== 12) {
            hour24 += 12;
          } else if (period === 'AM' && hour24 === 12) {
            hour24 = 0;
          }
          
          return `${String(hour24).padStart(2, '0')}:${minutes}:00`;
        }
      }
      
      // 24-hour format: handle with or without seconds
      const parts = timeStr.split(':');
      if (parts.length === 2) {
        return `${parts[0].padStart(2, '0')}:${parts[1]}:00`;
      } else if (parts.length === 3) {
        return `${parts[0].padStart(2, '0')}:${parts[1]}:${parts[2]}`;
      }
      
      return '00:00:00';
    };
    
    // Try multiple regex patterns to match different time formats
    // Pattern 1: 24-hour with seconds "09:00:00"
    let newDateMatch = message.match(/to (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2}:\d{2})/);
    let originalDateMatch = message.match(/from (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2}:\d{2})/);
    
    // Pattern 2: 24-hour without seconds "09:00"
    if (!newDateMatch) {
      newDateMatch = message.match(/to (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2})(?!\d)/);
    }
    if (!originalDateMatch) {
      originalDateMatch = message.match(/from (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2})(?!\d)/);
    }
    
    // Pattern 3: 12-hour format "9:00 AM" or "09:00 PM"
    if (!newDateMatch) {
      newDateMatch = message.match(/to (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    }
    if (!originalDateMatch) {
      originalDateMatch = message.match(/from (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    }
    
    if (!newDateMatch || !originalDateMatch) {
      console.error('❌ Failed to parse date/time from message:', {
        message,
        newDateMatch: newDateMatch ? newDateMatch[0] : null,
        originalDateMatch: originalDateMatch ? originalDateMatch[0] : null
      });
      return res.status(400).json(
        errorResponse('Could not parse reschedule date/time from notification message')
      );
    }

    const newDate = newDateMatch[1];
    const newTime = parseTimeString(newDateMatch[2]);
    
    console.log('✅ Parsed reschedule info:', {
      newDate,
      newTime,
      originalDate: originalDateMatch[1],
      originalTime: parseTimeString(originalDateMatch[2])
    });

    // Get the session - use supabaseAdmin to bypass RLS
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    if (action === 'approve') {
      // Check if new time slot is still available - use supabaseAdmin
      const { data: conflictingSessions } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('psychologist_id', session.psychologist_id)
        .eq('scheduled_date', formatDate(newDate))
        .eq('scheduled_time', formatTime(newTime))
        .in('status', ['booked', 'rescheduled', 'confirmed'])
        .neq('id', session.id);

      if (conflictingSessions && conflictingSessions.length > 0) {
        return res.status(400).json(
          errorResponse('Selected time slot is no longer available')
        );
      }

      // Update session with new date/time - use supabaseAdmin
      const { data: updatedSession, error: updateError } = await supabaseAdmin
        .from('sessions')
        .update({
          scheduled_date: formatDate(newDate),
          scheduled_time: formatTime(newTime),
          status: 'rescheduled',
          reschedule_count: (session.reschedule_count || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id)
        .select('*')
        .single();

      if (updateError) {
        console.error('Error updating session:', updateError);
        return res.status(500).json(
          errorResponse('Failed to reschedule session')
        );
      }

      // Update receipt with new session date and time
      try {
        const { data: receipt, error: receiptError } = await supabaseAdmin
          .from('receipts')
          .select('id, receipt_details')
          .eq('session_id', session.id)
          .maybeSingle();

        if (!receiptError && receipt) {
          // Update receipt_details JSON with new session date and time
          const updatedReceiptDetails = {
            ...receipt.receipt_details,
            session_date: formatDate(newDate),
            session_time: formatTime(newTime)
          };

          await supabaseAdmin
            .from('receipts')
            .update({
              receipt_details: updatedReceiptDetails,
              updated_at: new Date().toISOString()
            })
            .eq('id', receipt.id);

          console.log('✅ Receipt updated with new session date and time');
        } else if (receiptError && receiptError.code !== 'PGRST116') {
          console.error('Error fetching receipt:', receiptError);
        }
      } catch (receiptUpdateError) {
        console.error('Error updating receipt:', receiptUpdateError);
        // Continue even if receipt update fails
      }

      // Get client user_id for notification - use supabaseAdmin
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('user_id')
        .eq('id', session.client_id)
        .single();

      // Create approval notification for client - use supabaseAdmin
      if (client?.user_id) {
      const clientNotificationData = {
          user_id: client.user_id,
        title: 'Reschedule Approved',
          message: `Your reschedule request has been approved by admin. Session moved to ${newDate} at ${newTime}`,
          type: 'success',
          related_id: session.id,
          related_type: 'session',
        is_read: false,
        created_at: new Date().toISOString()
      };

      await supabaseAdmin
        .from('notifications')
        .insert([clientNotificationData]);
      }

      // Also notify psychologist that reschedule was approved - use supabaseAdmin
      const { data: psychologistUser } = await supabaseAdmin
        .from('psychologists')
        .select('user_id')
        .eq('id', session.psychologist_id)
        .single();

      if (psychologistUser?.user_id) {
        const psychologistNotification = {
          user_id: psychologistUser.user_id,
          title: 'Reschedule Approved by Admin',
          message: `Admin has approved the reschedule request. Session moved to ${newDate} at ${newTime}`,
          type: 'success',
          related_id: session.id,
          related_type: 'session',
          is_read: false,
          created_at: new Date().toISOString()
        };

        await supabaseAdmin
          .from('notifications')
          .insert([psychologistNotification]);
      }

      // Mark original request as read - use supabaseAdmin
      await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      // Send email and WhatsApp notifications to client and psychologist
      // Run in background to not block the response
      (async () => {
        try {
          // Get client and psychologist details with email and phone for notifications
          const { data: clientDetails } = await supabaseAdmin
            .from('clients')
            .select(`
              id,
              first_name,
              last_name,
              child_name,
              phone_number,
              user:users(email)
            `)
            .eq('id', session.client_id)
            .single();

          const { data: psychologistDetails } = await supabaseAdmin
            .from('psychologists')
            .select('id, first_name, last_name, email, phone')
            .eq('id', session.psychologist_id)
            .single();

          if (!clientDetails || !psychologistDetails) {
            console.warn('⚠️ Could not fetch client or psychologist details for notifications');
            return;
          }

          const clientName = clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim();
          const psychologistName = `${psychologistDetails?.first_name || ''} ${psychologistDetails?.last_name || ''}`.trim();
          const clientEmail = clientDetails?.user?.email || clientDetails?.email;
          const psychologistEmail = psychologistDetails?.email;

          // Get Meet link from updated session
          const meetLink = updatedSession.google_meet_link || null;

          // Send email notifications
          try {
            const emailService = require('../utils/emailService');
            await emailService.sendRescheduleNotification(
              {
                clientName,
                psychologistName,
                clientEmail,
                psychologistEmail,
                scheduledDate: updatedSession.scheduled_date,
                scheduledTime: updatedSession.scheduled_time,
                sessionId: updatedSession.id,
                meetLink,
                isFreeAssessment: session.session_type === 'free_assessment'
              },
              session.scheduled_date,
              session.scheduled_time
            );
            console.log('✅ Reschedule approval emails sent successfully');
          } catch (emailError) {
            console.error('❌ Error sending reschedule approval emails:', emailError);
          }

          // Send WhatsApp notifications
          try {
            const { sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
            
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

            const isFreeAssessment = session.session_type === 'free_assessment';
            const sessionType = isFreeAssessment ? 'free assessment' : 'therapy session';

            // Send WhatsApp to client
            if (clientDetails?.phone_number) {
              const clientMessage = `✅ Your reschedule request has been approved!\n\n` +
                `❌ Old: ${originalDateTime}\n` +
                `✅ New: ${newDateTime}\n\n` +
                (meetLink 
                  ? `🔗 Google Meet Link: ${meetLink}\n\n`
                  : '') +
                `Your ${sessionType} has been successfully rescheduled. We look forward to seeing you at the new time!`;

              const clientResult = await sendWhatsAppTextWithRetry(clientDetails.phone_number, clientMessage);
              if (clientResult?.success) {
                console.log(`✅ Reschedule approval WhatsApp sent to client (${sessionType})`);
              } else {
                console.warn('⚠️ Failed to send reschedule approval WhatsApp to client');
              }
            }

            // Send WhatsApp to psychologist
            if (psychologistDetails?.phone) {
              const psychologistMessage = `✅ Reschedule request approved by admin.\n\n` +
                `👤 Client: ${clientName}\n` +
                `❌ Old: ${originalDateTime}\n` +
                `✅ New: ${newDateTime}\n\n` +
                (meetLink 
                  ? `🔗 Google Meet Link: ${meetLink}\n\n`
                  : '\n') +
                `Session ID: ${session.id}`;

              const psychologistResult = await sendWhatsAppTextWithRetry(psychologistDetails.phone, psychologistMessage);
              if (psychologistResult?.success) {
                console.log(`✅ Reschedule approval WhatsApp sent to psychologist (${sessionType})`);
              } else {
                console.warn('⚠️ Failed to send reschedule approval WhatsApp to psychologist');
              }
            }
            
            console.log('✅ WhatsApp notifications sent for reschedule approval');
          } catch (waError) {
            console.error('❌ Error sending reschedule approval WhatsApp:', waError);
          }
        } catch (notificationError) {
          console.error('❌ Error in background notification tasks:', notificationError);
          // Don't throw - notifications are not critical for the approval response
        }
      })();

      res.json(
        successResponse(updatedSession, 'Reschedule request approved successfully')
      );

    } else if (action === 'reject') {
      
      // Revert session status back to booked - use supabaseAdmin
      const { data: updatedSession, error: updateError } = await supabaseAdmin
        .from('sessions')
        .update({
          status: 'booked',
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id)
        .select('*')
        .single();

      if (updateError) {
        console.error('Error updating session:', updateError);
        return res.status(500).json(
          errorResponse('Failed to reject reschedule request')
        );
      }

      // Get client details for notifications - use supabaseAdmin
      const { data: clientDetails } = await supabaseAdmin
        .from('clients')
        .select(`
          id,
          first_name,
          last_name,
          child_name,
          phone_number,
          user_id,
          user:users(email)
        `)
        .eq('id', session.client_id)
        .single();

      // Create rejection notification for client with operations contact info - use supabaseAdmin
      if (clientDetails?.user_id) {
        const rejectionMessage = reason 
          ? `Your reschedule request has been declined. Reason: ${reason}. Your session remains scheduled for ${session.scheduled_date} at ${session.scheduled_time}. For further communication, please contact our operations team via WhatsApp or call.`
          : `Your reschedule request has been declined. Your session remains scheduled for ${session.scheduled_date} at ${session.scheduled_time}. For further communication, please contact our operations team via WhatsApp or call.`;

        const clientNotificationData = {
          user_id: clientDetails.user_id,
          title: 'Reschedule Request Declined',
          message: rejectionMessage,
          type: 'error',
          related_id: session.id,
          related_type: 'session',
          is_read: false,
          created_at: new Date().toISOString()
        };

        await supabaseAdmin
          .from('notifications')
          .insert([clientNotificationData]);
      }

      // Mark original request as read - use supabaseAdmin
      await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      // Send email and WhatsApp notifications to client
      // Run in background to not block the response
      (async () => {
        try {
          if (!clientDetails) {
            console.warn('⚠️ Could not fetch client details for decline notifications');
            return;
          }

          const clientName = clientDetails?.child_name || `${clientDetails?.first_name || ''} ${clientDetails?.last_name || ''}`.trim();
          const clientEmail = clientDetails?.user?.email || clientDetails?.email;
          const clientPhone = clientDetails?.phone_number;

          // Format session date/time
          const sessionDateTime = new Date(`${session.scheduled_date}T${session.scheduled_time}`).toLocaleString('en-IN', { 
            timeZone: 'Asia/Kolkata',
            dateStyle: 'long',
            timeStyle: 'short'
          });

          // Send email notification
          try {
            const emailService = require('../utils/emailService');
            const formattedDate = new Date(`${session.scheduled_date}T00:00:00`).toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'Asia/Kolkata'
            });
            
            // Format time
            const formatTimeFromString = (timeStr) => {
              if (!timeStr) return '';
              const [hours, minutes] = timeStr.split(':');
              const hour = parseInt(hours, 10);
              const ampm = hour >= 12 ? 'PM' : 'AM';
              const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
              return `${displayHour}:${minutes} ${ampm}`;
            };
            
            const formattedTime = formatTimeFromString(session.scheduled_time);

            // Send custom decline email
            const declineEmailSubject = 'Reschedule Request Declined';
            const declineEmailHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #dc2626;">Reschedule Request Declined</h2>
                <p>Dear ${clientName},</p>
                <p>We regret to inform you that your reschedule request has been declined.</p>
                ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
                <p><strong>Your original session is still scheduled:</strong></p>
                <ul>
                  <li><strong>Date:</strong> ${formattedDate}</li>
                  <li><strong>Time:</strong> ${formattedTime}</li>
                </ul>
                <p>Your session remains available at the originally scheduled time. If you need to discuss this further or have any concerns, please contact our operations team via WhatsApp or call.</p>
                <p>Thank you for your understanding.</p>
                <p>Best regards,<br>Kuttikal Team</p>
              </div>
            `;

            if (clientEmail) {
              await emailService.transporter.sendMail({
                from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
                to: clientEmail,
                subject: declineEmailSubject,
                html: declineEmailHtml
              });
              console.log('✅ Reschedule decline email sent to client');
            }
          } catch (emailError) {
            console.error('❌ Error sending reschedule decline email:', emailError);
          }

          // Send WhatsApp notification
          try {
            const { sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
            
            if (clientPhone) {
              const whatsappMessage = `❌ Your reschedule request has been declined.\n\n` +
                `${reason ? `Reason: ${reason}\n\n` : ''}` +
                `✅ Your original session is still scheduled:\n` +
                `📅 Date: ${sessionDateTime}\n\n` +
                `Your session remains available at the originally scheduled time. If you need to discuss this further or have any concerns, please contact our operations team via WhatsApp or call.\n\n` +
                `Thank you for your understanding.`;

              const whatsappResult = await sendWhatsAppTextWithRetry(clientPhone, whatsappMessage);
              if (whatsappResult?.success) {
                console.log('✅ Reschedule decline WhatsApp sent to client');
              } else {
                console.warn('⚠️ Failed to send reschedule decline WhatsApp to client');
              }
            }
          } catch (waError) {
            console.error('❌ Error sending reschedule decline WhatsApp:', waError);
          }
        } catch (notificationError) {
          console.error('❌ Error in background decline notification tasks:', notificationError);
          // Don't throw - notifications are not critical for the decline response
        }
      })();

      res.json(
        successResponse(updatedSession, 'Reschedule request rejected')
      );
    }

  } catch (error) {
    console.error('Handle reschedule request error:', error);
    res.status(500).json(
      errorResponse('Internal server error while handling reschedule request')
    );
  }
};

// Create manual booking (admin only - for edge cases)
const createManualBooking = async (req, res) => {
  try {
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

    console.log('📝 Admin creating manual booking:', {
      client_id,
      psychologist_id,
      package_id,
      scheduled_date,
      scheduled_time,
      amount,
      payment_received_date,
      client_id_type: typeof client_id,
      client_id_length: client_id?.toString().length
    });

    // Validate required fields
    if (!client_id || !psychologist_id || !scheduled_date || !scheduled_time || !amount) {
      return res.status(400).json(
        errorResponse('Missing required fields: client_id, psychologist_id, scheduled_date, scheduled_time, amount')
      );
    }

    // Validate payment_received_date
    if (!payment_received_date) {
      return res.status(400).json(
        errorResponse('payment_received_date is required for manual bookings')
      );
    }

    // Check if client exists (use admin client to bypass RLS)
    // Convert client_id to integer if it's a string (UUIDs will remain strings)
    const clientIdForQuery = isNaN(client_id) ? client_id : parseInt(client_id);
    
    console.log('🔍 Looking up client:', {
      client_id,
      client_id_type: typeof client_id,
      clientIdForQuery,
      clientIdForQuery_type: typeof clientIdForQuery
    });

    // First try to find client by id
    let { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select(`
        *,
        user:users(email)
      `)
      .eq('id', clientIdForQuery)
      .single();

    // If not found by id, try looking up by user_id (in case frontend sent user.id instead of client.id)
    if (clientError || !client) {
      console.log('⚠️ Client not found by id, trying user_id lookup...');
      const { data: clientByUserId, error: userLookupError } = await supabaseAdmin
        .from('clients')
        .select(`
          *,
          user:users(email)
        `)
        .eq('user_id', clientIdForQuery)
        .single();

      if (clientByUserId && !userLookupError) {
        console.log('✅ Found client by user_id instead');
        client = clientByUserId;
        clientError = null;
      } else {
        console.error('❌ Client lookup error (by id and user_id):', {
          client_id,
          clientIdForQuery,
          errorById: clientError,
          errorByUserId: userLookupError,
          client: client,
          errorDetails: clientError ? {
            message: clientError.message,
            code: clientError.code,
            details: clientError.details,
            hint: clientError.hint
          } : null
        });
        return res.status(404).json(
          errorResponse(`Client not found with id or user_id: ${client_id}`)
        );
      }
    }

    console.log('✅ Client found:', {
      clientId: client.id,
      clientEmail: client.user?.email,
      clientPhone: client.phone_number,
      clientName: `${client.first_name} ${client.last_name}`,
      childName: client.child_name
    });

    // Check if psychologist exists (use admin client to bypass RLS)
    // Also fetch Google Calendar credentials for better Meet link creation
    const { data: psychologist, error: psychologistError } = await supabaseAdmin
      .from('psychologists')
      .select('*, google_calendar_credentials')
      .eq('id', psychologist_id)
      .single();

    if (psychologistError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    // Check if package exists (if package_id is provided and not null)
    let packageData = null;
    if (package_id) {
      const { data: pkg, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', package_id)
        .single();

      if (packageError || !pkg) {
        return res.status(404).json(
          errorResponse('Package not found')
        );
      }
      packageData = pkg;
    }

    // Check if time slot is already booked (use admin client to bypass RLS)
    const { data: existingSession, error: existingError } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('psychologist_id', psychologist_id)
      .eq('scheduled_date', scheduled_date)
      .eq('scheduled_time', scheduled_time)
      .in('status', ['booked', 'rescheduled', 'confirmed'])
      .single();

    if (existingSession) {
      return res.status(400).json(
        errorResponse('This time slot is already booked for the psychologist')
      );
    }

    // Generate transaction ID for manual payment
    // Format: MANUAL-{timestamp}-{random}
    // Example: MANUAL-1704067200000-abc123xyz
    // Note: For manual payments, we don't have Razorpay order_id or payment_id
    // The transaction_id serves as the unique identifier for manual payments
    const transactionId = `MANUAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Normalize payment method (default to 'cash' if not provided)
    const normalizedPaymentMethod = (payment_method || 'cash').toLowerCase();

    // Create manual payment record (use admin client to bypass RLS)
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        transaction_id: transactionId,
        session_id: null, // Will be set after session creation
        psychologist_id: psychologist_id,
        client_id: client.id, // Use the actual client.id we found, not the user_id that was sent
        package_id: package_id || null,
        amount: amount,
        session_type: packageData ? 'package' : 'individual',
        status: 'success', // Mark as success for manual payment
        payment_method: normalizedPaymentMethod, // Store payment method in dedicated column
        razorpay_params: {
          notes: {
            manual: true,
            payment_method: normalizedPaymentMethod, // Also store in notes for reference
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
      console.error('❌ Error creating payment record:', paymentError);
      return res.status(500).json(
        errorResponse('Failed to create payment record')
      );
    }

    console.log('✅ Manual payment record created:', paymentRecord.id);

    // Generate Google Meet link (non-blocking - continue even if it takes time)
    const meetLinkService = require('../utils/meetLinkService');
    const { addMinutesToTime } = require('../utils/helpers');
    let meetData = null;

    try {
      console.log('🔄 Creating Google Meet meeting for manual booking...');
      
      const sessionData = {
        summary: `Therapy Session - ${client.child_name || client.first_name} with ${psychologist.first_name}`,
        description: `Online therapy session between ${client.child_name || client.first_name} and ${psychologist.first_name} ${psychologist.last_name}`,
        startDate: scheduled_date,
        startTime: scheduled_time,
        endTime: addMinutesToTime(scheduled_time, 50) // Add 50 minutes
      };
      
      // Try to use psychologist's Google Calendar OAuth credentials for faster Meet link creation
      let userAuth = null;
      if (psychologist.google_calendar_credentials) {
        try {
          const credentials = typeof psychologist.google_calendar_credentials === 'string' 
            ? JSON.parse(psychologist.google_calendar_credentials) 
            : psychologist.google_calendar_credentials;
          
          // Check if access token is still valid (not expired, with 5 min buffer)
          const now = Date.now();
          const expiryDate = credentials.expiry_date;
          const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
          
          if (credentials.access_token) {
            if (!expiryDate || expiryDate > (now + bufferTime)) {
              // Token is valid
              userAuth = {
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token,
                expiry_date: credentials.expiry_date
              };
              console.log('✅ Using psychologist Google Calendar OAuth credentials for Meet link creation (token valid)');
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
        console.log('ℹ️ Psychologist does not have Google Calendar connected - will use service account method');
      }
      
      // Create Meet link - will use OAuth if available, otherwise falls back to Calendar API
      // The service will try to get the link immediately, and if not available,
      // it waits up to 30 seconds for the conference to be ready.
      // Even if it times out, the calendar event is created and the Meet link becomes available later.
      const meetResult = await meetLinkService.generateSessionMeetLink(sessionData, userAuth);
      
      if (meetResult.success && meetResult.meetLink && !meetResult.meetLink.includes('meet.google.com/new')) {
        // Real Meet link created
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || meetResult.calendarLink || null,
          method: meetResult.method
        };
        console.log('✅ Real Google Meet link created successfully:', meetResult.method);
      } else if (meetResult.requiresOAuth || meetResult.method === 'service_account_limitation') {
        // Service account limitation - psychologist needs to connect Google Calendar
        console.log('⚠️ ⚠️ ⚠️ IMPORTANT: Real Meet link NOT created');
        console.log('⚠️ Reason: Service accounts cannot create Meet conferences');
        console.log('⚠️ Solution: Psychologist must connect their Google Calendar for OAuth authentication');
        console.log('⚠️ Calendar event created:', meetResult.eventLink);
        console.log('⚠️ Meet link must be added manually or psychologist needs to connect Google Calendar');
        
        // Return null for meetLink to indicate it needs manual creation or OAuth
        meetData = {
          meetLink: null, // No Meet link available
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || meetResult.calendarLink || null,
          method: meetResult.method || 'oauth_required',
          requiresOAuth: true,
          note: 'Psychologist must connect Google Calendar to generate real Meet links'
        };
      } else {
        // Fallback case
        meetData = {
          meetLink: meetResult.meetLink || null,
          eventId: meetResult.eventId || null,
          calendarLink: meetResult.eventLink || meetResult.calendarLink || null,
          method: meetResult.method || 'fallback'
        };
        console.log('⚠️ Using fallback or no Meet link');
      }
    } catch (meetError) {
      console.error('❌ Error creating Meet link:', meetError);
      // Use fallback link and continue
      meetData = {
        meetLink: 'https://meet.google.com/new?hs=122&authuser=0',
        eventId: null,
        calendarLink: null,
        method: 'fallback'
      };
      console.log('⚠️ Continuing with fallback Meet link');
    }

    // Create session
    const sessionData = {
      client_id: client.id, // Use the actual client.id we found, not the user_id that was sent
      psychologist_id: psychologist_id,
      package_id: package_id || null,
      scheduled_date: scheduled_date,
      scheduled_time: scheduled_time,
      status: 'booked',
      payment_id: paymentRecord.id,
      price: amount, // Sessions table uses 'price' column, not 'amount'
      session_notes: notes || null, // Sessions table uses 'session_notes' column, not 'notes'
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

          // Add meet data if available
          // IMPORTANT: Only add Meet link if it's a real Meet link (not fallback)
          if (meetData && meetData.eventId) {
            sessionData.google_calendar_event_id = meetData.eventId;
            // Only set Meet link if it's a real link (not fallback URL)
            if (meetData.meetLink && !meetData.meetLink.includes('meet.google.com/new')) {
              sessionData.google_meet_link = meetData.meetLink;
              sessionData.google_meet_join_url = meetData.meetLink;
              sessionData.google_meet_start_url = meetData.meetLink;
            } else {
              // Leave Meet link fields as null - indicates manual creation needed
              sessionData.google_meet_link = null;
              sessionData.google_meet_join_url = null;
              sessionData.google_meet_start_url = null;
            }
            // Always add calendar link if available
            if (meetData.calendarLink) {
              sessionData.google_calendar_link = meetData.calendarLink;
            }
          }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      console.error('❌ Session creation failed:', sessionError);
        
        // Check if it's a unique constraint violation (double booking)
        if (sessionError.code === '23505' || 
            sessionError.message?.includes('unique') || 
            sessionError.message?.includes('duplicate')) {
          console.log('⚠️ Double booking detected - slot was just booked by another user');
          // Rollback payment record
          await supabaseAdmin.from('payments').delete().eq('id', paymentRecord.id);
          return res.status(409).json(
            errorResponse('This time slot was just booked by another user. Please select another time.')
          );
        }
        
      // Rollback payment record
      await supabaseAdmin.from('payments').delete().eq('id', paymentRecord.id);
      return res.status(500).json(
        errorResponse('Failed to create session')
      );
    }

    console.log('✅ Session created successfully:', session.id);

    // Update payment record with session_id (use admin client to bypass RLS)
    await supabaseAdmin
      .from('payments')
      .update({ session_id: session.id })
      .eq('id', paymentRecord.id);

    // Generate PDF receipt FIRST (before sending email/WhatsApp so we can attach it)
    let receiptResult = null;
    try {
      console.log('📄 Generating PDF receipt...');
      const { generateAndStoreReceipt } = require('../controllers/paymentController');
      receiptResult = await generateAndStoreReceipt(
        session,
        paymentRecord,
        client,
        psychologist
      );
      if (receiptResult && receiptResult.receiptNumber) {
        console.log('✅ Receipt generated successfully:', {
          receiptNumber: receiptResult.receiptNumber,
          pdfGenerated: !!receiptResult.pdfBuffer,
          pdfSize: receiptResult.pdfBuffer?.length || 0
        });
      }
    } catch (receiptError) {
      console.error('❌ Error generating receipt:', receiptError);
      // Continue even if receipt generation fails
    }

    // Send email notifications (with receipt attachment)
    try {
      console.log('📧 Sending email notifications...');
      const emailService = require('../utils/emailService');
      
      // Use client_name from receiptDetails if available (first_name + last_name), otherwise use first_name + last_name directly
      const emailClientName = receiptResult?.receiptDetails?.client_name || 
                              `${client.first_name || ''} ${client.last_name || ''}`.trim() || 
                              'Client';
      const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`.trim();

      console.log('📧 Client details for email:', {
        clientName: emailClientName,
        clientEmail: client.user?.email,
        clientPhone: client.phone_number,
        psychologistName
      });

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
        status: session.status || 'booked',
        psychologistId: psychologist_id,
        clientId: client.id,
        receiptPdfBuffer: receiptResult?.pdfBuffer || null,
        receiptNumber: receiptResult?.receiptNumber || null
      });

      console.log('✅ Email notifications sent');
    } catch (emailError) {
      console.error('❌ Error sending emails:', emailError);
      // Continue even if email fails
    }

    // Send WhatsApp notifications (with receipt PDF)
    try {
      console.log('📱 Sending WhatsApp notifications via UltraMsg API...');
      const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
      
      // Fix clientName: Don't use child_name if it's "Pending", null, or empty
      const clientName = (client.child_name && 
        client.child_name.trim() !== '' && 
        client.child_name.toLowerCase() !== 'pending')
        ? client.child_name
        : `${client.first_name || ''} ${client.last_name || ''}`.trim();
      const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`.trim();

      console.log('📱 Client details for WhatsApp:', {
        clientName,
        clientPhone: client.phone_number,
        psychologistName,
        hasReceiptPdf: !!receiptResult?.pdfBuffer
      });

      // Send WhatsApp to client
      if (client.phone_number) {
        console.log(`📱 Sending WhatsApp to client at: ${client.phone_number}`);
        const meetLinkText = meetData?.meetLink && !meetData.meetLink.includes('meet.google.com/new') 
          ? `🔗 Google Meet Link: ${meetData.meetLink}` 
          : meetData?.requiresOAuth
            ? `⚠️ Note: Google Meet link will be shared once available.`
            : `🔗 Google Meet Link: Will be shared shortly`;
        
        const sessionDateTime = new Date(`${scheduled_date}T${scheduled_time}`).toLocaleString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          dateStyle: 'long',
          timeStyle: 'short'
        });
        
        if (meetData?.meetLink && !meetData.meetLink.includes('meet.google.com/new')) {
          // Use booking confirmation for real Meet links
          // Only include childName if child_name exists and is not empty/null/'Pending'
          const childName = client.child_name && 
            client.child_name.trim() !== '' && 
            client.child_name.toLowerCase() !== 'pending'
            ? client.child_name 
            : null;
          
          // Get client name from receiptDetails (first_name + last_name) for receipt filename
          const receiptClientName = receiptResult?.receiptDetails?.client_name || clientName || null;
          
          const clientDetails = {
            childName: childName,
            date: scheduled_date,
            time: scheduled_time,
            meetLink: meetData.meetLink,
            psychologistName: psychologistName, // Add psychologist name to WhatsApp message
            receiptPdfBuffer: receiptResult?.pdfBuffer || null, // Add receipt PDF buffer
            receiptNumber: receiptResult?.receiptNumber || null, // Add receipt number
            clientName: receiptClientName // Client name (first_name + last_name) for receipt filename
          };
          await sendBookingConfirmation(client.phone_number, clientDetails);
        } else {
          // Use plain text for cases without Meet link
          const clientMessage = `🎉 Your session with Dr. ${psychologistName} is confirmed!\n\n` +
            `📅 Date: ${sessionDateTime}\n` +
            `${meetLinkText}\n\n` +
            `We look forward to seeing you!`;
          await sendWhatsAppTextWithRetry(client.phone_number, clientMessage);
        }
        console.log('✅ WhatsApp sent to client');
      }

      // Send WhatsApp to psychologist
      if (psychologist.phone) {
        const meetLinkText = meetData?.meetLink && !meetData.meetLink.includes('meet.google.com/new')
          ? `🔗 Google Meet Link: ${meetData.meetLink}`
          : meetData?.requiresOAuth
            ? `⚠️ IMPORTANT: Please connect your Google Calendar in your profile to enable automatic Meet link creation.`
            : `🔗 Google Meet Link: Will be shared shortly`;
        
        const sessionDateTime = new Date(`${scheduled_date}T${scheduled_time}`).toLocaleString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          dateStyle: 'long',
          timeStyle: 'short'
        });
        
        const psychologistMessage = `🔔 New session booked with ${clientName}.\n\n` +
          `📅 Date: ${sessionDateTime}\n` +
          `${meetLinkText}\n\n` +
          `Session ID: ${session.id}`;
        await sendWhatsAppTextWithRetry(psychologist.phone, psychologistMessage);
        console.log('✅ WhatsApp sent to psychologist');
      }
      
      console.log('✅ WhatsApp notifications sent successfully');
    } catch (whatsappError) {
      console.error('❌ Error sending WhatsApp:', whatsappError);
      // Continue even if WhatsApp fails
    }

    // If package booking, create client package record
    if (package_id && packageData) {
      console.log('📦 Creating client package record...');
      try {
        // Check if client package already exists (use admin client to bypass RLS)
        const { data: existingClientPackage } = await supabaseAdmin
          .from('client_packages')
          .select('*')
          .eq('client_id', client.id) // Use the actual client.id we found, not the user_id that was sent
          .eq('package_id', package_id)
          .eq('status', 'active')
          .single();

        if (existingClientPackage) {
          // Update existing package: increment used sessions
          await supabaseAdmin
            .from('client_packages')
            .update({
              remaining_sessions: existingClientPackage.remaining_sessions - 1
            })
            .eq('id', existingClientPackage.id);
          console.log('✅ Updated existing client package');
        } else {
          // Create new client package
          const clientPackageData = {
            client_id: client.id, // Use the actual client.id we found, not the user_id that was sent
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
          console.log('✅ Client package record created');
        }
      } catch (packageError) {
        console.error('❌ Error creating client package:', packageError);
        // Continue even if package creation fails
      }
    }

    // Fetch the complete session with relations for response
    const { data: completeSession, error: fetchError } = await supabaseAdmin
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

    console.log('✅ Manual booking created successfully');
    
    // PRIORITY: Check and send reminder immediately if manual booking is 12 hours away
    // This gives manual bookings priority over batch reminder processing
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
      successResponse(completeSession || session, 'Manual booking created successfully')
    );

  } catch (error) {
    console.error('Create manual booking error:', error);
    res.status(500).json(
      errorResponse('Internal server error while creating manual booking')
    );
  }
};

// Get all reschedule requests (for admin dashboard)
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

// Daily task to add next day availability (called at 12 AM)
const addNextDayAvailability = async (req, res) => {
  try {
    const result = await defaultAvailabilityService.addNextDayAvailability();
    if (result.success) {
      res.json(successResponse(result, 'Next day availability added successfully'));
    } else {
      res.status(500).json(errorResponse(result.message || 'Failed to add next day availability'));
    }
  } catch (error) {
    console.error('Error in addNextDayAvailability endpoint:', error);
    res.status(500).json(errorResponse('Internal server error while adding next day availability'));
  }
};

// Update all existing psychologists with default availability
const updateAllPsychologistsAvailability = async (req, res) => {
  try {
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

// Check which doctors are missing 3-session and 6-session packages
const checkMissingPackages = async (req, res) => {
  try {
    // Get all psychologists
    const { data: psychologists, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .order('first_name');

    if (psychError) {
      return res.status(500).json(
        errorResponse('Failed to fetch psychologists')
      );
    }

    if (!psychologists || psychologists.length === 0) {
      return res.json(
        successResponse({
          total: 0,
          complete: 0,
          missing: 0,
          missingDoctors: []
        }, 'No psychologists found')
      );
    }

    const missingPackages = [];
    const allGood = [];

    // Check each psychologist
    for (const psychologist of psychologists) {
      const { data: packages, error: packagesError } = await supabaseAdmin
        .from('packages')
        .select('id, session_count, name, price')
        .eq('psychologist_id', psychologist.id)
        .in('session_count', [3, 6]);

      if (packagesError) {
        console.error(`Error fetching packages for ${psychologist.first_name} ${psychologist.last_name}:`, packagesError);
        continue;
      }

      const sessionCounts = (packages || []).map(p => p.session_count);
      const has3Session = sessionCounts.includes(3);
      const has6Session = sessionCounts.includes(6);

      const missing = [];
      if (!has3Session) missing.push('3-session');
      if (!has6Session) missing.push('6-session');

      if (missing.length > 0) {
        missingPackages.push({
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`,
          email: psychologist.email,
          missing: missing,
          existingPackages: packages || []
        });
      } else {
        allGood.push({
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`
        });
      }
    }

    res.json(
      successResponse({
        total: psychologists.length,
        complete: allGood.length,
        missing: missingPackages.length,
        missingDoctors: missingPackages,
        completeDoctors: allGood
      }, 'Package check completed')
    );

  } catch (error) {
    console.error('Check missing packages error:', error);
    res.status(500).json(
      errorResponse('Internal server error while checking packages')
    );
  }
};

// Delete package (admin only)
const deletePackage = async (req, res) => {
  try {
    const { packageId } = req.params;

    // Check if package exists
    const { data: package, error: packageError } = await supabaseAdmin
      .from('packages')
      .select('id, psychologist_id, name, session_count')
      .eq('id', packageId)
      .single();

    if (packageError || !package) {
      return res.status(404).json(
        errorResponse('Package not found')
      );
    }

    // Check if package is being used in any sessions
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('package_id', packageId)
      .limit(1);

    if (sessionsError) {
      console.error('Error checking sessions:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to check package usage')
      );
    }

    if (sessions && sessions.length > 0) {
      return res.status(400).json(
        errorResponse('Cannot delete package that is being used in sessions')
      );
    }

    // Delete the package
    const { error: deleteError } = await supabaseAdmin
      .from('packages')
      .delete()
      .eq('id', packageId);

    if (deleteError) {
      console.error('Delete package error:', deleteError);
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

// Get stuck slot locks (for debugging)
const getStuckSlotLocks = async (req, res) => {
  try {
    const { checkStuckSlotLocks } = require('../scripts/checkStuckSlotLocks');
    const result = await checkStuckSlotLocks();
    
    res.json(
      successResponse(result, 'Stuck slot locks retrieved successfully')
    );
  } catch (error) {
    console.error('Error fetching stuck slot locks:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching stuck slot locks')
    );
  }
};

// Update session payment details (admin only)
const updateSessionPayment = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { 
      payment_method, 
      transaction_id, 
      razorpay_order_id, 
      razorpay_payment_id 
    } = req.body;

    console.log('📝 Admin updating session payment:', {
      sessionId,
      payment_method,
      transaction_id,
      razorpay_order_id,
      razorpay_payment_id
    });

    // Validate required fields
    if (!transaction_id) {
      return res.status(400).json(
        errorResponse('Transaction ID is required')
      );
    }

    // Check if session exists
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('id, payment_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      console.error('❌ Session not found:', sessionError);
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Check if payment exists
    if (!session.payment_id) {
      return res.status(400).json(
        errorResponse('This session does not have an associated payment record')
      );
    }

    // Prepare update data
    const paymentUpdateData = {
      transaction_id: transaction_id.trim(),
      updated_at: new Date().toISOString()
    };

    // Add payment_method if provided
    if (payment_method) {
      paymentUpdateData.payment_method = payment_method.toLowerCase();
    }

    // Add Razorpay fields if provided
    if (razorpay_order_id !== undefined) {
      paymentUpdateData.razorpay_order_id = razorpay_order_id?.trim() || null;
    }

    if (razorpay_payment_id !== undefined) {
      paymentUpdateData.razorpay_payment_id = razorpay_payment_id?.trim() || null;
    }

    // Update payment record
    const { data: updatedPayment, error: paymentUpdateError } = await supabaseAdmin
      .from('payments')
      .update(paymentUpdateData)
      .eq('id', session.payment_id)
      .select()
      .single();

    if (paymentUpdateError) {
      console.error('❌ Error updating payment:', paymentUpdateError);
      return res.status(500).json(
        errorResponse('Failed to update payment details')
      );
    }

    console.log('✅ Payment updated successfully:', updatedPayment.id);

    // Also update razorpay_params notes if payment_method is provided
    if (payment_method && updatedPayment.razorpay_params) {
      const updatedParams = {
        ...updatedPayment.razorpay_params,
        notes: {
          ...(updatedPayment.razorpay_params.notes || {}),
          payment_method: payment_method.toLowerCase()
        }
      };

      await supabaseAdmin
        .from('payments')
        .update({ razorpay_params: updatedParams })
        .eq('id', session.payment_id);
    }

    // Fetch updated session with payment details
    const { data: updatedSession, error: fetchError } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        payment:payments(*)
      `)
      .eq('id', sessionId)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching updated session:', fetchError);
      // Still return success since payment was updated
      return res.json(
        successResponse(updatedPayment, 'Payment details updated successfully')
      );
    }

    res.json(
      successResponse(updatedSession, 'Session payment details updated successfully')
    );
  } catch (error) {
    console.error('❌ Exception in updateSessionPayment:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating payment details')
    );
  }
};

// Update session details (admin only - comprehensive update)
const updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      psychologist_id,
      client_id,
      scheduled_date,
      scheduled_time,
      status,
      price,
      payment_method,
      transaction_id,
      razorpay_order_id,
      razorpay_payment_id
    } = req.body;

    console.log('📝 Admin updating session:', {
      sessionId,
      psychologist_id,
      client_id,
      scheduled_date,
      scheduled_time,
      status,
      price
    });

    // Check if session exists
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('id, psychologist_id, client_id, scheduled_date, scheduled_time, status, price, payment_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      console.error('❌ Session not found:', sessionError);
      return res.status(404).json(
        errorResponse('Session not found')
      );
    }

    // Define allowed statuses
    const ALLOWED_STATUSES = ['booked', 'scheduled', 'rescheduled', 'reschedule_requested', 'confirmed', 'completed', 'cancelled', 'no_show', 'noshow'];

    // Validate status if provided
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json(
        errorResponse(`Invalid session status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`)
      );
    }

    // Prepare session update data
    const sessionUpdateData = {
      updated_at: new Date().toISOString()
    };

    // Update psychologist if provided
    if (psychologist_id !== undefined && psychologist_id !== null) {
      // Verify psychologist exists
      const { data: psychologist, error: psychError } = await supabaseAdmin
        .from('psychologists')
        .select('id')
        .eq('id', psychologist_id)
        .single();

      if (psychError || !psychologist) {
        return res.status(404).json(
          errorResponse('Psychologist not found')
        );
      }
      sessionUpdateData.psychologist_id = psychologist_id;
    }

    // Update client if provided
    if (client_id !== undefined && client_id !== null) {
      // Verify client exists
      const { data: client, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', client_id)
        .single();

      if (clientError || !client) {
        return res.status(404).json(
          errorResponse('Client not found')
        );
      }
      sessionUpdateData.client_id = client_id;
    }

    // Update date/time if provided
    if (scheduled_date) {
      sessionUpdateData.scheduled_date = scheduled_date;
    }
    if (scheduled_time) {
      sessionUpdateData.scheduled_time = scheduled_time;
    }

    // Update status if provided
    if (status) {
      sessionUpdateData.status = status;
    }

    // Update price if provided
    if (price !== undefined && price !== null) {
      sessionUpdateData.price = parseFloat(price);
    }

    // Check for conflicts if date/time/psychologist changed
    if ((scheduled_date || scheduled_time || psychologist_id !== undefined) && sessionUpdateData.psychologist_id) {
      const checkPsychologistId = sessionUpdateData.psychologist_id || session.psychologist_id;
      const checkDate = sessionUpdateData.scheduled_date || session.scheduled_date;
      const checkTime = sessionUpdateData.scheduled_time || session.scheduled_time;

      const { data: conflictingSessions, error: conflictError } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('psychologist_id', checkPsychologistId)
        .eq('scheduled_date', checkDate)
        .eq('scheduled_time', checkTime)
        .in('status', ['booked', 'rescheduled', 'confirmed', 'scheduled'])
        .neq('id', sessionId);

      if (conflictError) {
        console.error('❌ Error checking conflicts:', conflictError);
      } else if (conflictingSessions && conflictingSessions.length > 0) {
        return res.status(400).json(
          errorResponse('Selected time slot is already booked for the psychologist')
        );
      }
    }

    // Update session
    const { data: updatedSession, error: updateError } = await supabaseAdmin
      .from('sessions')
      .update(sessionUpdateData)
      .eq('id', sessionId)
      .select(`
        *,
        client:clients(
          id,
          first_name,
          last_name,
          child_name,
          child_age,
          phone_number,
          user:users(email)
        ),
        psychologist:psychologists(
          id,
          first_name,
          last_name,
          email,
          phone
        )
      `)
      .single();

    if (updateError) {
      console.error('❌ Error updating session:', updateError);
      return res.status(500).json(
        errorResponse('Failed to update session')
      );
    }

    // Update payment details if provided and payment exists
    if (session.payment_id && (payment_method || transaction_id || razorpay_order_id !== undefined || razorpay_payment_id !== undefined)) {
      const paymentUpdateData = {
        updated_at: new Date().toISOString()
      };

      if (payment_method) {
        paymentUpdateData.payment_method = payment_method.toLowerCase();
      }
      if (transaction_id) {
        paymentUpdateData.transaction_id = transaction_id.trim();
      }
      if (razorpay_order_id !== undefined) {
        paymentUpdateData.razorpay_order_id = razorpay_order_id?.trim() || null;
      }
      if (razorpay_payment_id !== undefined) {
        paymentUpdateData.razorpay_payment_id = razorpay_payment_id?.trim() || null;
      }

      const { error: paymentUpdateError } = await supabaseAdmin
        .from('payments')
        .update(paymentUpdateData)
        .eq('id', session.payment_id);

      if (paymentUpdateError) {
        console.error('❌ Error updating payment:', paymentUpdateError);
        // Don't fail the request, just log the error
      }
    }

    console.log('✅ Session updated successfully:', updatedSession.id);

    res.json(
      successResponse(updatedSession, 'Session updated successfully')
    );
  } catch (error) {
    console.error('❌ Exception in updateSession:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating session')
    );
  }
};

module.exports = {
  getAllUsers,
  getAllPsychologists,
  getUserDetails,
  updateUserRole,
  deactivateUser,
  checkCalendarSyncStatus,
  getPlatformStats,
  searchUsers,
  createPsychologist,
  updatePsychologist,
  deletePsychologist,
  createPsychologistPackages,
  createUser,
  updateUser,
  deleteUser,
  getRecentActivities,
  getRecentUsers,
  getRecentBookings,
  rescheduleSession,
  getPsychologistAvailabilityForReschedule,
  getPsychologistCalendarEvents,
  addNextDayAvailability,
  updateAllPsychologistsAvailability,
  handleRescheduleRequest,
  createManualBooking,
  updateSessionPayment,
  updateSession,
  approveAssessmentRescheduleRequest,
  getRescheduleRequests,
  checkMissingPackages,
  deletePackage,
  getStuckSlotLocks
};
