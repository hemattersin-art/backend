const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  getAllBetterParentingPages,
  getAllBetterParentingPagesAdmin,
  getBetterParentingPageBySlug,
  getBetterParentingPageById,
  createBetterParentingPage,
  updateBetterParentingPage,
  deleteBetterParentingPage
} = require('../controllers/betterParentingController');

// Public routes
router.get('/', getAllBetterParentingPages);

// Admin routes (require authentication and admin role)
router.get('/admin', authenticateToken, requireAdmin, getAllBetterParentingPagesAdmin);
router.get('/admin/:id', authenticateToken, requireAdmin, getBetterParentingPageById);
router.post('/admin', authenticateToken, requireAdmin, createBetterParentingPage);
router.put('/admin/:id', authenticateToken, requireAdmin, updateBetterParentingPage);
router.delete('/admin/:id', authenticateToken, requireAdmin, deleteBetterParentingPage);

// Public slug route (must be after admin routes)
router.get('/:slug', getBetterParentingPageBySlug);

module.exports = router;

