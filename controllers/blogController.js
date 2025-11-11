const supabase = require('../config/supabase');
const storageService = require('../utils/storageService');
const { 
  processStructuredContent: processContent, 
  validateStructuredContent, 
  calculateReadingTime,
  extractImagesFromContent 
} = require('../utils/blogContentProcessor');

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
      featured_image_url: blog.featured_image_url || '/mainlogo.webp',
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
      featured_image_url: blog.featured_image_url || '/mainlogo.webp',
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
      structured_content,
      featured_image_url,
      content_images = [],
      author_name,
      status = 'draft',
      tags = [],
      read_time_minutes: incomingReadTime
    } = req.body;

    if (!title || (!content && !structured_content)) {
      return res.status(400).json(errorResponse('Title and content (or structured_content) are required'));
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

    let computedReadTime = incomingReadTime;

    // Process structured content if provided
    let processedStructuredContent = null;
    if (structured_content && Array.isArray(structured_content)) {
      // Validate structured content
      const validation = validateStructuredContent(structured_content);
      if (!validation.isValid) {
        return res.status(400).json(errorResponse('Invalid structured content', validation.errors));
      }
      
      processedStructuredContent = processContent(structured_content);
      
      // Calculate reading time if not provided
      if (!computedReadTime) {
        computedReadTime = calculateReadingTime(processedStructuredContent);
      }
    }

    // Process content images
    let processedContentImages = [];
    if (content_images && Array.isArray(content_images)) {
      processedContentImages = content_images.filter(img => img && img.src);
    }

    const { data: blog, error } = await supabase
      .from('blogs')
      .insert([{
        title,
        slug,
        excerpt,
        content,
        structured_content: processedStructuredContent,
        featured_image_url,
        content_images: processedContentImages,
        author_id: req.user.id,
        author_name: author_name || req.user.name || 'Admin',
        status,
        published_at,
        tags: Array.isArray(tags) ? tags : [],
        read_time_minutes: computedReadTime || 5,
        view_count: 0
      }])
      .select('*')
      .single();

    if (error) throw error;

    res.status(201).json(successResponse('Blog created successfully', {
      ...blog,
      tags: blog.tags || [],
      structured_content: blog.structured_content || [],
      content_images: blog.content_images || []
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
      structured_content,
      featured_image_url,
      content_images,
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
    if (structured_content !== undefined) {
      if (structured_content && Array.isArray(structured_content)) {
        // Validate structured content
        const validation = validateStructuredContent(structured_content);
        if (!validation.isValid) {
          return res.status(400).json(errorResponse('Invalid structured content', validation.errors));
        }
        
        updateData.structured_content = processContent(structured_content);
        
        // Recalculate reading time if structured content is updated
        if (!read_time_minutes) {
          updateData.read_time_minutes = calculateReadingTime(updateData.structured_content);
        }
      } else {
        updateData.structured_content = null;
      }
    }
    if (featured_image_url !== undefined) updateData.featured_image_url = featured_image_url;
    if (content_images !== undefined) {
      updateData.content_images = content_images && Array.isArray(content_images) 
        ? content_images.filter(img => img && img.src)
        : [];
    }
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
      tags: blog.tags || [],
      structured_content: blog.structured_content || [],
      content_images: blog.content_images || []
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

// Create test dummy blog post (for testing purposes)
const createTestBlog = async (req, res) => {
  try {
    const testBlogData = {
      title: "Understanding Child Psychology: A Comprehensive Guide",
      excerpt: "Explore the fascinating world of child psychology with our comprehensive guide covering development stages, common challenges, and effective therapeutic approaches.",
      structured_content: [
        {
          type: 'paragraph',
          content: 'Child psychology is a fascinating field that helps us understand how children develop, learn, and interact with the world around them. This comprehensive guide will walk you through the essential concepts and practical applications of child psychology.'
        },
        {
          type: 'heading',
          level: 2,
          content: 'Key Developmental Stages'
        },
        {
          type: 'paragraph',
          content: 'Understanding child development is crucial for parents, educators, and therapists. Each stage brings unique challenges and opportunities for growth.'
        },
        {
          type: 'numberedList',
          items: [
            'Infancy (0-2 years): Basic trust, sensory development, and motor skills',
            'Early Childhood (2-6 years): Language development, social skills, and independence',
            'Middle Childhood (6-12 years): Academic skills, peer relationships, and self-concept',
            'Adolescence (12-18 years): Identity formation, abstract thinking, and social identity'
          ]
        },
        {
          type: 'heading',
          level: 3,
          content: 'Common Psychological Challenges'
        },
        {
          type: 'paragraph',
          content: 'Children may face various psychological challenges that require understanding and support from caring adults.'
        },
        {
          type: 'bulletList',
          items: [
            'Anxiety disorders and separation anxiety',
            'Attention-deficit/hyperactivity disorder (ADHD)',
            'Autism spectrum disorders',
            'Learning disabilities and academic challenges',
            'Behavioral problems and conduct disorders',
            'Depression and mood disorders',
            'Social skills difficulties'
          ]
        },
        {
          type: 'heading',
          level: 2,
          content: 'Therapeutic Approaches'
        },
        {
          type: 'paragraph',
          content: 'Various evidence-based therapeutic approaches have proven effective in helping children overcome psychological challenges and develop healthy coping mechanisms.'
        },
        {
          type: 'image',
          src: '/uploads/blog/therapy-session.jpg',
          alt: 'Child therapy session with therapist',
          caption: 'A typical child therapy session focuses on creating a safe, supportive environment for emotional expression and growth.'
        },
        {
          type: 'heading',
          level: 3,
          content: 'Cognitive Behavioral Therapy (CBT)'
        },
        {
          type: 'paragraph',
          content: 'CBT helps children identify and change negative thought patterns and behaviors. It\'s particularly effective for anxiety and depression.'
        },
        {
          type: 'quote',
          content: 'Children are not things to be molded, but people to be unfolded.',
          author: 'Jess Lair'
        },
        {
          type: 'heading',
          level: 3,
          content: 'Play Therapy'
        },
        {
          type: 'paragraph',
          content: 'Play therapy uses the natural language of children - play - to help them express feelings, resolve conflicts, and develop problem-solving skills.'
        },
        {
          type: 'image',
          src: '/uploads/blog/play-therapy.jpg',
          alt: 'Children engaging in play therapy activities',
          caption: 'Play therapy allows children to communicate their feelings and experiences through their natural medium of expression.'
        },
        {
          type: 'heading',
          level: 2,
          content: 'Parenting Strategies'
        },
        {
          type: 'paragraph',
          content: 'Effective parenting strategies can significantly impact a child\'s psychological development and well-being.'
        },
        {
          type: 'bulletList',
          items: [
            'Create a safe and nurturing environment',
            'Establish consistent routines and boundaries',
            'Practice active listening and empathy',
            'Encourage emotional expression',
            'Model healthy coping strategies',
            'Celebrate achievements and efforts'
          ]
        },
        {
          type: 'heading',
          level: 3,
          content: 'Building Emotional Intelligence'
        },
        {
          type: 'paragraph',
          content: 'Emotional intelligence is crucial for a child\'s success in life. It involves recognizing, understanding, and managing emotions effectively.'
        },
        {
          type: 'link',
          href: 'https://www.apa.org/topics/emotion/children',
          text: 'Learn more about emotional development in children',
          target: '_blank'
        },
        {
          type: 'heading',
          level: 2,
          content: 'When to Seek Professional Help'
        },
        {
          type: 'paragraph',
          content: 'It\'s important to recognize when a child may benefit from professional psychological support. Early intervention can make a significant difference.'
        },
        {
          type: 'numberedList',
          items: [
            'Persistent behavioral problems that don\'t respond to typical discipline',
            'Significant changes in mood, appetite, or sleep patterns',
            'Difficulty with social interactions or peer relationships',
            'Academic struggles that persist despite support',
            'Signs of anxiety or depression lasting more than a few weeks',
            'Traumatic experiences or significant life changes'
          ]
        },
        {
          type: 'image',
          src: '/uploads/blog/family-counseling.jpg',
          alt: 'Family counseling session with therapist',
          caption: 'Family therapy can be beneficial when addressing child psychological challenges, involving the whole family in the healing process.'
        },
        {
          type: 'heading',
          level: 2,
          content: 'Conclusion'
        },
        {
          type: 'paragraph',
          content: 'Understanding child psychology is essential for supporting children\'s healthy development. By recognizing developmental stages, common challenges, and effective interventions, we can help children thrive and reach their full potential.'
        },
        {
          type: 'paragraph',
          content: 'Remember that every child is unique, and what works for one child may not work for another. Patience, understanding, and professional guidance when needed can make all the difference in a child\'s psychological well-being.'
        }
      ],
      featured_image_url: '/uploads/blog/child-psychology-featured.jpg',
      content_images: [
        {
          src: '/uploads/blog/therapy-session.jpg',
          alt: 'Child therapy session with therapist'
        },
        {
          src: '/uploads/blog/play-therapy.jpg',
          alt: 'Children engaging in play therapy activities'
        },
        {
          src: '/uploads/blog/family-counseling.jpg',
          alt: 'Family counseling session with therapist'
        }
      ],
      author_name: 'Dr. Sarah Johnson',
      status: 'published',
      tags: ['Child Psychology', 'Development', 'Therapy', 'Parenting', 'Mental Health'],
      read_time_minutes: 8
    };

    // Generate slug from title
    let slug = generateSlug(testBlogData.title);
    
    // Check if test blog already exists
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

    const published_at = new Date().toISOString();

    // Process structured content
    const validation = validateStructuredContent(testBlogData.structured_content);
    if (!validation.isValid) {
      return res.status(400).json(errorResponse('Invalid structured content', validation.errors));
    }
    
    const processedStructuredContent = processContent(testBlogData.structured_content);

    // Process content images
    const processedContentImages = testBlogData.content_images.filter(img => img && img.src);

    const { data: blog, error } = await supabase
      .from('blogs')
      .insert([{
        title: testBlogData.title,
        slug: slug,
        excerpt: testBlogData.excerpt,
        content: '', // Empty content since we're using structured content
        structured_content: processedStructuredContent,
        featured_image_url: testBlogData.featured_image_url,
        content_images: processedContentImages,
        author_id: req.user?.id || 'c634c633-6938-4342-8811-e9b365c92bb6', // Use existing admin ID for test
        author_name: testBlogData.author_name,
        status: testBlogData.status,
        published_at: published_at,
        tags: testBlogData.tags,
        read_time_minutes: testBlogData.read_time_minutes,
        view_count: 0
      }])
      .select('*')
      .single();

    if (error) throw error;

    res.status(201).json(successResponse('Test blog created successfully', {
      ...blog,
      tags: blog.tags || [],
      structured_content: blog.structured_content || [],
      content_images: blog.content_images || []
    }));
  } catch (error) {
    console.error('Error creating test blog:', error);
    res.status(500).json(errorResponse('Failed to create test blog', error.message));
  }
};

module.exports = {
  getAllBlogs,
  getBlogBySlug,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
  createTestBlog
};