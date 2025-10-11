const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role key for admin operations
);

const BLOG_IMAGES_BUCKET = 'blog-images';

/**
 * Upload image to blog images bucket
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Unique file name
 * @param {string} mimeType - File MIME type
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function uploadBlogImage(fileBuffer, fileName, mimeType) {
  try {
    const { data, error } = await supabase.storage
      .from(BLOG_IMAGES_BUCKET)
      .upload(fileName, fileBuffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false // Don't overwrite existing files
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data };
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete image from blog images bucket
 * @param {string} filePath - File path in bucket
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteBlogImage(filePath) {
  try {
    const { error } = await supabase.storage
      .from(BLOG_IMAGES_BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('Supabase delete error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get public URL for blog image
 * @param {this} filePath - File path in bucket
 * @returns {string} Public URL
 */
function getBlogImageUrl(filePath) {
  if (!filePath) return null;
  
  const { data } = supabase.storage
    .from(BLOG_IMAGES_BUCKET)
    .getPublicUrl(filePath);
    
  return data.publicUrl;
}

/**
 * Generate unique filename for blog image
 * @param {string} originalName - Original filename
 * @param {string} blogTitle - Blog title for context
 * @returns {string} Unique filename
 */
function generateUniqueFileName(originalName, blogTitle) {
  const timestamp = Date.now();
  const extension = originalName.split('.').pop().toLowerCase();
  const slug = blogTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 30); // Limit length
    
  return `blog-${slug}-${timestamp}.${extension}`;
}

/**
 * Validate image file
 * @param {object} file - File object
 * @returns {{valid: boolean, error?: string}}
 */
function validateImageFile(file) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!allowedTypes.includes(file.mimetype)) {
    return { valid: false, error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed' };
  }

  if (file.size > maxSize) {
    return { valid: false, error: 'File too large. Maximum size is 5MB' };
  }

  return { valid: true };
}

module.exports = {
  uploadBlogImage,
  deleteBlogImage,
  getBlogImageUrl,
  generateUniqueFileName,
  validateImageFile
};
