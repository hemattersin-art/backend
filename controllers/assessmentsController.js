const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');
const multer = require('multer');

// List (admin)
const getAllAssessmentsAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('assessments')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    let { data: rows, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      // Handle missing table gracefully
      if (error.code === '42P01') {
        return res.json(successResponse('Assessments retrieved', {
          assessments: [],
          pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, totalPages: 0 }
        }));
      }
      throw error;
    }

    // Seed demo assessments if empty (use minimal columns to avoid schema mismatches)
    if ((rows?.length || 0) === 0 && offset === 0) {
      const demoNow = Date.now();
      const demoSlugs = [
        'adhd',
        'adhd-vanderbilt',
        'adhd-conners-3',
        'basc-3',
        'child-depression-inventory',
        'spence-anxiety-scale',
        'vsms',
        'cat',
        'child-sentence-completion-test',
      ];
      const demos = demoSlugs.map((slug) => ({
        slug,
        status: 'draft',
        seo_title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        hero_title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      }));

      const { error: seedErr } = await supabaseAdmin
        .from('assessments')
        .insert(demos);
      if (!seedErr) {
        // Re-fetch after seeding
        const refetch = await supabaseAdmin
          .from('assessments')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        rows = refetch.data || rows;
        count = refetch.count ?? 0;
      }
    }

    res.json(successResponse('Assessments retrieved', {
      assessments: rows || [],
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
    }));
  } catch (err) {
    // Gracefully return empty when table/rls not ready yet
    return res.json(successResponse({
      assessments: [],
      pagination: { page: parseInt(req.query?.page || 1), limit: parseInt(req.query?.limit || 20), total: 0, totalPages: 0 }
    }, 'Assessments retrieved'));
  }
};

// List (public)
const getAllAssessments = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('assessments')
      .select('*', { count: 'exact' })
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: rows, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      if (error.code === '42P01') {
        return res.json(successResponse('Assessments retrieved', {
          assessments: [],
          pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, totalPages: 0 }
        }));
      }
      throw error;
    }

    res.json(successResponse('Assessments retrieved', {
      assessments: rows || [],
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
    }));
  } catch (err) {
    res.status(500).json(errorResponse('Failed to fetch assessments', err.message));
  }
};

// Public by slug
const getAssessmentBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const { data, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();
    if (error) {
      if (error.code === '42P01') return res.status(404).json(errorResponse('Assessment not found'));
      if (error.code === 'PGRST116') return res.status(404).json(errorResponse('Assessment not found'));
      throw error;
    }
    if (!data) return res.status(404).json(errorResponse('Assessment not found'));
    
    // Ensure assigned_doctor_ids is an array (might be JSON string from database)
    if (data.assigned_doctor_ids && typeof data.assigned_doctor_ids === 'string') {
      try {
        data.assigned_doctor_ids = JSON.parse(data.assigned_doctor_ids);
      } catch (e) {
        console.warn('Failed to parse assigned_doctor_ids:', e);
        data.assigned_doctor_ids = [];
      }
    }
    if (!Array.isArray(data.assigned_doctor_ids)) {
      data.assigned_doctor_ids = [];
    }
    
    res.json(successResponse('Assessment retrieved', data));
  } catch (err) {
    res.status(500).json(errorResponse('Failed to fetch assessment', err.message));
  }
};

// Admin by id
const getAssessmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('assessments')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      if (error.code === '42P01') return res.status(404).json(errorResponse('Assessment not found'));
      if (error.code === 'PGRST116') return res.status(404).json(errorResponse('Assessment not found'));
      throw error;
    }
    if (!data) return res.status(404).json(errorResponse('Assessment not found'));
    
    // Ensure assigned_doctor_ids is an array (might be JSON string from database)
    if (data.assigned_doctor_ids && typeof data.assigned_doctor_ids === 'string') {
      try {
        data.assigned_doctor_ids = JSON.parse(data.assigned_doctor_ids);
      } catch (e) {
        console.warn('Failed to parse assigned_doctor_ids:', e);
        data.assigned_doctor_ids = [];
      }
    }
    if (!Array.isArray(data.assigned_doctor_ids)) {
      data.assigned_doctor_ids = [];
    }
    
    res.json(successResponse('Assessment retrieved', data));
  } catch (err) {
    res.status(500).json(errorResponse('Failed to fetch assessment', err.message));
  }
};

// Create
const createAssessment = async (req, res) => {
  try {
    const body = req.body || {};
    const {
      slug,
      status = 'draft',
      category,
      menu_order,
      seo_title,
      hero_title,
      hero_subtext,
      hero_image_url,
      benefits = [],
      types = [],
      faqs = [],
      testimonials = [],
      info_cards = [],
      benefits_image_url,
      right_image_url,
      mobile_image_url
    } = body;

    if (!slug || !hero_title) {
      return res.status(400).json(errorResponse('Slug and hero title are required'));
    }

    const validateJsonArray = (arr, fieldName) => {
      if (!Array.isArray(arr)) {
        throw new Error(`${fieldName} must be an array`);
      }
      return arr;
    };

    const { data: existing, error: existErr } = await supabaseAdmin
      .from('assessments')
      .select('id')
      .eq('slug', slug)
      .single();
    if (existErr && existErr.code === '42P01') {
      return res.status(400).json(errorResponse('Assessments table not found. Please create the table in Supabase.'));
    }
    if (existing) return res.status(400).json(errorResponse('Slug already exists'));

    // Insert minimal, schema-safe payload (avoid columns that might not exist)
    // Step 1: insert minimal safe columns
    const minimalInsert = { slug, status, seo_title, hero_title };
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('assessments')
      .insert([minimalInsert])
      .select('*')
      .single();
    if (insertErr) throw insertErr;

    // Step 2: build full update payload, then keep only existing columns
    const fullUpdate = {
      category,
      menu_order: menu_order || 0,
      hero_subtext,
      therapists_heading: body.therapists_heading,
      hero_image_url,
      benefits: validateJsonArray(benefits, 'benefits'),
      types: validateJsonArray(types, 'types'),
      faqs: validateJsonArray(faqs, 'faqs'),
      testimonials: validateJsonArray(testimonials, 'testimonials'),
      info_cards: validateJsonArray(info_cards, 'info_cards'),
      videos: Array.isArray(body.videos) ? body.videos : undefined,
      reviews: Array.isArray(body.reviews) ? body.reviews : undefined,
      benefits_image_url,
      right_image_url,
      mobile_image_url,
      assigned_doctor_ids: Array.isArray(body.assigned_doctor_ids) ? body.assigned_doctor_ids : undefined,
      updated_by: req.user?.id,
    };

    // Derive allowed keys from inserted row (actual table columns)
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
        .from('assessments')
        .update(safeUpdate)
        .eq('id', inserted.id)
        .select('*')
        .single();
      if (updateErr) throw updateErr;
      finalRow = updatedRow;
    }

    res.status(201).json(successResponse('Assessment created', finalRow));
  } catch (err) {
    res.status(500).json(errorResponse('Failed to create assessment', err.message));
  }
};

// Update (slug immutable)
const updateAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const src = req.body || {};

    const validateJsonArray = (arr, fieldName) => {
      if (arr === undefined) return undefined;
      if (!Array.isArray(arr)) {
        throw new Error(`${fieldName} must be an array`);
      }
      return arr;
    };

    const updateData = {
      status: src.status,
      category: src.category,
      menu_order: src.menu_order,
      seo_title: src.seo_title,
      seo_description: src.seo_description,
      seo_keywords: src.seo_keywords,
      og_title: src.og_title,
      og_description: src.og_description,
      og_image: src.og_image,
      canonical_url: src.canonical_url,
      robots: src.robots,
      schema_enabled: src.schema_enabled,
      schema_service_type: src.schema_service_type,
      hero_title: src.hero_title,
      hero_subtext: src.hero_subtext,
      therapists_heading: src.therapists_heading,
      hero_cta_text: src.hero_cta_text,
      hero_image_url: src.hero_image_url,
      hero_point_1: src.hero_point_1,
      hero_point_2: src.hero_point_2,
      hero_point_3: src.hero_point_3,
      benefits_title: src.benefits_title,
      benefits_image_url: src.benefits_image_url,
      benefits: validateJsonArray(src.benefits, 'benefits'),
      info_cards: validateJsonArray(src.info_cards, 'info_cards'),
      types_title: src.types_title,
      right_image_url: src.right_image_url,
      mobile_image_url: src.mobile_image_url,
      types: validateJsonArray(src.types, 'types'),
      faqs: validateJsonArray(src.faqs, 'faqs'),
      videos: validateJsonArray(src.videos, 'videos'),
      reviews: validateJsonArray(src.reviews, 'reviews'),
      assigned_doctor_ids: Array.isArray(src.assigned_doctor_ids) ? src.assigned_doctor_ids : undefined,
      updated_by: req.user?.id,
    };

    Object.keys(updateData).forEach((k) => updateData[k] === undefined && delete updateData[k]);

    // Fetch existing to derive allowed columns dynamically
    const { data: existingRow, error: fetchErr } = await supabaseAdmin
      .from('assessments')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    // Keep only keys that exist on the table (present in fetched row)
    const allowedKeys = new Set(Object.keys(existingRow || {}));
    Object.keys(updateData).forEach((k) => {
      if (updateData[k] === undefined || !allowedKeys.has(k)) {
        delete updateData[k];
      }
    });

    const { data, error } = await supabaseAdmin
      .from('assessments')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(successResponse('Assessment updated', data));
  } catch (err) {
    res.status(500).json(errorResponse('Failed to update assessment', err.message));
  }
};

// Delete
const deleteAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('assessments').delete().eq('id', id);
    if (error) throw error;
    res.json(successResponse('Assessment deleted'));
  } catch (err) {
    res.status(500).json(errorResponse('Failed to delete assessment', err.message));
  }
};

module.exports = {
  getAllAssessments,
  getAllAssessmentsAdmin,
  getAssessmentBySlug,
  getAssessmentById,
  createAssessment,
  updateAssessment,
  deleteAssessment,
};

// Image Upload (similar to counselling)
const {
  uploadCounsellingImage: uploadAssessmentImageToStorage,
  getCounsellingImageUrl: getAssessmentImageUrl,
  generateCounsellingFileName: generateAssessmentFileName,
  validateImageFile: validateAssessmentImage
} = require('../utils/storageService');

const uploadAssessmentImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(errorResponse('No file uploaded'));
    }

    const validation = validateAssessmentImage(req.file);
    if (!validation.valid) {
      return res.status(400).json(errorResponse(validation.error));
    }

    const { slug, imageType } = req.body;
    if (!slug || !imageType) {
      return res.status(400).json(errorResponse('Slug and imageType are required'));
    }

    const fileName = generateAssessmentFileName(req.file.originalname, slug, imageType);
    const uploadResult = await uploadAssessmentImageToStorage(req.file.buffer, fileName, req.file.mimetype);
    if (!uploadResult.success) {
      return res.status(500).json(errorResponse('Failed to upload image', uploadResult.error));
    }

    const publicUrl = getAssessmentImageUrl(fileName);
    return res.json(successResponse({ url: publicUrl, filename: fileName }, 'Image uploaded successfully'));
  } catch (error) {
    console.error('Error uploading assessment image:', error);
    return res.status(500).json(errorResponse('Failed to upload image', error.message));
  }
};

module.exports.uploadAssessmentImage = uploadAssessmentImage;


