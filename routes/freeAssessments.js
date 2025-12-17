const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  getFreeAssessmentStatus,
  getAvailableTimeSlots,
  getFreeAssessmentAvailabilityRange,
  bookFreeAssessment,
  cancelFreeAssessment,
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


module.exports = router;
