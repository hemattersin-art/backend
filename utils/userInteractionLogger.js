const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LOGS_BUCKET = 'logs';

/**
 * User Interaction Logger Service
 * Logs all user interactions to Supabase Storage in organized folders by user name
 */
class UserInteractionLogger {
  constructor() {
    this.initialized = false;
    this.bucketName = LOGS_BUCKET;
  }

  /**
   * Initialize Supabase Storage client and ensure bucket exists
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Check if bucket exists, create if it doesn't
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      
      if (listError) {
        console.error('❌ Error listing buckets:', listError.message);
        this.initialized = false;
        return;
      }

      const bucketExists = buckets.some(bucket => bucket.name === this.bucketName);

      if (!bucketExists) {
        console.log(`📦 Creating bucket: ${this.bucketName}`);
        const { data, error: createError } = await supabase.storage.createBucket(this.bucketName, {
          public: false, // Private bucket
          fileSizeLimit: 10485760, // 10MB per file
          allowedMimeTypes: ['application/json']
        });

        if (createError) {
          console.error('❌ Error creating bucket:', createError.message);
          console.error('💡 Please create the bucket manually in Supabase Dashboard:');
          console.error(`   1. Go to Storage → Create bucket`);
          console.error(`   2. Name: ${this.bucketName}`);
          console.error(`   3. Make it private`);
          this.initialized = false;
          return;
        }

        console.log(`✅ Created bucket: ${this.bucketName}`);
      } else {
        console.log(`✅ Bucket exists: ${this.bucketName}`);
      }

      this.initialized = true;
      console.log('✅ User Interaction Logger initialized successfully');
    } catch (error) {
      console.error('❌ User Interaction Logger initialization failed:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Get user email from client ID or user ID
   */
  async getUserEmail(userId, userRole = 'client') {
    try {
      if (userRole === 'client') {
        // Try to get email from clients table
        const { data: client } = await supabase
          .from('clients')
          .select('email, user_id')
          .eq('id', userId)
          .single();

        if (client && client.email) {
          return client.email;
        }

        // If client has user_id, try to get email from users table
        if (client && client.user_id) {
          const { data: user } = await supabase
            .from('users')
            .select('email')
            .eq('id', client.user_id)
            .single();

          if (user && user.email) {
            return user.email;
          }
        }
      } else if (userRole === 'psychologist') {
        const { data: psychologist } = await supabase
          .from('psychologists')
          .select('email')
          .eq('id', userId)
          .single();

        if (psychologist && psychologist.email) {
          return psychologist.email;
        }
      } else {
        // For admin/superadmin, get from users table
        const { data: user } = await supabase
          .from('users')
          .select('email')
          .eq('id', userId)
          .single();

        if (user && user.email) {
          return user.email;
        }
      }

      // Fallback to user ID
      return `user_${userId}`;
    } catch (error) {
      console.error('Error getting user email:', error.message);
      return `user_${userId}`;
    }
  }

  /**
   * Get file path in bucket (logs folder structure)
   * File names start with user email
   */
  getFilePath(userEmail, action, status, dateStr) {
    // Sanitize email for filename: replace @ with _at_, remove invalid chars
    const sanitizedEmail = userEmail
      .replace('@', '_at_')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .toLowerCase()
      .trim();
    const fileName = `${sanitizedEmail}_${dateStr}_${action}_${status}.json`;
    // Store in logs/ folder
    return `logs/${fileName}`;
  }

  /**
   * Find existing log file in Supabase Storage
   */
  async findExistingLogFile(filePath) {
    try {
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .list('logs', {
          search: filePath.split('/').pop()
        });

      if (error) {
        return null;
      }

      // Check if exact file exists
      const fileName = filePath.split('/').pop();
      const existingFile = data.find(file => file.name === fileName);
      
      return existingFile ? filePath : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Log user interaction to Supabase Storage
   */
  async logInteraction({
    userId,
    userRole = 'client',
    action,
    status, // 'success' or 'failure'
    details = {},
    error = null
  }) {
    // Don't block if logging fails
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.initialized) {
        console.warn('⚠️ User Interaction Logger not initialized, skipping log');
        return;
      }

      // Get user email
      const userEmail = await this.getUserEmail(userId, userRole);

      // Create log entry
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        userEmail,
        userId,
        userRole,
        action,
        status,
        details,
        error: error ? {
          message: error.message,
          stack: error.stack,
          code: error.code
        } : null
      };

      // Create log file name starting with user email
      const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const filePath = this.getFilePath(userEmail, action, status, dateStr);

      // Check if file exists (append to it) or create new
      const existingFilePath = await this.findExistingLogFile(filePath);
      
      if (existingFilePath) {
        // Read existing file, append new log, write back
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(this.bucketName)
          .download(existingFilePath);

        if (downloadError) {
          console.error('❌ Error downloading existing log file:', downloadError.message);
          // Create new file instead
        } else {
          try {
            const fileText = await fileData.text();
            let logs = [];
            try {
              logs = JSON.parse(fileText);
              if (!Array.isArray(logs)) {
                logs = [logs];
              }
            } catch (e) {
              logs = [];
            }

            logs.push(logEntry);

            // Update file
            const { error: uploadError } = await supabase.storage
              .from(this.bucketName)
              .update(existingFilePath, JSON.stringify(logs, null, 2), {
                contentType: 'application/json',
                upsert: true
              });

            if (uploadError) {
              console.error('❌ Error updating log file:', uploadError.message);
            } else {
              console.log(`✅ Logged ${action} (${status}) for user: ${userEmail}`);
            }
            return;
          } catch (parseError) {
            console.error('❌ Error parsing existing log file:', parseError.message);
            // Fall through to create new file
          }
        }
      }

      // Create new file
      const logContent = JSON.stringify([logEntry], null, 2);
      const { error: uploadError } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, logContent, {
          contentType: 'application/json',
          cacheControl: '3600',
          upsert: false // Don't overwrite if exists
        });

      if (uploadError) {
        // If file exists, try updating instead
        if (uploadError.message.includes('already exists') || uploadError.message.includes('duplicate')) {
          const { error: updateError } = await supabase.storage
            .from(this.bucketName)
            .update(filePath, logContent, {
              contentType: 'application/json',
              upsert: true
            });

          if (updateError) {
            console.error('❌ Error creating/updating log file:', updateError.message);
          } else {
            console.log(`✅ Logged ${action} (${status}) for user: ${userEmail}`);
          }
        } else {
          console.error('❌ Error creating log file:', uploadError.message);
        }
      } else {
        console.log(`✅ Logged ${action} (${status}) for user: ${userEmail}`);
      }
    } catch (error) {
      // Don't throw - logging failures shouldn't break the app
      console.error('❌ Error logging user interaction:', error.message);
    }
  }

  /**
   * Log detailed booking flow with comprehensive information
   */
  async logBookingFlow({
    userId,
    userRole = 'client',
    step,
    status,
    data = {},
    error = null
  }) {
    await this.logInteraction({
      userId,
      userRole,
      action: `booking_flow_${step}`,
      status,
      details: {
        step,
        ...data
      },
      error
    });
  }

  /**
   * Log booking interaction
   */
  async logBooking({
    userId,
    userRole = 'client',
    psychologistId,
    packageId,
    scheduledDate,
    scheduledTime,
    price,
    status,
    error = null,
    sessionId = null,
    detailedFlow = null // Optional: include detailed flow data
  }) {
    const details = {
      psychologistId,
      packageId,
      scheduledDate,
      scheduledTime,
      price,
      sessionId
    };

    // If detailed flow data is provided, merge it into details
    if (detailedFlow && typeof detailedFlow === 'object') {
      // Merge all detailed flow data into details
      Object.keys(detailedFlow).forEach(key => {
        details[key] = detailedFlow[key];
      });
    }

    await this.logInteraction({
      userId,
      userRole,
      action: 'booking',
      status,
      details,
      error
    });
  }

  /**
   * Log package interaction
   */
  async logPackageInteraction({
    userId,
    userRole = 'client',
    packageId,
    packageType,
    action, // 'view', 'select', 'purchase'
    status,
    error = null,
    details = {}
  }) {
    await this.logInteraction({
      userId,
      userRole,
      action: `package_${action}`,
      status,
      details: {
        packageId,
        packageType,
        ...details
      },
      error
    });
  }

  /**
   * Log receipt generation/viewing
   */
  async logReceipt({
    userId,
    userRole = 'client',
    paymentId,
    sessionId,
    amount,
    status,
    error = null,
    action = 'view' // 'view', 'generate', 'download'
  }) {
    await this.logInteraction({
      userId,
      userRole,
      action: `receipt_${action}`,
      status,
      details: {
        paymentId,
        sessionId,
        amount
      },
      error
    });
  }

  /**
   * Log reschedule request
   */
  async logReschedule({
    userId,
    userRole = 'client',
    sessionId,
    oldDate,
    oldTime,
    newDate,
    newTime,
    status,
    error = null
  }) {
    await this.logInteraction({
      userId,
      userRole,
      action: 'reschedule',
      status,
      details: {
        sessionId,
        oldDate,
        oldTime,
        newDate,
        newTime
      },
      error
    });
  }

  /**
   * Log message interaction
   */
  async logMessage({
    userId,
    userRole = 'client',
    sessionId,
    action, // 'send', 'view', 'reply'
    status,
    error = null,
    messageId = null
  }) {
    await this.logInteraction({
      userId,
      userRole,
      action: `message_${action}`,
      status,
      details: {
        sessionId,
        messageId
      },
      error
    });
  }
}

const userInteractionLogger = new UserInteractionLogger();
module.exports = userInteractionLogger;
