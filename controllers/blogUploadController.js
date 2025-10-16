const multer = require('multer');
const storageService = require('../utils/storageService');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  }
});

// Upload blog image
const uploadBlogImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const { blogTitle = 'untitled' } = req.body;
    const fileName = storageService.generateUniqueFileName(req.file.originalname, blogTitle);
    
    const uploadResult = await storageService.uploadBlogImage(
      req.file.buffer, 
      fileName, 
      req.file.mimetype
    );

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload image',
        error: uploadResult.error
      });
    }

    const imageUrl = storageService.getBlogImageUrl(uploadResult.data.path);

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        filePath: uploadResult.data.path,
        imageUrl: imageUrl,
        fileName: fileName,
        size: req.file.size,
        mimeType: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
};

// Upload multiple blog images
const uploadMultipleBlogImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const { blogTitle = 'untitled' } = req.body;
    const uploadResults = [];
    const errors = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      try {
        const fileName = storageService.generateUniqueFileName(file.originalname, `${blogTitle}_${i}`);
        
        const uploadResult = await storageService.uploadBlogImage(
          file.buffer, 
          fileName, 
          file.mimetype
        );

        if (uploadResult.success) {
          const imageUrl = storageService.getBlogImageUrl(uploadResult.data.path);
          uploadResults.push({
            fileName: fileName,
            filePath: uploadResult.data.path,
            imageUrl: imageUrl,
            size: file.size,
            mimeType: file.mimetype
          });
        } else {
          errors.push({
            fileName: file.originalname,
            error: uploadResult.error
          });
        }
      } catch (error) {
        errors.push({
          fileName: file.originalname,
          error: error.message
        });
      }
    }

    res.json({
      success: uploadResults.length > 0,
      message: uploadResults.length > 0 
        ? `${uploadResults.length} images uploaded successfully` 
        : 'Failed to upload images',
      data: {
        uploadedImages: uploadResults,
        errors: errors
      }
    });
  } catch (error) {
    console.error('Error uploading multiple images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images',
      error: error.message
    });
  }
};

module.exports = {
  upload,
  uploadBlogImage,
  uploadMultipleBlogImages
};
