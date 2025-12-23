/**
 * Token Revocation Service
 * 
 * Manages revoked tokens to prevent their use even if they haven't expired.
 * Uses database for persistent storage (survives server restarts).
 * Falls back to in-memory cache if database is unavailable.
 */

const { globalCache } = require('./cache');
const { supabaseAdmin } = require('../config/supabase');
const crypto = require('crypto');

class TokenRevocationService {
  constructor() {
    this.revokedTokens = new Set(); // In-memory set for fast lookups
    this.useDatabase = true; // Use database for persistence
    this.useCache = true; // Use cache as fallback/secondary storage
  }

  /**
   * Hash token for storage (don't store full token for security)
   * @param {string} token - JWT token
   * @returns {string} - SHA-256 hash of token
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Revoke a token (add to blacklist)
   * @param {string} token - JWT token to revoke
   * @param {number} ttl - Time to live in milliseconds (default: token expiry time)
   * @param {string} userId - Optional user ID for tracking
   * @param {string} reason - Optional reason for revocation
   */
  async revokeToken(token, ttl = 30 * 24 * 60 * 60 * 1000, userId = null, reason = 'logout') {
    try {
      if (!token || typeof token !== 'string' || token.length === 0) {
        return { success: false, error: 'Invalid token' };
      }

      const tokenHash = this.hashToken(token);
      const expiresAt = new Date(Date.now() + ttl).toISOString();

      // Add to in-memory set for fast lookups
      this.revokedTokens.add(token);

      // Store in cache as backup
      if (this.useCache) {
        const cacheKey = `revoked_token:${tokenHash}`;
        globalCache.set(cacheKey, true, ttl);
      }

      // Store in database for persistence (survives restarts)
      if (this.useDatabase) {
        try {
          const { error: dbError } = await supabaseAdmin
            .from('revoked_tokens')
            .insert({
              token_hash: tokenHash,
              user_id: userId,
              expires_at: expiresAt,
              reason: reason
            });

          if (dbError) {
            // If table doesn't exist, log warning but continue
            if (dbError.code === '42P01') { // Table doesn't exist
              console.warn('⚠️ revoked_tokens table not found. Run migration: create_revoked_tokens_table.sql');
            } else {
              console.error('❌ Error storing revoked token in database:', dbError);
            }
          }
        } catch (dbError) {
          console.error('❌ Database error revoking token:', dbError);
          // Continue with in-memory/cache revocation
        }
      }

      console.log('🔒 Token revoked:', token.substring(0, 20) + '...');
      return { success: true };
    } catch (error) {
      console.error('❌ Error revoking token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if a token is revoked
   * @param {string} token - JWT token to check
   * @returns {Promise<boolean>} - True if token is revoked
   */
  async isTokenRevoked(token) {
    try {
      if (!token || typeof token !== 'string' || token.length === 0) {
        return false;
      }

      // Check in-memory set first (fastest)
      if (this.revokedTokens.has(token)) {
        return true;
      }

      const tokenHash = this.hashToken(token);

      // Check cache
      if (this.useCache) {
        const cacheKey = `revoked_token:${tokenHash}`;
        const isRevoked = globalCache.get(cacheKey);
        if (isRevoked) {
          // Add back to in-memory set for faster future lookups
          this.revokedTokens.add(token);
          return true;
        }
      }

      // Check database (persistent storage)
      if (this.useDatabase) {
        try {
          const { data, error } = await supabaseAdmin
            .from('revoked_tokens')
            .select('id, expires_at')
            .eq('token_hash', tokenHash)
            .gt('expires_at', new Date().toISOString()) // Only non-expired
            .limit(1)
            .maybeSingle();

          if (error) {
            // If table doesn't exist, fall back to cache/memory
            if (error.code === '42P01') { // Table doesn't exist
              console.warn('⚠️ revoked_tokens table not found. Using cache/memory only.');
              return false;
            }
            
            // Check if it's a timeout/connection error (Cloudflare 522, network issues)
            const errorMessage = error.message || '';
            const isTimeoutError = errorMessage.includes('522') || 
                                  errorMessage.includes('Connection timed out') ||
                                  errorMessage.includes('timeout') ||
                                  errorMessage.includes('ETIMEDOUT') ||
                                  errorMessage.includes('ECONNREFUSED') ||
                                  errorMessage.includes('ENOTFOUND') ||
                                  errorMessage.includes('<!DOCTYPE html>'); // HTML error page (Cloudflare)
            
            if (isTimeoutError) {
              // Network/timeout error - fail-open (allow token) for availability
              // Cache/memory checks above provide protection if available
              console.warn('⚠️ Database timeout checking token revocation (allowing token):', 
                errorMessage.substring(0, 100) + (errorMessage.length > 100 ? '...' : ''));
              return false; // Fail-open: Allow token if database check fails due to timeout
            }
            
            // For other database errors, log cleanly and fail-open
            console.error('❌ Database error checking token revocation (allowing token):', {
              message: error.message?.substring(0, 200) || 'Unknown error',
              code: error.code,
              details: error.details,
              hint: error.hint
            });
            // Fail-open: Allow token if database check fails (cache/memory still provides protection)
            return false;
          }

          if (data) {
            // Token is revoked, add to in-memory set and cache
            this.revokedTokens.add(token);
            if (this.useCache) {
              const expiresAt = new Date(data.expires_at).getTime();
              const ttl = expiresAt - Date.now();
              if (ttl > 0) {
                globalCache.set(`revoked_token:${tokenHash}`, true, ttl);
              }
            }
            return true;
          }
        } catch (dbError) {
          // Check if it's a timeout/connection error
          const errorMessage = dbError.message || String(dbError);
          const isTimeoutError = errorMessage.includes('522') || 
                                errorMessage.includes('Connection timed out') ||
                                errorMessage.includes('timeout') ||
                                errorMessage.includes('ETIMEDOUT') ||
                                errorMessage.includes('ECONNREFUSED') ||
                                errorMessage.includes('ENOTFOUND') ||
                                errorMessage.includes('<!DOCTYPE html>'); // HTML error page (Cloudflare)
          
          if (isTimeoutError) {
            // Network/timeout error - fail-open (allow token) for availability
            console.warn('⚠️ Database timeout checking token revocation (allowing token):', 
              errorMessage.substring(0, 100) + (errorMessage.length > 100 ? '...' : ''));
          } else {
            // Other errors - log cleanly
            console.error('❌ Error checking token revocation in database (allowing token):', 
              errorMessage.substring(0, 200) + (errorMessage.length > 200 ? '...' : ''));
          }
          // Fail-open: Allow token if check fails (cache/memory still provides protection)
          return false;
        }
      }

      return false;
    } catch (error) {
      console.error('❌ Error checking token revocation:', error);
      // Fail secure: reject token on error (security over availability)
      return true;
    }
  }

  /**
   * Revoke all tokens for a user (on password change, account deactivation, etc.)
   * @param {string} userId - User ID whose tokens should be revoked
   * @param {string} reason - Reason for revocation
   * @param {number} ttl - Time to live in milliseconds (default: 30 days)
   */
  async revokeUserTokens(userId, reason = 'deactivation', ttl = 30 * 24 * 60 * 60 * 1000) {
    try {
      if (!userId) {
        return { success: false, error: 'User ID required' };
      }

      const expiresAt = new Date(Date.now() + ttl).toISOString();

      // Store in cache
      if (this.useCache) {
        const cacheKey = `revoked_user:${userId}`;
        globalCache.set(cacheKey, true, ttl);
      }

      // Store in database for persistence
      if (this.useDatabase) {
        try {
          // Upsert (update if exists, insert if not)
          const { error: dbError } = await supabaseAdmin
            .from('revoked_users')
            .upsert({
              user_id: userId,
              expires_at: expiresAt,
              reason: reason
            }, {
              onConflict: 'user_id'
            });

          if (dbError) {
            if (dbError.code === '42P01') { // Table doesn't exist
              console.warn('⚠️ revoked_users table not found. Run migration: create_revoked_tokens_table.sql');
            } else {
              console.error('❌ Error storing revoked user in database:', dbError);
            }
          }
        } catch (dbError) {
          console.error('❌ Database error revoking user tokens:', dbError);
          // Continue with cache revocation
        }
      }

      console.log(`🔒 All tokens revoked for user: ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error revoking user tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if user's tokens are revoked
   * @param {string} userId - User ID to check
   * @returns {Promise<boolean>} - True if user tokens are revoked
   */
  async isUserRevoked(userId) {
    try {
      if (!userId) {
        return false;
      }

      // Check cache first
      if (this.useCache) {
        const cacheKey = `revoked_user:${userId}`;
        const isRevoked = globalCache.get(cacheKey);
        if (isRevoked === true) {
          return true;
        }
      }

      // Check database (persistent storage)
      if (this.useDatabase) {
        try {
          const { data, error } = await supabaseAdmin
            .from('revoked_users')
            .select('id, expires_at')
            .eq('user_id', userId)
            .gt('expires_at', new Date().toISOString()) // Only non-expired
            .limit(1)
            .maybeSingle();

          if (error) {
            if (error.code === '42P01') { // Table doesn't exist
              console.warn('⚠️ revoked_users table not found. User revocation check skipped.');
              return false; // Table doesn't exist, assume not revoked
            }
            // For database errors (not network), log but allow (fail-open for availability)
            console.error('❌ Database error checking user revocation:', {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint
            });
            // Fail-open: Allow request if database check fails (availability over security for this check)
            // The cache check above will still catch revoked users if available
            return false;
          }

          if (data) {
            // User is revoked, update cache
            if (this.useCache) {
              const expiresAt = new Date(data.expires_at).getTime();
              const ttl = expiresAt - Date.now();
              if (ttl > 0) {
                globalCache.set(`revoked_user:${userId}`, true, ttl);
              }
            }
            return true;
          }
        } catch (dbError) {
          // Network/timeout errors - fail-open (allow request) for availability
          // Cache check above provides protection if available
          const isNetworkError = dbError.message?.includes('fetch failed') || 
                                 dbError.message?.includes('timeout') ||
                                 dbError.message?.includes('ECONNREFUSED') ||
                                 dbError.message?.includes('ENOTFOUND') ||
                                 dbError.code === 'ETIMEDOUT' ||
                                 dbError.code === 'ECONNREFUSED';
          
          if (isNetworkError) {
            console.warn('⚠️ Network error checking user revocation (allowing request):', dbError.message);
          } else {
            console.error('❌ Error checking user revocation in database (allowing request):', dbError.message);
          }
          // Fail-open: Allow request if check fails (cache still provides protection)
          return false;
        }
      }

      return false;
    } catch (error) {
      // Outer catch for unexpected errors - fail-open for availability
      // Cache check provides protection if available
      console.error('❌ Unexpected error checking user revocation (allowing request):', error.message);
      return false; // Fail-open: Allow request if check fails
    }
  }

  /**
   * Cleanup old revoked tokens from memory (periodic cleanup)
   */
  cleanup() {
    // In-memory set will grow, but tokens are short-lived
    // For production, consider using Redis with TTL
    // This is a simple cleanup to prevent memory bloat
    if (this.revokedTokens.size > 10000) {
      console.log('🧹 Cleaning up revoked tokens set (size:', this.revokedTokens.size, ')');
      // Keep only last 5000 entries (simple approach)
      // In production, use Redis with automatic TTL
      const tokensArray = Array.from(this.revokedTokens);
      this.revokedTokens = new Set(tokensArray.slice(-5000));
    }
  }
}

// Singleton instance
const tokenRevocationService = new TokenRevocationService();

// Periodic cleanup (every hour)
setInterval(() => {
  tokenRevocationService.cleanup();
}, 60 * 60 * 1000);

module.exports = tokenRevocationService;

