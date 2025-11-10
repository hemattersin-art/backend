const supabase = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

// Get all counselling services (admin - includes drafts)
const getAllCounsellingServicesAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('counselling_services')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Add search functionality
    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: services, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching counselling services:', error);
      return res.status(500).json(errorResponse('Failed to fetch counselling services', error.message));
    }

    res.json(successResponse({
      services: services || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    }, 'Counselling services retrieved successfully'));
  } catch (error) {
    console.error('Error fetching counselling services:', error);
    res.status(500).json(errorResponse('Failed to fetch counselling services', error.message));
  }
};

// Get all counselling services (public - only published)
const getAllCounsellingServices = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('counselling_services')
      .select('*', { count: 'exact' })
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    // Add search functionality
    if (search) {
      query = query.or(`slug.ilike.%${search}%,hero_title.ilike.%${search}%,seo_title.ilike.%${search}%`);
    }

    const { data: services, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching counselling services:', error);
      return res.status(500).json(errorResponse('Failed to fetch counselling services', error.message));
    }

    res.json(successResponse({
      services: services || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    }, 'Counselling services retrieved successfully'));
  } catch (error) {
    console.error('Error fetching counselling services:', error);
    res.status(500).json(errorResponse('Failed to fetch counselling services', error.message));
  }
};

// Get counselling service by slug (public)
const getCounsellingServiceBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: service, error } = await supabase
      .from('counselling_services')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Counselling service not found'));
      }
      console.error('Error fetching counselling service:', error);
      return res.status(500).json(errorResponse('Failed to fetch counselling service', error.message));
    }

    res.json(successResponse(service, 'Counselling service retrieved successfully'));
  } catch (error) {
    console.error('Error fetching counselling service:', error);
    res.status(500).json(errorResponse('Failed to fetch counselling service', error.message));
  }
};

// Get counselling service by ID (admin only)
const getCounsellingServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: service, error } = await supabase
      .from('counselling_services')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Counselling service not found'));
      }
      console.error('Error fetching counselling service:', error);
      return res.status(500).json(errorResponse('Failed to fetch counselling service', error.message));
    }

    // Add left_image_url field if it doesn't exist
    if (!service.left_image_url) {
      service.left_image_url = '/360_F_262015638_nxpC4t1wbe8cLiVX3eholwctgVItTqF6.png';
    }

    res.json(successResponse(service, 'Counselling service retrieved successfully'));
  } catch (error) {
    console.error('Error fetching counselling service:', error);
    res.status(500).json(errorResponse('Failed to fetch counselling service', error.message));
  }
};

// Create new counselling service (admin only)
const createCounsellingService = async (req, res) => {
  try {
    const {
      slug,
      status = 'draft',
      category,
      menu_order,
      seo_title,
      hero_title,
      hero_subtext,
      therapists_heading,
      hero_image_url,
      benefits = [],
      types = [],
      faqs = [],
      testimonials = [],
      info_cards = [],
      benefits_image_url,
      right_image_url,
      mobile_image_url,
      videos = [],
      reviews = [],
      blog_teaser_enabled = true,
      blog_teaser_tag = null
    } = req.body;

    if (!slug || !hero_title) {
      return res.status(400).json(errorResponse('Slug and hero title are required'));
    }

    // Check if slug already exists
    const { data: existingService } = await supabase
      .from('counselling_services')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existingService) {
      return res.status(400).json(errorResponse('A counselling service with this slug already exists'));
    }

    // Validate JSON arrays
    const validateJsonArray = (arr, fieldName) => {
      if (!Array.isArray(arr)) {
        throw new Error(`${fieldName} must be an array`);
      }
      return arr;
    };

    const { data: service, error } = await supabase
      .from('counselling_services')
      .insert([{
        slug,
        status,
        category,
        menu_order: menu_order || 0,
        seo_title,
        hero_title,
        hero_subtext,
        therapists_heading,
        hero_image_url,
        benefits: validateJsonArray(benefits, 'benefits'),
        types: validateJsonArray(types, 'types'),
        faqs: validateJsonArray(faqs, 'faqs'),
        testimonials: validateJsonArray(testimonials, 'testimonials'),
        info_cards: validateJsonArray(info_cards, 'info_cards'),
        benefits_image_url,
        right_image_url,
        mobile_image_url,
        videos: validateJsonArray(videos, 'videos'),
        reviews: validateJsonArray(reviews, 'reviews'),
        blog_teaser_enabled,
        blog_teaser_tag,
        updated_by: req.user?.id
      }])
      .select('*')
      .single();

    if (error) {
      console.error('Error creating counselling service:', error);
      return res.status(500).json(errorResponse('Failed to create counselling service', error.message));
    }

    res.status(201).json(successResponse(service, 'Counselling service created successfully'));
  } catch (error) {
    console.error('Error creating counselling service:', error);
    res.status(500).json(errorResponse('Failed to create counselling service', error.message));
  }
};

// Update counselling service (admin only)
const updateCounsellingService = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      category,
      menu_order,
      seo_title,
      hero_title,
      hero_subtext,
      therapists_heading,
      hero_image_url,
      benefits,
      types,
      faqs,
      testimonials,
      info_cards,
      benefits_image_url,
      right_image_url,
      mobile_image_url,
      videos,
      reviews,
      blog_teaser_enabled,
      blog_teaser_tag
    } = req.body;

    // Check if service exists
    const { data: existingService, error: fetchError } = await supabase
      .from('counselling_services')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Counselling service not found'));
      }
      console.error('Error fetching counselling service:', fetchError);
      return res.status(500).json(errorResponse('Failed to fetch counselling service', fetchError.message));
    }

    // Build update data
    // Note: slug is intentionally excluded from updates to prevent broken links
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (category !== undefined) updateData.category = category;
    if (menu_order !== undefined) updateData.menu_order = menu_order;
    if (seo_title !== undefined) updateData.seo_title = seo_title;
    if (hero_title !== undefined) updateData.hero_title = hero_title;
    if (hero_subtext !== undefined) updateData.hero_subtext = hero_subtext;
    if (therapists_heading !== undefined) updateData.therapists_heading = therapists_heading;
    if (hero_image_url !== undefined) updateData.hero_image_url = hero_image_url;
    if (benefits !== undefined) updateData.benefits = benefits;
    if (types !== undefined) updateData.types = types;
    if (faqs !== undefined) updateData.faqs = faqs;
    if (testimonials !== undefined) updateData.testimonials = testimonials;
    if (info_cards !== undefined) updateData.info_cards = info_cards;
    if (benefits_image_url !== undefined) updateData.benefits_image_url = benefits_image_url;
    if (right_image_url !== undefined) updateData.right_image_url = right_image_url;
    if (mobile_image_url !== undefined) updateData.mobile_image_url = mobile_image_url;
    if (videos !== undefined) updateData.videos = videos;
    if (reviews !== undefined) updateData.reviews = reviews;
    if (blog_teaser_enabled !== undefined) updateData.blog_teaser_enabled = blog_teaser_enabled;
    if (blog_teaser_tag !== undefined) updateData.blog_teaser_tag = blog_teaser_tag;
    updateData.updated_by = req.user?.id;

    // Keep only keys that exist on the table (based on fetched row)
    const allowedKeys = new Set(Object.keys(existingService || {}));
    Object.keys(updateData).forEach((k) => {
      if (!allowedKeys.has(k)) {
        delete updateData[k];
      }
    });

    const { data: service, error } = await supabase
      .from('counselling_services')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('Error updating counselling service:', error);
      return res.status(500).json(errorResponse('Failed to update counselling service', error.message));
    }

    res.json(successResponse(service, 'Counselling service updated successfully'));
  } catch (error) {
    console.error('Error updating counselling service:', error);
    res.status(500).json(errorResponse('Failed to update counselling service', error.message));
  }
};

// Delete counselling service (admin only)
const deleteCounsellingService = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if service exists
    const { data: existingService, error: fetchError } = await supabase
      .from('counselling_services')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Counselling service not found'));
      }
      console.error('Error fetching counselling service:', fetchError);
      return res.status(500).json(errorResponse('Failed to fetch counselling service', fetchError.message));
    }

    const { error } = await supabase
      .from('counselling_services')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting counselling service:', error);
      return res.status(500).json(errorResponse('Failed to delete counselling service', error.message));
    }

    res.json(successResponse(null, 'Counselling service deleted successfully'));
  } catch (error) {
    console.error('Error deleting counselling service:', error);
    res.status(500).json(errorResponse('Failed to delete counselling service', error.message));
  }
};

// Upload image for counselling service
const uploadCounsellingImage = async (req, res) => {
  try {
    const { 
      uploadCounsellingImage: uploadImage, 
      getCounsellingImageUrl, 
      generateCounsellingFileName,
      validateImageFile 
    } = require('../utils/storageService');

    if (!req.file) {
      return res.status(400).json(errorResponse('No file uploaded'));
    }

    // Validate file
    const validation = validateImageFile(req.file);
    if (!validation.valid) {
      return res.status(400).json(errorResponse(validation.error));
    }

    const { slug, imageType } = req.body;
    if (!slug || !imageType) {
      return res.status(400).json(errorResponse('Slug and imageType are required'));
    }

    // Generate unique filename
    const fileName = generateCounsellingFileName(req.file.originalname, slug, imageType);

    // Upload to Supabase
    const uploadResult = await uploadImage(req.file.buffer, fileName, req.file.mimetype);

    if (!uploadResult.success) {
      return res.status(500).json(errorResponse('Failed to upload image', uploadResult.error));
    }

    // Get public URL
    const publicUrl = getCounsellingImageUrl(fileName);

    res.json(successResponse({
      url: publicUrl,
      filename: fileName
    }, 'Image uploaded successfully'));
  } catch (error) {
    console.error('Error uploading counselling image:', error);
    res.status(500).json(errorResponse('Failed to upload image', error.message));
  }
};

module.exports = {
  getAllCounsellingServices,
  getAllCounsellingServicesAdmin,
  getCounsellingServiceBySlug,
  getCounsellingServiceById,
  createCounsellingService,
  updateCounsellingService,
  deleteCounsellingService,
  uploadCounsellingImage
};
