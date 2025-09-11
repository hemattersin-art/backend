const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { withCache } = require('../utils/cache');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

module.exports = router;

// File uploads (admin only)
// Store under /uploads/psychologists and return public URL
const uploadsBaseDir = path.join(process.cwd(), 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = path.join(uploadsBaseDir, 'psychologists');
    fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Note: keep route definitions after middleware so auth applies
router.post('/upload/image', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const publicBase = process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const relativePath = `/uploads/psychologists/${req.file.filename}`;
    const url = `${publicBase}${relativePath}`;
    return res.json({ success: true, url, path: relativePath, filename: req.file.filename });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload file' });
  }
});
