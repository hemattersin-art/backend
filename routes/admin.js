const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const assessmentBookingController = require('../controllers/assessmentBookingController');
const sessionController = require('../controllers/sessionController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { createRateLimiters } = require('../middleware/security');
const { requireRequestSignature } = require('../middleware/requestSigning');
const multer = require('multer');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');

// Admin-specific rate limiter (stricter than general API)
// Note: This runs BEFORE authentication, so we can only use IP
const adminLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes per IP
  message: {
    error: 'Too many admin requests',
    message: 'Rate limit exceeded for admin operations. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
  keyGenerator: (req) => {
    // Use IP only (user ID not available before authentication)
    return `admin-${req.ip}`;
  }
});

// All routes require authentication and admin role
// Apply rate limiting first, then authentication, then authorization
// Note: IP filtering is handled by Cloudflare, not application-level
const validateCSRF = require('../middleware/csrf');
router.use(adminLimiter);
router.use(validateCSRF); // MEDIUM-RISK FIX: CSRF protection
router.use(authenticateToken);
router.use(requireAdmin);

// User management
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
// Critical operations require request signing
router.put('/users/:userId/role', requireRequestSignature, adminController.updateUserRole);
router.put('/users/:userId/deactivate', requireRequestSignature, adminController.deactivateUser);

// Platform statistics
router.get('/stats/platform', adminController.getPlatformStats);
router.get('/stats/dashboard', adminController.getPlatformStats); // Alias for dashboard

// User search
router.get('/search/users', adminController.searchUsers);

// Activities
router.get('/activities', adminController.getRecentActivities);

// Recent data for dashboard
router.get('/recent-users', adminController.getRecentUsers);
router.get('/recent-bookings', adminController.getRecentBookings);

// Psychologist management
router.get('/psychologists', adminController.getAllPsychologists);
router.post('/psychologists', adminController.createPsychologist);
router.put('/psychologists/:psychologistId', adminController.updatePsychologist);
router.delete('/psychologists/:psychologistId', adminController.deletePsychologist);

// Availability management
router.post('/availability/add-next-day', adminController.addNextDayAvailability);
router.post('/availability/update-all', adminController.updateAllPsychologistsAvailability);

// Package management for psychologists
router.post('/psychologists/:psychologistId/packages', adminController.createPsychologistPackages);
router.get('/packages/check-missing', adminController.checkMissingPackages);
router.delete('/packages/:packageId', adminController.deletePackage);

// Debug endpoints
router.get('/debug/stuck-slot-locks', adminController.getStuckSlotLocks);

// User management
router.post('/users', requireRequestSignature, adminController.createUser);
router.put('/users/:userId', adminController.updateUser);
router.delete('/users/:userId', requireRequestSignature, adminController.deleteUser);

// Session management
router.get('/sessions/all', sessionController.getAllSessions);

// Session rescheduling
router.put('/sessions/:sessionId/reschedule', adminController.rescheduleSession);
router.put('/sessions/:sessionId/payment', adminController.updateSessionPayment);
router.put('/sessions/:sessionId', adminController.updateSession);
router.put('/sessions/:sessionId/no-show', sessionController.markSessionAsNoShow);
router.get('/psychologists/:psychologistId/availability', adminController.getPsychologistAvailabilityForReschedule);

// Manual booking (admin only - for edge cases)
router.post('/bookings/manual', adminController.createManualBooking);

// Reschedule request handling
router.put('/reschedule-requests/:notificationId', adminController.handleRescheduleRequest);
router.get('/reschedule-requests', adminController.getRescheduleRequests);
router.put('/reschedule-requests/assessment/:notificationId/approve', adminController.approveAssessmentRescheduleRequest);

// Assessment session rescheduling (admin can reschedule directly)
router.put('/assessment-sessions/:assessmentSessionId/reschedule', assessmentBookingController.rescheduleAssessmentSession);
router.delete('/assessment-sessions/:assessmentSessionId', assessmentBookingController.deleteAssessmentSession);

// Psychologist calendar events
router.get('/psychologists/:psychologistId/calendar-events', adminController.getPsychologistCalendarEvents);

// Check calendar sync status
router.get('/psychologists/:psychologistId/calendar-sync-status', adminController.checkCalendarSyncStatus);

// Manual trigger for session reminders (admin only, for testing)
router.post('/trigger-session-reminders', async (req, res) => {
  try {
    const sessionReminderService = require('../services/sessionReminderService');
    await sessionReminderService.triggerReminderCheck();
    res.json({
      success: true,
      message: 'Session reminder check triggered successfully'
    });
  } catch (error) {
    console.error('Error triggering session reminders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual trigger for calendar conflict check (admin only, for testing)
router.post('/trigger-calendar-conflict-check', async (req, res) => {
  try {
    const dailyCalendarConflictAlert = require('../services/dailyCalendarConflictAlert');
    await dailyCalendarConflictAlert.triggerConflictCheck();
    res.json({
      success: true,
      message: 'Calendar conflict check triggered successfully'
    });
  } catch (error) {
    console.error('Error triggering calendar conflict check:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// File uploads (admin only)
// Store in Supabase Storage bucket 'psychologists' and return public URL
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB to accommodate high‑res formats
  fileFilter: (req, file, cb) => {
    // Accept any image/* mimetype (jpg, jpeg, png, webp, gif, heic, heif, bmp, tiff, svg, etc.)
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

// Note: keep route definitions after middleware so auth applies
router.post('/upload/image', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // HIGH-RISK FIX: Path traversal protection - generate UUID filename, ignore client-supplied name
    const crypto = require('crypto');
    const uuid = crypto.randomUUID();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = allowedExtensions.includes(path.extname(req.file.originalname).toLowerCase()) 
      ? path.extname(req.file.originalname).toLowerCase() 
      : '.jpg';
    const filename = `${uuid}${ext}`;
    const objectPath = `${filename}`; // flat path; change to folders if needed

    const bucket = 'profile-pictures';

    // Upload to Supabase Storage using admin client (bypasses RLS)
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError);
      return res.status(500).json({ success: false, error: 'Failed to upload to storage' });
    }

    // Get public URL (assumes bucket has public policy)
    const { data: publicData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(objectPath);

    const publicUrl = publicData?.publicUrl;

    return res.json({
      success: true,
      url: publicUrl,
      bucket,
      path: objectPath,
      filename
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload file' });
  }
});

module.exports = router;
