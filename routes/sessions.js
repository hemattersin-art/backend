const express = require('express');
const router = express.Router();
const { authenticateToken, requirePsychologist } = require('../middleware/auth');
const sessionController = require('../controllers/sessionController');

// Public route for booking sessions (requires client authentication)
router.post('/book', authenticateToken, sessionController.bookSession);

// Reschedule request handling (psychologist only) - place before parameterized routes
router.get('/reschedule-requests', authenticateToken, requirePsychologist, sessionController.getRescheduleRequests);
router.put('/reschedule-request/:notificationId', authenticateToken, requirePsychologist, sessionController.handleRescheduleRequest);

// Protected routes for authenticated users
router.get('/client/:clientId', authenticateToken, sessionController.getClientSessions);
router.get('/psychologist/:psychologistId', authenticateToken, sessionController.getPsychologistSessions);
router.get('/admin/all', authenticateToken, sessionController.getAllSessions);
router.put('/:sessionId/status', authenticateToken, sessionController.updateSessionStatus);
router.put('/:sessionId/complete', authenticateToken, sessionController.completeSession); // Complete session with summary, report, and notes
router.put('/:sessionId/no-show', authenticateToken, sessionController.markSessionAsNoShow); // Mark session as no-show (psychologist or admin)
router.delete('/:sessionId', authenticateToken, sessionController.deleteSession);

module.exports = router;
