/**
 * Recovery Job
 * 
 * Background job that recovers failed session creations.
 * 
 * This job:
 * - Finds payments that succeeded but sessions weren't created
 * - Retries session creation idempotently
 * - Runs every 5 minutes
 * - Logs all recovery attempts
 */

const { supabaseAdmin } = require('../config/supabase');
const { getSlotLockByOrderId } = require('../services/slotLockService');
const { createSessionFromSlotLock } = require('../services/sessionCreationService');
const userInteractionLogger = require('../utils/userInteractionLogger');

/**
 * Run recovery job
 * 
 * Finds slot locks with PAYMENT_SUCCESS status but no session,
 * and attempts to create the session.
 * 
 * @returns {Promise<Object>} { success: boolean, processed: number, errors: number }
 */
const runRecoveryJob = async () => {
  try {
    // Only log in non-production to reduce log noise
    if (process.env.NODE_ENV !== 'production') {
      console.log('🔄 Starting recovery job...');
    }
    const startTime = Date.now();

    // Find slot locks that have PAYMENT_SUCCESS but no session created
    // Check for locks updated in last 24 hours (to avoid processing very old ones)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: slotLocks, error: findError } = await supabaseAdmin
      .from('slot_locks')
      .select('id, order_id, psychologist_id, client_id, scheduled_date, scheduled_time, status, updated_at')
      .eq('status', 'PAYMENT_SUCCESS')
      .gte('updated_at', twentyFourHoursAgo.toISOString())
      .order('updated_at', { ascending: true })
      .limit(50); // Process max 50 at a time

    if (findError) {
      console.error('❌ Error finding slot locks for recovery:', findError);
      return {
        success: false,
        processed: 0,
        errors: 1,
        error: findError.message
      };
    }

    if (!slotLocks || slotLocks.length === 0) {
      // Only log in non-production to reduce log noise
      if (process.env.NODE_ENV !== 'production') {
        console.log('✅ No slot locks need recovery');
      }
      return {
        success: true,
        processed: 0,
        errors: 0
      };
    }

    console.log(`📋 Found ${slotLocks.length} slot locks needing recovery`);

    let processed = 0;
    let errors = 0;
    const results = [];

    // Process each slot lock
    for (const slotLock of slotLocks) {
      try {
        console.log(`🔄 Processing slot lock: ${slotLock.id} (order: ${slotLock.order_id?.substring(0, 10)}...)`);

        // Verify payment record exists and is successful
        const { data: paymentRecord } = await supabaseAdmin
          .from('payments')
          .select('id, status, session_id')
          .eq('razorpay_order_id', slotLock.order_id)
          .maybeSingle();

        if (!paymentRecord) {
          console.warn(`⚠️ Payment record not found for order: ${slotLock.order_id}`);
          errors++;
          results.push({
            slotLockId: slotLock.id,
            orderId: slotLock.order_id,
            status: 'payment_not_found'
          });
          continue;
        }

        if (paymentRecord.status !== 'success') {
          console.warn(`⚠️ Payment not successful for order: ${slotLock.order_id}`);
          errors++;
          results.push({
            slotLockId: slotLock.id,
            orderId: slotLock.order_id,
            status: 'payment_not_successful'
          });
          continue;
        }

        // Check if session already exists
        if (paymentRecord.session_id) {
          const { data: session } = await supabaseAdmin
            .from('sessions')
            .select('id')
            .eq('id', paymentRecord.session_id)
            .maybeSingle();

          if (session) {
            console.log(`✅ Session already exists: ${session.id}`);
            // Update slot lock status
            const { updateSlotLockStatus } = require('../services/slotLockService');
            await updateSlotLockStatus(slotLock.order_id, 'SESSION_CREATED');
            processed++;
            results.push({
              slotLockId: slotLock.id,
              orderId: slotLock.order_id,
              status: 'session_already_exists',
              sessionId: session.id
            });
            continue;
          }
        }

        // Attempt to create session
        const sessionResult = await createSessionFromSlotLock(slotLock);

        if (sessionResult.success) {
          console.log(`✅ Session created successfully: ${sessionResult.session?.id}`);
          processed++;
          results.push({
            slotLockId: slotLock.id,
            orderId: slotLock.order_id,
            status: 'session_created',
            sessionId: sessionResult.session?.id
          });

          // Log recovery success
          await userInteractionLogger.logInteraction({
            userId: slotLock.client_id,
            userRole: 'client',
            action: 'recovery_job_session_created',
            status: 'success',
            details: {
              slotLockId: slotLock.id,
              orderId: slotLock.order_id?.substring(0, 10) + '...',
              sessionId: sessionResult.session?.id
            }
          });
        } else {
          console.error(`❌ Failed to create session: ${sessionResult.error}`);
          errors++;
          results.push({
            slotLockId: slotLock.id,
            orderId: slotLock.order_id,
            status: 'session_creation_failed',
            error: sessionResult.error
          });

          // Log recovery failure
          await userInteractionLogger.logInteraction({
            userId: slotLock.client_id,
            userRole: 'client',
            action: 'recovery_job_session_failed',
            status: 'failure',
            details: {
              slotLockId: slotLock.id,
              orderId: slotLock.order_id?.substring(0, 10) + '...',
              error: sessionResult.error
            }
          });
        }
      } catch (error) {
        console.error(`❌ Exception processing slot lock ${slotLock.id}:`, error);
        errors++;
        results.push({
          slotLockId: slotLock.id,
          orderId: slotLock.order_id,
          status: 'exception',
          error: error.message
        });
      }
    }

    const duration = Date.now() - startTime;
    // Only log if there's work done or errors, or in non-production
    if (processed > 0 || errors > 0 || process.env.NODE_ENV !== 'production') {
      console.log(`✅ Recovery job completed: ${processed} processed, ${errors} errors (${duration}ms)`);
    }

    return {
      success: true,
      processed,
      errors,
      results,
      duration
    };
  } catch (error) {
    console.error('❌ Exception in recovery job:', error);
    return {
      success: false,
      processed: 0,
      errors: 1,
      error: error.message
    };
  }
};

/**
 * Start recovery job scheduler
 * 
 * Runs recovery job every 5 minutes
 * 
 * @param {number} intervalMinutes - Interval in minutes (default: 5)
 */
const startRecoveryScheduler = (intervalMinutes = 5) => {
  // Only log startup in non-production
  if (process.env.NODE_ENV !== 'production') {
    console.log(`⏰ Starting recovery job scheduler (every ${intervalMinutes} minutes)`);
  }

  // Run immediately on start
  runRecoveryJob().catch(err => {
    console.error('❌ Error in initial recovery job run:', err);
  });

  // Schedule recurring runs
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    runRecoveryJob().catch(err => {
      console.error('❌ Error in scheduled recovery job:', err);
    });
  }, intervalMs);
};

module.exports = {
  runRecoveryJob,
  startRecoveryScheduler
};

