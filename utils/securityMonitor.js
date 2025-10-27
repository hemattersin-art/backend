const fs = require('fs');
const path = require('path');

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
    
    this.logFile = path.join(__dirname, 'security-logs.json');
    this.loadMetrics();
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

  // Log security events
  logSecurityEvent(event) {
    const logEntry = {
      ...event,
      id: Date.now() + Math.random()
    };

    // Append to log file
    try {
      const logs = this.loadLogs();
      logs.push(logEntry);
      
      // Keep only last 1000 entries
      if (logs.length > 1000) {
        logs.splice(0, logs.length - 1000);
      }
      
      fs.writeFileSync(this.logFile, JSON.stringify(logs, null, 2));
    } catch (error) {
      console.error('Failed to write security log:', error);
    }

    // Console warning for critical events
    if (event.type === 'BLOCKED_REQUEST' || event.type === 'MEMORY_ALERT') {
      console.warn(`🚨 Security Alert: ${event.type} - IP: ${event.ip || 'N/A'}`);
    }
  }

  // Load existing logs
  loadLogs() {
    try {
      if (fs.existsSync(this.logFile)) {
        const data = fs.readFileSync(this.logFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load security logs:', error);
    }
    return [];
  }

  // Load metrics from file
  loadMetrics() {
    try {
      const metricsFile = path.join(__dirname, 'security-metrics.json');
      if (fs.existsSync(metricsFile)) {
        const data = fs.readFileSync(metricsFile, 'utf8');
        const savedMetrics = JSON.parse(data);
        
        // Merge with current metrics
        this.metrics = {
          ...this.metrics,
          ...savedMetrics,
          suspiciousIPs: new Set(savedMetrics.suspiciousIPs || [])
        };
      }
    } catch (error) {
      console.error('Failed to load security metrics:', error);
    }
  }

  // Save metrics to file
  saveMetrics() {
    try {
      const metricsFile = path.join(__dirname, 'security-metrics.json');
      const metricsToSave = {
        ...this.metrics,
        suspiciousIPs: Array.from(this.metrics.suspiciousIPs)
      };
      
      fs.writeFileSync(metricsFile, JSON.stringify(metricsToSave, null, 2));
    } catch (error) {
      console.error('Failed to save security metrics:', error);
    }
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

  // Get recent security events
  getRecentEvents(limit = 50) {
    const logs = this.loadLogs();
    return logs.slice(-limit).reverse();
  }

  // Clean old logs (run periodically)
  cleanOldLogs() {
    try {
      const logs = this.loadLogs();
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const recentLogs = logs.filter(log => 
        new Date(log.timestamp) > oneWeekAgo
      );
      
      fs.writeFileSync(this.logFile, JSON.stringify(recentLogs, null, 2));
      console.log(`🧹 Cleaned security logs. Kept ${recentLogs.length} recent entries.`);
    } catch (error) {
      console.error('Failed to clean security logs:', error);
    }
  }
}

// Create singleton instance
const securityMonitor = new SecurityMonitor();

// Save metrics every 5 minutes
setInterval(() => {
  securityMonitor.saveMetrics();
}, 5 * 60 * 1000);

// Clean logs daily
setInterval(() => {
  securityMonitor.cleanOldLogs();
}, 24 * 60 * 60 * 1000);

module.exports = securityMonitor;
