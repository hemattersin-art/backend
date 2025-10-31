const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

// Admin list
const getAllBetterParentingAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('better_parenting')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: rows, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    return res.json(successResponse('Pages retrieved', {
      pages: rows || [],
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
    }));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to fetch pages', err.message));
  }
};

// Public list (published)
const getAllBetterParenting = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('better_parenting')
      .select('*', { count: 'exact' })
      .eq('status', 'published')
      .order('menu_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: rows, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    return res.json(successResponse('Pages retrieved', {
      pages: rows || [],
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
    }));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to fetch pages', err.message));
  }
};

// Public by slug
const getBetterParentingBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const { data, error } = await supabaseAdmin
      .from('better_parenting')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();
    if (error) throw error;
    return res.json(successResponse('Page retrieved', data));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to fetch page', err.message));
  }
};

// Admin by id
const getBetterParentingById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('better_parenting')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return res.json(successResponse('Page retrieved', data));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to fetch page', err.message));
  }
};

// Create (robust to missing optional columns)
const createBetterParenting = async (req, res) => {
  try {
    const body = req.body || {};
    const {
      slug,
      status = 'draft',
      menu_order = 0,
      seo_title = '',
      hero_title,
      hero_subtext = '',
      hero_image_url = '',
      benefits = [],
      benefits_title = '',
      benefits_image_url = '',
      types = [],
      types_title = '',
      right_image_url = '',
      mobile_image_url = '',
      faqs = [],
    } = body;

    if (!slug || !hero_title) {
      return res.status(400).json(errorResponse('Slug and hero title are required'));
    }

    const { data: existing } = await supabaseAdmin
      .from('better_parenting')
      .select('id')
      .eq('slug', slug)
      .single();
    if (existing) return res.status(400).json(errorResponse('Slug already exists'));

    // Step 1: minimal insert (always-existing columns)
    const minimalInsert = {
      slug,
      status,
      menu_order: menu_order || 0,
      seo_title,
      hero_title,
    };
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('better_parenting')
      .insert([minimalInsert])
      .select('*')
      .single();
    if (insertErr) throw insertErr;

    // Step 2: prepare full payload, then keep only columns that exist in table
    const fullUpdate = {
      hero_subtext,
      hero_image_url,
      benefits,
      benefits_title,
      benefits_image_url,
      types,
      types_title,
      right_image_url,
      mobile_image_url,
      faqs,
      videos: Array.isArray(body.videos) ? body.videos : undefined,
      reviews: Array.isArray(body.reviews) ? body.reviews : undefined,
      blog_teaser_enabled: body.blog_teaser_enabled,
      blog_teaser_tag: body.blog_teaser_tag,
    };

    const allowedKeys = new Set(Object.keys(inserted || {}));
    const safeUpdate = {};
    Object.keys(fullUpdate).forEach((k) => {
      if (fullUpdate[k] !== undefined && allowedKeys.has(k)) {
        safeUpdate[k] = fullUpdate[k];
      }
    });

    let finalRow = inserted;
    if (Object.keys(safeUpdate).length > 0) {
      const { data: updatedRow, error: updateErr } = await supabaseAdmin
        .from('better_parenting')
        .update(safeUpdate)
        .eq('id', inserted.id)
        .select('*')
        .single();
      if (updateErr) throw updateErr;
      finalRow = updatedRow;
    }

    return res.status(201).json(successResponse('Page created', finalRow));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to create page', err.message));
  }
};

// Update (robust to missing optional columns)
const updateBetterParenting = async (req, res) => {
  try {
    const { id } = req.params;
    const src = req.body || {};

    const updateData = {
      status: src.status,
      menu_order: src.menu_order,
      seo_title: src.seo_title,
      hero_title: src.hero_title,
      hero_subtext: src.hero_subtext,
      hero_image_url: src.hero_image_url,
      benefits_title: src.benefits_title,
      benefits: Array.isArray(src.benefits) ? src.benefits : undefined,
      benefits_image_url: src.benefits_image_url,
      types_title: src.types_title,
      types: Array.isArray(src.types) ? src.types : undefined,
      right_image_url: src.right_image_url,
      mobile_image_url: src.mobile_image_url,
      faqs: Array.isArray(src.faqs) ? src.faqs : undefined,
      videos: Array.isArray(src.videos) ? src.videos : undefined,
      reviews: Array.isArray(src.reviews) ? src.reviews : undefined,
      blog_teaser_enabled: src.blog_teaser_enabled,
      blog_teaser_tag: src.blog_teaser_tag,
    };
    Object.keys(updateData).forEach((k) => updateData[k] === undefined && delete updateData[k]);

    // Fetch existing row to derive existing columns
    const { data: existingRow, error: fetchErr } = await supabaseAdmin
      .from('better_parenting')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    const allowedKeys = new Set(Object.keys(existingRow || {}));
    const safeUpdate = {};
    Object.keys(updateData).forEach((k) => {
      if (updateData[k] !== undefined && allowedKeys.has(k)) {
        safeUpdate[k] = updateData[k];
      }
    });

    const { data, error } = await supabaseAdmin
      .from('better_parenting')
      .update(safeUpdate)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return res.json(successResponse('Page updated', data));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to update page', err.message));
  }
};

// Delete
const deleteBetterParenting = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('better_parenting')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return res.json(successResponse('Page deleted'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to delete page', err.message));
  }
};

module.exports = {
  getAllBetterParentingAdmin,
  getAllBetterParenting,
  getBetterParentingBySlug,
  getBetterParentingById,
  createBetterParenting,
  updateBetterParenting,
  deleteBetterParenting,
};


