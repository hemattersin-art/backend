const express = require('express');
const router = express.Router();
const superadminController = require('../controllers/superadminController');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const validateCSRF = require('../middleware/csrf');

// All routes require authentication and superadmin role
router.use(validateCSRF); // MEDIUM-RISK FIX: CSRF protection
router.use(authenticateToken);
router.use(requireSuperAdmin);

// Admin user management
router.post('/create-admin', superadminController.createAdmin);

// User management (superadmin only)
router.delete('/users/:userId', superadminController.deleteUser);

// Platform analytics
router.get('/analytics/platform', superadminController.getPlatformAnalytics);

// System maintenance
router.post('/maintenance', superadminController.systemMaintenance);

// System logs
router.get('/logs/system', superadminController.getSystemLogs);

module.exports = router;
