const express = require('express');
const router = express.Router();
const availabilityController = require('../controllers/availabilityController');
const { authenticateToken } = require('../middleware/auth');

// Google Calendar integration routes

/**
 * POST /api/availability/sync-google-calendar
 * Sync Google Calendar events and block conflicting times
 */
router.post('/sync-google-calendar', authenticateToken, availabilityController.syncGoogleCalendar);

/**
 * GET /api/availability/google-calendar-busy-times
 * Get Google Calendar busy times for a psychologist
 */
router.get('/google-calendar-busy-times', authenticateToken, availabilityController.getGoogleCalendarBusyTimes);

/**
 * POST /api/availability/set
 * Set psychologist availability (with Google Calendar conflict checking)
 */
router.post('/set', authenticateToken, availabilityController.setAvailability);

/**
 * GET /api/availability/get
 * Get psychologist availability
 */
router.get('/get', authenticateToken, availabilityController.getAvailability);

/**
 * GET /api/availability/time-slots
 * Get available time slots for a specific date
 */
router.get('/time-slots', authenticateToken, availabilityController.getAvailableTimeSlots);

/**
 * DELETE /api/availability/:availabilityId
 * Delete availability
 */
router.delete('/:availabilityId', authenticateToken, availabilityController.deleteAvailability);

/**
 * POST /api/availability/bulk-set
 * Set bulk availability for multiple dates
 */
router.post('/bulk-set', authenticateToken, availabilityController.setBulkAvailability);

module.exports = router;
