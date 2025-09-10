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
    const { email, password, role } = req.body;

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

    // Check if psychologist already exists with this email
    if (role === 'psychologist') {
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
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    let user, profileData;

    if (role === 'client') {
      // Create user for client
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
        console.error('User creation error:', userError);
        return res.status(500).json(
          errorResponse('Failed to create user account')
        );
      }

      user = newUser;

      // Create client profile with minimal data (can be updated later)
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .insert([{
          user_id: user.id,
          first_name: req.body.first_name || 'Pending',
          last_name: req.body.last_name || 'Update',
          phone_number: req.body.phone_number || '+91',
          child_name: req.body.child_name || 'Pending',
          child_age: req.body.child_age || 1
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

// User login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

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

    // If not a psychologist, check users table for clients/admins
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) {
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
    if (user.role === 'client') {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', user.id)
        .single();
      profile = client;
    }

    // Generate JWT token
    const token = generateToken(user.id, user.role);

    res.json(
      successResponse({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
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
        .eq('user_id', userId)
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
  getProfile,
  updateProfilePicture,
  changePassword,
  logout,
  sendPasswordResetOTP,
  resetPassword
};
