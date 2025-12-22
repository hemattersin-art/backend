/**
 * Audit Middleware
 * 
 * Automatically logs admin actions for security and compliance.
 * This middleware should be applied to admin routes.
 */

const auditLogger = require('../utils/auditLogger');

/**
 * Middleware to log admin actions
 * Extracts action name from route and logs it
 */
const auditAdminAction = (action, resource = 'unknown') => {
  return async (req, res, next) => {
    // Store original res.json to capture response
    const originalJson = res.json;
    let responseData = null;
    let statusCode = 200;

    // Override res.json to capture response
    res.json = function(data) {
      responseData = data;
      statusCode = res.statusCode;
      return originalJson.call(this, data);
    };

    // Call next middleware
    await next();

    // Log the action after response is sent
    // Only log successful actions (2xx status codes)
    if (statusCode >= 200 && statusCode < 300) {
      // Extract resource ID from params or body
      const resourceId = req.params.id || 
                        req.params.userId || 
                        req.params.sessionId || 
                        req.params.paymentId ||
                        req.body?.id ||
                        null;

      await auditLogger.logRequest(
        req,
        action,
        resource,
        resourceId,
        {
          statusCode: statusCode,
          method: req.method,
          // Include relevant request body data (sanitized)
          ...(req.body && Object.keys(req.body).length > 0 ? {
            body: Object.keys(req.body).reduce((acc, key) => {
              // Don't log sensitive data
              if (!['password', 'password_hash', 'token', 'secret'].includes(key.toLowerCase())) {
                acc[key] = req.body[key];
              }
              return acc;
            }, {})
          } : {})
        }
      );
    }
  };
};

module.exports = {
  auditAdminAction
};


