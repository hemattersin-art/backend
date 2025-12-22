/**
 * Request ID Middleware
 * 
 * Generates unique request ID for correlation and tracking
 * Adds X-Request-ID header to response
 */

const crypto = require('crypto');

const requestIdMiddleware = (req, res, next) => {
  // Generate or use existing request ID
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  
  // Attach to request for use in handlers
  req.requestId = requestId;
  
  // Add to response header
  res.setHeader('X-Request-ID', requestId);
  
  // Add to response locals for logging
  res.locals.requestId = requestId;
  
  next();
};

module.exports = requestIdMiddleware;

