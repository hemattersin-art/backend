/**
 * Session Creation Service
 * 
 * Provides idempotent session creation from slot locks.
 * This service is called by the Razorpay webhook after payment verification.
 * 
 * Key features:
 * - Fully idempotent (can be called multiple times safely)
 * - Prevents double booking with database constraints
 * - Handles race conditions gracefully
 */

const { supabaseAdmin } = require('../config/supabase');
const { updateSlotLockStatus } = require('./slotLockService');
const meetLinkService = require('../utils/meetLinkService');
const emailService = require('../utils/emailService');
const userInteractionLogger = require('../utils/userInteractionLogger');

/**
 * Create session from slot lock (idempotent)
 * 
 * @param {Object} slotLock - Slot lock record
 * @returns {Promise<Object>} { success: boolean, session?: session, error?: string, alreadyExists?: boolean }
 */
const createSessionFromSlotLock = async (slotLock) => {
  try {
    console.log('📅 Creating session from slot lock:', {
      lockId: slotLock.id,
      orderId: slotLock.order_id?.substring(0, 10) + '...',
      status: slotLock.status
    });

    // Check if session already exists for this slot lock
    // We can check by looking for a session with matching details
    const { data: existingSession, error: checkError } = await supabaseAdmin
      .from('sessions')
      .select('id, status, payment_id')
      .eq('psychologist_id', slotLock.psychologist_id)
      .eq('client_id', slotLock.client_id)
      .eq('scheduled_date', slotLock.scheduled_date)
      .eq('scheduled_time', slotLock.scheduled_time)
      .eq('status', 'booked')
      .maybeSingle();

    if (checkError) {
      console.error('❌ Error checking existing session:', checkError);
      return {
        success: false,
        error: 'Failed to check existing session'
      };
    }

    if (existingSession) {
      console.log('✅ Session already exists:', {
        sessionId: existingSession.id,
        paymentId: existingSession.payment_id
      });

      // Update slot lock to SESSION_CREATED if not already
      if (slotLock.status !== 'SESSION_CREATED') {
        await updateSlotLockStatus(slotLock.order_id, 'SESSION_CREATED');
      }

      return {
        success: true,
        session: existingSession,
        alreadyExists: true
      };
    }

    // Get payment record to get amount and other details
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('id, amount, package_id, session_type, razorpay_params')
      .eq('razorpay_order_id', slotLock.order_id)
      .maybeSingle();

    if (paymentError) {
      console.error('❌ Error fetching payment record:', paymentError);
      return {
        success: false,
        error: 'Failed to fetch payment record'
      };
    }

    if (!paymentRecord) {
      console.error('❌ Payment record not found for order:', slotLock.order_id);
      return {
        success: false,
        error: 'Payment record not found'
      };
    }

    // Prepare session data
    const sessionData = {
      client_id: slotLock.client_id,
      psychologist_id: slotLock.psychologist_id,
      scheduled_date: slotLock.scheduled_date,
      scheduled_time: slotLock.scheduled_time,
      status: 'booked',
      price: paymentRecord.amount,
      payment_id: paymentRecord.id
    };

    // Add package_id if available (not individual session)
    if (paymentRecord.package_id && paymentRecord.package_id !== 'null' && paymentRecord.package_id !== 'undefined' && paymentRecord.package_id !== 'individual') {
      sessionData.package_id = paymentRecord.package_id;
    }

    // Set session_type from payment record, or determine from package_id
    if (paymentRecord.session_type) {
      sessionData.session_type = paymentRecord.session_type;
    } else if (paymentRecord.package_id && paymentRecord.package_id !== 'null' && paymentRecord.package_id !== 'undefined' && paymentRecord.package_id !== 'individual') {
      sessionData.session_type = 'Package Session';
    } else {
      sessionData.session_type = 'Individual Session';
    }

    // Try to create session
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      // Check if it's a unique constraint violation (double booking)
      if (sessionError.code === '23505' || sessionError.message?.includes('unique') || sessionError.message?.includes('duplicate')) {
        console.log('⚠️ Double booking detected - slot was just booked by another user');
        
        // Try to fetch the session that was just created
        const { data: conflictingSession } = await supabaseAdmin
          .from('sessions')
          .select('id, client_id, payment_id')
          .eq('psychologist_id', slotLock.psychologist_id)
          .eq('scheduled_date', slotLock.scheduled_date)
          .eq('scheduled_time', slotLock.scheduled_time)
          .eq('status', 'booked')
          .maybeSingle();

        if (conflictingSession) {
          // Check if it's our session (same client)
          if (conflictingSession.client_id === slotLock.client_id) {
            // It's our session, just created by another request (idempotent)
            console.log('✅ Session created by concurrent request (idempotent)');
            await updateSlotLockStatus(slotLock.order_id, 'SESSION_CREATED');
            return {
              success: true,
              session: conflictingSession,
              alreadyExists: true
            };
          } else {
            // Different client - real double booking
            console.error('❌ Real double booking - different client');
            await updateSlotLockStatus(slotLock.order_id, 'FAILED', {
              reason: 'Double booking - slot taken by another user'
            });
            return {
              success: false,
              error: 'This time slot was just booked by another user',
              conflict: true
            };
          }
        }
      }

      console.error('❌ Error creating session:', sessionError);
      return {
        success: false,
        error: 'Failed to create session',
        details: sessionError.message
      };
    }

    console.log('✅ Session created successfully:', {
      sessionId: session.id,
      clientId: session.client_id,
      psychologistId: session.psychologist_id
    });

    // Update payment record with session_id
    const { error: paymentUpdateError } = await supabaseAdmin
      .from('payments')
      .update({ session_id: session.id })
      .eq('id', paymentRecord.id);
    
    if (paymentUpdateError) {
      console.error('❌ Error updating payment record with session_id:', paymentUpdateError);
    } else {
      console.log('✅ Payment record updated with session_id:', session.id);
    }

    // Update slot lock to SESSION_CREATED
    await updateSlotLockStatus(slotLock.order_id, 'SESSION_CREATED');

    // Log booking
    await userInteractionLogger.logBooking({
      userId: slotLock.client_id,
      userRole: 'client',
      psychologistId: slotLock.psychologist_id,
      packageId: paymentRecord.package_id,
      scheduledDate: slotLock.scheduled_date,
      scheduledTime: slotLock.scheduled_time,
      sessionId: session.id,
      paymentId: paymentRecord.id,
      status: 'success'
    });

    // Create Google Meet link and send emails asynchronously (don't wait)
    (async () => {
      try {
        // Fetch client and psychologist details for Meet link, emails, and WhatsApp
        const { data: clientDetails } = await supabaseAdmin
          .from('clients')
          .select(`
            id,
            first_name,
            last_name,
            child_name,
            phone_number,
            user:users(email)
          `)
          .eq('id', slotLock.client_id)
          .single();

        const { data: psychologistDetails } = await supabaseAdmin
          .from('psychologists')
          .select('id, first_name, last_name, email, phone, google_calendar_credentials')
          .eq('id', slotLock.psychologist_id)
          .single();

        if (!clientDetails || !psychologistDetails) {
          console.error('❌ Could not fetch client or psychologist details');
          return;
        }

        // Fetch package details if this is a package session
        let packageInfo = null;
        if (paymentRecord.package_id && paymentRecord.package_id !== 'null' && paymentRecord.package_id !== 'undefined' && paymentRecord.package_id !== 'individual') {
          try {
            const { data: packageData, error: packageError } = await supabaseAdmin
              .from('packages')
              .select('id, package_type, session_count')
              .eq('id', paymentRecord.package_id)
              .single();
            
            if (!packageError && packageData) {
              // Calculate package progress: count completed sessions for this package
              const { data: packageSessions, error: sessionsError } = await supabaseAdmin
                .from('sessions')
                .select('id, status')
                .eq('package_id', paymentRecord.package_id)
                .eq('client_id', slotLock.client_id);
              
              if (!sessionsError && packageSessions) {
                const totalSessions = packageData.session_count || 0;
                const completedSessions = packageSessions.filter(s => s.status === 'completed').length;
                const remainingSessions = Math.max(totalSessions - completedSessions, 0);
                
                packageInfo = {
                  totalSessions: totalSessions,
                  completedSessions: completedSessions,
                  remainingSessions: remainingSessions,
                  packageType: packageData.package_type || 'Package'
                };
                
                console.log('📦 Package info:', packageInfo);
              }
            }
          } catch (packageErr) {
            console.warn('⚠️ Error fetching package details:', packageErr);
          }
        }

        // Calculate end time (50 minutes for therapy session)
        const { addMinutesToTime } = require('../utils/helpers');
        const endTime = addMinutesToTime(slotLock.scheduled_time, 50);

        // Create Google Meet link
        // Handle client name: prefer child_name, but skip if it's "Pending" or empty
        let clientName = clientDetails.child_name;
        if (!clientName || clientName.trim() === '' || clientName.toLowerCase() === 'pending') {
          // Fall back to first_name + last_name
          const firstName = clientDetails.first_name || '';
          const lastName = clientDetails.last_name || '';
          clientName = `${firstName} ${lastName}`.trim();
          // If still empty, use a default
          if (!clientName) {
            clientName = 'Client';
          }
        }
        const psychologistName = `${psychologistDetails.first_name} ${psychologistDetails.last_name}`;
        
        const meetSessionData = {
          summary: `Therapy Session - ${clientName} with ${psychologistDetails.first_name}`,
          description: `Online therapy session between ${clientName} and ${psychologistName}`,
          startDate: slotLock.scheduled_date,
          startTime: slotLock.scheduled_time,
          endTime: endTime,
          clientEmail: clientDetails.user?.email,
          psychologistEmail: psychologistDetails.email
        };

        // Get psychologist OAuth tokens if available
        let userAuth = null;
        if (psychologistDetails.google_calendar_credentials) {
          const credentials = psychologistDetails.google_calendar_credentials;
          userAuth = {
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token,
            expiry_date: credentials.expiry_date
          };
        }

        const meetResult = await meetLinkService.generateSessionMeetLink(meetSessionData, userAuth);

        if (meetResult.success && meetResult.meetLink) {
          const { error: updateError } = await supabaseAdmin
            .from('sessions')
            .update({ 
              google_meet_link: meetResult.meetLink,
              google_meet_join_url: meetResult.meetLink,
              google_meet_start_url: meetResult.meetLink,
              google_calendar_event_id: meetResult.eventId || null
            })
            .eq('id', session.id);
          
          if (updateError) {
            console.error('❌ Error updating session with meet link:', updateError);
          } else {
            // Log which method was used to create the Meet link
            const method = meetResult.method || 'unknown';
            const isRealLink = method !== 'fallback' && meetResult.meetLink && !meetResult.meetLink.includes('meet.google.com/new');
            const methodDescription = {
              'oauth': '✅ Real Meet link created via OAuth (psychologist calendar)',
              'oauth_calendar': '✅ Real Meet link created via OAuth (psychologist calendar)',
              'calendar_service_account': '✅ Real Meet link created via Service Account (shared calendar)',
              'service_account_limitation': '⚠️ Service account limitation - Meet link may require manual creation',
              'calendar_error': '❌ Calendar API error - using fallback',
              'fallback': '⚠️ Fallback Meet link (manual creation may be required)',
              'unknown': '❓ Meet link created (method unknown)'
            };
            
            console.log('✅ Meet link created and saved to session:', {
              meetLink: meetResult.meetLink,
              method: method,
              isRealLink: isRealLink,
              description: methodDescription[method] || methodDescription['unknown'],
              eventId: meetResult.eventId || null,
              eventLink: meetResult.eventLink || null,
              hasOAuth: !!userAuth,
              hasPsychologistCredentials: !!psychologistDetails.google_calendar_credentials,
              error: meetResult.error || null
            });
          }
        } else {
          console.warn('⚠️ Meet link creation failed or returned fallback:', {
            error: meetResult.error,
            method: meetResult.method,
            meetLink: meetResult.meetLink
          });
        }

        // Generate receipt before sending emails
        let receiptResult = null;
        try {
          const { generateAndStoreReceipt } = require('../controllers/paymentController');
          
          // Fetch full payment record with transaction_id and package_id
          const { data: fullPaymentRecord } = await supabaseAdmin
            .from('payments')
            .select('id, amount, transaction_id, completed_at, razorpay_payment_id, package_id')
            .eq('id', paymentRecord.id)
            .single();
          
          console.log('🔍 sessionCreationService - Payment data for receipt:', {
            payment_id: fullPaymentRecord?.id,
            package_id: fullPaymentRecord?.package_id
          });
          
          receiptResult = await generateAndStoreReceipt(
            session,
            { 
              ...fullPaymentRecord, 
              completed_at: fullPaymentRecord?.completed_at || new Date().toISOString() 
            },
            clientDetails,
            psychologistDetails
          );
          
          if (receiptResult && receiptResult.receiptNumber) {
            console.log('✅ Receipt generated successfully:', {
              receiptNumber: receiptResult.receiptNumber,
              pdfGenerated: !!receiptResult.pdfBuffer,
              pdfSize: receiptResult.pdfBuffer?.length || 0
            });
          }
        } catch (receiptError) {
          console.error('❌ Error generating receipt:', receiptError);
          // Continue even if receipt generation fails
        }

        // Send confirmation emails with receipt
        try {
          // Use client_name from receiptDetails if available (first_name + last_name), otherwise use computed clientName
          const emailClientName = receiptResult?.receiptDetails?.client_name || clientName;
          
          const emailResult = await emailService.sendSessionConfirmation({
            clientName: emailClientName,
            psychologistName: psychologistName,
            clientEmail: clientDetails.user?.email,
            psychologistEmail: psychologistDetails.email,
            scheduledDate: slotLock.scheduled_date,
            scheduledTime: slotLock.scheduled_time,
            sessionDate: slotLock.scheduled_date,
            sessionTime: slotLock.scheduled_time,
            googleMeetLink: meetResult.meetLink,
            meetLink: meetResult.meetLink,
            sessionId: session.id,
            price: paymentRecord.amount,
            amount: paymentRecord.amount,
            status: session.status || 'booked',
            psychologistId: slotLock.psychologist_id,
            clientId: slotLock.client_id,
            packageInfo: packageInfo, // Include package details
            receiptId: receiptResult?.receiptId || null, // Pass receipt ID for reference
            receiptNumber: receiptResult?.receiptNumber || null,
            receiptPdfBuffer: receiptResult?.pdfBuffer || null // Pass PDF buffer to attach to email
          });
          
          if (emailResult) {
            console.log('✅ Confirmation emails sent successfully');
          } else {
            console.warn('⚠️ Email sending returned false - check email service logs');
          }
        } catch (emailError) {
          console.error('❌ Error sending confirmation emails:', emailError);
          // Continue - don't block the process
        }

        // Send WhatsApp notifications to both client and psychologist
        try {
          console.log('📱 Sending WhatsApp notifications...');
          const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
          
          // Send WhatsApp to client
          const clientPhone = clientDetails.phone_number || null;
          if (clientPhone && meetResult.meetLink) {
            // Only include childName if child_name exists and is not empty/null/'Pending'
            const childName = clientDetails.child_name && 
              clientDetails.child_name.trim() !== '' && 
              clientDetails.child_name.toLowerCase() !== 'pending'
              ? clientDetails.child_name 
              : null;
            
            // Get client name from receiptDetails (first_name + last_name) for receipt filename
            const receiptClientName = receiptResult?.receiptDetails?.client_name || 
                                      `${clientDetails.first_name || ''} ${clientDetails.last_name || ''}`.trim() || null;
            
            const clientDetails_wa = {
              childName: childName,
              date: slotLock.scheduled_date,
              time: slotLock.scheduled_time,
              meetLink: meetResult.meetLink,
              psychologistName: psychologistName,
              packageInfo: packageInfo, // Include package details
              receiptPdfBuffer: receiptResult?.pdfBuffer || null,
              receiptNumber: receiptResult?.receiptNumber || null,
              clientName: receiptClientName // Client name (first_name + last_name) for receipt filename
            };
            
            const clientWaResult = await sendBookingConfirmation(clientPhone, clientDetails_wa);
            if (clientWaResult?.success) {
              console.log('✅ WhatsApp confirmation sent to client');
            } else if (clientWaResult?.skipped) {
              console.log('ℹ️ Client WhatsApp skipped:', clientWaResult.reason);
            } else {
              console.warn('⚠️ Client WhatsApp send failed:', clientWaResult?.error || 'Unknown error');
            }
          } else {
            console.log('ℹ️ No client phone or meet link; skipping client WhatsApp');
          }

          // Send WhatsApp to psychologist
          const psychologistPhone = psychologistDetails.phone || null;
          if (psychologistPhone && meetResult.meetLink) {
            let psychologistMessage = `New session booked with ${clientName}.\n\nDate: ${slotLock.scheduled_date}\nTime: ${slotLock.scheduled_time}\n\n`;
            
            // Add package info if it's a package session
            if (packageInfo && packageInfo.totalSessions) {
              psychologistMessage += `📦 Package Session: ${packageInfo.completedSessions || 0}/${packageInfo.totalSessions} completed, ${packageInfo.remainingSessions || 0} remaining\n\n`;
            }
            
            psychologistMessage += `Join via Google Meet: ${meetResult.meetLink}\n\nClient: ${clientName}\nSession ID: ${session.id}`;
            
            const psychologistWaResult = await sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
            if (psychologistWaResult?.success) {
              console.log('✅ WhatsApp notification sent to psychologist');
            } else if (psychologistWaResult?.skipped) {
              console.log('ℹ️ Psychologist WhatsApp skipped:', psychologistWaResult.reason);
            } else {
              console.warn('⚠️ Psychologist WhatsApp send failed:', psychologistWaResult?.error || 'Unknown error');
            }
          } else {
            console.log('ℹ️ No psychologist phone or meet link; skipping psychologist WhatsApp');
          }
        } catch (whatsappError) {
          console.error('❌ Error sending WhatsApp notifications:', whatsappError);
          // Continue - don't block the process
        }
      } catch (asyncError) {
        console.error('❌ Error in async background process (Meet link/emails):', asyncError);
      }
    })();

    return {
      success: true,
      session,
      alreadyExists: false
    };
  } catch (error) {
    console.error('❌ Exception in createSessionFromSlotLock:', error);
    return {
      success: false,
      error: error.message || 'Failed to create session'
    };
  }
};

module.exports = {
  createSessionFromSlotLock
};


