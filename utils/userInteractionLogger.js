// Use supabaseAdmin from config for consistency and RLS bypass
const { supabaseAdmin } = require('../config/supabase');
// Alias for storage operations (same client, just for clarity)
const supabase = supabaseAdmin;

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
        // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
        const { supabaseAdmin } = require('../config/supabase');
        const { data: client } = await supabaseAdmin
          .from('clients')
          .select('email, user_id')
          .eq('id', userId)
          .single();

        if (client && client.email) {
          return client.email;
        }

        // If client has user_id, try to get email from users table
        if (client && client.user_id) {
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('id', client.user_id)
            .single();

          if (user && user.email) {
            return user.email;
          }
        }
      } else if (userRole === 'psychologist') {
        const { supabaseAdmin } = require('../config/supabase');
        const { data: psychologist } = await supabaseAdmin
          .from('psychologists')
          .select('email')
          .eq('id', userId)
          .single();

        if (psychologist && psychologist.email) {
          return psychologist.email;
        }
      } else {
        // For admin/superadmin, get from users table
        // Use supabaseAdmin to bypass RLS (backend service, proper auth already handled)
        const { supabaseAdmin } = require('../config/supabase');
        const { data: user } = await supabaseAdmin
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
   * Get file path in bucket - NEW STRUCTURE: 1 folder per user, 1 file per user
   * Structure: logs/{user_email}/all_logs.json
   */
  getFilePath(userEmail) {
    // Sanitize email for folder name: replace @ with _at_, remove invalid chars
    const sanitizedEmail = userEmail
      .replace('@', '_at_')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .toLowerCase()
      .trim();
    // One file per user: logs/{user_email}/all_logs.json
    return `logs/${sanitizedEmail}/all_logs.json`;
  }

  /**
   * Find existing log file in Supabase Storage
   */
  async findExistingLogFile(userEmail) {
    try {
      const filePath = this.getFilePath(userEmail);
      const folderPath = filePath.split('/').slice(0, -1).join('/'); // Get folder path
      const fileName = filePath.split('/').pop(); // Get filename
      
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .list(folderPath);

      if (error) {
        // Folder doesn't exist yet
        return null;
      }

      // Check if file exists
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

      // Create detailed log entry with backend-style logging
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        userEmail,
        userId,
        userRole,
        action,
        status,
        details: {
          ...details,
          // Add detailed error information if present
          errorDetails: error ? {
            message: error.message || String(error),
            stack: error.stack,
            code: error.code,
            name: error.name,
            // Include full error object for debugging
            fullError: error
          } : null,
          // Add failure reason if status is failure
          failureReason: status === 'failure' && error 
            ? (error.message || error.reason || String(error))
            : null
        },
        // Keep error at top level for backward compatibility
        error: error ? {
          message: error.message || String(error),
          stack: error.stack,
          code: error.code,
          name: error.name
        } : null
      };

      // Get file path: logs/{user_email}/all_logs.json
      const filePath = this.getFilePath(userEmail);
      const folderPath = filePath.split('/').slice(0, -1).join('/'); // Get folder path

      // Check if file exists (append to it) or create new
      const existingFilePath = await this.findExistingLogFile(userEmail);
      
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

            // Sort logs by timestamp to maintain chronological order
            logs.push(logEntry);
            logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

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
              console.log(`✅ Logged ${action} (${status}) for user: ${userEmail} → ${filePath}`);
            }
            return;
          } catch (parseError) {
            console.error('❌ Error parsing existing log file:', parseError.message);
            // Fall through to create new file
          }
        }
      }

      // Create new file - ensure folder exists first
      try {
        // Try to create folder by uploading a placeholder (Supabase creates folders automatically)
        // But we'll just upload the file directly - Supabase will create the folder structure
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
            // File exists, read it, append, and update
            const { data: fileData, error: downloadError } = await supabase.storage
              .from(this.bucketName)
              .download(filePath);

            if (!downloadError && fileData) {
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
                logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

          const { error: updateError } = await supabase.storage
            .from(this.bucketName)
                  .update(filePath, JSON.stringify(logs, null, 2), {
              contentType: 'application/json',
              upsert: true
            });

          if (updateError) {
                  console.error('❌ Error updating existing log file:', updateError.message);
                } else {
                  console.log(`✅ Logged ${action} (${status}) for user: ${userEmail} → ${filePath}`);
                }
              } catch (parseError) {
                console.error('❌ Error parsing existing log file:', parseError.message);
              }
          } else {
              console.error('❌ Error downloading existing log file:', downloadError?.message);
          }
        } else {
          console.error('❌ Error creating log file:', uploadError.message);
        }
      } else {
          console.log(`✅ Logged ${action} (${status}) for user: ${userEmail} → ${filePath}`);
        }
      } catch (folderError) {
        console.error('❌ Error creating user log folder/file:', folderError.message);
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
