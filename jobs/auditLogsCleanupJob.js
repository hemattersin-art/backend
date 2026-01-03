/**
 * Audit Logs Cleanup Job
 * 
 * Automatically deletes audit logs older than 1 week.
 * Runs weekly to keep the database clean.
 * 
 * This job:
 * - Deletes logs older than 7 days
 * - Runs weekly (every 7 days)
 * - Logs cleanup statistics
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Run cleanup job
 * 
 * Deletes audit logs older than 1 week (7 days)
 * 
 * @returns {Promise<Object>} { success: boolean, deleted: number, error?: string }
 */
const runAuditLogsCleanup = async () => {
  try {
    console.log('🧹 Starting audit logs cleanup job...');
    const startTime = Date.now();

    // Calculate cutoff date (7 days ago)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const cutoffDate = oneWeekAgo.toISOString();

    // First, count how many logs will be deleted
    const { count, error: countError } = await supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .lt('timestamp', cutoffDate);

    if (countError) {
      console.error('❌ Error counting audit logs:', countError);
      return {
        success: false,
        deleted: 0,
        error: countError.message
      };
    }

    const logsToDelete = count || 0;

    if (logsToDelete === 0) {
      console.log('✅ No audit logs to clean up (all logs are within 1 week)');
      return {
        success: true,
        deleted: 0
      };
    }

    console.log(`📋 Found ${logsToDelete} audit log(s) older than 1 week`);

    // Delete logs older than 1 week
    const { error: deleteError } = await supabaseAdmin
      .from('audit_logs')
      .delete()
      .lt('timestamp', cutoffDate);

    if (deleteError) {
      console.error('❌ Error deleting audit logs:', deleteError);
      return {
        success: false,
        deleted: 0,
        error: deleteError.message
      };
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Audit logs cleanup completed: Deleted ${logsToDelete} log(s) (${duration}ms)`);

    return {
      success: true,
      deleted: logsToDelete,
      duration
    };
  } catch (error) {
    console.error('❌ Exception in audit logs cleanup job:', error);
    return {
      success: false,
      deleted: 0,
      error: error.message
    };
  }
};

/**
 * Start cleanup job scheduler
 * 
 * Runs cleanup job weekly (every 7 days)
 * 
 * @param {number} intervalDays - Interval in days (default: 7)
 */
const startAuditLogsCleanupScheduler = (intervalDays = 7) => {
  console.log(`⏰ Starting audit logs cleanup scheduler (every ${intervalDays} days)`);

  // Run immediately on start
  runAuditLogsCleanup().catch(err => {
    console.error('❌ Error in initial audit logs cleanup run:', err);
  });

  // Schedule recurring runs (weekly)
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  setInterval(() => {
    runAuditLogsCleanup().catch(err => {
      console.error('❌ Error in scheduled audit logs cleanup:', err);
    });
  }, intervalMs);
};

module.exports = {
  runAuditLogsCleanup,
  startAuditLogsCleanupScheduler
};

