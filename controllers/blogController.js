const supabase = require('../config/supabase');
const storageService = require('../utils/storageService');

// Helper function for consistent error responses
const errorResponse = (message, error = null, statusCode = 500) => ({
  success: false,
  message,
  error,
  statusCode
});

// Helper function for consistent success responses
const successResponse = (message, data = null) => ({
  success: true,
  message,
  data
});

// Generate slug from title
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');
};

// Get all blog posts
const getAllBlogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = 'published', search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('blogs')
      .select('*')
      .order('created_at', { ascending: false });

    // Filter by status
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Search functionality
    if (search) {
      query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%,excerpt.ilike.%${search}%`);
    }

    // For public access, only show published blogs
    if (!req.user || req.user.role === 'client') {
      query = query.eq('status', 'published');
    }

    const { data: blogs, error } = await query;
    
    if (error) throw error;

    // Get total count for pagination
    const { count, error: countError } = await supabase
      .from('blogs')
      .select('*', { count: 'exact', head: true })
      .eq(status && status !== 'all' ? 'status' : 'id', status && status !== 'all' ? status : '*');

    // Transform blog data
    const formattedBlogs = blogs.map(blog => ({
      ...blog,
      featured_image_url: blog.featured_image_url || '/images/blog-default.jpg',
      tags: blog.tags || [],
      read_time_minutes: blog.read_time_minutes || 5
    }));

    res.json(successResponse('Blogs retrieved successfully', {
      blogs: formattedBlogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || formattedBlogs.length,
        totalPages: Math.ceil((count || formattedBlogs.length) / limit)
      }
    }));
  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json(errorResponse('Failed to fetch blogs', error.message));
  }
};

// Get blog by slug (public)
const getBlogBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: blog, error } = await supabase
      .from('blogs')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Blog post not found'));
      }
      throw error;
    }

    // Increment view count
    await supabase
      .from('blogs')
      .update({ view_count: (blog.view_count || 0) + 1 })
      .eq('id', blog.id);

    res.json(successResponse('Blog retrieved successfully', {
      ...blog,
      featured_image_url: blog.featured_image_url || '/images/blog-default.jpg',
      tags: blog.tags || []
    }));
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json(errorResponse('Failed to fetch blog', error.message));
  }
};

// Get blog by ID (admin/superadmin only)
const getBlogById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: blog, error } = await supabase
      .from('blogs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Blog post not found'));
      }
      throw error;
    }

    res.json(successResponse('Blog retrieved successfully', {
      ...blog,
      tags: blog.tags || []
    }));
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json(errorResponse('Failed to fetch blog', error.message));
  }
};

// Create new blog post (admin/superadmin only)
const createBlog = async (req, res) => {
  try {
    const {
      title,
      excerpt,
      content,
      featured_image_url,
      author_name,
      status = 'draft',
      tags = [],
      read_time_minutes
    } = req.body;

    if (!title || !content) {
      return res.status(400).json(errorResponse('Title and content are required'));
    }

    // Generate slug from title
    let slug = generateSlug(title);
    
    // Check if slug already exists
    const { data: existingBlog } = await supabase
      .from('blogs')
      .select('slug')
      .eq('slug', slug)
      .single();

    // If slug exists, append a number
    if (existingBlog) {
      let counter = 1;
      let newSlug = `${slug}-${counter}`;
      
      while (await supabase.from('blogs').select('id').eq('slug', newSlug).single()) {
        counter++;
        newSlug = `${slug}-${counter}`;
      }
      slug = newSlug;
    }

    const published_at = status === 'published' ? new Date().toISOString() : null;

    const { data: blog, error } = await supabase
      .from('blogs')
      .insert([{
        title,
        slug,
        excerpt,
        content,
        featured_image_url,
        author_id: req.user.id,
        author_name: author_name || req.user.name || 'Admin',
        status,
        published_at,
        tags: Array.isArray(tags) ? tags : [],
        read_time_minutes: read_time_minutes || 5,
        view_count: 0
      }])
      .select('*')
      .single();

    if (error) throw error;

    res.status(201).json(successResponse('Blog created successfully', {
      ...blog,
      tags: blog.tags || []
    }));
  } catch (error) {
    console.error('Error creating blog:', error);
    res.status(500).json(errorResponse('Failed to create blog', error.message));
  }
};

// Update blog post (admin/superadmin only)
const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      excerpt,
      content,
      featured_image_url,
      author_name,
      status,
      tags,
      read_time_minutes
    } = req.body;

    // Check if blog exists
    const { data: existingBlog, error: fetchError } = await supabase
      .from('blogs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Blog post not found'));
      }
      throw fetchError;
    }

    let slug = existingBlog.slug;
    let published_at = existingBlog.published_at;

    // If title is being updated, generate new slug
    if (title && title !== existingBlog.title) {
      slug = generateSlug(title);
      
      // Check if new slug already exists
      const { data: slugCheck } = await supabase
        .from('blogs')
        .select('slug')
        .eq('slug', slug)
        .neq('id', id)
        .single();

      if (slugCheck) {
        let counter = 1;
        let newSlug = `${slug}-${counter}`;
        
        while (await supabase.from('blogs').select('id').eq('slug', newSlug).neq('id', id).single()) {
          counter++;
          newSlug = `${slug}-${counter}`;
        }
        slug = newSlug;
      }
    }

    // Handle status change to published
    if (status === 'published' && existingBlog.status !== 'published') {
      published_at = new Date().toISOString();
    } else if (status !== 'published') {
      published_at = null;
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title) updateData.title = title;
    if (excerpt !== undefined) updateData.excerpt = excerpt;
    if (content) updateData.content = content;
    if (featured_image_url !== undefined) updateData.featured_image_url = featured_image_url;
    if (author_name) updateData.author_name = author_name;
    if (status) updateData.status = status;
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];
    if (read_time_minutes !== undefined) updateData.read_time_minutes = read_time_minutes;
    
    updateData.slug = slug;
    updateData.published_at = published_at;

    const { data: blog, error } = await supabase
      .from('blogs')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    res.json(successResponse('Blog updated successfully', {
      ...blog,
      tags: blog.tags || []
    }));
  } catch (error) {
    console.error('Error updating blog:', error);
    res.status(500).json(errorResponse('Failed to update blog', error.message));
  }
};

// Delete blog post (superadmin only)
const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if blog exists
    const { data: existingBlog, error: fetchError } = await supabase
      .from('blogs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json(errorResponse('Blog post not found'));
      }
      throw fetchError;
    }

    const { error } = await supabase
      .from('blogs')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json(successResponse('Blog deleted successfully'));
  } catch (error) {
    console.error('Error deleting blog:', error);
    res.status(500).json(errorResponse('Failed to delete blog', error.message));
  }
};

module.exports = {
  getAllBlogs,
  getBlogBySlug,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog
};