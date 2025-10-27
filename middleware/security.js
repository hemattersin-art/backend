const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const securityMonitor = require('../utils/securityMonitor');
const advancedBotDetector = require('../utils/advancedBotDetector');
const securityNotifications = require('../utils/securityNotifications');

// Advanced Rate Limiting Strategies
const createRateLimiters = () => {
  // 1. General API Rate Limiter (Stricter)
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 50 : 500, // Reduced from 100
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests
    skipSuccessfulRequests: true,
    // Skip failed requests (to avoid penalizing legitimate users)
    skipFailedRequests: false,
    // Custom key generator for better tracking
    keyGenerator: (req) => {
      return `${req.ip}-${req.headers['user-agent']?.slice(0, 50) || 'unknown'}`;
    },
    // Track blocked requests using the new handler approach
    handler: (req, res, next, options) => {
      securityMonitor.trackBlockedRequest(req, 'RATE_LIMIT_EXCEEDED');
      
      // Create security alert for rate limit exceeded
      securityNotifications.createAlert('rate_limit_exceeded', 'high', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
        url: req.url,
        method: req.method,
        limit: options.max,
        windowMs: options.windowMs,
        action: 'BLOCKED'
      });
      
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: '15 minutes'
      });
    }
  });

  // 2. Strict Auth Rate Limiter
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 login attempts per 15 minutes
    message: {
      error: 'Too many authentication attempts',
      message: 'Too many login attempts. Please try again in 15 minutes.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      return `auth-${req.ip}-${req.body?.email || 'unknown'}`;
    }
  });

  // 3. File Upload Rate Limiter
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Only 10 uploads per hour
    message: {
      error: 'Upload limit exceeded',
      message: 'Too many file uploads. Please try again in 1 hour.',
      retryAfter: '1 hour'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true
  });

  // 4. Password Reset Rate Limiter
  const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Only 3 password reset attempts per hour
    message: {
      error: 'Password reset limit exceeded',
      message: 'Too many password reset attempts. Please try again in 1 hour.',
      retryAfter: '1 hour'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      return `password-reset-${req.ip}-${req.body?.email || 'unknown'}`;
    }
  });

  // 5. Email Verification Rate Limiter
  const emailVerificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // Only 3 email verification attempts per 15 minutes
    message: {
      error: 'Email verification limit exceeded',
      message: 'Too many email verification attempts. Please try again in 15 minutes.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      return `email-verify-${req.ip}-${req.body?.email || 'unknown'}`;
    }
  });

  return {
    generalLimiter,
    authLimiter,
    uploadLimiter,
    passwordResetLimiter,
    emailVerificationLimiter
  };
};

// Slow Down Middleware (Progressive Delays)
const createSlowDown = () => {
  return slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 25, // Allow 25 requests per 15 minutes, then start adding delays
    delayMs: (used, req) => {
      const delayAfter = req.slowDown.limit;
      return (used - delayAfter) * 500;
    },
    maxDelayMs: 20000, // Maximum delay of 20 seconds
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      // Use a simple key generator to avoid IPv6 issues
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent']?.slice(0, 50) || 'unknown';
      return `${ip}-${userAgent}`;
    }
  });
};

// Request Size Limiter
const requestSizeLimiter = (req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0');
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (contentLength > maxSize) {
    return res.status(413).json({
      error: 'Request too large',
      message: 'Request size exceeds 5MB limit',
      maxSize: '5MB'
    });
  }

  next();
};

// Memory Usage Monitor
const memoryMonitor = (req, res, next) => {
  const memUsage = process.memoryUsage();
  const memUsageMB = memUsage.heapUsed / 1024 / 1024;

  // Log high memory usage
  if (memUsageMB > 500) { // 500MB threshold
    console.warn(`⚠️ High memory usage: ${memUsageMB.toFixed(2)}MB`);
    securityMonitor.trackMemoryAlert(memUsageMB);
    
    // Create memory alert
    securityNotifications.createAlert('high_memory_usage', 'medium', {
      memoryUsage: memUsageMB,
      threshold: 500,
      action: 'MONITORING'
    });
  }

  // Block requests if memory usage is too high
  if (memUsageMB > 1000) { // 1GB threshold
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      message: 'Server is experiencing high load. Please try again later.',
      retryAfter: '5 minutes'
    });
  }

  next();
};

// Advanced Bot Detection Middleware
const advancedBotDetection = (req, res, next) => {
  try {
    const detectionResult = advancedBotDetector.detectBot(req);
    
    // Log detection result
    console.log(`🤖 Bot Detection for IP ${req.ip}:`, {
      confidence: detectionResult.confidence,
      isBot: detectionResult.isBot,
      reasons: detectionResult.reasons,
      fingerprint: detectionResult.fingerprint
    });

    // Track bot detection
    if (detectionResult.isBot) {
      securityMonitor.trackBotDetection(req, req.headers['user-agent'] || '');
      
      // Update IP reputation
      advancedBotDetector.updateIPReputation(req.ip, true);
    }

    // Handle different confidence levels
    if (detectionResult.confidence > 70) {
      // High confidence bot - block completely
      console.warn(`🚫 BLOCKING HIGH CONFIDENCE BOT: ${req.ip} (${detectionResult.confidence}% confidence)`);
      
      // Create critical security alert
      securityNotifications.createAlert('bot_attack_blocked', 'critical', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
        confidence: detectionResult.confidence,
        reasons: detectionResult.reasons,
        url: req.url,
        method: req.method,
        fingerprint: detectionResult.fingerprint,
        action: 'BLOCKED'
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'Automated requests are not allowed',
        reason: 'Bot detected',
        confidence: detectionResult.confidence
      });
    } else if (detectionResult.confidence > 50) {
      // Medium confidence bot - slow down significantly
      console.warn(`🐌 SLOWING DOWN MEDIUM CONFIDENCE BOT: ${req.ip} (${detectionResult.confidence}% confidence)`);
      
      // Create high severity alert
      securityNotifications.createAlert('bot_attack_slowed', 'high', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
        confidence: detectionResult.confidence,
        reasons: detectionResult.reasons,
        url: req.url,
        method: req.method,
        fingerprint: detectionResult.fingerprint,
        action: 'SLOWED_DOWN_3S'
      });
      
      setTimeout(() => {
        next();
      }, 3000); // 3 second delay
    } else if (detectionResult.confidence > 30) {
      // Low confidence bot - slow down moderately
      console.log(`⏳ SLOWING DOWN LOW CONFIDENCE BOT: ${req.ip} (${detectionResult.confidence}% confidence)`);
      
      // Create medium severity alert
      securityNotifications.createAlert('suspicious_activity', 'medium', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
        confidence: detectionResult.confidence,
        reasons: detectionResult.reasons,
        url: req.url,
        method: req.method,
        fingerprint: detectionResult.fingerprint,
        action: 'SLOWED_DOWN_1S'
      });
      
      setTimeout(() => {
        next();
      }, 1000); // 1 second delay
    } else {
      // Likely human - proceed normally
      next();
    }
  } catch (error) {
    console.error('Bot detection error:', error);
    // If bot detection fails, proceed normally
    next();
  }
};

// IP Whitelist/Blacklist
const ipFilter = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Blacklisted IPs (add known malicious IPs here)
  const blacklistedIPs = [
    // Add malicious IPs here
  ];

  // Whitelisted IPs (add trusted IPs here)
  const whitelistedIPs = [
    '127.0.0.1',
    '::1',
    // Add trusted IPs here
  ];

  if (blacklistedIPs.includes(clientIP)) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address is not allowed to access this service'
    });
  }

  // Whitelisted IPs bypass rate limiting
  if (whitelistedIPs.includes(clientIP)) {
    req.isWhitelisted = true;
  }

  next();
};

// Request Validation Middleware
const requestValidator = (req, res, next) => {
  // Check for suspicious request patterns
  const suspiciousHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip'
  ];

  const hasSuspiciousHeaders = suspiciousHeaders.some(header => 
    req.headers[header] && req.headers[header].includes(',')
  );

  if (hasSuspiciousHeaders) {
    console.warn(`⚠️ Suspicious headers detected from IP: ${req.ip}`);
  }

  // Validate request method
  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
  if (!allowedMethods.includes(req.method)) {
    return res.status(405).json({
      error: 'Method not allowed',
      message: `HTTP method ${req.method} is not allowed`
    });
  }

  next();
};

module.exports = {
  createRateLimiters,
  createSlowDown,
  requestSizeLimiter,
  memoryMonitor,
  advancedBotDetection,
  ipFilter,
  requestValidator
};
