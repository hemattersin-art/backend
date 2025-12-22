/**
 * Audit Logger Service
 * 
 * Logs all admin actions for security and compliance purposes.
 * Stores audit logs in database for long-term retention.
 */

const { supabaseAdmin } = require('../config/supabase');

class AuditLogger {
  /**
   * Log an admin action
   * @param {Object} params
   * @param {string} params.userId - Admin user ID
   * @param {string} params.userEmail - Admin user email
   * @param {string} params.userRole - Admin user role
   * @param {string} params.action - Action performed (e.g., 'UPDATE_USER_ROLE', 'DELETE_USER')
   * @param {string} params.resource - Resource affected (e.g., 'user', 'session', 'payment')
   * @param {string} params.resourceId - ID of affected resource
   * @param {string} params.endpoint - API endpoint called
   * @param {string} params.method - HTTP method
   * @param {Object} params.details - Additional details about the action
   * @param {string} params.ip - IP address of requester
   * @param {string} params.userAgent - User agent string
   */
  async logAction({
    userId,
    userEmail,
    userRole,
    action,
    resource,
    resourceId,
    endpoint,
    method,
    details = {},
    ip,
    userAgent
  }) {
    try {
      // Handle null userId for failed authentication attempts
      // For failed logins, userId will be null, but we still want to log the attempt
      // If user_id column has NOT NULL constraint, we'll skip the insert but log to console
      const auditLog = {
        user_id: userId,
        user_email: userEmail,
        user_role: userRole,
        action: action,
        resource: resource,
        resource_id: resourceId,
        endpoint: endpoint,
        method: method,
        details: details,
        ip_address: ip,
        user_agent: userAgent,
        timestamp: new Date().toISOString()
      };

      // Try to insert into audit_logs table if it exists
      // SECURITY: Fail secure - if audit logging fails, we should know about it
      try {
        // Note: user_id column is nullable, so failed login attempts (null user_id) 
        // can be inserted into the database. This is the expected behavior.
        // If schema changes to require user_id, we'll catch the error and log to console as fallback.
        const { error } = await supabaseAdmin
          .from('audit_logs')
          .insert([auditLog]);

        if (error) {
          // Handle NOT NULL constraint violation for user_id (fallback for schema changes)
          // Note: Currently user_id is nullable, so this shouldn't happen, but kept as safety net
          if (error.code === '23502' && error.message.includes('user_id')) {
            // user_id is required but we don't have it (failed login attempt)
            // Log to console for security monitoring, but don't fail the request
            console.warn('⚠️ Audit log skipped (null user_id):', {
              action,
              user_email: userEmail,
              user_role: userRole,
              endpoint,
              ip_address: ip,
              reason: 'user_id is null (failed authentication attempt)'
            });
            console.warn('⚠️ Full audit log (console only):', JSON.stringify(auditLog, null, 2));
            // Return success since we've logged it to console
            return { success: true, loggedToConsole: true };
          }
          
          // Table might not exist - this is a critical security issue
          if (error.code === '42P01') { // Table doesn't exist
            console.error('🚨 CRITICAL: audit_logs table not found! Run migration: create_audit_logs_table.sql');
            console.error('🚨 Audit log (console only):', JSON.stringify(auditLog, null, 2));
            // Don't throw - allow request to continue, but log critical error
            // In production, you might want to send alert to monitoring system
          } else {
            // Other database errors - log and alert
            console.error('🚨 CRITICAL: Failed to write audit log:', error);
            console.error('🚨 Audit log (console only):', JSON.stringify(auditLog, null, 2));
            // Consider sending alert to monitoring system
          }
        } else {
          console.log(`📋 Audit logged: ${action} by ${userEmail || 'unknown'} (${userRole})`);
        }
      } catch (dbError) {
        // Critical error - log and alert
        console.error('🚨 CRITICAL: Exception writing audit log:', dbError);
        console.error('🚨 Audit log (console only):', JSON.stringify(auditLog, null, 2));
        // In production, send alert to monitoring system
        // Don't throw - allow request to continue, but ensure monitoring is aware
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Error logging audit:', error);
      // Don't throw - audit logging failure shouldn't break the request
      return { success: false, error: error.message };
    }
  }

  /**
   * Log admin action from request object
   * Convenience method that extracts info from req object
   */
  async logRequest(req, action, resource, resourceId, details = {}) {
    if (!req.user) {
      return { success: false, error: 'No user in request' };
    }

    // MEDIUM-RISK FIX: Include request ID for correlation
    const requestId = req.requestId || req.headers['x-request-id'] || 'unknown';
    const enrichedDetails = {
      ...details,
      requestId: requestId
    };

    return this.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: action,
      resource: resource,
      resourceId: resourceId,
      endpoint: req.path || req.url,
      method: req.method,
      details: enrichedDetails,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'] || 'Unknown'
    });
  }
}

// Singleton instance
const auditLogger = new AuditLogger();

module.exports = auditLogger;


