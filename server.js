const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { 
  createRateLimiters, 
  requestSizeLimiter, 
  memoryMonitor, 
  ipFilter, 
  requestValidator 
} = require('./middleware/security');
const securityMonitor = require('./utils/securityMonitor');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const psychologistRoutes = require('./routes/psychologists');
const sessionRoutes = require('./routes/sessions');
const adminRoutes = require('./routes/admin');
const superadminRoutes = require('./routes/superadmin');
const availabilityRoutes = require('./routes/availability');
const availabilityControllerRoutes = require('./routes/availabilityControllerRoutes');
const oauthRoutes = require('./routes/oauth');
const meetRoutes = require('./routes/meet');
const notificationRoutes = require('./routes/notifications');
const clientNotificationRoutes = require('./routes/clientNotifications');
const messageRoutes = require('./routes/messages');
const paymentRoutes = require('./routes/payment');
const freeAssessmentRoutes = require('./routes/freeAssessments');
const freeAssessmentTimeslotRoutes = require('./routes/freeAssessmentTimeslots');
const emailVerificationRoutes = require('./routes/emailVerification');
const calendarSyncService = require('./services/calendarSyncService');
const sessionReminderService = require('./services/sessionReminderService');
const dailyAvailabilityService = require('./services/dailyAvailabilityService');
const googleCalendarRoutes = require('./routes/googleCalendar');
const blogRoutes = require('./routes/blogs');
const counsellingRoutes = require('./routes/counselling');
const assessmentsRoutes = require('./routes/assessments');
const securityRoutes = require('./routes/security');
const betterParentingRoutes = require('./routes/betterParenting');

const app = express();
const PORT = process.env.PORT || 5001;

// Initialize advanced security middleware
const {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  passwordResetLimiter,
  emailVerificationLimiter
} = createRateLimiters();

// Security middleware stack
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration (MUST be before security middleware)
app.use(cors({
  origin: ['https://kutikkal-one.vercel.app', 'https://www.little.care', 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept']
}));

// IP filtering only (bot detection removed)
app.use(ipFilter);

// Request validation and size limiting
app.use(requestValidator);
app.use(requestSizeLimiter);

// Memory monitoring
app.use(memoryMonitor);

// Progressive slow down removed (was causing IPv6 issues)

// General rate limiting
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Kuttikal Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Security monitoring endpoint (admin only)
app.get('/api/security/status', (req, res) => {
  const summary = securityMonitor.getSecuritySummary();
  const recentEvents = securityMonitor.getRecentEvents(20);
  
  res.json({
    success: true,
    data: {
      summary,
      recentEvents,
      timestamp: new Date().toISOString()
    }
  });
});

// Test OAuth Meet endpoint
app.post('/api/test-oauth-meet', async (req, res) => {
  try {
    const { summary, description } = req.body;
    
    const { google } = require('googleapis');
    
    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Generate OAuth URL for user to authorize
           const authUrl = oauth2Client.generateAuthUrl({
             access_type: 'offline',
             scope: [
               'https://www.googleapis.com/auth/calendar',
               'https://www.googleapis.com/auth/calendar.events'
             ]
           });

    res.json({
      success: true,
      message: 'OAuth URL generated successfully',
      authUrl: authUrl,
      instructions: [
        '1. User clicks the OAuth URL',
        '2. User authorizes Meet permissions',
        '3. User gets access token',
        '4. Use access token to create Meet links'
      ]
    });
  } catch (error) {
    console.error('OAuth Meet test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test OAuth with local redirect URI
// GET endpoint for easier browser access
app.get('/api/test-oauth-local', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:5001/api/oauth2/callback' // Local redirect URI
    );
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Force consent screen to get refresh token
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });

    res.json({
      success: true,
      message: 'OAuth authorization URL generated',
      authUrl: authUrl,
      instructions: [
        '1. Click the authUrl above',
        '2. Grant permissions to your Google account',
        '3. OAuth tokens will be stored automatically',
        '4. Real Meet links will be created after this setup'
      ]
    });
  } catch (error) {
    console.error('❌ OAuth URL generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/test-oauth-local', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:5001/api/oauth2/callback' // Local redirect URI
    );
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Force consent screen to get refresh token
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    res.json({
      success: true,
      message: 'OAuth URL generated for local testing',
      authUrl: authUrl,
      instructions: [
        '1. Click the OAuth URL (uses localhost redirect)',
        '2. Authorize Meet permissions',
        '3. Get redirected to localhost callback',
        '4. Test real Meet link creation'
      ]
    });
  } catch (error) {
    console.error('OAuth local test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// OAuth callback handler for Google Meet integration
app.get('/api/oauth2/callback', async (req, res) => {
  try {
    console.log('🔄 OAuth callback received');
    console.log('Query params:', req.query);
    
    const { code, error } = req.query;
    
    if (error) {
      console.log('❌ OAuth error:', error);
      return res.status(400).json({
        success: false,
        error: 'OAuth authorization failed',
        details: error
      });
    }
    
    if (!code) {
      console.log('❌ No authorization code received');
      return res.status(400).json({
        success: false,
        error: 'No authorization code received'
      });
    }
    
    console.log('✅ Authorization code received:', code);
    
    // Exchange code for tokens
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:5001/api/oauth2/callback' // Use local redirect URI
    );
    
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    console.log('✅ OAuth tokens obtained successfully');
    console.log('Access token:', tokens.access_token ? 'Present' : 'Missing');
    console.log('Refresh token:', tokens.refresh_token ? 'Present' : 'Missing');
    
    // Store OAuth tokens for future use
    const meetLinkService = require('./utils/meetLinkService');
    await meetLinkService.storeOAuthTokens(tokens);
    
    // Test creating a Meet link with the OAuth token
    
    const testSessionData = {
      summary: 'Test OAuth Meet Link',
      description: 'Testing real Meet link creation with OAuth token',
      startDate: '2024-09-07',
      startTime: '20:00:00',
      endTime: '21:00:00'
    };
    
    console.log('🔄 Testing Meet link creation with OAuth token...');
    const result = await meetLinkService.createMeetLinkWithOAuth(tokens.access_token, testSessionData);
    
    res.json({
      success: true,
      message: 'OAuth authorization successful!',
      tokens: {
        access_token: tokens.access_token ? 'Present' : 'Missing',
        refresh_token: tokens.refresh_token ? 'Present' : 'Missing',
        expires_in: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'Unknown'
      },
      meetLinkTest: result,
      instructions: [
        '✅ OAuth authorization completed successfully',
        '✅ Access token obtained for Google Meet API',
        '✅ Meet link creation tested',
        '🎉 Real Google Meet links can now be created!'
      ]
    });
    
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    res.status(500).json({
      success: false,
      error: 'OAuth callback failed',
      details: error.message
    });
  }
});





// TEMPORARY TEST ENDPOINT - Create test psychologist
app.post('/api/test/create-psychologist', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { hashPassword } = require('./utils/helpers');
    
                    const testPsychologist = {
                  email: 'test@example.com',
                  password: 'password123',
                  first_name: 'Test',
                  last_name: 'Doctor',
                  phone: '+1234567890',
                  ug_college: 'University of Psychology',
                  pg_college: 'Graduate School of Mental Health',
                  phd_college: 'Doctoral Institute of Psychology',
                  area_of_expertise: ['Anxiety', 'Depression', 'Trauma'],
                  description: 'Experienced psychologist specializing in anxiety and depression treatment.',
                  experience_years: 8
                };

    // Check if psychologist already exists
    const { data: existingPsychologist } = await supabase
      .from('psychologists')
      .select('id')
      .eq('email', testPsychologist.email)
      .single();

    if (existingPsychologist) {
      return res.status(200).json({
        success: true,
        message: 'Test psychologist already exists',
        data: {
          email: testPsychologist.email,
          password: testPsychologist.password
        }
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(testPsychologist.password);

    // Create psychologist in psychologists table
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .insert([{
        email: testPsychologist.email,
        password_hash: hashedPassword,
        first_name: testPsychologist.first_name,
        last_name: testPsychologist.last_name,
        phone: testPsychologist.phone,
        ug_college: testPsychologist.ug_college,
        pg_college: testPsychologist.pg_college,
        phd_college: testPsychologist.phd_college,
        area_of_expertise: testPsychologist.area_of_expertise,
        description: testPsychologist.description,
        experience_years: testPsychologist.experience_years
      }])
      .select('*')
      .single();

    if (psychologistError) {
      console.error('Test psychologist creation error:', psychologistError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create test psychologist',
        error: psychologistError.message
      });
    }

    res.status(201).json({
      success: true,
      message: 'Test psychologist created successfully',
      data: {
        email: testPsychologist.email,
        password: testPsychologist.password,
        id: psychologist.id
      }
    });

  } catch (error) {
    console.error('Test psychologist creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Public endpoint to get all psychologists (no authentication required)
const formatPublicPsychologist = (psych) => {
  if (!psych) return null;

  let extractedPrice = psych.individual_session_price;
  if (!extractedPrice) {
    const priceMatch = psych.description?.match(/Individual Session Price: [₹\$](\d+(?:\.\d+)?)/);
    extractedPrice = priceMatch ? parseInt(priceMatch[1]) : null;
  }

  return {
    id: psych.id,
    name: `${psych.first_name} ${psych.last_name}`.trim(),
    first_name: psych.first_name,
    last_name: psych.last_name,
    email: psych.email,
    phone: psych.phone || 'N/A',
    area_of_expertise: psych.area_of_expertise || [],
    personality_traits: psych.personality_traits || [],
    experience_years: psych.experience_years || 0,
    designation: psych.designation || '',
    languages_json: psych.languages_json || null,
    ug_college: psych.ug_college || 'N/A',
    pg_college: psych.pg_college || 'N/A',
    phd_college: psych.phd_college || 'N/A',
    description: psych.description || 'Professional psychologist dedicated to helping clients achieve mental wellness.',
    profile_picture_url: null,
    cover_image_url: psych.cover_image_url,
    price: extractedPrice
  };
};

// ... existing /api/public/psychologists route (use helper)
app.get('/api/public/psychologists', async (req, res) => {
  try {
    const supabase = require('./config/supabase');

    const { data: psychologists, error: psychologistsError } = await supabase
      .from('psychologists')
      .select(`
        id,
        email,
        first_name,
        last_name,
        area_of_expertise,
        personality_traits,
        description,
        experience_years,
        ug_college,
        pg_college,
        phd_college,
        phone,
        cover_image_url,
        individual_session_price,
        display_order,
        created_at,
        designation,
        languages_json
      `)
      .order('created_at', { ascending: false });

    if (psychologistsError) {
      console.error('Error fetching psychologists:', psychologistsError);
      throw new Error('Failed to fetch psychologists');
    }

    if (psychologists && psychologists.length > 0) {
      console.log('📊 Display orders before sorting:', psychologists.map(p => ({
        name: `${p.first_name} ${p.last_name}`,
        display_order: p.display_order,
        created_at: p.created_at
      })));
      
      psychologists.sort((a, b) => {
        const aOrder = a.display_order !== null && a.display_order !== undefined ? a.display_order : null;
        const bOrder = b.display_order !== null && b.display_order !== undefined ? b.display_order : null;
        
        if (aOrder !== null && bOrder === null) return -1;
        if (aOrder === null && bOrder !== null) return 1;
        
        if (aOrder !== null && bOrder !== null) {
          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
          const dateA = new Date(a.created_at);
          const dateB = new Date(b.created_at);
          return dateB - dateA;
        }
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB - dateA;
      });
      
      console.log('📊 Display orders after sorting:', psychologists.map(p => ({
        name: `${p.first_name} ${p.last_name}`,
        display_order: p.display_order,
        created_at: p.created_at
      })));
    }

    console.log('Successfully fetched psychologists:', psychologists?.length || 0);

    const formattedPsychologists = psychologists.map(formatPublicPsychologist);

    res.json({
      success: true,
      data: {
        psychologists: formattedPsychologists
      }
    });
  } catch (error) {
    console.error('Error fetching psychologists:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch psychologists',
      message: error.message
    });
  }
});

app.get('/api/public/psychologists/:psychologistId/details', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { psychologistId } = req.params;

    const { data: psychologist, error } = await supabase
      .from('psychologists')
      .select(`
        *,
        individual_session_price
      `)
      .eq('id', psychologistId)
      .single();

    if (error || !psychologist) {
      console.error('Error fetching psychologist details:', error);
      return res.status(404).json({
        success: false,
        error: 'Psychologist not found'
      });
    }

    const formattedPsychologist = formatPublicPsychologist(psychologist);

    res.json({
      success: true,
      data: {
        psychologist: formattedPsychologist
      }
    });
  } catch (error) {
    console.error('Error fetching psychologist details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch psychologist details',
      message: error.message
    });
  }
});

// Public psychologist packages endpoint
app.get('/api/public/psychologists/:psychologistId/packages', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
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
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch packages',
        message: packagesError.message
      });
    }

    console.log(`✅ Found ${packages?.length || 0} packages for psychologist ${psychologistId}`);
    res.json({
      success: true,
      data: { packages: packages || [] }
    });

  } catch (error) {
    console.error('Error getting psychologist packages:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching packages',
      message: error.message
    });
  }
});

// TEMPORARY: Check database contents (for debugging)
app.get('/api/debug/users', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    
    // Check users table
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');
    
    // Check clients table
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('*');
    
    // Check psychologists table
    const { data: psychologists, error: psychologistsError } = await supabase
      .from('psychologists')
      .select('*');

    res.json({
      success: true,
      data: {
        users: users || [],
        clients: clients || [],
        psychologists: psychologists || [],
        errors: {
          users: usersError?.message,
          clients: clientsError?.message,
          psychologists: psychologistsError?.message
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TEMPORARY: Create test psychologist user (for debugging)
app.post('/api/debug/create-psychologist', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { hashPassword } = require('./utils/helpers');
    
    const testPsychologist = {
      email: 'testpsychologist@test.com',
      password: 'psych123',
      first_name: 'Dr. Sarah',
      last_name: 'Johnson',
      phone: '+1234567890',
      ug_college: 'University of Psychology',
      pg_college: 'Graduate School of Mental Health',
      phd_college: 'Doctoral Institute of Psychology',
      area_of_expertise: ['Anxiety', 'Depression', 'Trauma'],
      description: 'Experienced psychologist specializing in anxiety and depression treatment.',
      experience_years: 8
    };

    // Check if psychologist already exists
    const { data: existingPsychologist } = await supabase
      .from('psychologists')
      .select('id')
      .eq('email', testPsychologist.email)
      .single();

    if (existingPsychologist) {
      return res.status(200).json({
        success: true,
        message: 'Test psychologist already exists',
        data: {
          email: testPsychologist.email,
          password: testPsychologist.password,
          role: 'psychologist'
        }
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(testPsychologist.password);

    // Create psychologist
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .insert([{
        email: testPsychologist.email,
        password_hash: hashedPassword,
        first_name: testPsychologist.first_name,
        last_name: testPsychologist.last_name,
        phone: testPsychologist.phone,
        ug_college: testPsychologist.ug_college,
        pg_college: testPsychologist.pg_college,
        phd_college: testPsychologist.phd_college,
        area_of_expertise: testPsychologist.area_of_expertise,
        description: testPsychologist.description,
        experience_years: testPsychologist.experience_years,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id, email, first_name, last_name, created_at')
      .single();

    if (psychologistError) {
      console.error('Psychologist creation error:', psychologistError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create psychologist user'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Test psychologist created successfully',
      data: {
        id: psychologist.id,
        email: testPsychologist.email,
        password: testPsychologist.password,
        role: 'psychologist',
        name: `${testPsychologist.first_name} ${testPsychologist.last_name}`
      }
    });

  } catch (error) {
    console.error('Create psychologist error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TEMPORARY: Create test client user (for debugging)
app.post('/api/debug/create-client', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { hashPassword } = require('./utils/helpers');
    
    const testClient = {
      email: 'testclient@test.com',
      password: 'client123',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+1987654321',
      child_name: 'Emma',
      child_age: 12
    };

    // Check if client already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', testClient.email)
      .single();

    if (existingUser) {
      return res.status(200).json({
        success: true,
        message: 'Test client already exists',
        data: {
          email: testClient.email,
          password: testClient.password,
          role: 'client'
        }
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(testClient.password);

    // Create user with client role
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email: testClient.email,
        password_hash: hashedPassword,
        role: 'client',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id, email, role, created_at')
      .single();

    if (userError) {
      console.error('User creation error:', userError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create user account'
      });
    }

    // Create client profile
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert([{
        user_id: user.id,
        first_name: testClient.first_name,
        last_name: testClient.last_name,
        phone_number: testClient.phone,
        child_name: testClient.child_name,
        child_age: testClient.child_age,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('*')
      .single();

    if (clientError) {
      console.error('Client profile creation error:', clientError);
      // Delete user if profile creation fails
      await supabase.from('users').delete().eq('id', user.id);
      return res.status(500).json({
        success: false,
        error: 'Failed to create client profile'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Test client created successfully',
      data: {
        id: user.id,
        email: testClient.email,
        password: testClient.password,
        role: 'client',
        name: `${testClient.first_name} ${testClient.last_name}`
      }
    });

  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TEMPORARY: Create test admin user (for debugging)
app.post('/api/debug/create-admin', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { hashPassword } = require('./utils/helpers');
    
    const testAdmin = {
      email: 'newadmin@test.com',
      password: 'admin123',
      first_name: 'Test',
      last_name: 'Admin',
      role: 'admin'
    };

    // Check if admin already exists
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id')
      .eq('email', testAdmin.email)
      .single();

    if (existingAdmin) {
      return res.status(200).json({
        success: true,
        message: 'Test admin already exists',
        data: {
          email: testAdmin.email,
          password: testAdmin.password,
          role: testAdmin.role
        }
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(testAdmin.password);

    // Create admin user
    const { data: admin, error: adminError } = await supabase
      .from('users')
      .insert([{
        email: testAdmin.email,
        password_hash: hashedPassword,
        role: testAdmin.role,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id, email, role, created_at')
      .single();

    if (adminError) {
      console.error('Admin creation error:', adminError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create admin user'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Test admin created successfully',
      data: {
        id: admin.id,
        email: testAdmin.email,
        password: testAdmin.password,
        role: testAdmin.role
      }
    });

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TEMPORARY: Clear test data (for debugging)
app.delete('/api/debug/clear-test-data', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    
    // Clear test data from all tables
    const { error: usersError } = await supabase
      .from('users')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Keep system IDs
    
    const { error: clientsError } = await supabase
      .from('clients')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    const { error: psychologistsError } = await supabase
      .from('psychologists')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    res.json({
      success: true,
      message: 'Test data cleared successfully',
      errors: {
        users: usersError?.message,
        clients: clientsError?.message,
        psychologists: psychologistsError?.message
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TEMPORARY: Seed availability for testing
app.post('/api/debug/seed-availability', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { psychologist_id, date, time_slots } = req.body;

    if (!psychologist_id || !date || !Array.isArray(time_slots)) {
      return res.status(400).json({
        success: false,
        error: 'psychologist_id, date (YYYY-MM-DD), and time_slots (array like ["10:00 AM"]) are required'
      });
    }

    // Upsert availability
    const { data: existing } = await supabase
      .from('availability')
      .select('*')
      .eq('psychologist_id', psychologist_id)
      .eq('date', date)
      .single();

    if (existing) {
      const { data, error } = await supabase
        .from('availability')
        .update({ time_slots, is_available: true })
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, data, message: 'Availability updated' });
    } else {
      const { data, error } = await supabase
        .from('availability')
        .insert({ psychologist_id, date, time_slots, is_available: true })
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, data, message: 'Availability created' });
    }
  } catch (error) {
    console.error('Error seeding availability:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// TEMPORARY: Check sessions for a specific date and psychologist
app.get('/api/debug/sessions/:psychologist_id/:date', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { psychologist_id, date } = req.params;

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('psychologist_id', psychologist_id)
      .eq('scheduled_date', date);

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      data: {
        date,
        psychologist_id,
        sessions: sessions || []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TEMPORARY: Debug client sessions
app.get('/api/debug/client-sessions/:clientId', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { clientId } = req.params;

    console.log('🔍 Debug - Checking sessions for client:', clientId);

    // Get all sessions for this client
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        status,
        payment_id,
        payment:payments!sessions_payment_id_fkey(
          id,
          transaction_id,
          amount,
          status,
          completed_at
        )
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    console.log('🔍 Debug - Found sessions:', sessions);

    res.json({
      success: true,
      data: {
        clientId,
        sessionsCount: sessions?.length || 0,
        sessions: sessions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Public endpoint to get psychologist availability (no authentication required)
// This is now handled by the availability routes with better Google Calendar integration

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/psychologists', psychologistRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/availability-controller', availabilityControllerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/client-notifications', clientNotificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/free-assessments', freeAssessmentRoutes);
app.use('/api/free-assessment-timeslots', freeAssessmentTimeslotRoutes);
app.use('/api/email-verification', emailVerificationLimiter, emailVerificationRoutes);
app.use('/api', oauthRoutes);
app.use('/api/psychologists/google-calendar', googleCalendarRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/counselling', counsellingRoutes);
app.use('/api/assessments', assessmentsRoutes);
app.use('/api/better-parenting', betterParentingRoutes);
app.use('/api/security', securityRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Kuttikal Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV}`);
  
  // Start Google Calendar sync service
  calendarSyncService.start();
  
  // Start Session Reminder service (12-hour WhatsApp reminders)
  sessionReminderService.start();
  
  // Start Daily Availability service (adds next day at 12 AM)
  dailyAvailabilityService.start();
});

module.exports = app;
