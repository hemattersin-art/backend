const cron = require('node-cron');
const defaultAvailabilityService = require('../utils/defaultAvailabilityService');

class DailyAvailabilityService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the daily availability service
   * Runs every day at 12:00 AM to add the next day (3 weeks from today)
   */
  start() {
    console.log('🔄 Starting Daily Availability Service...');
    
    // Run every day at 12:00 AM (midnight)
    // Cron format: '0 0 * * *' = minute 0, hour 0, every day, every month, every day of week
    cron.schedule('0 0 * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️  Daily availability update already running, skipping...');
        return;
      }
      
      this.isRunning = true;
      console.log('🕛 Running daily availability update (12:00 AM)...');
      
      try {
        // Step 1: Add next day availability (3 weeks from today)
        const result = await defaultAvailabilityService.addNextDayAvailability();
        if (result.success) {
          console.log(`✅ Daily availability update completed: ${result.message}`);
          console.log(`   - Updated: ${result.updated || 0} psychologists`);
          console.log(`   - Skipped: ${result.skipped || 0} psychologists`);
        } else {
          console.error(`❌ Daily availability update failed: ${result.message}`);
        }
        
        // Step 2: Clean up past availability records
        console.log('\n🧹 Running daily cleanup of past availability records...');
        const cleanupResult = await defaultAvailabilityService.cleanupPastAvailability();
        if (cleanupResult.success) {
          console.log(`✅ Cleanup completed: ${cleanupResult.message}`);
          console.log(`   - Deleted: ${cleanupResult.deleted || 0} past records`);
        } else {
          console.error(`❌ Cleanup failed: ${cleanupResult.message}`);
        }
      } catch (error) {
        console.error('❌ Error in daily availability update:', error);
      } finally {
        this.isRunning = false;
      }
    });

    // Also run immediately on startup (for testing/initial setup)
    setTimeout(() => {
      console.log('🔄 Running initial daily availability check...');
      this.isRunning = true;
      defaultAvailabilityService.addNextDayAvailability()
        .then(result => {
          if (result.success) {
            console.log(`✅ Initial availability check completed: ${result.message}`);
          } else {
            console.log(`⚠️  Initial availability check: ${result.message}`);
          }
        })
        .catch(error => {
          console.error('❌ Error in initial availability check:', error);
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
    console.log('🛑 Stopping Daily Availability Service...');
    this.isRunning = false;
  }
}

module.exports = new DailyAvailabilityService();

