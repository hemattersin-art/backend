const supabase = require('../config/supabase');
const supabaseAdmin = require('../config/supabase').supabaseAdmin;
const { successResponse, errorResponse } = require('../utils/helpers');

// Get all assessment pages (admin - includes drafts)
const getAllAssessmentsAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('assessments')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Add search functionality
    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: assessments, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching assessments:', error);
      return res.status(500).json(errorResponse('Failed to fetch assessments', error.message));
    }

    res.json(successResponse('Assessments retrieved successfully', {
      pages: assessments || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    }));
  } catch (error) {
    console.error('Error fetching assessments:', error);
    res.status(500).json(errorResponse('Failed to fetch assessments', error.message));
  }
};

// Get assessment page by slug (public)
const getAssessmentBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: assessment, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Assessment not found'));
      }
      console.error('Error fetching assessment:', error);
      return res.status(500).json(errorResponse('Failed to fetch assessment', error.message));
    }

    res.json(successResponse('Assessment retrieved successfully', assessment));
  } catch (error) {
    console.error('Error fetching assessment:', error);
    res.status(500).json(errorResponse('Failed to fetch assessment', error.message));
  }
};

// Get assessment by ID (admin)
const getAssessmentById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: assessment, error } = await supabaseAdmin
      .from('assessments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Assessment not found'));
      }
      console.error('Error fetching assessment:', error);
      return res.status(500).json(errorResponse('Failed to fetch assessment', error.message));
    }

    res.json(successResponse('Assessment retrieved successfully', assessment));
  } catch (error) {
    console.error('Error fetching assessment:', error);
    res.status(500).json(errorResponse('Failed to fetch assessment', error.message));
  }
};

// Create assessment page (admin)
const createAssessment = async (req, res) => {
  try {
    const assessmentData = req.body;
    
    const { data: assessment, error } = await supabaseAdmin
      .from('assessments')
      .insert(assessmentData)
      .select()
      .single();

    if (error) {
      console.error('Error creating assessment:', error);
      return res.status(500).json(errorResponse('Failed to create assessment', error.message));
    }

    res.json(successResponse('Assessment created successfully', assessment));
  } catch (error) {
    console.error('Error creating assessment:', error);
    res.status(500).json(errorResponse('Failed to create assessment', error.message));
  }
};

// Update assessment page (admin)
const updateAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data: assessment, error } = await supabaseAdmin
      .from('assessments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating assessment:', error);
      return res.status(500).json(errorResponse('Failed to update assessment', error.message));
    }

    res.json(successResponse('Assessment updated successfully', assessment));
  } catch (error) {
    console.error('Error updating assessment:', error);
    res.status(500).json(errorResponse('Failed to update assessment', error.message));
  }
};

// Delete assessment page (admin)
const deleteAssessment = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('assessments')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting assessment:', error);
      return res.status(500).json(errorResponse('Failed to delete assessment', error.message));
    }

    res.json(successResponse('Assessment deleted successfully'));
  } catch (error) {
    console.error('Error deleting assessment:', error);
    res.status(500).json(errorResponse('Failed to delete assessment', error.message));
  }
};

module.exports = {
  getAllAssessmentsAdmin,
  getAssessmentBySlug,
  getAssessmentById,
  createAssessment,
  updateAssessment,
  deleteAssessment
};

