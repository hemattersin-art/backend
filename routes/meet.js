const express = require('express');
const { createMeetEvent } = require('../utils/meetEventHelper');
const meetLinkService = require('../utils/meetLinkService'); // New Meet Link Service
const router = express.Router();

/**
 * POST /api/events/meet
 * Create an event with Google Meet link
 * 
 * Body:
 * {
 *   "summary": "Therapy Session - Client A x Dr. B",
 *   "description": "Online session via Google Meet",
 *   "startISO": "2025-08-28T10:00:00+05:30",
 *   "endISO": "2025-08-28T11:00:00+05:30",
 *   "attendees": [
 *     {"email": "client@example.com"},
 *     {"email": "doctor@example.com", "displayName": "Dr. Jane Doe"}
 *   ],
 *   "location": "Online"
 * }
 */
router.post('/events/meet', async (req, res, next) => {
  try {
    console.log('📝 Creating Meet event via API...');
    console.log('   📊 Request body:', JSON.stringify(req.body, null, 2));
    
    const {
      summary,
      description,
      startISO,
      endISO,
      attendees = [],
      location
    } = req.body;
    
    // Validation
    if (!summary) {
      return res.status(400).json({ error: 'Summary is required' });
    }
    if (!startISO) {
      return res.status(400).json({ error: 'startISO is required' });
    }
    if (!endISO) {
      return res.status(400).json({ error: 'endISO is required' });
    }
    if (!attendees || attendees.length === 0) {
      return res.status(400).json({ error: 'At least one attendee is required' });
    }
    
    // Validate ISO date format
    const startDate = new Date(startISO);
    const endDate = new Date(endISO);
    
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startISO format' });
    }
    if (isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid endISO format' });
    }
    if (startDate >= endDate) {
      return res.status(400).json({ error: 'Start time must be before end time' });
    }
    
    // Validate attendees
    for (const attendee of attendees) {
      if (!attendee.email) {
        return res.status(400).json({ error: 'Each attendee must have an email' });
      }
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(attendee.email)) {
        return res.status(400).json({ error: `Invalid email format: ${attendee.email}` });
      }
    }
    
    console.log('✅ Validation passed, creating Meet event...');
    
    // Create the Meet event using the new Meet Link Service
    const sessionData = {
      summary,
      description,
      startDate: startISO.split('T')[0], // Extract date part
      startTime: startISO.split('T')[1].split('+')[0], // Extract time part
      endTime: endISO.split('T')[1].split('+')[0] // Extract end time part
    };
    
    const result = await meetLinkService.generateSessionMeetLink(sessionData);
    
    if (result.success) {
      console.log('🎉 Meet event created successfully via API!');
      
      res.json({
        success: true,
        message: 'Meet event created successfully',
        data: {
          eventId: result.eventId,
          meetLink: result.meetLink,
          calendarLink: result.eventLink,
          method: result.method,
          summary: sessionData.summary,
          start: startISO,
          end: endISO
        }
      });
    } else {
      console.log('⚠️ Meet event creation failed, using fallback');
      
      res.json({
        success: false,
        message: 'Meet event creation failed, using fallback',
        data: {
          eventId: null,
          meetLink: result.meetLink,
          calendarLink: null,
          method: 'fallback',
          summary: sessionData.summary,
          start: startISO,
          end: endISO
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error in Meet event creation API:', error);
    
    // Handle specific errors
    if (error.message.includes('Timed out')) {
      return res.status(408).json({ 
        error: 'Conference creation timed out. Please try again.' 
      });
    }
    
    if (error.message.includes('Conference creation failed')) {
      return res.status(500).json({ 
        error: 'Failed to create Google Meet conference. Please try again.' 
      });
    }
    
    if (error.message.includes('Invalid Credentials')) {
      return res.status(401).json({ 
        error: 'Google authentication required. Please authenticate first.' 
      });
    }
    
    // Generic error
    res.status(500).json({ 
      error: 'Failed to create Meet event',
      details: error.message 
    });
  }
});

/**
 * GET /api/events/meet/status
 * Check if OAuth is working
 */
router.get('/events/meet/status', async (req, res, next) => {
  try {
    const { calendar } = require('../utils/googleOAuthClient');
    const cal = calendar();
    
    // Try to access calendar to check auth
    const { data } = await cal.calendarList.get({ calendarId: 'primary' });
    
    res.json({
      success: true,
      authenticated: true,
      calendar: {
        id: data.id,
        summary: data.summary,
        accessRole: data.accessRole
      }
    });
    
  } catch (error) {
    console.error('❌ Auth status check failed:', error);
    
    res.json({
      success: false,
      authenticated: false,
      error: error.message,
      message: 'Please authenticate with Google first'
    });
  }
});

module.exports = router;




