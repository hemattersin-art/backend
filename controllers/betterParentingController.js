const supabase = require('../config/supabase');
const supabaseAdmin = require('../config/supabase').supabaseAdmin;
const { successResponse, errorResponse } = require('../utils/helpers');

// Get all better parenting pages (admin - includes drafts)
const getAllBetterParentingPagesAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('better_parenting')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Add search functionality
    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: pages, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching better parenting pages:', error);
      return res.status(500).json(errorResponse('Failed to fetch better parenting pages', error.message));
    }

    res.json(successResponse('Better parenting pages retrieved successfully', {
      pages: pages || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    }));
  } catch (error) {
    console.error('Error fetching better parenting pages:', error);
    res.status(500).json(errorResponse('Failed to fetch better parenting pages', error.message));
  }
};

// Get all better parenting pages (public - only published)
const getAllBetterParentingPages = async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const { data: pages, error } = await supabase
      .from('better_parenting')
      .select('id, slug, hero_title, hero_subtext, order, category')
      .eq('status', 'published')
      .order('order', { ascending: true });

    if (error) {
      console.error('Error fetching better parenting pages:', error);
      return res.status(500).json(errorResponse('Failed to fetch better parenting pages', error.message));
    }

    res.json(successResponse('Better parenting pages retrieved successfully', {
      pages: pages || []
    }));
  } catch (error) {
    console.error('Error fetching better parenting pages:', error);
    res.status(500).json(errorResponse('Failed to fetch better parenting pages', error.message));
  }
};

// Get better parenting page by slug (public)
const getBetterParentingPageBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: page, error } = await supabase
      .from('better_parenting')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Better parenting page not found'));
      }
      console.error('Error fetching better parenting page:', error);
      return res.status(500).json(errorResponse('Failed to fetch better parenting page', error.message));
    }

    res.json(successResponse('Better parenting page retrieved successfully', page));
  } catch (error) {
    console.error('Error fetching better parenting page:', error);
    res.status(500).json(errorResponse('Failed to fetch better parenting page', error.message));
  }
};

// Get better parenting page by ID (admin)
const getBetterParentingPageById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: page, error } = await supabaseAdmin
      .from('better_parenting')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Better parenting page not found'));
      }
      console.error('Error fetching better parenting page:', error);
      return res.status(500).json(errorResponse('Failed to fetch better parenting page', error.message));
    }

    res.json(successResponse('Better parenting page retrieved successfully', page));
  } catch (error) {
    console.error('Error fetching better parenting page:', error);
    res.status(500).json(errorResponse('Failed to fetch better parenting page', error.message));
  }
};

// Create better parenting page (admin)
const createBetterParentingPage = async (req, res) => {
  try {
    const pageData = req.body;

    const { data: newPage, error } = await supabaseAdmin
      .from('better_parenting')
      .insert([pageData])
      .select()
      .single();

    if (error) {
      console.error('Error creating better parenting page:', error);
      return res.status(500).json(errorResponse('Failed to create better parenting page', error.message));
    }

    res.status(201).json(successResponse('Better parenting page created successfully', newPage));
  } catch (error) {
    console.error('Error creating better parenting page:', error);
    res.status(500).json(errorResponse('Failed to create better parenting page', error.message));
  }
};

// Update better parenting page (admin)
const updateBetterParentingPage = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data: updatedPage, error } = await supabaseAdmin
      .from('better_parenting')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating better parenting page:', error);
      return res.status(500).json(errorResponse('Failed to update better parenting page', error.message));
    }

    res.json(successResponse('Better parenting page updated successfully', updatedPage));
  } catch (error) {
    console.error('Error updating better parenting page:', error);
    res.status(500).json(errorResponse('Failed to update better parenting page', error.message));
  }
};

// Delete better parenting page (admin)
const deleteBetterParentingPage = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('better_parenting')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting better parenting page:', error);
      return res.status(500).json(errorResponse('Failed to delete better parenting page', error.message));
    }

    res.json(successResponse('Better parenting page deleted successfully'));
  } catch (error) {
    console.error('Error deleting better parenting page:', error);
    res.status(500).json(errorResponse('Failed to delete better parenting page', error.message));
  }
};

module.exports = {
  getAllBetterParentingPages,
  getAllBetterParentingPagesAdmin,
  getBetterParentingPageBySlug,
  getBetterParentingPageById,
  createBetterParentingPage,
  updateBetterParentingPage,
  deleteBetterParentingPage
};

