const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Verify JWT token (handles both backend JWT and Supabase JWT)
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    console.log('🔍 Auth Middleware Debug:', {
      method: req.method,
      url: req.url,
      hasAuthHeader: !!authHeader,
      tokenPreview: token ? token.substring(0, 20) + '...' : 'none',
      origin: req.headers.origin
    });

    if (!token) {
      console.log('🔍 No token provided');
      return res.status(401).json({
        error: 'Access denied',
        message: 'No token provided'
      });
    }

    console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
    console.log('Token received:', token.substring(0, 20) + '...');
    
    let decoded;
    let userId;
    
    try {
      // First try to verify as backend JWT token
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Decoded backend token:', decoded);
      userId = decoded.userId || decoded.id;
    } catch (backendJwtError) {
      console.log('Not a backend JWT token, trying Supabase verification...');
      
      try {
        // Try to verify as Supabase JWT token
        const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);
        
        if (supabaseError || !supabaseUser) {
          console.error('Supabase token verification failed:', supabaseError);
          return res.status(401).json({ 
            error: 'Invalid token', 
            message: 'Token verification failed' 
          });
        }
        
        console.log('Supabase user verified:', supabaseUser);
        
        // For Supabase users, we need to find them in our database
        // Check clients table first (since clients are stored directly in clients table)
        console.log('🔍 Looking up client in database for email:', supabaseUser.email);
        const { data: client, error: clientError } = await supabase
          .from('clients')
          .select('*')
          .eq('email', supabaseUser.email)
          .single();

        console.log('🔍 Client lookup result:', { client, clientError });

        if (client && !clientError) {
          console.log('🔍 Found existing client:', client.id);
          req.user = {
            id: client.id,
            email: client.email,
            role: 'client',
            created_at: client.created_at,
            ...client
          };
          return next();
        }

        // If not found in clients table, check users table (for admins/superadmins)
        console.log('🔍 Looking up user in users table for email:', supabaseUser.email);
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('email', supabaseUser.email)
          .single();

        console.log('🔍 User lookup result:', { user, userError });

        if (user && !userError) {
          console.log('🔍 Found existing user:', user.id);
          req.user = user;
          return next();
        }

        // If not found in users table, check psychologists table
        console.log('🔍 Looking up psychologist for email:', supabaseUser.email);
        const { data: psychologist, error: psychologistError } = await supabase
          .from('psychologists')
          .select('*')
          .eq('email', supabaseUser.email)
          .single();

        console.log('🔍 Psychologist lookup result:', { psychologist, psychologistError });

        if (psychologist && !psychologistError) {
          console.log('🔍 Found existing psychologist:', psychologist.id);
          req.user = {
            id: psychologist.id,
            email: psychologist.email,
            role: 'psychologist',
            created_at: psychologist.created_at,
            updated_at: psychologist.updated_at
          };
          return next();
        }

        // If user not found in either table, create them as a new client
        console.log('Creating new client from Supabase:', supabaseUser.email);
        
        try {
          // Create client directly in clients table (following the same pattern as registration)
          const { data: newClient, error: clientCreateError } = await supabase
            .from('clients')
            .insert({ 
              email: supabaseUser.email,
              google_id: supabaseUser.id,
              first_name: supabaseUser.user_metadata?.full_name?.split(' ')[0] || 'User', 
              last_name: supabaseUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '', 
              phone_number: '+91', 
              child_name: 'Pending', 
              child_age: 1, 
              created_at: new Date().toISOString() 
            })
            .select()
            .single();
            
          if (clientCreateError) {
            console.error('Error creating client:', clientCreateError);
            return res.status(500).json({ 
              error: 'Client creation failed', 
              message: 'Failed to create client account' 
            });
          }

          // Set the user data for the request (following the same pattern as registration)
          req.user = {
            id: newClient.id,
            email: newClient.email,
            role: 'client',
            created_at: newClient.created_at,
            ...newClient
          };
          
          console.log('Successfully created new client:', req.user.email);
          return next();
          
        } catch (createError) {
          console.error('Error during client creation:', createError);
          return res.status(500).json({ 
            error: 'Client creation failed', 
            message: 'Failed to create client account' 
          });
        }
        
      } catch (supabaseJwtError) {
        console.error('Supabase JWT verification failed:', supabaseJwtError);
        return res.status(401).json({ 
          error: 'Invalid token', 
          message: 'Token verification failed' 
        });
      }
    }
    
    // Handle backend JWT token (original logic)
    if (!userId) {
      console.error('Token missing userId:', decoded);
      return res.status(401).json({ 
        error: 'Invalid token structure', 
        message: 'Token missing user ID' 
      });
    }
    
    // Check if it's a psychologist first (since login checks psychologists table first)
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('*')
      .eq('id', userId)
      .single();

    if (psychologist && !psychologistError) {
      // Psychologist exists in psychologists table (standalone)
      req.user = {
        id: psychologist.id,
        email: psychologist.email,
        role: 'psychologist',
        created_at: psychologist.created_at,
        updated_at: psychologist.updated_at
      };
      return next();
    }

    // If not a psychologist, check users table for clients/admins
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('User not found in either table:', { userId, userError, psychologistError });
      return res.status(401).json({ 
        error: 'Access denied', 
        message: 'Invalid token' 
      });
    }

    // User exists in users table (client, admin, superadmin)
    req.user = user;

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired', 
        message: 'Please login again' 
      });
    }
    
    return res.status(403).json({ 
      error: 'Invalid token', 
      message: 'Access denied' 
    });
  }
};

// Check if user has specific role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authentication required' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Insufficient permissions' 
      });
    }

    next();
  };
};

// Specific role middlewares
const requireClient = requireRole(['client']);
const requirePsychologist = requireRole(['psychologist']);
const requireAdmin = requireRole(['admin', 'superadmin']);
const requireSuperAdmin = requireRole(['superadmin']);

module.exports = {
  authenticateToken,
  requireRole,
  requireClient,
  requirePsychologist,
  requireAdmin,
  requireSuperAdmin
};
