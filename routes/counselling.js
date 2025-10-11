const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  getAllCounsellingServices,
  getAllCounsellingServicesAdmin,
  getCounsellingServiceBySlug,
  getCounsellingServiceById,
  createCounsellingService,
  updateCounsellingService,
  deleteCounsellingService
} = require('../controllers/counsellingController');

// Public routes
router.get('/', getAllCounsellingServices);

// Admin routes (require authentication and admin role)
router.get('/admin', authenticateToken, requireAdmin, getAllCounsellingServicesAdmin);
router.get('/admin/:id', authenticateToken, requireAdmin, getCounsellingServiceById);
router.post('/admin', authenticateToken, requireAdmin, createCounsellingService);
router.put('/admin/:id', authenticateToken, requireAdmin, updateCounsellingService);
router.delete('/admin/:id', authenticateToken, requireAdmin, deleteCounsellingService);

// Public slug route (must be after admin routes)
router.get('/:slug', getCounsellingServiceBySlug);

module.exports = router;
