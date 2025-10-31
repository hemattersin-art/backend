const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const {
  getAllBetterParenting,
  getAllBetterParentingAdmin,
  getBetterParentingBySlug,
  getBetterParentingById,
  createBetterParenting,
  updateBetterParenting,
  deleteBetterParenting,
} = require('../controllers/betterParentingController');

// Admin (before public slug)
router.get('/admin', authenticateToken, requireAdmin, getAllBetterParentingAdmin);
router.get('/admin/:id', authenticateToken, requireAdmin, getBetterParentingById);
router.post('/admin', authenticateToken, requireAdmin, createBetterParenting);
router.put('/admin/:id', authenticateToken, requireAdmin, updateBetterParenting);
router.delete('/admin/:id', authenticateToken, requireAdmin, deleteBetterParenting);

// Public
router.get('/', getAllBetterParenting);
router.get('/:slug', getBetterParentingBySlug);

module.exports = router;


