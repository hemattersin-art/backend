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

module.exports = {
  upload,
  uploadBlogImage
};
