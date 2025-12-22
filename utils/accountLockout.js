/**
 * Account Lockout Service
 * 
 * Tracks failed login attempts and locks accounts after threshold.
 * Prevents brute force attacks.
 */

const { supabaseAdmin } = require('../config/supabase');
const { globalCache } = require('./cache');

class AccountLockoutService {
  constructor() {
    this.maxAttempts = 5; // Lock after 5 failed attempts
    this.lockoutDuration = 30 * 60 * 1000; // 30 minutes
    this.useDatabase = true; // Use database for persistence
    this.useCache = true; // Use cache for fast lookups
  }

  /**
   * Record a failed login attempt
   * @param {string} email - User email
   * @param {string} ip - IP address
   * @returns {Promise<{locked: boolean, attemptsRemaining: number, lockoutUntil: Date|null}>}
   */
  async recordFailedAttempt(email, ip = null) {
    try {
      if (!email) {
        return { locked: false, attemptsRemaining: this.maxAttempts };
      }

      const normalizedEmail = email.toLowerCase().trim();
      const cacheKey = `failed_attempts:${normalizedEmail}`;
      
      // Get current attempts from cache
      let attempts = globalCache.get(cacheKey) || 0;
      attempts += 1;

      // Store in cache
      if (this.useCache) {
        globalCache.set(cacheKey, attempts, this.lockoutDuration);
      }

      // Store in database for persistence
      if (this.useDatabase) {
        try {
          // Check if account is already locked
          const { data: existingLock } = await supabaseAdmin
            .from('account_lockouts')
            .select('*')
            .eq('email', normalizedEmail)
            .gt('locked_until', new Date().toISOString())
            .maybeSingle();

          if (existingLock) {
            // Already locked
            const lockedUntil = new Date(existingLock.locked_until);
            return {
              locked: true,
              attemptsRemaining: 0,
              lockoutUntil: lockedUntil
            };
          }

          // Upsert failed attempt
          const { error: dbError } = await supabaseAdmin
            .from('account_lockouts')
            .upsert({
              email: normalizedEmail,
              failed_attempts: attempts,
              locked_until: attempts >= this.maxAttempts 
                ? new Date(Date.now() + this.lockoutDuration).toISOString()
                : null,
              last_attempt_ip: ip,
              last_attempt_at: new Date().toISOString()
            }, {
              onConflict: 'email'
            });

          if (dbError && dbError.code !== '42P01') { // Ignore table not found
            console.error('❌ Error recording failed attempt:', dbError);
          }
        } catch (dbError) {
          console.error('❌ Database error recording failed attempt:', dbError);
          // Continue with cache-only tracking
        }
      }

      // Check if account should be locked
      if (attempts >= this.maxAttempts) {
        const lockoutUntil = new Date(Date.now() + this.lockoutDuration);
        return {
          locked: true,
          attemptsRemaining: 0,
          lockoutUntil: lockoutUntil
        };
      }

      return {
        locked: false,
        attemptsRemaining: this.maxAttempts - attempts,
        lockoutUntil: null
      };
    } catch (error) {
      console.error('❌ Error recording failed attempt:', error);
      return { locked: false, attemptsRemaining: this.maxAttempts };
    }
  }

  /**
   * Check if account is locked
   * @param {string} email - User email
   * @returns {Promise<{locked: boolean, lockoutUntil: Date|null}>}
   */
  async isAccountLocked(email) {
    try {
      if (!email) {
        return { locked: false, lockoutUntil: null };
      }

      const normalizedEmail = email.toLowerCase().trim();
      const cacheKey = `failed_attempts:${normalizedEmail}`;
      
      // Check cache first
      const attempts = globalCache.get(cacheKey) || 0;
      if (attempts >= this.maxAttempts) {
        // Check database for lockout expiry
        if (this.useDatabase) {
          try {
            const { data: lockout } = await supabaseAdmin
              .from('account_lockouts')
              .select('locked_until')
              .eq('email', normalizedEmail)
              .gt('locked_until', new Date().toISOString())
              .maybeSingle();

            if (lockout) {
              return {
                locked: true,
                lockoutUntil: new Date(lockout.locked_until)
              };
            }
          } catch (dbError) {
            if (dbError.code !== '42P01') { // Ignore table not found
              console.error('❌ Error checking account lockout:', dbError);
            }
          }
        }
        // If no database or expired, check cache
        return {
          locked: true,
          lockoutUntil: new Date(Date.now() + this.lockoutDuration)
        };
      }

      // Check database
      if (this.useDatabase) {
        try {
          const { data: lockout } = await supabaseAdmin
            .from('account_lockouts')
            .select('locked_until')
            .eq('email', normalizedEmail)
            .gt('locked_until', new Date().toISOString())
            .maybeSingle();

          if (lockout) {
            return {
              locked: true,
              lockoutUntil: new Date(lockout.locked_until)
            };
          }
        } catch (dbError) {
          if (dbError.code !== '42P01') {
            console.error('❌ Error checking account lockout:', dbError);
          }
        }
      }

      return { locked: false, lockoutUntil: null };
    } catch (error) {
      console.error('❌ Error checking account lockout:', error);
      return { locked: false, lockoutUntil: null };
    }
  }

  /**
   * Clear failed attempts on successful login
   * @param {string} email - User email
   */
  async clearFailedAttempts(email) {
    try {
      if (!email) {
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const cacheKey = `failed_attempts:${normalizedEmail}`;

      // Clear cache
      if (this.useCache) {
        globalCache.delete(cacheKey);
      }

      // Clear database
      if (this.useDatabase) {
        try {
          await supabaseAdmin
            .from('account_lockouts')
            .delete()
            .eq('email', normalizedEmail);
        } catch (dbError) {
          if (dbError.code !== '42P01') {
            console.error('❌ Error clearing failed attempts:', dbError);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error clearing failed attempts:', error);
    }
  }
}

// Singleton instance
const accountLockoutService = new AccountLockoutService();

module.exports = accountLockoutService;

