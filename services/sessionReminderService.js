const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const whatsappService = require('../utils/whatsappService');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

class SessionReminderService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the session reminder service
   * Runs every hour to check for sessions 2 hours away
   */
  start() {
    console.log('🔔 Starting Session Reminder Service...');
    
    // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00, etc.)
    cron.schedule('0 * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️  Session reminder check already running, skipping...');
        return;
      }
      
      await this.checkAndSendReminders();
    });

    console.log('✅ Session Reminder Service started (runs every hour)');
    
    // Also run immediately on startup (optional - can remove if not needed)
    setTimeout(() => {
      this.checkAndSendReminders();
    }, 10000); // Wait 10 seconds after startup
  }

  /**
   * Check for sessions 2 hours away and send WhatsApp reminders
   */
  async checkAndSendReminders() {
    this.isRunning = true;
    console.log('🔍 Checking for sessions requiring reminders...');

    try {
      // Get current time and calculate 2 hours from now
      const now = dayjs().tz('Asia/Kolkata');
      const targetTime = now.add(2, 'hours');
      
      console.log(`📅 Current time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
      console.log(`📅 Checking for sessions at: ${targetTime.format('YYYY-MM-DD HH:mm:ss')}`);

      // Query sessions that are:
      // 1. Scheduled in approximately 2 hours (within a 1-hour window)
      // 2. Status is 'booked' or 'rescheduled'
      // 3. Haven't had reminder sent yet (check notifications table)
      
      const targetDate = targetTime.format('YYYY-MM-DD');
      const targetTimeStr = targetTime.format('HH:mm:ss');
      
      // Get sessions scheduled for the target date
      // Use supabaseAdmin to bypass RLS and avoid fetch errors
      const { data: sessions, error: sessionsError } = await supabaseAdmin
        .from('sessions')
        .select(`
          id,
          client_id,
          psychologist_id,
          scheduled_date,
          scheduled_time,
          status,
          google_meet_link,
          client:clients(
            id,
            first_name,
            last_name,
            child_name,
            phone_number,
            email
          ),
          psychologist:psychologists(
            id,
            first_name,
            last_name,
            phone,
            email
          )
        `)
        .eq('scheduled_date', targetDate)
        .in('status', ['booked', 'rescheduled', 'confirmed'])
        .order('scheduled_time', { ascending: true });

      if (sessionsError) {
        console.error('❌ Error fetching sessions:', {
          message: sessionsError.message,
          details: sessionsError.details || sessionsError.toString(),
          hint: sessionsError.hint || '',
          code: sessionsError.code || ''
        });
        this.isRunning = false;
        return;
      }

      if (!sessions || sessions.length === 0) {
        console.log('✅ No sessions found for reminder check');
        this.isRunning = false;
        return;
      }

      console.log(`📋 Found ${sessions.length} sessions for ${targetDate}`);

      // Filter sessions that are approximately 2 hours away (within 1-hour window)
      const reminderSessions = sessions.filter(session => {
        if (!session.scheduled_time) return false;
        
        const sessionTime = dayjs(`${session.scheduled_date} ${session.scheduled_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Kolkata');
        const timeDiff = sessionTime.diff(now, 'hour', true); // Difference in hours (decimal)
        
        // Check if session is between 1.5 and 2.5 hours away (1-hour window)
        return timeDiff >= 1.5 && timeDiff <= 2.5;
      });

      console.log(`🔔 Found ${reminderSessions.length} sessions requiring 2-hour reminders`);

      // Process sessions in batches with parallel processing within each batch
      // This balances speed with API rate limiting
      const BATCH_SIZE = 5; // Process 5 sessions at a time
      const BATCH_DELAY = 1000; // 1 second delay between batches
      
      for (let i = 0; i < reminderSessions.length; i += BATCH_SIZE) {
        const batch = reminderSessions.slice(i, i + BATCH_SIZE);
        
        // Process batch in parallel (up to 5 sessions concurrently)
        await Promise.all(
          batch.map(session => this.sendReminderForSession(session))
        );
        
        // Add delay between batches (except for the last batch)
        if (i + BATCH_SIZE < reminderSessions.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }

      console.log('✅ Session reminder check completed');
      
      // IMPORTANT: Do a final check for any new sessions that were created/rescheduled 
      // during the reminder processing to catch edge cases
      await this.checkForNewSessionsDuringProcessing(now);
    } catch (error) {
      console.error('❌ Error in session reminder check:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Send WhatsApp reminder for a specific session
   */
  async sendReminderForSession(session) {
    try {
      // Check if reminder has already been sent
      const { data: existingNotifications } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('related_id', session.id)
        .eq('type', 'session_reminder_2h')
        .limit(1);

      if (existingNotifications && existingNotifications.length > 0) {
        console.log(`⏭️  Reminder already sent for session ${session.id}, skipping...`);
        return;
      }

      const client = session.client;
      const psychologist = session.psychologist;

      if (!client || !psychologist) {
        console.warn(`⚠️  Missing client or psychologist data for session ${session.id}`);
        return;
      }

      // Format session date and time
      const sessionDateTime = dayjs(`${session.scheduled_date} ${session.scheduled_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Kolkata');
      const formattedDate = sessionDateTime.format('DD MMMM YYYY');
      const formattedTime = sessionDateTime.format('hh:mm A');

      const clientName = client.child_name || `${client.first_name} ${client.last_name}`.trim();
      const psychologistName = `${psychologist.first_name} ${psychologist.last_name}`.trim();

      // Send reminders to both client and psychologist
      // Using Promise.all to send both messages concurrently (faster) but still sequentially per session
      const reminderPromises = [];

      // Send reminder to client
      if (client.phone_number) {
        const clientMessage = `🔔 Reminder: Your therapy session with Dr. ${psychologistName} is scheduled in 2 hours.\n\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n\n` +
          (session.google_meet_link 
            ? `🔗 Join via Google Meet: ${session.google_meet_link}\n\n`
            : '') +
          `Please be ready for your session. We look forward to seeing you!`;

        reminderPromises.push(
          whatsappService.sendWhatsAppTextWithRetry(client.phone_number, clientMessage)
            .then(result => {
              if (result?.success) {
                console.log(`✅ Reminder sent to client for session ${session.id}`);
              } else {
                console.warn(`⚠️  Failed to send reminder to client for session ${session.id}:`, result?.error || result?.reason);
              }
            })
            .catch(err => {
              console.error(`❌ Error sending reminder to client for session ${session.id}:`, err);
            })
        );
      } else {
        console.log(`ℹ️  No phone number for client in session ${session.id}`);
      }

      // Send reminder to psychologist
      if (psychologist.phone) {
        const psychologistMessage = `🔔 Reminder: You have a session with ${clientName} in 2 hours.\n\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n\n` +
          `👤 Client: ${clientName}\n` +
          (session.google_meet_link 
            ? `🔗 Join via Google Meet: ${session.google_meet_link}\n\n`
            : '\n') +
          `Session ID: ${session.id}`;

        reminderPromises.push(
          whatsappService.sendWhatsAppTextWithRetry(psychologist.phone, psychologistMessage)
            .then(result => {
              if (result?.success) {
                console.log(`✅ Reminder sent to psychologist for session ${session.id}`);
              } else {
                console.warn(`⚠️  Failed to send reminder to psychologist for session ${session.id}:`, result?.error || result?.reason);
              }
            })
            .catch(err => {
              console.error(`❌ Error sending reminder to psychologist for session ${session.id}:`, err);
            })
        );
      } else {
        console.log(`ℹ️  No phone number for psychologist in session ${session.id}`);
      }

      // Wait for both messages to complete (or fail) before moving to next session
      await Promise.all(reminderPromises);

      // Create notification record to track that reminder was sent
      await supabaseAdmin
        .from('notifications')
        .insert([
          {
            user_id: client.id,
            user_role: 'client',
            type: 'session_reminder_2h',
            title: 'Session Reminder',
            message: `Your session with Dr. ${psychologistName} is in 2 hours`,
            related_id: session.id,
            is_read: false
          },
          {
            user_id: psychologist.id,
            user_role: 'psychologist',
            type: 'session_reminder_2h',
            title: 'Session Reminder',
            message: `Your session with ${clientName} is in 2 hours`,
            related_id: session.id,
            is_read: false
          }
        ]);

      console.log(`✅ Reminder notifications created for session ${session.id}`);
    } catch (error) {
      console.error(`❌ Error sending reminder for session ${session.id}:`, error);
    }
  }

  /**
   * Check for any new sessions that were created/rescheduled during the reminder processing
   * This catches edge cases where a booking/reschedule happened while reminders were being sent
   */
  async checkForNewSessionsDuringProcessing(originalCheckTime) {
    try {
      const now = dayjs().tz('Asia/Kolkata');
      const targetTime = now.add(12, 'hours');
      const targetDate = targetTime.format('YYYY-MM-DD');
      
      // Query for sessions that are still in the 12-hour window
      // Check for both newly created sessions AND recently rescheduled sessions
      const checkTimeMinus1Min = originalCheckTime.subtract(1, 'minute').toISOString();
      
      // Query for sessions created or updated in the last minute
      // We'll fetch and filter in JavaScript to avoid complex OR query syntax
      // Use supabaseAdmin to bypass RLS
      const { data: allTargetSessions, error: sessionsError } = await supabaseAdmin
        .from('sessions')
        .select(`
          id,
          client_id,
          psychologist_id,
          scheduled_date,
          scheduled_time,
          status,
          google_meet_link,
          created_at,
          updated_at,
          client:clients(
            id,
            first_name,
            last_name,
            child_name,
            phone_number,
            email
          ),
          psychologist:psychologists(
            id,
            first_name,
            last_name,
            phone,
            email
          )
        `)
        .eq('scheduled_date', targetDate)
        .in('status', ['booked', 'rescheduled', 'confirmed'])
        .order('scheduled_time', { ascending: true });

      if (sessionsError || !allTargetSessions) {
        return;
      }

      // Filter for sessions created or updated after the original check time
      const newSessions = allTargetSessions.filter(session => {
        const created = new Date(session.created_at);
        const updated = new Date(session.updated_at);
        const checkTime = new Date(checkTimeMinus1Min);
        return created >= checkTime || updated >= checkTime;
      });

      if (!newSessions || newSessions.length === 0) {
        return; // No new sessions found
      }

      // Filter for sessions that are 11.5-12.5 hours away
      const newReminderSessions = newSessions.filter(session => {
        if (!session.scheduled_time) return false;
        
        const sessionTime = dayjs(`${session.scheduled_date} ${session.scheduled_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Kolkata');
        const timeDiff = sessionTime.diff(now, 'hour', true);
        
        return timeDiff >= 11.5 && timeDiff <= 12.5;
      });

      if (newReminderSessions.length > 0) {
        console.log(`🔄 Found ${newReminderSessions.length} new session(s) created during reminder processing, sending reminders...`);
        
        // Process new sessions (smaller batch since these are edge cases)
        for (const session of newReminderSessions) {
          await this.sendReminderForSession(session);
        }
        
        console.log('✅ New session reminders sent');
      }
    } catch (error) {
      console.error('❌ Error checking for new sessions during processing:', error);
      // Don't throw - this is a catch-up check, shouldn't break the main flow
    }
  }

  /**
   * Check and send reminder immediately for a specific session (PRIORITY)
   * This is called when a new booking/reschedule happens to give it immediate priority
   * over the batch reminder processing
   * @param {string} sessionId - Session ID to check
   */
  async checkAndSendReminderForSessionId(sessionId) {
    try {
      console.log(`🔔 [PRIORITY] Checking immediate reminder for session ${sessionId}...`);
      
      const now = dayjs().tz('Asia/Kolkata');
      
      // Fetch the specific session with all required data
      // Use supabaseAdmin to bypass RLS
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .select(`
          id,
          client_id,
          psychologist_id,
          scheduled_date,
          scheduled_time,
          status,
          google_meet_link,
          client:clients(
            id,
            first_name,
            last_name,
            child_name,
            phone_number,
            email
          ),
          psychologist:psychologists(
            id,
            first_name,
            last_name,
            phone,
            email
          )
        `)
        .eq('id', sessionId)
        .in('status', ['booked', 'rescheduled', 'confirmed'])
        .single();

      if (sessionError || !session) {
        console.log(`ℹ️  [PRIORITY] Session ${sessionId} not found or not in valid status`);
        return;
      }

      // Check if session is approximately 2 hours away (within 1-hour window)
      if (!session.scheduled_time) {
        console.log(`ℹ️  [PRIORITY] Session ${sessionId} has no scheduled time`);
        return;
      }

      const sessionTime = dayjs(`${session.scheduled_date} ${session.scheduled_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Kolkata');
      const timeDiff = sessionTime.diff(now, 'hour', true);

      // Check if session is between 1.5 and 2.5 hours away
      if (timeDiff >= 1.5 && timeDiff <= 2.5) {
        console.log(`✅ [PRIORITY] Session ${sessionId} is in 2-hour window, sending reminder immediately...`);
        await this.sendReminderForSession(session);
        console.log(`✅ [PRIORITY] Reminder sent immediately for session ${sessionId}`);
      } else {
        console.log(`ℹ️  [PRIORITY] Session ${sessionId} is ${timeDiff.toFixed(2)} hours away (not in 2-hour window)`);
      }
    } catch (error) {
      console.error(`❌ [PRIORITY] Error checking reminder for session ${sessionId}:`, error);
      // Don't throw - this is a priority check, shouldn't break the booking flow
    }
  }

  /**
   * Manually trigger reminder check (for testing/admin use)
   */
  async triggerReminderCheck() {
    console.log('🔔 Manually triggering reminder check...');
    await this.checkAndSendReminders();
  }
}

// Export singleton instance
const sessionReminderService = new SessionReminderService();
module.exports = sessionReminderService;

