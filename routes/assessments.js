const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const {
  getAllAssessments,
  getAllAssessmentsAdmin,
  getAssessmentBySlug,
  getAssessmentById,
  createAssessment,
  updateAssessment,
  deleteAssessment,
} = require('../controllers/assessmentsController');
const { uploadAssessmentImage } = require('../controllers/assessmentsController');

// Admin (must be before public slug route)
router.get('/admin', authenticateToken, requireAdmin, getAllAssessmentsAdmin);
router.get('/admin/:id', authenticateToken, requireAdmin, getAssessmentById);
router.post('/admin', authenticateToken, requireAdmin, createAssessment);
router.put('/admin/:id', authenticateToken, requireAdmin, updateAssessment);
router.delete('/admin/:id', authenticateToken, requireAdmin, deleteAssessment);
router.post('/admin/upload-image', authenticateToken, requireAdmin, upload.single('image'), uploadAssessmentImage);

// Public
router.get('/', getAllAssessments);
router.get('/:slug', getAssessmentBySlug);

module.exports = router;


