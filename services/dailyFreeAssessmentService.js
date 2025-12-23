const cron = require('node-cron');
const freeAssessmentAvailabilityService = require('../utils/freeAssessmentAvailabilityService');

class DailyFreeAssessmentService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the daily free assessment availability service
   * Runs every day at 12:00 AM to add the next day (3 weeks from today)
   */
  start() {
    console.log('🔄 Starting Daily Free Assessment Availability Service...');
    
    // Run every day at 12:00 AM (midnight)
    // Cron format: '0 0 * * *' = minute 0, hour 0, every day, every month, every day of week
    cron.schedule('0 0 * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️  Daily free assessment availability update already running, skipping...');
        return;
      }
      
      this.isRunning = true;
      console.log('🕛 Running daily free assessment availability update (12:00 AM)...');
      
      try {
        // Step 1: Add next day availability (3 weeks from today)
        const result = await freeAssessmentAvailabilityService.addNextDayAvailability();
        if (result.success) {
          console.log(`✅ Daily free assessment availability update completed: ${result.message}`);
          console.log(`   - Updated: ${result.updated || 0} date configs`);
          console.log(`   - Skipped: ${result.skipped || 0} date configs`);
        } else {
          console.error(`❌ Daily free assessment availability update failed: ${result.message}`);
        }
        
        // Step 2: Clean up past date config records
        console.log('\n🧹 Running daily cleanup of past free assessment date configs...');
        const cleanupResult = await freeAssessmentAvailabilityService.cleanupPastAvailability();
        if (cleanupResult.success) {
          console.log(`✅ Cleanup completed: ${cleanupResult.message}`);
          console.log(`   - Deleted: ${cleanupResult.deleted || 0} past records`);
        } else {
          console.error(`❌ Cleanup failed: ${cleanupResult.message}`);
        }
      } catch (error) {
        console.error('❌ Error in daily free assessment availability update:', error);
      } finally {
        this.isRunning = false;
      }
    });

    // Also run immediately on startup (for testing/initial setup)
    setTimeout(() => {
      console.log('🔄 Running initial free assessment availability check...');
      this.isRunning = true;
      freeAssessmentAvailabilityService.addNextDayAvailability()
        .then(result => {
          if (result.success) {
            console.log(`✅ Initial free assessment availability check completed: ${result.message}`);
          } else {
            console.log(`⚠️  Initial free assessment availability check: ${result.message}`);
          }
        })
        .catch(error => {
          console.error('❌ Error in initial free assessment availability check:', error);
        })
        .finally(() => {
          this.isRunning = false;
        });
    }, 10000); // Wait 10 seconds after startup
  }

  /**
   * Stop the service (for testing or graceful shutdown)
   */
  stop() {
    console.log('🛑 Stopping Daily Free Assessment Availability Service...');
    this.isRunning = false;
  }
}

module.exports = new DailyFreeAssessmentService();






















