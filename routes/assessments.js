const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  getAllAssessmentsAdmin,
  getAssessmentBySlug,
  getAssessmentById,
  createAssessment,
  updateAssessment,
  deleteAssessment
} = require('../controllers/assessmentsController');

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Admin routes (require authentication and admin role)
router.get('/admin', authenticateToken, requireAdmin, getAllAssessmentsAdmin);
router.get('/admin/:id', authenticateToken, requireAdmin, getAssessmentById);
router.post('/admin', authenticateToken, requireAdmin, createAssessment);
router.put('/admin/:id', authenticateToken, requireAdmin, updateAssessment);
router.delete('/admin/:id', authenticateToken, requireAdmin, deleteAssessment);

// Public slug route (must be after admin routes)
router.get('/:slug', getAssessmentBySlug);

module.exports = router;

