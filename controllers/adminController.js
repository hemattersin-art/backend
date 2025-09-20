const supabase = require('../config/supabase');
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
    
    const { page = 1, limit = 10, role, search, sort = 'created_at', order = 'desc' } = req.query;

    // If fetching psychologists, get them directly from psychologists table
    if (role === 'psychologist') {
      console.log('=== Fetching psychologists directly from psychologists table ===');
      
      // Fetch psychologists directly from psychologists table with pagination
      const offset = (page - 1) * limit;
      const { data: psychologists, error: psychError } = await supabase
        .from('psychologists')
        .select('*')
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: order === 'asc' });

      if (psychError) {
        console.error('Error fetching psychologists:', psychError);
        return res.status(500).json(
          errorResponse('Failed to fetch psychologists')
        );
      }

      console.log('Successfully fetched psychologists:', psychologists?.length || 0);
      console.log('Psychologists data:', psychologists);
      
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
        area_of_expertise: psych.area_of_expertise || [],
        availability: [], // Will be populated below
        cover_image_url: psych.cover_image_url || null
      }));

      // Fetch availability data for all psychologists
      if (enrichedPsychologists.length > 0) {
        try {
          const psychologistIds = enrichedPsychologists
            .map(user => user.psychologist_id)
            .filter(Boolean);

          if (psychologistIds.length > 0) {
            const { data: availabilityData, error: availabilityError } = await supabase
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
    try {
      const { data: testData, error: testError } = await supabase
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

    let query = supabase
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
      query = query.eq('role', role);
    }

    // Apply sorting
    if (sort && order) {
      query = query.order(sort, { ascending: order === 'asc' });
    }

    // Add pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: users, error, count } = await query;

    if (error) {
      console.error('Get all users error:', error);
      return res.status(500).json(
        errorResponse('Failed to fetch users')
      );
    }

    let enrichedUsers = users;

    // Filter by search if provided
    let filteredUsers = enrichedUsers;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredUsers = enrichedUsers.filter(user => 
        user.email.toLowerCase().includes(searchLower) ||
        (user.name && user.name.toLowerCase().includes(searchLower))
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
    
    const { page = 1, limit = 10, search, sort = 'created_at', order = 'desc' } = req.query;

    // Fetch psychologists directly from psychologists table with pagination
    const offset = (page - 1) * limit;
    const { data: psychologists, error: psychError } = await supabase
      .from('psychologists')
      .select('*, individual_session_price')
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: order === 'asc' });

    if (psychError) {
      console.error('Error fetching psychologists:', psychError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologists')
      );
    }

    console.log('Successfully fetched psychologists:', psychologists?.length || 0);
    console.log('Psychologists data:', psychologists);
    
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
      area_of_expertise: psych.area_of_expertise || [],
      availability: [], // Will be populated below
      cover_image_url: psych.cover_image_url || null
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
        userDescription: user.description,
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
          const { data: availabilityData, error: availabilityError } = await supabase
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
    const { data: psychologist, error: psychologistError } = await supabase
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
            created_at: psychologist.created_at,
            updated_at: psychologist.updated_at,
            profile: psychologist
          }
        })
      );
    }

    // If not a psychologist, check users table
    const { data: user, error: userError } = await supabase
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
      const { data: client } = await supabase
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

    if (!new_role || !['client', 'psychologist', 'admin', 'superadmin'].includes(new_role)) {
      return res.status(400).json(
        errorResponse('Valid new role is required')
      );
    }

    // Check if user exists
    const { data: user } = await supabase
      .from('users')
      .select('role')
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
    const { data: updatedUser, error } = await supabase
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

    // Check if user exists
    const { data: user } = await supabase
      .from('users')
      .select('role')
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

    // For now, we'll just update the user to indicate deactivation
    // In a real system, you might want to add a status field or move to archive table
    const { data: updatedUser, error } = await supabase
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
    try {
      const { data: testData, error: testError } = await supabase
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
    const { count: totalUsers, error: usersError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (usersError) {
      console.error('Get users error:', usersError);
      return res.status(500).json(
        errorResponse('Failed to fetch user statistics')
      );
    }

    // Get psychologist counts (optimized)
    const { count: totalPsychologists, error: psychologistsError } = await supabase
      .from('psychologists')
      .select('*', { count: 'exact', head: true });

    if (psychologistsError) {
      console.error('Get psychologists error:', psychologistsError);
      return res.status(500).json(
        errorResponse('Failed to fetch psychologist statistics')
      );
    }

    // Get session counts (optimized with count)
    const { count: totalSessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true });

    if (sessionsError) {
      console.error('Get sessions error:', sessionsError);
      return res.status(500).json(
        errorResponse('Failed to fetch session statistics')
      );
    }

    // Get client counts (optimized)
    const { count: totalClients, error: clientsError } = await supabase
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
    const { data: userRoles, error: userRolesError } = await supabase
      .from('users')
      .select('role')
      .limit(1000); // Reasonable limit for 2GB plan

    const { data: sessionStatuses, error: sessionStatusError } = await supabase
      .from('sessions')
      .select('status, price')
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
    const { 
      query: searchQuery, 
      page = 1, 
      limit = 10,
      role
    } = req.query;

    if (!searchQuery) {
      return res.status(400).json(
        errorResponse('Search query is required')
      );
    }

    let supabaseQuery = supabase
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
const createPsychologist = async (req, res) => {
  try {
    console.log('=== createPsychologist function called ===');
    console.log('Request body:', req.body);
    const { 
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
      price // Individual session price
    } = req.body;

    // Check if psychologist already exists with this email
    const { data: existingPsychologist } = await supabase
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
    const { data: psychologist, error: psychologistError } = await supabase
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
        description,
        experience_years: experience_years || 0,
        individual_session_price: price ? parseInt(price) : null
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

        const { error: packagesError } = await supabase
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

    // Handle availability if provided
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
              
              availabilityRecords.push({
                psychologist_id: psychologist.id,
                date: dateString, // Use local date formatting
                time_slots: item.slots // Direct array of time strings as expected by validation
              });
            }
          });
        });

        if (availabilityRecords.length > 0) {
          const { error: availabilityError } = await supabase
            .from('availability')
            .insert(availabilityRecords);

          if (availabilityError) {
            console.error('Availability creation error:', availabilityError);
            // Continue without availability if it fails
          }
        }
      } catch (availabilityError) {
        console.error('Exception while creating availability:', availabilityError);
        // Continue without availability if it fails
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
    const updateData = req.body;

    // Get psychologist profile
    const { data: psychologist, error: psychologistError } = await supabase
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
    const { price, availability, packages, ...psychologistUpdateData } = updateData;

    // Update psychologist profile
    const { data: updatedPsychologist, error: updateError } = await supabase
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

    // Handle individual price by storing it in the dedicated field
    if (price !== undefined) {
      console.log('💰 Individual price provided:', price);
      console.log('💰 Psychologist ID:', psychologistId);
      console.log('💰 Price type:', typeof price);
      console.log('💰 Parsed price:', parseInt(price));
      
      try {
        // Store price in the dedicated individual_session_price field (as integer)
        const { error: priceUpdateError } = await supabase
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
    if (packages && Array.isArray(packages) && packages.length > 0) {
      console.log('📦 Packages provided for update:', packages);
      
      try {
        // Get existing packages for this psychologist
        const { data: existingPackages, error: fetchError } = await supabase
          .from('packages')
          .select('id, name, session_count')
          .eq('psychologist_id', psychologistId);

        if (fetchError) {
          console.error('Error fetching existing packages:', fetchError);
        } else {
          console.log('📦 Existing packages:', existingPackages);
          
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
              // Update existing package
              const existingPackage = existingPackages.find(ep => ep.id === parseInt(pkg.id));
              if (existingPackage) {
                console.log(`📦 Updating existing package ${pkg.id} (${pkg.name}) with price $${pkg.price}`);
                
                const { error: updateError } = await supabase
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
                } else {
                  console.log(`✅ Package ${pkg.id} updated successfully`);
                }
              } else {
                console.log(`📦 Package ${pkg.id} not found in database, skipping update`);
              }
            } else {
              // Create new package
              console.log(`📦 Creating new package: ${pkg.name} (${pkg.sessions} sessions, $${pkg.price})`);
              console.log(`📦 Package data:`, pkg);
              
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
              
              console.log(`📦 Inserting package data:`, packageData);
              
              const { data: insertedPackage, error: createError } = await supabase
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
      }
    }

    // Handle availability updates
    if (availability && Array.isArray(availability) && availability.length > 0) {
      console.log('📅 Availability provided for update:', availability);
      
      try {
        // Convert frontend format to backend format
        const availabilityRecords = [];
        
        for (const avail of availability) {
          if (avail.day && avail.slots && Array.isArray(avail.slots)) {
            // Generate dates for the next 1 occurrence of this day
            const dates = getAvailabilityDatesForDay(avail.day, 1);
            
            if (dates.length > 0) {
              const dateStr = dates[0].toISOString().split('T')[0]; // YYYY-MM-DD format
              
              // Convert all time slots to strings to prevent object storage
              const stringTimeSlots = avail.slots.map(slot => {
                if (typeof slot === 'object' && slot !== null) {
                  // Extract the display time from object
                  if (slot.displayTime) {
                    return slot.displayTime;
                  } else if (slot.time) {
                    return slot.time;
                  } else {
                    console.warn('Time slot object has no displayable time property:', slot);
                    return String(slot);
                  }
                } else if (typeof slot === 'string') {
                  return slot;
                } else {
                  return String(slot);
                }
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
          // Delete existing availability first
          const { error: deleteError } = await supabase
            .from('availability')
            .delete()
            .eq('psychologist_id', psychologistId);

          if (deleteError) {
            console.error('Error deleting existing availability:', deleteError);
          } else {
            console.log('✅ Existing availability deleted');
          }

          // Insert ONLY the new availability records (no preservation of old ones)
          const { data: newAvailability, error: insertError } = await supabase
            .from('availability')
            .insert(availabilityRecords)
            .select('*');

          if (insertError) {
            console.error('Error inserting new availability:', insertError);
          } else {
            console.log(`✅ ${newAvailability.length} availability records created successfully`);
          }
        } else {
          console.log('⚠️ No valid availability records to insert');
        }
      } catch (error) {
        console.error('Error handling availability updates:', error);
      }
    } else if (availability && Array.isArray(availability) && availability.length === 0) {
      // If empty array is sent, delete all availability
      console.log('📅 Empty availability array sent - deleting all availability');
      
      try {
        const { error: deleteError } = await supabase
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

    res.json(
      successResponse(updatedPsychologist, 'Psychologist updated successfully')
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
    const { data: psychologist, error: psychologistError } = await supabase
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
    const { error: deleteAvailabilityError } = await supabase
      .from('availability')
      .delete()
      .eq('psychologist_id', psychologistId);

    if (deleteAvailabilityError) {
      console.error('Delete availability error:', deleteAvailabilityError);
      // Continue with deletion even if availability deletion fails
    }

    // Delete psychologist profile
    const { error: deleteProfileError } = await supabase
      .from('psychologists')
      .delete()
      .eq('id', psychologistId);

    if (deleteProfileError) {
      console.error('Delete psychologist profile error:', deleteProfileError);
      return res.status(500).json(
        errorResponse('Failed to delete psychologist profile')
      );
    }

    res.json(
      successResponse(null, 'Psychologist deleted successfully')
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
    const { data: existingUser } = await supabase
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

    // Create user
    const { data: user, error: userError } = await supabase
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

    // Create client profile
    const { data: client, error: clientError } = await supabase
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
      await supabase.from('users').delete().eq('id', user.id);
      return res.status(500).json(
        errorResponse('Failed to create client profile')
      );
    }

    res.status(201).json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          profile: client
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
    const updateData = req.body;

    // Get user
    const { data: user, error: userError } = await supabase
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
      const { data: updatedClient, error: updateError } = await supabase
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

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json(
        errorResponse('User not found')
      );
    }

    // Delete profile first
    if (user.role === 'client') {
      const { error: deleteProfileError } = await supabase
        .from('clients')
        .delete()
        .eq('id', userId);

      if (deleteProfileError) {
        console.error('Delete client profile error:', deleteProfileError);
        return res.status(500).json(
          errorResponse('Failed to delete client profile')
        );
      }
    }

    // Delete user account
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteUserError) {
      console.error('Delete user error:', deleteUserError);
      return res.status(500).json(
        errorResponse('Failed to delete user account')
      );
    }

    res.json(
      successResponse(null, 'User deleted successfully')
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
    const { data: recentUsers, error: usersError } = await supabase
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
      const { data: clients, error: clientsError } = await supabase
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

// Get recent bookings for dashboard
const getRecentBookings = async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Get recent sessions
    const { data: recentSessions, error: sessionsError } = await supabase
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
    const { data: recentUsers, error: usersError } = await supabase
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
    const { data: recentPsychologists, error: psychologistsError } = await supabase
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
    const { data: recentSessions, error: sessionsError } = await supabase
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
    const { data: psychologist, error: psychologistError } = await supabase
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

    const { data: createdPackages, error: packagesError } = await supabase
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
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
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
    const { data: conflictingSessions } = await supabase
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

    // Update session with new date/time
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({
        scheduled_date: formatDate(new_date),
        scheduled_time: formatTime(new_time),
        status: 'rescheduled',
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
          await supabase
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
        reason: reason || 'Admin rescheduled'
      }, oldSessionData.date, oldSessionData.time);
      
      console.log('✅ Reschedule notification emails sent successfully');
    } catch (emailError) {
      console.error('Error sending reschedule notification emails:', emailError);
      // Continue even if email sending fails
    }

    // Create notification for client
    await supabase
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
    await supabase
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
    const { data: psychologist, error: psychologistError } = await supabase
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
    const { data: availability, error: availabilityError } = await supabase
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
    const { data: existingSessions, error: sessionsError } = await supabase
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
        timeSlots,
        bookedTimes,
        availableSlots: timeSlots.filter(slot => !bookedTimes.includes(slot))
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

module.exports = {
  getAllUsers,
  getAllPsychologists,
  getUserDetails,
  updateUserRole,
  deactivateUser,
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
  getPsychologistAvailabilityForReschedule
};
