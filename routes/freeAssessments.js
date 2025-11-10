const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  getFreeAssessmentStatus,
  getAvailableTimeSlots,
  getFreeAssessmentAvailabilityRange,
  bookFreeAssessment,
  cancelFreeAssessment,
  testGlobalTimeslots,
  testDateConfigs,
  adminListFreeAssessments
} = require('../controllers/freeAssessmentController');

// Get client's free assessment status
router.get('/status', authenticateToken, getFreeAssessmentStatus);

// Get available time slots for free assessments (public)
router.get('/available-slots', getAvailableTimeSlots);

// Get free assessment availability range for calendar (public)
router.get('/availability-range', getFreeAssessmentAvailabilityRange);

// Book a free assessment
router.post('/book', authenticateToken, bookFreeAssessment);

// Cancel a free assessment
router.put('/cancel/:assessmentId', authenticateToken, cancelFreeAssessment);

// Admin: List free assessments
router.get('/admin/list', authenticateToken, requireAdmin, adminListFreeAssessments);

// Test global timeslots
router.get('/test-timeslots', authenticateToken, testGlobalTimeslots);

// Test date-specific configurations
router.get('/test-date-configs', authenticateToken, testDateConfigs);

module.exports = router;
