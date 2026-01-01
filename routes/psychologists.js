const express = require('express');
const router = express.Router();
const psychologistController = require('../controllers/psychologistController');
const assessmentBookingController = require('../controllers/assessmentBookingController');
const timeBlockingController = require('../controllers/timeBlockingController');
const { authenticateToken, requirePsychologist } = require('../middleware/auth');
const { 
  validatePsychologistProfile,
  validateAvailability
} = require('../utils/validation');

// All routes require authentication and psychologist role
router.use(authenticateToken);
router.use(requirePsychologist);

// Profile management
router.get('/profile', psychologistController.getProfile);
router.put('/profile', validatePsychologistProfile, psychologistController.updateProfile);

// Session management
router.get('/sessions', psychologistController.getSessions);
router.get('/stats/monthly', psychologistController.getMonthlyStats);
router.put('/sessions/:sessionId', psychologistController.updateSession);
router.post('/sessions/:sessionId/complete', psychologistController.completeSession);
router.delete('/sessions/:sessionId', psychologistController.deleteSession);
// Assessment session scheduling
router.post('/assessment-sessions/:assessmentSessionId/schedule', psychologistController.scheduleAssessmentSession);
router.put('/assessment-sessions/:assessmentSessionId/reschedule', assessmentBookingController.rescheduleAssessmentSession);
router.delete('/assessment-sessions/:assessmentSessionId', psychologistController.deleteAssessmentSession);

// Availability management
router.get('/availability', psychologistController.getAvailability);
router.post('/availability', validateAvailability, psychologistController.addAvailability);
router.put('/availability', validateAvailability, psychologistController.updateAvailability);
router.delete('/availability/:availabilityId', psychologistController.deleteAvailability);

// Time blocking management
router.post('/block-time', timeBlockingController.blockTimeSlots);
router.post('/unblock-time', timeBlockingController.unblockTimeSlots);
router.get('/blocked-time', timeBlockingController.getBlockedTimeSlots);

module.exports = router;
