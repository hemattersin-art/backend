const crypto = require('crypto');

class AdvancedBotDetector {
  constructor() {
    this.botPatterns = [
      // Common bot user agents
      /bot/i, /crawler/i, /spider/i, /scraper/i, /crawling/i,
      /curl/i, /wget/i, /python/i, /java/i, /php/i, /perl/i,
      /ruby/i, /go-http/i, /okhttp/i, /apache/i, /nginx/i,
      /headless/i, /phantom/i, /selenium/i, /webdriver/i,
      /chrome-lighthouse/i, /gtmetrix/i, /pingdom/i,
      /uptimerobot/i, /monitor/i, /check/i, /test/i,
      /automation/i, /script/i, /tool/i, /client/i,
      /http/i, /request/i, /fetch/i, /axios/i,
      /postman/i, /insomnia/i, /rest/i, /api/i
    ];

    // Behavioral patterns
    this.suspiciousBehaviors = new Map();
    this.requestPatterns = new Map();
    this.ipReputation = new Map();
    
    // Rate limiting for bot detection
    this.detectionLimits = {
      maxRequestsPerMinute: 30,
      maxRequestsPerHour: 100,
      maxConsecutiveFailures: 5,
      maxSuspiciousPatterns: 3
    };
  }

  // 1. User Agent Analysis
  analyzeUserAgent(userAgent) {
    const score = {
      suspicious: 0,
      reasons: []
    };

    // Check for bot patterns
    this.botPatterns.forEach(pattern => {
      if (pattern.test(userAgent)) {
        score.suspicious += 10;
        score.reasons.push(`Bot pattern detected: ${pattern.source}`);
      }
    });

    // Check for missing or generic user agents
    if (!userAgent || userAgent.length < 10) {
      score.suspicious += 20;
      score.reasons.push('Missing or too short user agent');
    }

    // Check for suspicious user agent characteristics
    if (userAgent.includes('Mozilla') && userAgent.length < 50) {
      score.suspicious += 15;
      score.reasons.push('Suspicious Mozilla user agent');
    }

    // Check for automation tools
    const automationTools = ['selenium', 'webdriver', 'phantom', 'headless', 'chrome-lighthouse'];
    automationTools.forEach(tool => {
      if (userAgent.toLowerCase().includes(tool)) {
        score.suspicious += 25;
        score.reasons.push(`Automation tool detected: ${tool}`);
      }
    });

    return score;
  }

  // 2. Request Pattern Analysis
  analyzeRequestPattern(req) {
    const ip = req.ip;
    const now = Date.now();
    
    if (!this.requestPatterns.has(ip)) {
      this.requestPatterns.set(ip, {
        requests: [],
        patterns: new Set(),
        suspiciousCount: 0
      });
    }

    const ipData = this.requestPatterns.get(ip);
    ipData.requests.push({
      timestamp: now,
      url: req.url,
      method: req.method,
      userAgent: req.headers['user-agent'] || '',
      referer: req.headers.referer || '',
      accept: req.headers.accept || ''
    });

    // Keep only last hour of requests
    ipData.requests = ipData.requests.filter(r => now - r.timestamp < 3600000);

    const score = {
      suspicious: 0,
      reasons: []
    };

    // Check request frequency
    const requestsLastMinute = ipData.requests.filter(r => now - r.timestamp < 60000).length;
    if (requestsLastMinute > this.detectionLimits.maxRequestsPerMinute) {
      score.suspicious += 30;
      score.reasons.push(`High request frequency: ${requestsLastMinute}/min`);
    }

    // Check for repetitive patterns
    const uniqueUrls = new Set(ipData.requests.map(r => r.url));
    if (uniqueUrls.size < 3 && ipData.requests.length > 10) {
      score.suspicious += 20;
      score.reasons.push('Repetitive URL patterns detected');
    }

    // Check for missing headers
    const missingHeaders = [];
    if (!req.headers.accept) missingHeaders.push('Accept');
    if (!req.headers['accept-language']) missingHeaders.push('Accept-Language');
    if (!req.headers['accept-encoding']) missingHeaders.push('Accept-Encoding');
    
    if (missingHeaders.length > 0) {
      score.suspicious += missingHeaders.length * 5;
      score.reasons.push(`Missing headers: ${missingHeaders.join(', ')}`);
    }

    return score;
  }

  // 3. Behavioral Analysis
  analyzeBehavior(req) {
    const ip = req.ip;
    const now = Date.now();
    
    if (!this.suspiciousBehaviors.has(ip)) {
      this.suspiciousBehaviors.set(ip, {
        failedRequests: 0,
        suspiciousActions: 0,
        lastSeen: now,
        behaviorScore: 0
      });
    }

    const behaviorData = this.suspiciousBehaviors.get(ip);
    behaviorData.lastSeen = now;

    const score = {
      suspicious: behaviorData.behaviorScore,
      reasons: []
    };

    // Check for rapid-fire requests
    const timeSinceLastRequest = now - behaviorData.lastSeen;
    if (timeSinceLastRequest < 100) { // Less than 100ms between requests
      behaviorData.behaviorScore += 15;
      score.reasons.push('Rapid-fire requests detected');
    }

    // Check for failed authentication attempts
    if (req.url.includes('/auth') && req.method === 'POST') {
      // This will be updated by auth middleware
      behaviorData.failedRequests++;
      if (behaviorData.failedRequests > this.detectionLimits.maxConsecutiveFailures) {
        behaviorData.behaviorScore += 25;
        score.reasons.push('Multiple failed authentication attempts');
      }
    }

    // Check for suspicious endpoints
    const suspiciousEndpoints = ['/admin', '/api/admin', '/api/superadmin'];
    if (suspiciousEndpoints.some(endpoint => req.url.includes(endpoint))) {
      behaviorData.behaviorScore += 10;
      score.reasons.push('Accessing sensitive endpoints');
    }

    return score;
  }

  // 4. IP Reputation Analysis
  analyzeIPReputation(req) {
    const ip = req.ip;
    
    if (!this.ipReputation.has(ip)) {
      this.ipReputation.set(ip, {
        reputation: 0,
        firstSeen: Date.now(),
        violations: 0,
        isWhitelisted: false,
        isBlacklisted: false
      });
    }

    const ipData = this.ipReputation.get(ip);
    
    const score = {
      suspicious: 0,
      reasons: []
    };

    // Check if IP is blacklisted
    if (ipData.isBlacklisted) {
      score.suspicious += 100;
      score.reasons.push('IP is blacklisted');
    }

    // Check IP reputation based on violations
    if (ipData.violations > 5) {
      score.suspicious += 50;
      score.reasons.push(`High violation count: ${ipData.violations}`);
    }

    // Check for suspicious IP patterns
    if (this.isSuspiciousIP(ip)) {
      score.suspicious += 20;
      score.reasons.push('Suspicious IP pattern');
    }

    return score;
  }

  // 5. Advanced Fingerprinting
  generateFingerprint(req) {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.headers['accept'] || '',
      req.headers['connection'] || '',
      req.headers['upgrade-insecure-requests'] || '',
      req.headers['sec-fetch-site'] || '',
      req.headers['sec-fetch-mode'] || '',
      req.headers['sec-fetch-user'] || '',
      req.headers['sec-fetch-dest'] || ''
    ];

    const fingerprint = crypto
      .createHash('sha256')
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16);

    return fingerprint;
  }

  // 6. Check for suspicious IP patterns
  isSuspiciousIP(ip) {
    // Check for common VPN/proxy ranges (simplified)
    const suspiciousRanges = [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8'
    ];

    // Check for Tor exit nodes (simplified check)
    if (ip.includes('tor') || ip.includes('onion')) {
      return true;
    }

    // Check for known bot IPs (you can expand this)
    const knownBotIPs = [
      // Add known malicious IPs here
    ];

    return knownBotIPs.includes(ip);
  }

  // 7. Comprehensive Bot Detection
  detectBot(req) {
    const detectionResults = {
      isBot: false,
      confidence: 0,
      reasons: [],
      actions: []
    };

    // Run all detection methods
    const userAgentScore = this.analyzeUserAgent(req.headers['user-agent'] || '');
    const patternScore = this.analyzeRequestPattern(req);
    const behaviorScore = this.analyzeBehavior(req);
    const ipScore = this.analyzeIPReputation(req);

    // Calculate total confidence
    detectionResults.confidence = Math.min(
      userAgentScore.suspicious + 
      patternScore.suspicious + 
      behaviorScore.suspicious + 
      ipScore.suspicious, 
      100
    );

    // Collect all reasons
    detectionResults.reasons = [
      ...userAgentScore.reasons,
      ...patternScore.reasons,
      ...behaviorScore.reasons,
      ...ipScore.reasons
    ];

    // Determine if it's a bot
    if (detectionResults.confidence > 50) {
      detectionResults.isBot = true;
      detectionResults.actions.push('BLOCK_REQUEST');
    } else if (detectionResults.confidence > 30) {
      detectionResults.isBot = true;
      detectionResults.actions.push('SLOW_DOWN');
    } else if (detectionResults.confidence > 15) {
      detectionResults.actions.push('MONITOR_CLOSELY');
    }

    // Add fingerprint for tracking
    detectionResults.fingerprint = this.generateFingerprint(req);

    return detectionResults;
  }

  // 8. Update IP reputation
  updateIPReputation(ip, violation) {
    if (!this.ipReputation.has(ip)) {
      this.ipReputation.set(ip, {
        reputation: 0,
        firstSeen: Date.now(),
        violations: 0,
        isWhitelisted: false,
        isBlacklisted: false
      });
    }

    const ipData = this.ipReputation.get(ip);
    
    if (violation) {
      ipData.violations++;
      ipData.reputation -= 10;
      
      if (ipData.violations > 10) {
        ipData.isBlacklisted = true;
      }
    } else {
      ipData.reputation += 1;
    }
  }

  // 9. Cleanup old data
  cleanup() {
    const now = Date.now();
    const oneHour = 3600000;
    const oneDay = 86400000;

    // Clean old request patterns
    for (const [ip, data] of this.requestPatterns.entries()) {
      data.requests = data.requests.filter(r => now - r.timestamp < oneHour);
      if (data.requests.length === 0) {
        this.requestPatterns.delete(ip);
      }
    }

    // Clean old behavior data
    for (const [ip, data] of this.suspiciousBehaviors.entries()) {
      if (now - data.lastSeen > oneDay) {
        this.suspiciousBehaviors.delete(ip);
      }
    }

    // Clean old IP reputation data
    for (const [ip, data] of this.ipReputation.entries()) {
      if (now - data.firstSeen > oneDay && data.violations === 0) {
        this.ipReputation.delete(ip);
      }
    }
  }

  // 10. Get detection statistics
  getStats() {
    return {
      totalIPs: this.requestPatterns.size,
      suspiciousIPs: Array.from(this.suspiciousBehaviors.entries())
        .filter(([ip, data]) => data.behaviorScore > 20).length,
      blacklistedIPs: Array.from(this.ipReputation.entries())
        .filter(([ip, data]) => data.isBlacklisted).length,
      whitelistedIPs: Array.from(this.ipReputation.entries())
        .filter(([ip, data]) => data.isWhitelisted).length
    };
  }
}

// Create singleton instance
const botDetector = new AdvancedBotDetector();

// Cleanup every hour
setInterval(() => {
  botDetector.cleanup();
}, 3600000);

module.exports = botDetector;
