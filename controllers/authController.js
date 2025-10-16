const supabase = require('../config/supabase');
const { 
  generateToken, 
  hashPassword, 
  comparePassword,
  successResponse,
  errorResponse
} = require('../utils/helpers');
const emailVerificationService = require('../utils/emailVerificationService');

// User registration
const register = async (req, res) => {
  try {
    let { email, password, role } = req.body;
    if (typeof email === 'string') {
      email = email.trim().toLowerCase();
    }

    // Check if user already exists
    if (role === 'client') {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('email', email)
        .single();

      if (existingClient) {
        return res.status(400).json(
          errorResponse('Client with this email already exists')
        );
      }
    } else if (role === 'psychologist') {
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
    } else {
      // For admin roles, check users table
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
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    let user, profileData;

    if (role === 'client') {
      // Create client directly in clients table (no users table entry)
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .insert([{
          email,
          password_hash: hashedPassword,
          first_name: req.body.first_name || 'Pending',
          last_name: req.body.last_name || 'Update',
          phone_number: req.body.phone_number || '+91',
          child_name: req.body.child_name || 'Pending',
          child_age: req.body.child_age || 1
        }])
        .select('*')
        .single();

      if (clientError) {
        console.error('Client creation error:', clientError);
        return res.status(500).json(
          errorResponse('Failed to create client account')
        );
      }

      // Create a mock user object for client (since they don't exist in users table)
      user = {
        id: client.id,
        email: client.email,
        role: 'client',
        created_at: client.created_at
      };
      profileData = client;
    } else if (role === 'psychologist') {
      // Create psychologist directly in psychologists table (no users table entry)
      const { data: psychologist, error: psychologistError } = await supabase
        .from('psychologists')
        .insert([{
          email,
          password_hash: hashedPassword,
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          ug_college: req.body.ug_college,
          pg_college: req.body.pg_college,
          phd_college: req.body.phd_college,
          area_of_expertise: req.body.area_of_expertise,
          description: req.body.description,
          experience_years: req.body.experience_years || 0,
          phone: req.body.phone || null
        }])
        .select('*')
        .single();

      if (psychologistError) {
        console.error('Psychologist profile creation error:', psychologistError);
        return res.status(500).json(
          errorResponse('Failed to create psychologist profile')
        );
      }

      // Create a mock user object for psychologist (since they don't exist in users table)
      user = {
        id: psychologist.id,
        email: psychologist.email,
        role: 'psychologist',
        created_at: psychologist.created_at
      };
      profileData = psychologist;
    } else {
      // Create admin/super admin/finance user in users table
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert([{
          email,
          password_hash: hashedPassword,
          role
        }])
        .select('id, email, role, created_at')
        .single();

      if (userError) {
        console.error('Admin user creation error:', userError);
        return res.status(500).json(
          errorResponse('Failed to create admin account')
        );
      }

      user = newUser;
      profileData = newUser; // Admin users don't have separate profile tables
    }

    // Generate JWT token
    const token = generateToken(user.id, user.role);

    res.status(201).json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          profile: profileData
        },
        token
      }, 'User registered successfully')
    );

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json(
      errorResponse('Internal server error during registration')
    );
  }
};

// Google OAuth login
const googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json(
        errorResponse('Google ID token is required')
      );
    }

    // Verify Google ID token
    const { OAuth2Client } = require('google-auth-library');
    // Use frontend Client ID to verify the token (since frontend issued it)
    // This should be the same Client ID used by the frontend
    const frontendClientId = process.env.FRONTEND_GOOGLE_CLIENT_ID || '975865953640-79vjma6g08dski07q39a041efpqj9k2o.apps.googleusercontent.com';
    const client = new OAuth2Client(frontendClientId);
    
    console.log('Verifying Google token with frontend client ID:', frontendClientId);
    
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: frontendClientId,
    });
    
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;
    
    console.log('Google token verified successfully:', {
      email,
      name,
      googleId,
      hasPicture: !!picture
    });

    if (!email) {
      return res.status(400).json(
        errorResponse('Email not provided by Google')
      );
    }

    // Check if user already exists
    let user = null;
    let userRole = 'client'; // Default role for Google sign-ins

    // First check psychologists table
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('*')
      .eq('email', email)
      .single();

    if (psychologist && !psychologistError) {
      user = psychologist;
      userRole = 'psychologist';
    } else {
      // Check clients table
      const { data: existingClient, error: clientError } = await supabase
        .from('clients')
        .select(`
          *,
          users!inner(*)
        `)
        .eq('users.email', email)
        .single();

      if (existingClient && !clientError) {
        user = existingClient;
        userRole = 'client';
      } else {
        // Check users table for admin roles
        const { data: existingUser, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .single();

        if (existingUser && !userError) {
          user = existingUser;
          userRole = existingUser.role;
        }
      }
    }

    // If user doesn't exist, create new client
    if (!user) {
      console.log('Creating new client with Google data:', {
        email,
        googleId,
        picture,
        firstName: name?.split(' ')[0] || '',
        lastName: name?.split(' ').slice(1).join(' ') || ''
      });

      // First create a user record in users table
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          email: email,
          role: 'client',
          google_id: googleId,
          profile_picture_url: picture,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (userError) {
        console.error('Error creating user:', userError);
        return res.status(500).json(
          errorResponse(`Failed to create user account: ${userError.message}`)
        );
      }

      // Then create client record with user_id reference
      const { data: newClient, error: createError } = await supabase
        .from('clients')
        .insert({
          user_id: newUser.id,
          first_name: name?.split(' ')[0] || '',
          last_name: name?.split(' ').slice(1).join(' ') || '',
          phone_number: '+91',
          child_name: 'Pending',
          child_age: 1,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating client:', createError);
        // Clean up user record if client creation fails
        await supabase.from('users').delete().eq('id', newUser.id);
        return res.status(500).json(
          errorResponse(`Failed to create client account: ${createError.message}`)
        );
      }

      // Combine user and client data
      user = { ...newUser, ...newClient };
      userRole = 'client';
    } else {
      // Update existing user with Google info if needed
      if (userRole === 'client') {
        // Update the user record with Google info
        const { error: updateUserError } = await supabase
          .from('users')
          .update({
            google_id: googleId,
            profile_picture_url: picture
          })
          .eq('id', user.user_id || user.id);

        if (updateUserError) {
          console.error('Error updating user with Google info:', updateUserError);
        }
      } else if (userRole === 'psychologist') {
        const { error: updateError } = await supabase
          .from('psychologists')
          .update({
            google_id: googleId,
            profile_picture_url: picture
          })
          .eq('id', user.id);

        if (updateError) {
          console.error('Error updating psychologist with Google info:', updateError);
        }
      } else {
        // Update admin users in users table
        const { error: updateError } = await supabase
          .from('users')
          .update({
            google_id: googleId,
            profile_picture_url: picture
          })
          .eq('id', user.id);

        if (updateError) {
          console.error('Error updating admin user with Google info:', updateError);
        }
      }
    }

    // Generate JWT token
    const token = generateToken(user.id, userRole);

    // Get role-specific profile
    let profile = null;
    if (userRole === 'client') {
      // Client profile is already the user object since clients are stored directly in clients table
      profile = user;
    } else if (userRole === 'psychologist') {
      profile = user;
    } else {
      // Admin users don't have separate profile tables
      profile = user;
    }

    res.json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: userRole,
          profile_picture_url: picture,
          profile: profile
        },
        token
      }, 'Google login successful')
    );

  } catch (error) {
    console.error('Google login error:', error);
    
    // Handle specific Google Auth errors
    if (error.message && error.message.includes('Invalid token')) {
      return res.status(400).json(
        errorResponse('Invalid Google token. Please try signing in again.')
      );
    }
    
    if (error.message && error.message.includes('Token expired')) {
      return res.status(400).json(
        errorResponse('Google token expired. Please try signing in again.')
      );
    }
    
    // Handle database errors
    if (error.code && error.code.includes('23505')) { // Unique constraint violation
      return res.status(400).json(
        errorResponse('Account with this email already exists. Please try logging in instead.')
      );
    }
    
    res.status(500).json(
      errorResponse('Google authentication failed. Please try again.')
    );
  }
};

// User login
const login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (typeof email === 'string') {
      email = email.trim().toLowerCase();
    }

    // First check if it's a psychologist
    const { data: psychologist, error: psychologistError } = await supabase
      .from('psychologists')
      .select('*')
      .eq('email', email)
      .single();

    if (psychologist && !psychologistError) {
      // Verify password for psychologist
      const isValidPassword = await comparePassword(password, psychologist.password_hash);
      if (!isValidPassword) {
        return res.status(401).json(
          errorResponse('Invalid email or password')
        );
      }

      // Generate JWT token for psychologist
      const token = generateToken(psychologist.id, 'psychologist');

      res.json(
        successResponse({
          user: {
            id: psychologist.id,
            email: psychologist.email,
            role: 'psychologist',
            profile_picture_url: null,
            profile: psychologist
          },
          token
        }, 'Login successful')
      );
      return;
    }

    // If not a psychologist, check clients table first, then users table for admins
    let user = null;
    let userRole = null;
    
    // Check clients table first
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .single();

    if (client && !clientError) {
      user = client;
      userRole = 'client';
    } else {
      // Check users table for admin roles
      const { data: adminUser, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (adminUser && !userError) {
        user = adminUser;
        userRole = adminUser.role;
      }
    }

    if (!user) {
      return res.status(401).json(
        errorResponse('Invalid email or password')
      );
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json(
        errorResponse('Invalid email or password')
      );
    }

    // Get role-specific profile
    let profile = null;
    if (userRole === 'client') {
      // Client profile is already the user object since clients are stored directly in clients table
      profile = user;
    } else {
      // Admin users don't have separate profile tables
      profile = user;
    }

    // Generate JWT token
    const token = generateToken(user.id, userRole);

    res.json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: userRole,
          profile_picture_url: user.profile_picture_url,
          profile
        },
        token
      }, 'Login successful')
    );

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(
      errorResponse('Internal server error during login')
    );
  }
};

// Get current user profile
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get user with profile based on role
    let profile = null;
    
    if (userRole === 'client') {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', userId)
        .single();
      profile = client;
    } else if (userRole === 'psychologist') {
      // For psychologists, the profile is the user data itself
      const { data: psychologist } = await supabase
        .from('psychologists')
        .select('*')
        .eq('id', userId)
        .single();
      profile = psychologist;
    }

    res.json(
      successResponse({
        user: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          profile_picture_url: req.user.profile_picture_url || null,
          profile
        }
      })
    );

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching profile')
    );
  }
};

// Update profile picture
const updateProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id;
    const { profile_picture_url } = req.body;

    if (!profile_picture_url) {
      return res.status(400).json(
        errorResponse('Profile picture URL is required')
      );
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({ 
        profile_picture_url,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('profile_picture_url')
      .single();

    if (error) {
      console.error('Profile picture update error:', error);
      return res.status(500).json(
        errorResponse('Failed to update profile picture')
      );
    }

    res.json(
      successResponse({
        profile_picture_url: user.profile_picture_url
      }, 'Profile picture updated successfully')
    );

  } catch (error) {
    console.error('Profile picture update error:', error);
    res.status(500).json(
      errorResponse('Internal server error while updating profile picture')
    );
  }
};

// Change password
const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json(
        errorResponse('Current password and new password are required')
      );
    }

    if (newPassword.length < 6) {
      return res.status(400).json(
        errorResponse('New password must be at least 6 characters long')
      );
    }

    // Get current user to verify current password
    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .single();

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(400).json(
        errorResponse('Current password is incorrect')
      );
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    const { error } = await supabase
      .from('users')
      .update({ 
        password_hash: hashedNewPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      console.error('Password change error:', error);
      return res.status(500).json(
        errorResponse('Failed to change password')
      );
    }

    res.json(
      successResponse(null, 'Password changed successfully')
    );

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json(
      errorResponse('Internal server error while changing password')
    );
  }
};

// Send password reset OTP
const sendPasswordResetOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(
        errorResponse('Email is required')
      );
    }

    // Check if user exists (only for clients in users table)
    const { data: user } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(404).json(
        errorResponse('No account found with this email address')
      );
    }

    // Only allow password reset for clients
    if (user.role !== 'client') {
      return res.status(403).json(
        errorResponse('Password reset is only available for client accounts')
      );
    }

    // Send OTP for password reset
    const result = await emailVerificationService.sendOTP(email, 'password_reset', 'client');
    
    if (!result.success) {
      return res.status(400).json(
        errorResponse(result.message, result.error)
      );
    }

    res.json(
      successResponse(null, 'Password reset OTP sent to your email')
    );

  } catch (error) {
    console.error('Send password reset OTP error:', error);
    res.status(500).json(
      errorResponse('Internal server error while sending password reset OTP')
    );
  }
};

// Reset password with OTP
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json(
        errorResponse('Email, OTP, and new password are required')
      );
    }

    if (newPassword.length < 6) {
      return res.status(400).json(
        errorResponse('New password must be at least 6 characters long')
      );
    }

    // Verify OTP
    const verificationResult = await emailVerificationService.verifyOTP(email, otp, 'password_reset');
    if (!verificationResult.success) {
      return res.status(400).json(
        errorResponse(verificationResult.message, verificationResult.error)
      );
    }

    // Check if user exists
    const { data: user } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(404).json(
        errorResponse('User not found')
      );
    }

    // Only allow password reset for clients
    if (user.role !== 'client') {
      return res.status(403).json(
        errorResponse('Password reset is only available for client accounts')
      );
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        password_hash: hashedPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Password reset update error:', updateError);
      return res.status(500).json(
        errorResponse('Failed to reset password')
      );
    }

    res.json(
      successResponse(null, 'Password reset successfully')
    );

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json(
      errorResponse('Internal server error while resetting password')
    );
  }
};

// Logout (client-side token removal)
const logout = async (req, res) => {
  try {
    // In a stateless JWT system, logout is handled client-side
    // You could implement a blacklist here if needed
    res.json(
      successResponse(null, 'Logged out successfully')
    );
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json(
      errorResponse('Internal server error during logout')
    );
  }
};

// Send OTP for email verification during registration
module.exports = {
  register,
  login,
  googleLogin,
  getProfile,
  updateProfilePicture,
  changePassword,
  logout,
  sendPasswordResetOTP,
  resetPassword
};
