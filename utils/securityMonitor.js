// Lazy load supabaseAdmin to avoid requiring it before dotenv is loaded
let _supabaseAdmin = null;
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = require('../config/supabase').supabaseAdmin;
  }
  return _supabaseAdmin;
}

class SecurityMonitor {
  constructor() {
    this.metrics = {
      requestsBlocked: 0,
      suspiciousIPs: new Set(),
      botDetections: 0,
      memoryAlerts: 0,
      authFailures: 0,
      startTime: new Date()
    };
    
    // Don't load metrics in constructor - wait until dotenv is loaded
    // loadMetrics() will be called after server starts
  }

  // Track blocked requests
  trackBlockedRequest(req, reason) {
    this.metrics.requestsBlocked++;
    this.metrics.suspiciousIPs.add(req.ip);
    
    this.logSecurityEvent({
      type: 'BLOCKED_REQUEST',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      reason: reason,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method
    });
  }

  // Track bot detection
  trackBotDetection(req, userAgent) {
    this.metrics.botDetections++;
    
    this.logSecurityEvent({
      type: 'BOT_DETECTED',
      ip: req.ip,
      userAgent: userAgent,
      timestamp: new Date().toISOString(),
      url: req.url
    });
  }

  // Track memory alerts
  trackMemoryAlert(memoryUsageMB) {
    this.metrics.memoryAlerts++;
    
    this.logSecurityEvent({
      type: 'MEMORY_ALERT',
      memoryUsage: memoryUsageMB,
      timestamp: new Date().toISOString()
    });
  }

  // Track authentication failures
  trackAuthFailure(req, email, reason) {
    this.metrics.authFailures++;
    
    this.logSecurityEvent({
      type: 'AUTH_FAILURE',
      ip: req.ip,
      email: email,
      reason: reason,
      timestamp: new Date().toISOString()
    });
  }

  // Log security events to database
  async logSecurityEvent(event) {
    // Prepare database entry
    const logEntry = {
      event_type: event.type,
      ip_address: event.ip || null,
      user_agent: event.userAgent || null,
      email: event.email || null,
      reason: event.reason || null,
      url: event.url || null,
      method: event.method || null,
      memory_usage_mb: event.memoryUsage || null,
      event_data: {
        // Store any additional event data
        ...(event.userAgent ? { userAgent: event.userAgent } : {}),
        ...(event.url ? { url: event.url } : {}),
        ...(event.method ? { method: event.method } : {})
      },
      timestamp: event.timestamp || new Date().toISOString()
    };

    // Insert into database (non-blocking)
    getSupabaseAdmin()
      .from('security_logs')
      .insert([logEntry])
      .then(({ error }) => {
        if (error) {
          // Table might not exist - this is a critical security issue
          if (error.code === '42P01') { // Table doesn't exist
            console.error('🚨 CRITICAL: security_logs table not found! Run migration: create_security_logs_table.sql');
            console.error('🚨 Security log (console only):', JSON.stringify(event, null, 2));
          } else {
            // Other database errors - log but don't break
            console.error('🚨 Failed to write security log to database:', error);
            console.error('🚨 Security log (console only):', JSON.stringify(event, null, 2));
          }
        } else {
          // Only log in non-production to reduce noise
          if (process.env.NODE_ENV !== 'production') {
            console.log(`🔒 Security log saved: ${event.type} - IP: ${event.ip || 'N/A'}`);
          }
        }
      })
      .catch((err) => {
        console.error('🚨 Exception writing security log:', err);
        console.error('🚨 Security log (console only):', JSON.stringify(event, null, 2));
      });

    // Console warning for critical events
    if (event.type === 'BLOCKED_REQUEST' || event.type === 'MEMORY_ALERT') {
      console.warn(`🚨 Security Alert: ${event.type} - IP: ${event.ip || 'N/A'}`);
    }
  }

  // Load existing logs from database (for backward compatibility)
  async loadLogs(limit = 1000) {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('security_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        if (error.code === '42P01') {
          // Table doesn't exist yet - return empty array
          return [];
        }
        console.error('Failed to load security logs from database:', error);
        return [];
      }

      // Convert database format to old format for backward compatibility
      return (data || []).map(log => ({
        id: log.id,
        type: log.event_type,
        ip: log.ip_address,
        userAgent: log.user_agent,
        email: log.email,
        reason: log.reason,
        url: log.url,
        method: log.method,
        memoryUsage: log.memory_usage_mb,
        timestamp: log.timestamp,
        ...(log.event_data || {})
      }));
    } catch (error) {
      console.error('Failed to load security logs:', error);
      return [];
    }
  }

  // Load metrics from database (aggregate from security_logs)
  async loadMetrics() {
    try {
      // Check if environment variables are loaded
      // If not, skip loading metrics (will retry later)
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Environment variables not loaded yet - this is expected on startup
        // Don't log as error, just return silently
        return;
      }

      // Get metrics from database
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const supabaseAdmin = getSupabaseAdmin();

      // Count blocked requests
      const { count: blockedCount } = await supabaseAdmin
        .from('security_logs')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'BLOCKED_REQUEST')
        .gte('timestamp', oneWeekAgo.toISOString());

      // Count bot detections
      const { count: botCount } = await supabaseAdmin
        .from('security_logs')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'BOT_DETECTED')
        .gte('timestamp', oneWeekAgo.toISOString());

      // Count memory alerts
      const { count: memoryCount } = await supabaseAdmin
        .from('security_logs')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'MEMORY_ALERT')
        .gte('timestamp', oneWeekAgo.toISOString());

      // Count auth failures
      const { count: authCount } = await supabaseAdmin
        .from('security_logs')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'AUTH_FAILURE')
        .gte('timestamp', oneWeekAgo.toISOString());

      // Get unique suspicious IPs
      const { data: ipData } = await supabaseAdmin
        .from('security_logs')
        .select('ip_address')
        .eq('event_type', 'BLOCKED_REQUEST')
        .gte('timestamp', oneWeekAgo.toISOString())
        .not('ip_address', 'is', null);

      const uniqueIPs = new Set((ipData || []).map(log => log.ip_address).filter(Boolean));

      // Update metrics
      this.metrics.requestsBlocked = blockedCount || 0;
      this.metrics.botDetections = botCount || 0;
      this.metrics.memoryAlerts = memoryCount || 0;
      this.metrics.authFailures = authCount || 0;
      this.metrics.suspiciousIPs = uniqueIPs;
    } catch (error) {
      // Only log errors if environment variables are loaded (avoid startup noise)
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Environment is loaded but query failed - this is a real error
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to load security metrics from database:', error.message);
        }
      }
      // Keep default metrics if database query fails
    }
  }

  // Save metrics (no longer needed - metrics are calculated from database)
  saveMetrics() {
    // Metrics are now calculated from database, no need to save separately
    // This method is kept for backward compatibility
  }

  // Get security summary
  getSecuritySummary() {
    const uptime = Date.now() - this.metrics.startTime.getTime();
    const uptimeHours = uptime / (1000 * 60 * 60);
    
    return {
      uptime: `${uptimeHours.toFixed(2)} hours`,
      totalRequestsBlocked: this.metrics.requestsBlocked,
      uniqueSuspiciousIPs: this.metrics.suspiciousIPs.size,
      botDetections: this.metrics.botDetections,
      memoryAlerts: this.metrics.memoryAlerts,
      authFailures: this.metrics.authFailures,
      requestsBlockedPerHour: (this.metrics.requestsBlocked / uptimeHours).toFixed(2),
      suspiciousIPs: Array.from(this.metrics.suspiciousIPs).slice(0, 10) // Top 10
    };
  }

  // Get recent security events from database
  async getRecentEvents(limit = 50) {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('security_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        if (error.code === '42P01') {
          // Table doesn't exist yet
          return [];
        }
        console.error('Failed to get recent security events:', error);
        return [];
      }

      // Convert database format to old format for backward compatibility
      return (data || []).map(log => ({
        id: log.id,
        type: log.event_type,
        ip: log.ip_address,
        userAgent: log.user_agent,
        email: log.email,
        reason: log.reason,
        url: log.url,
        method: log.method,
        memoryUsage: log.memory_usage_mb,
        timestamp: log.timestamp,
        ...(log.event_data || {})
      }));
    } catch (error) {
      console.error('Failed to get recent security events:', error);
      return [];
    }
  }

  // Clean old logs (now handled by cleanup job, kept for backward compatibility)
  async cleanOldLogs() {
    // Cleanup is now handled by securityLogsCleanupJob.js
    // This method is kept for backward compatibility but does nothing
    console.log('ℹ️ Security logs cleanup is now handled by securityLogsCleanupJob.js');
  }
}

// Create singleton instance
const securityMonitor = new SecurityMonitor();

// Don't load metrics immediately - wait for dotenv to load first
// Metrics will be loaded when first needed or by the interval below

// Refresh metrics every 5 minutes (starts after first interval)
// This ensures dotenv is loaded before first call
setTimeout(() => {
  // Initial load after a short delay to ensure dotenv is loaded
  securityMonitor.loadMetrics().catch(err => {
    // Silently fail on first load - it's expected if dotenv isn't loaded yet
    if (process.env.NODE_ENV === 'development') {
      // Only log in development for debugging
    }
  });
  
  // Then set up periodic refresh
  setInterval(() => {
    securityMonitor.loadMetrics().catch(err => {
      // Silently fail - metrics are not critical for operation
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to refresh security metrics:', err);
      }
    });
  }, 5 * 60 * 1000);
}, 1000); // Wait 1 second for dotenv to load

module.exports = securityMonitor;
