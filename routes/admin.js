const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const assessmentBookingController = require('../controllers/assessmentBookingController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { withCache } = require('../utils/cache');
const multer = require('multer');
const path = require('path');
const supabase = require('../config/supabase');

// All routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

// User management
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.put('/users/:userId/role', adminController.updateUserRole);
router.put('/users/:userId/deactivate', adminController.deactivateUser);

// Platform statistics (with optimized caching for 2GB plan)
router.get('/stats/platform', withCache(adminController.getPlatformStats, 'platform_stats', 3 * 60 * 1000));
router.get('/stats/dashboard', withCache(adminController.getPlatformStats, 'platform_stats', 3 * 60 * 1000)); // Alias for dashboard

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

// Package management for psychologists
router.post('/psychologists/:psychologistId/packages', adminController.createPsychologistPackages);

// User management
router.post('/users', adminController.createUser);
router.put('/users/:userId', adminController.updateUser);
router.delete('/users/:userId', adminController.deleteUser);

// Session rescheduling
router.put('/sessions/:sessionId/reschedule', adminController.rescheduleSession);
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

module.exports = router;

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

    const bucket = 'profile-pictures';
    const ext = path.extname(req.file.originalname) || '.jpg';
    const base = path
      .basename(req.file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .toLowerCase();
    const filename = `${base}-${Date.now()}${ext}`;
    const objectPath = `${filename}`; // flat path; change to folders if needed

    // Upload to Supabase Storage using admin client (bypasses RLS)
    const { error: uploadError } = await supabase.supabaseAdmin.storage
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
    const { data: publicData } = supabase.supabaseAdmin.storage
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
