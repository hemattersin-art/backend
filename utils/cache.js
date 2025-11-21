// Simple in-memory cache for backend
class SimpleCache {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes
  }

  set(key, value, ttl = this.defaultTTL) {
    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { value, expiresAt });
    
    // Clean up expired entries periodically
    if (this.cache.size > 100) {
      this.cleanup();
    }
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  size() {
    return this.cache.size;
  }
}

// Global cache instance
const globalCache = new SimpleCache();

// Cache middleware for API responses
const withCache = (handler, cacheKey, ttl = 5 * 60 * 1000) => {
  return async (req, res) => {
    // Check cache first
    const cached = globalCache.get(cacheKey);
    if (cached) {
      console.log(`📦 Cache hit for ${cacheKey}`);
      return res.json(cached);
    }

    // Store original res.json
    const originalJson = res.json;
    let responseData = null;

    // Override res.json to capture response
    res.json = function(data) {
      responseData = data;
      return originalJson.call(this, data);
    };

    // Call original handler
    await handler(req, res);

    // Cache the response if successful
    if (responseData && res.statusCode === 200) {
      globalCache.set(cacheKey, responseData, ttl);
      console.log(`💾 Cached response for ${cacheKey}`);
    }
  };
};

module.exports = {
  globalCache,
  withCache,
  SimpleCache
};







































