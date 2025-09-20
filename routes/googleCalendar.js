const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const supabase = require('../config/supabase');
const { authenticateToken, requirePsychologist } = require('../middleware/auth');
const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// Connect Google Calendar
router.post('/connect', authenticateToken, requirePsychologist, async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;
    const psychologist_id = req.user.id;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code is required'
      });
    }

    // Exchange authorization code for tokens
    const oAuth2Client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      redirect_uri || GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oAuth2Client.getToken(code);
    
    // Store tokens in database
    const { error } = await supabase
      .from('psychologists')
      .update({
        google_calendar_credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expiry_date: tokens.expiry_date,
          connected_at: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', psychologist_id);

    if (error) {
      console.error('Error storing Google Calendar credentials:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to save Google Calendar credentials'
      });
    }

    res.json({
      success: true,
      message: 'Google Calendar connected successfully'
    });

  } catch (error) {
    console.error('Error connecting Google Calendar:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to connect Google Calendar'
    });
  }
});

// Disconnect Google Calendar
router.post('/disconnect', authenticateToken, requirePsychologist, async (req, res) => {
  try {
    const psychologist_id = req.user.id;

    // Remove Google Calendar credentials
    const { error } = await supabase
      .from('psychologists')
      .update({
        google_calendar_credentials: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', psychologist_id);

    if (error) {
      console.error('Error removing Google Calendar credentials:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to disconnect Google Calendar'
      });
    }

    res.json({
      success: true,
      message: 'Google Calendar disconnected successfully'
    });

  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to disconnect Google Calendar'
    });
  }
});

// Get Google Calendar connection status
router.get('/status', authenticateToken, requirePsychologist, async (req, res) => {
  try {
    const psychologist_id = req.user.id;

    const { data: psychologist, error } = await supabase
      .from('psychologists')
      .select('google_calendar_credentials')
      .eq('id', psychologist_id)
      .single();

    if (error) {
      console.error('Error fetching psychologist data:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch connection status'
      });
    }

    const isConnected = psychologist?.google_calendar_credentials !== null;
    const lastSync = psychologist?.google_calendar_credentials?.connected_at;

    res.json({
      success: true,
      isConnected,
      lastSync,
      credentials: isConnected ? {
        connected_at: psychologist.google_calendar_credentials.connected_at,
        scope: psychologist.google_calendar_credentials.scope
      } : null
    });

  } catch (error) {
    console.error('Error checking Google Calendar status:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to check connection status'
    });
  }
});

module.exports = router;
