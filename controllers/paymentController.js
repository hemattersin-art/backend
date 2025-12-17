const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { ensureClientPackageRecord } = require('../services/packageService');
const { 
  getRazorpayConfig, 
  getRazorpayInstance,
  generateTransactionId, 
  verifyPaymentSignature 
} = require('../config/razorpay');
const meetLinkService = require('../utils/meetLinkService');
const assessmentSessionService = require('../services/assessmentSessionService');
const { addMinutesToTime } = require('../utils/helpers');
const emailService = require('../utils/emailService');

// Generate and store PDF receipt in Supabase storage
const generateAndStoreReceipt = async (sessionData, paymentData, clientData, psychologistData) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50
      });

      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', async () => {
      try {
        const pdfBuffer = Buffer.concat(chunks);
        console.log('✅ PDF generated successfully, size:', pdfBuffer.length, 'bytes');

        // Generate unique filename
        const receiptNumber = `RCP-${sessionData.id.toString().padStart(6, '0')}`;
        const filename = `receipts/${receiptNumber}-${sessionData.id}.pdf`;

        // Upload to Supabase storage using admin client
        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
          .from('receipts')
          .upload(filename, pdfBuffer, {
            contentType: 'application/pdf',
            cacheControl: '3600'
          });

        if (uploadError) {
          console.error('❌ Error uploading receipt to storage:', uploadError);
          return;
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
          .from('receipts')
          .getPublicUrl(filename);

        console.log('✅ Receipt uploaded successfully:', urlData.publicUrl);

        // Store receipt metadata in database using admin client
        const receiptData = {
          session_id: sessionData.id,
          payment_id: paymentData.id,
          receipt_number: receiptNumber,
          file_path: filename,
          file_url: urlData.publicUrl,
          file_size: pdfBuffer.length,
          created_at: new Date().toISOString()
        };
        
        console.log('📄 Storing receipt data - session_id:', receiptData.session_id, 'receipt_number:', receiptData.receipt_number);
        
        const { error: receiptError } = await supabaseAdmin
          .from('receipts')
          .insert(receiptData);

        if (receiptError) {
          console.error('❌ Error storing receipt metadata:', receiptError);
          reject(receiptError);
        } else {
          console.log('✅ Receipt metadata stored successfully');
          
          // Verify the receipt was stored by querying it back
          const { data: verifyReceipt, error: verifyError } = await supabaseAdmin
            .from('receipts')
            .select('*')
            .eq('session_id', sessionData.id)
            .single();
            
          if (verifyError) {
            console.error('❌ Error verifying receipt storage:', verifyError);
          } else {
            console.log('✅ Receipt verification successful:', verifyReceipt);
          }
          
          resolve({ 
            success: true, 
            receiptNumber, 
            fileUrl: urlData.publicUrl,
            pdfBuffer: pdfBuffer // Return buffer for email attachment
          });
        }

        // Note: pdfBuffer is automatically garbage collected - no local file cleanup needed

      } catch (error) {
        console.error('❌ Error in PDF upload process:', error);
        reject(error);
      }
    });

    // Add company logo/header
    doc.fontSize(24).font('Helvetica-Bold').text('Little Care', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Mental Health & Wellness Platform', { align: 'center' });
    doc.moveDown();

    // Add receipt title
    doc.fontSize(18).font('Helvetica-Bold').text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown();

    // Add receipt details
    doc.fontSize(10).font('Helvetica');
    
    // Receipt number
    doc.text(`Receipt Number: RCP-${sessionData.id.toString().padStart(6, '0')}`);
    doc.text(`Date: ${new Date(paymentData.completed_at || new Date()).toLocaleDateString('en-IN')}`);
    doc.text(`Time: ${new Date(paymentData.completed_at || new Date()).toLocaleTimeString('en-IN')}`);
    doc.moveDown();

    // Session details
    doc.fontSize(12).font('Helvetica-Bold').text('Session Details:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Date: ${new Date(sessionData.scheduled_date).toLocaleDateString('en-IN')}`);
    doc.text(`Time: ${sessionData.scheduled_time}`);
    doc.text(`Status: ${sessionData.status}`);
    doc.moveDown();

    // Psychologist details
    doc.fontSize(12).font('Helvetica-Bold').text('Therapist:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${psychologistData.first_name} ${psychologistData.last_name}`);
    doc.text(`Email: ${psychologistData.email}`);
    doc.text(`Phone: ${psychologistData.phone || 'N/A'}`);
    doc.moveDown();

    // Client details
    doc.fontSize(12).font('Helvetica-Bold').text('Client:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${clientData.first_name} ${clientData.last_name}`);
    doc.text(`Email: ${clientData.user?.email || 'N/A'}`);
    doc.moveDown();

    // Payment details
    doc.fontSize(12).font('Helvetica-Bold').text('Payment Details:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Transaction ID: ${paymentData.transaction_id}`);
    doc.text(`Amount: ₹${paymentData.amount}`);
    doc.text(`Payment Date: ${new Date(paymentData.completed_at || new Date()).toLocaleDateString('en-IN')}`);
    doc.moveDown();

    // Footer
    doc.fontSize(10).font('Helvetica').text('Thank you for choosing Little Care for your mental health needs.', { align: 'center' });
    doc.text('For any queries, please contact our support team.', { align: 'center' });

    doc.end();

    doc.on('error', (error) => {
      console.error('❌ PDF generation error:', error);
      reject(error);
    });

  } catch (error) {
    console.error('❌ Error generating receipt PDF:', error);
    reject(error);
  }
  });
};

// Create Razorpay payment order
const createPaymentOrder = async (req, res) => {
  try {
    console.log('🔍 Payment Request Body:', req.body);
    
    const { 
      sessionId, 
      psychologistId, 
      clientId, 
      amount, 
      packageId,
      sessionType,
      clientName,
      clientEmail,
      clientPhone,
      scheduledDate,
      scheduledTime,
      assessmentSessionId,
      assessmentType
    } = req.body;

    // Validate required fields
    if (!scheduledDate || !scheduledTime || !psychologistId || !clientId || !amount || !clientName || !clientEmail) {
      console.log('❌ Missing fields:', {
        scheduledDate: !!scheduledDate,
        scheduledTime: !!scheduledTime,
        psychologistId: !!psychologistId,
        clientId: !!clientId,
        amount: !!amount,
        clientName: !!clientName,
        clientEmail: !!clientEmail
      });
      return res.status(400).json({
        success: false,
        message: 'Missing required fields for payment'
      });
    }

    const razorpayConfig = getRazorpayConfig();
    const razorpay = getRazorpayInstance();
    
    // Validate Razorpay config
    if (!razorpayConfig || !razorpayConfig.keyId) {
      console.error('❌ Invalid Razorpay configuration:', razorpayConfig);
      return res.status(500).json({
        success: false,
        message: 'Payment gateway configuration error'
      });
    }
    
    console.log('🔧 Razorpay Config:', {
      keyId: razorpayConfig.keyId,
      successUrl: razorpayConfig.successUrl,
      failureUrl: razorpayConfig.failureUrl
    });
    
    // Generate transaction ID (receipt ID for Razorpay)
    const txnid = generateTransactionId();
    
    // Convert amount to paise (Razorpay uses smallest currency unit)
    const amountInPaise = Math.round(amount * 100);
    
    // Create Razorpay order
    const orderOptions = {
      amount: amountInPaise, // Amount in paise
      currency: 'INR',
      receipt: txnid,
      payment_capture: 1, // Auto capture payment
      notes: {
        scheduledDate: scheduledDate,
        psychologistId: psychologistId,
        clientId: clientId,
        packageId: packageId || '',
        scheduledTime: scheduledTime,
        assessmentSessionId: assessmentSessionId || '',
        assessmentType: assessmentType || '',
        sessionType: sessionType,
        clientName: clientName,
        clientEmail: clientEmail
      }
    };

    console.log('📦 Creating Razorpay order...');
    let razorpayOrder;
    try {
      razorpayOrder = await razorpay.orders.create(orderOptions);
      console.log('✅ Razorpay order created:', razorpayOrder.id);
    } catch (razorpayError) {
      console.error('❌ Razorpay order creation failed:', razorpayError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment order with Razorpay',
        error: razorpayError.message || 'Razorpay API error'
      });
    }

    // Store pending payment record
    console.log('💾 Creating payment record in database...');
    console.log('🔍 Assessment booking check:', {
      assessmentSessionId,
      assessmentType,
      hasAssessmentSessionId: !!assessmentSessionId
    });
    
    const paymentData = {
      transaction_id: txnid,
      razorpay_order_id: razorpayOrder.id, // Store Razorpay order ID
      session_id: null, // Will be set after payment success
      psychologist_id: psychologistId,
      client_id: clientId,
      package_id: packageId === 'individual' ? null : packageId, // Set to null for individual sessions
      amount: amount,
      session_type: sessionType,
      status: 'pending',
      razorpay_params: {
        orderId: razorpayOrder.id,
        amount: amountInPaise,
        currency: 'INR',
        receipt: txnid,
        notes: orderOptions.notes
      },
      created_at: new Date().toISOString()
    };
    
    // Add assessment_session_id if assessment booking (only if column exists)
    if (assessmentSessionId) {
      paymentData.assessment_session_id = assessmentSessionId;
      console.log('🔍 Adding assessment_session_id to payment data:', assessmentSessionId);
    }
    
    console.log('🔍 Final payment data (excluding razorpay_params):', {
      ...paymentData,
      razorpay_params: '[REDACTED]'
    });
    
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert([paymentData])
      .select()
      .single();

    if (paymentError) {
      console.error('❌ Error creating payment record:', paymentError);
      console.error('❌ Payment data attempted:', JSON.stringify(paymentData, null, 2));
      console.error('❌ Full error details:', {
        message: paymentError.message,
        code: paymentError.code,
        details: paymentError.details,
        hint: paymentError.hint
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment record',
        error: paymentError.message || 'Database error'
      });
    }

    console.log('✅ Payment record created successfully:', paymentRecord.id);
    
    console.log('📤 Sending payment response to frontend...');
    
    res.json({
      success: true,
      data: {
        paymentId: paymentRecord.id,
        transactionId: txnid,
        orderId: razorpayOrder.id,
        amount: amount,
        amountInPaise: amountInPaise,
        currency: 'INR',
        keyId: razorpayConfig.keyId,
        name: 'Little Care',
        description: assessmentType === 'assessment' ? `Assessment Session - ${sessionType}` : `Therapy Session - ${sessionType}`,
        prefill: {
          name: clientName,
          email: clientEmail,
          contact: clientPhone || ''
        },
        notes: orderOptions.notes,
        theme: {
          color: '#3b82f6'
        }
      }
    });

  } catch (error) {
    console.error('Error creating payment order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order'
    });
  }
};

// Handle Razorpay success response
const handlePaymentSuccess = async (req, res) => {
  try {
    const razorpayConfig = getRazorpayConfig();
    const params = req.body;

    console.log('Razorpay Success Response:', params);

    // Extract Razorpay payment details
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = params;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      console.error('❌ Missing Razorpay payment details');
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification details'
      });
    }

    // Find payment record by Razorpay order ID
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('razorpay_order_id', razorpay_order_id)
      .single();

    if (paymentError || !paymentRecord) {
      console.error('Payment record not found for order:', razorpay_order_id);
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }

    // Verify payment signature
    const isValidSignature = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      razorpayConfig.keySecret
    );

    if (!isValidSignature) {
      console.error('❌ Invalid Razorpay payment signature');
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    console.log('✅ Payment signature verified successfully');

    // Use data from payment record
    const clientId = paymentRecord.client_id;
    const actualPsychologistId = paymentRecord.psychologist_id;
    const actualScheduledDate = paymentRecord.razorpay_params?.notes?.scheduledDate;
    const actualScheduledTime = paymentRecord.razorpay_params?.notes?.scheduledTime;
    const actualPackageId = paymentRecord.package_id;
    const isAssessment = paymentRecord.assessment_session_id || paymentRecord.razorpay_params?.notes?.assessmentType === 'assessment';
    const actualAssessmentSessionId = paymentRecord.assessment_session_id || paymentRecord.razorpay_params?.notes?.assessmentSessionId;

    // Check if already processed
    if (paymentRecord.status === 'success') {
      return res.json({
        success: true,
        message: 'Payment already processed'
      });
    }

    console.log('✅ Payment validated, creating session...');

    // Check if this is an assessment booking
    if (isAssessment && actualAssessmentSessionId) {
      // Update assessment session status to booked
      const { data: assessmentSession, error: assessError } = await supabaseAdmin
        .from('assessment_sessions')
        .update({
          status: 'booked',
          payment_id: paymentRecord.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', actualAssessmentSessionId)
        .eq('status', 'reserved')
        .select('*')
        .single();

      if (assessError || !assessmentSession) {
        console.error('❌ Assessment session update failed:', assessError);
        return res.status(500).json({
          success: false,
          message: 'Failed to update assessment session after payment'
        });
      }

      console.log('✅ Assessment session booked successfully:', assessmentSession.id);

      let sessionWithMeet = assessmentSession;
      try {
        const { session: enrichedSession } = await assessmentSessionService.finalizeAssessmentSessionBooking(assessmentSession.id, {
          durationMinutes: 50
        });
        if (enrichedSession) {
          sessionWithMeet = enrichedSession;
        }
      } catch (notifyError) {
        console.error('⚠️ Failed to finalize assessment session notifications:', notifyError?.message || notifyError);
      }

      // Block the booked slot from availability (best-effort)
      try {
        const hhmm = (assessmentSession.scheduled_time || '').substring(0,5);
        const { data: avail } = await supabaseAdmin
          .from('availability')
          .select('id, time_slots')
          .eq('psychologist_id', assessmentSession.psychologist_id)
          .eq('date', assessmentSession.scheduled_date)
          .single();
        if (avail && Array.isArray(avail.time_slots)) {
          const filtered = avail.time_slots.filter(t => (typeof t === 'string' ? t.substring(0,5) : String(t).substring(0,5)) !== hhmm);
          if (filtered.length !== avail.time_slots.length) {
            await supabaseAdmin
              .from('availability')
              .update({ time_slots: filtered, updated_at: new Date().toISOString() })
              .eq('id', avail.id);
            console.log('✅ Availability updated to block booked assessment slot', { date: assessmentSession.scheduled_date, time: hhmm });
          }
        }
      } catch (blockErr) {
        console.warn('⚠️ Failed to update availability after assessment booking:', blockErr?.message);
      }

      // After first session is booked, create 2 additional sessions for psychologists to schedule
      try {
        // Get assessment details for pricing
        const { data: assessmentData } = await supabaseAdmin
          .from('assessments')
          .select('assessment_price')
          .eq('id', assessmentSession.assessment_id)
          .single();

        // Get client details for the new sessions
        const { data: clientData } = await supabaseAdmin
          .from('clients')
          .select('user_id, id')
          .eq('id', assessmentSession.client_id)
          .single();

        const assessmentPrice = assessmentData?.assessment_price || 5000;

        // Get the actual user_id from the client record
        // If client has user_id, use it; otherwise try to get it from the assessment session
        const actualUserId = clientData?.user_id || assessmentSession.user_id;
        
        // If still no user_id, we need to find it from the users table using client email or other means
        if (!actualUserId) {
          console.warn('⚠️ No user_id found in client or assessment session, attempting to find user by client email');
          // Try to get user_id from users table if client has email
          // This is a fallback for old clients that might not have user_id set
        }

        // Create 2 additional sessions with status 'pending' - unassigned (psychologist_id = null)
        // Any psychologist can schedule these sessions and assign them to any psychologist
        const additionalSessions = [];

        console.log('🔍 Creating pending sessions - unassigned (any psychologist can schedule):', {
          assessment_id: assessmentSession.assessment_id,
          user_id: actualUserId,
          client_id: assessmentSession.client_id,
          note: 'Pending sessions are unassigned - any psychologist can schedule them with any psychologist'
        });

        additionalSessions.push({
          user_id: actualUserId, // Use the actual user_id from client record
          client_id: assessmentSession.client_id,
          assessment_id: assessmentSession.assessment_id,
          assessment_slug: assessmentSession.assessment_slug,
          psychologist_id: null, // Unassigned - can be assigned to any psychologist when scheduled
          scheduled_date: null, // To be set by psychologist
          scheduled_time: null, // To be set by psychologist
          amount: assessmentPrice,
          currency: 'INR',
          status: 'pending', // Status for psychologist to schedule
          payment_id: paymentRecord.id, // Link to the same payment
          created_at: new Date().toISOString()
        });

        additionalSessions.push({
          user_id: actualUserId, // Use the actual user_id from client record
          client_id: assessmentSession.client_id,
          assessment_id: assessmentSession.assessment_id,
          assessment_slug: assessmentSession.assessment_slug,
          psychologist_id: null, // Unassigned - can be assigned to any psychologist when scheduled
          scheduled_date: null, // To be set by psychologist
          scheduled_time: null, // To be set by psychologist
          amount: assessmentPrice,
          currency: 'INR',
          status: 'pending', // Status for psychologist to schedule
          payment_id: paymentRecord.id, // Link to the same payment
          created_at: new Date().toISOString()
        });

        // Also update the first session to mark it as session 1 (if column exists)
        try {
          await supabaseAdmin
            .from('assessment_sessions')
            .update({ session_number: 1 })
            .eq('id', assessmentSession.id);
        } catch (updateError) {
          // Ignore if session_number column doesn't exist yet
          console.log('Note: session_number column may not exist yet:', updateError.message);
        }

        // Insert the 2 additional sessions
        const { data: newSessions, error: insertError } = await supabaseAdmin
          .from('assessment_sessions')
          .insert(additionalSessions)
          .select('*');

        if (insertError) {
          console.error('❌ Error creating additional assessment sessions:', insertError);
          console.error('❌ Insert data attempted:', JSON.stringify(additionalSessions, null, 2));
          // Don't fail the payment, just log the error
        } else {
          console.log('✅ Created 2 additional unassigned assessment sessions (any psychologist can schedule):', newSessions.map(s => ({
            id: s.id,
            psychologist_id: s.psychologist_id,
            status: s.status,
            scheduled_date: s.scheduled_date
          })));
        }
      } catch (error) {
        console.error('❌ Error creating additional assessment sessions:', error);
        // Don't fail the payment, just log the error
      }

      // Update payment record
      await supabaseAdmin
        .from('payments')
        .update({ status: 'success', completed_at: new Date().toISOString() })
        .eq('id', paymentRecord.id);

      return res.json({
        success: true,
        message: 'Assessment session booked successfully. 2 additional sessions have been created for psychologists to schedule.',
        data: { assessmentSessionId: assessmentSession.id, session: sessionWithMeet }
      });
    }

    // Regular therapy session booking (existing code)
    // Get client and psychologist details for session creation
    const { data: clientDetails, error: clientDetailsError } = await supabase
      .from('clients')
      .select(`
        *,
        user:users(email)
      `)
      .eq('id', clientId)
      .single();

    if (clientDetailsError || !clientDetails) {
      console.error('❌ Error fetching client details:', clientDetailsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch client details'
      });
    }

    const { data: psychologistDetails, error: psychologistDetailsError } = await supabase
      .from('psychologists')
      .select('first_name, last_name, email, phone, google_calendar_credentials')
      .eq('id', actualPsychologistId)
      .single();

    if (psychologistDetailsError || !psychologistDetails) {
      console.error('❌ Error fetching psychologist details:', psychologistDetailsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch psychologist details'
      });
    }

    // Create the actual session IMMEDIATELY (don't wait for gmeet link)
    // Gmeet link will be created asynchronously and session will be updated later
    const sessionData = {
      client_id: clientId,
      psychologist_id: actualPsychologistId,
      scheduled_date: actualScheduledDate,
      scheduled_time: actualScheduledTime,
      status: 'booked',
      price: paymentRecord.amount,
      payment_id: paymentRecord.id
    };

    // Only add package_id if it's provided and valid (not individual)
    if (actualPackageId && actualPackageId !== 'null' && actualPackageId !== 'undefined' && actualPackageId !== 'individual') {
      sessionData.package_id = actualPackageId;
    }

    // Don't add meet data yet - will be added asynchronously

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      console.error('❌ Session creation failed:', sessionError);

      // Check if it's a unique constraint violation (double booking)
      if (
        sessionError.code === '23505' ||
        sessionError.message?.includes('unique') ||
        sessionError.message?.includes('duplicate')
      ) {
        console.log('⚠️ Double booking detected - slot was just booked by another user');

        // Instead of deleting the payment, preserve it as a usable credit-like record
        // (paid, but no session). We keep status as 'pending' but attach Razorpay details.
        try {
          await supabase
            .from('payments')
            .update({
              status: 'pending',
              razorpay_payment_id: razorpay_payment_id,
              razorpay_response: params,
              // Keep session_id null so it can be used for a future booking
              completed_at: new Date().toISOString()
            })
            .eq('id', paymentRecord.id);
        } catch (creditError) {
          console.error('⚠️ Failed to update payment after double booking:', creditError);
        }

        return res.status(409).json(
          errorResponse('This time slot was just booked by another user. Your payment is safe – please choose another available time.')
        );
      }

      // Send error notification email to admin
      try {
        await emailService.sendEmail({
          to: 'abhishekravi063@gmail.com',
          subject: '🚨 Booking Failed After Payment - Action Required',
          html: `
            <h2>Booking Failed After Payment</h2>
            <p><strong>Error:</strong> Failed to create session after payment</p>
            <p><strong>Payment Order ID:</strong> ${razorpay_order_id}</p>
            <p><strong>Payment ID:</strong> ${razorpay_payment_id}</p>
            <p><strong>Client ID:</strong> ${clientId}</p>
            <p><strong>Psychologist ID:</strong> ${actualPsychologistId}</p>
            <p><strong>Scheduled Date:</strong> ${actualScheduledDate}</p>
            <p><strong>Scheduled Time:</strong> ${actualScheduledTime}</p>
            <p><strong>Error Details:</strong> ${JSON.stringify(sessionError, null, 2)}</p>
            <p><strong>Payment Record:</strong> ${JSON.stringify(paymentRecord, null, 2)}</p>
            <p><em>Please investigate and manually create the session if needed.</em></p>
          `
        });
        console.log('✅ Error notification email sent to admin');
      } catch (emailErr) {
        console.error('❌ Failed to send error notification email:', emailErr);
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to create session after payment. Our team has been notified and will resolve this shortly.'
      });
    }

    console.log('✅ Session created successfully:', session.id);

    // Update payment status to completed
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'success',
        razorpay_payment_id: razorpay_payment_id,
        razorpay_response: params,
        session_id: session.id,
        completed_at: new Date().toISOString()
      })
      .eq('id', paymentRecord.id);

    if (updateError) {
      console.error('❌ Error updating payment:', updateError);
      // Continue - payment status update failure shouldn't block response
    }

    // Generate and store PDF receipt IMMEDIATELY
    console.log('📄 Generating and storing PDF receipt...');
    let receiptResult = null;
    try {
      receiptResult = await generateAndStoreReceipt(
        session,
        { ...paymentRecord, completed_at: new Date().toISOString() },
        clientDetails,
        psychologistDetails
      );
      console.log('✅ Receipt generated successfully');
    } catch (receiptError) {
      console.error('❌ Error generating receipt:', receiptError);
      // Continue even if receipt generation fails
    }

    // Return success response IMMEDIATELY (don't wait for async processes)
    // Session and receipt are already created, gmeet/emails/WhatsApp will happen in background
    res.json({
      success: true,
      message: 'Payment successful and session created',
      data: {
        sessionId: session.id,
        transactionId: paymentRecord.transaction_id,
        razorpayPaymentId: razorpay_payment_id,
        amount: paymentRecord.amount
      }
      });
      
    // ASYNC: Create gmeet link, send emails and WhatsApp in background (don't wait)
    // This runs after response is sent, so it doesn't block the user
    (async () => {
      try {
        console.log('🔄 Starting async gmeet link creation and notifications...');
        
        // Create Google Meet link asynchronously
        let meetData = null;
        try {
          console.log('🔄 Creating Google Meet meeting via OAuth2 (async)...');
          
          const meetSessionData = {
        summary: `Therapy Session - ${clientDetails.child_name || clientDetails.first_name} with ${psychologistDetails.first_name}`,
        description: `Online therapy session between ${clientDetails.child_name || clientDetails.first_name} and ${psychologistDetails.first_name} ${psychologistDetails.last_name}`,
        startDate: actualScheduledDate,
        startTime: actualScheduledTime,
            endTime: addMinutesToTime(actualScheduledTime, 50),
            // Add both emails as attendees - this ensures they can join without host approval
            clientEmail: clientDetails.user?.email,
            psychologistEmail: psychologistDetails.email
          };
          
          // Get psychologist's OAuth tokens if available (for real Meet link creation)
          let userAuth = null;
          if (psychologistDetails.google_calendar_credentials) {
            const credentials = psychologistDetails.google_calendar_credentials;
            userAuth = {
              access_token: credentials.access_token,
              refresh_token: credentials.refresh_token,
              expiry_date: credentials.expiry_date
            };
            console.log('✅ Using psychologist OAuth tokens for Meet link creation');
          } else {
            console.log('⚠️ No OAuth tokens for psychologist - will use service account (may not create real Meet link)');
          }
          
          const meetResult = await meetLinkService.generateSessionMeetLink(meetSessionData, userAuth);
      
      if (meetResult.success) {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || null,
          method: meetResult.method
        };
            console.log('✅ Real Meet link created successfully (async):', meetResult);
            
            // Update session with meet link
            await supabase
              .from('sessions')
              .update({
                google_calendar_event_id: meetData.eventId,
                google_meet_link: meetData.meetLink,
                google_meet_join_url: meetData.meetLink,
                google_meet_start_url: meetData.meetLink,
                updated_at: new Date().toISOString()
              })
              .eq('id', session.id);
            
            console.log('✅ Session updated with meet link');
      } else {
        meetData = {
              meetLink: meetResult.meetLink,
          eventId: null,
          calendarLink: null,
          method: 'fallback'
        };
            console.log('⚠️ Using fallback Meet link (async):', meetResult.meetLink);
      }
    } catch (meetError) {
          console.error('❌ Error creating OAuth2 meeting (async):', meetError);
        }

        // Send confirmation emails with receipt (async)
        try {
          console.log('📧 Sending confirmation emails with receipt (async)...');
      
      await emailService.sendSessionConfirmation({
        clientName: clientDetails.child_name || `${clientDetails.first_name} ${clientDetails.last_name}`,
        psychologistName: `${psychologistDetails.first_name} ${psychologistDetails.last_name}`,
        sessionDate: actualScheduledDate,
        sessionTime: actualScheduledTime,
        sessionDuration: '60 minutes',
        clientEmail: clientDetails.user?.email,
        psychologistEmail: psychologistDetails.email,
        googleMeetLink: meetData?.meetLink,
        sessionId: session.id,
            transactionId: paymentRecord.transaction_id,
            amount: paymentRecord.amount,
            price: paymentRecord.amount, // Also pass as 'price' for email service
            status: session.status || 'booked',
            psychologistId: session.psychologist_id || actualPsychologistId,
            clientId: session.client_id || clientId,
            receiptUrl: receiptResult?.fileUrl || null,
            receiptPdfBuffer: receiptResult?.pdfBuffer || null
      });
      
          console.log('✅ Confirmation emails sent successfully with receipt (async)');
    } catch (emailError) {
          console.error('❌ Error sending confirmation emails (async):', emailError);
    }

        // Send WhatsApp messages (async)
    try {
          console.log('📱 Sending WhatsApp messages via WhatsApp API (async)...');
      const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/whatsappService');
      
      const clientName = clientDetails.child_name || `${clientDetails.first_name} ${clientDetails.last_name}`.trim();
      const psychologistName = `${psychologistDetails.first_name} ${psychologistDetails.last_name}`.trim();

      // Send WhatsApp to client
      const clientPhone = clientDetails.phone_number || null;
      if (clientPhone && meetData?.meetLink) {
        const clientDetails_wa = {
          childName: clientDetails.child_name || clientDetails.first_name,
          date: actualScheduledDate,
          time: actualScheduledTime,
          meetLink: meetData.meetLink,
          // Pass receipt URL so we can send the PDF via WhatsApp as well
          receiptUrl: receiptResult?.fileUrl || null
        };
        const clientWaResult = await sendBookingConfirmation(clientPhone, clientDetails_wa);
        if (clientWaResult?.success) {
              console.log('✅ WhatsApp confirmation & receipt sent to client via WhatsApp API (async)');
        } else if (clientWaResult?.skipped) {
          console.log('ℹ️ Client WhatsApp skipped:', clientWaResult.reason);
        } else {
          console.warn('⚠️ Client WhatsApp send failed');
        }
      } else {
        console.log('ℹ️ No client phone or meet link; skipping client WhatsApp');
      }

      // Send WhatsApp to psychologist (single detailed message)
      const psychologistPhone = psychologistDetails.phone || null;
      if (psychologistPhone && meetData?.meetLink) {
        const supportPhone = process.env.SUPPORT_PHONE || process.env.COMPANY_PHONE || '+91 95390 07766';
        const psychologistMessage =
          `🧸 New session booked.\n\n` +
          `Session details:\n\n` +
          `👧 Client: ${clientName}\n\n` +
          `📅 Date: ${actualScheduledDate}\n\n` +
          `⏰ Time: ${actualScheduledTime} (IST)\n\n` +
          `🔗 Google Meet: ${meetData.meetLink}\n\n` +
          `🆔 Session ID: ${session.id}\n\n` +
          `📞 For support or scheduling issues, contact Little Care support:\n` +
          `WhatsApp / Call: ${supportPhone}`;
        
        const psychologistWaResult = await sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
        if (psychologistWaResult?.success) {
              console.log('✅ WhatsApp notification sent to psychologist via WhatsApp API (async)');
        } else if (psychologistWaResult?.skipped) {
          console.log('ℹ️ Psychologist WhatsApp skipped:', psychologistWaResult.reason);
        } else {
          console.warn('⚠️ Psychologist WhatsApp send failed');
        }
      } else {
        console.log('ℹ️ No psychologist phone or meet link; skipping psychologist WhatsApp');
      }
      
          console.log('✅ WhatsApp messages sent successfully via UltraMsg (async)');
    } catch (whatsappError) {
          console.error('❌ Error sending WhatsApp messages (async):', whatsappError);
        }
        
        console.log('✅ Async gmeet link creation and notifications completed');
      } catch (asyncError) {
        console.error('❌ Error in async background process:', asyncError);
    }
    })(); // Immediately invoked async function - runs in background

    // Continue with async processes (don't block response)
    // If package booking, create client package record (async)
    if (actualPackageId && actualPackageId !== 'individual') {
      (async () => {
      try {
          console.log('📦 Creating client package record (async)...');
        const { data: packageData } = await supabase
          .from('packages')
          .select('*')
          .eq('id', actualPackageId)
          .single();

        if (packageData) {
          const { created, error: clientPackageError } = await ensureClientPackageRecord({
            clientId,
            psychologistId: actualPsychologistId,
            packageId: actualPackageId,
            sessionId: session.id,
            purchasedAt: new Date().toISOString(),
            packageData,
            consumedSessions: 1
          });

          if (clientPackageError) {
            console.error('❌ Client package creation failed:', clientPackageError);
          } else if (created) {
              console.log('✅ Client package record created successfully (async)');
          } else {
            console.log('ℹ️ Client package record already existed for this session');
          }
        }
      } catch (packageError) {
          console.error('❌ Exception while creating client package (async):', packageError);
      }
      })();
    }

    // PRIORITY: Check and send reminder immediately if session is 12 hours away (async)
    try {
      const sessionReminderService = require('../services/sessionReminderService');
      sessionReminderService.checkAndSendReminderForSessionId(session.id).catch(err => {
        console.error('❌ Error in priority reminder check:', err);
      });
    } catch (reminderError) {
      console.error('❌ Error initiating priority reminder check:', reminderError);
    }

  } catch (error) {
    console.error('❌ Error handling payment success:', error);
    
    // Send error notification email to admin
    try {
      const params = req.body || {};
      const razorpay_order_id = params.razorpay_order_id || 'Unknown';
      const razorpay_payment_id = params.razorpay_payment_id || 'Unknown';
      
      await emailService.sendEmail({
        to: 'abhishekravi063@gmail.com',
        subject: '🚨 Booking Failed After Payment - Action Required',
        html: `
          <h2>Booking Failed After Payment</h2>
          <p><strong>Error:</strong> ${error.message || 'Unknown error occurred'}</p>
          <p><strong>Payment Order ID:</strong> ${razorpay_order_id}</p>
          <p><strong>Payment ID:</strong> ${razorpay_payment_id}</p>
          <p><strong>Error Stack:</strong></p>
          <pre>${error.stack || JSON.stringify(error, null, 2)}</pre>
          <p><em>Please investigate and manually create the session if needed.</em></p>
        `
      });
      console.log('✅ Error notification email sent to admin');
    } catch (emailErr) {
      console.error('❌ Failed to send error notification email:', emailErr);
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to process payment. Our team has been notified and will resolve this shortly.'
    });
  }
};

// Handle Razorpay failure response
const handlePaymentFailure = async (req, res) => {
  try {
    const params = req.body;

    console.log('Razorpay Failure Response:', params);

    const { razorpay_order_id, error } = params;

    if (!razorpay_order_id) {
      console.error('❌ Missing Razorpay order ID in failure response');
      return res.status(400).json({
        success: false,
        message: 'Missing order ID in failure response'
      });
    }

    // Find payment record by Razorpay order ID
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('razorpay_order_id', razorpay_order_id)
      .single();

    if (paymentError || !paymentRecord) {
      console.error('Payment record not found for order:', razorpay_order_id);
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }

    // Update payment status to failed
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        razorpay_response: params,
        error_message: error?.description || error?.reason || 'Payment failed',
        failed_at: new Date().toISOString()
      })
      .eq('id', paymentRecord.id);

    if (updateError) {
      console.error('Error updating payment:', updateError);
    }

    // Release session slot if exists
    if (paymentRecord.session_id) {
    const { error: sessionError } = await supabase
      .from('sessions')
      .update({
        status: 'available',
        client_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentRecord.session_id);

    if (sessionError) {
      console.error('Error releasing session:', sessionError);
      }
    }

    res.json({
      success: false,
      message: 'Payment failed',
      data: {
        transactionId: paymentRecord.transaction_id,
        orderId: razorpay_order_id,
        errorMessage: error?.description || error?.reason || 'Payment failed'
      }
    });

  } catch (error) {
    console.error('Error handling payment failure:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment failure'
    });
  }
};

// Get payment status
const getPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const { data: paymentRecord, error } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', transactionId)
      .single();

    if (error || !paymentRecord) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      data: {
        status: paymentRecord.status,
        amount: paymentRecord.amount,
        sessionId: paymentRecord.session_id,
        createdAt: paymentRecord.created_at,
        completedAt: paymentRecord.completed_at
      }
    });

  } catch (error) {
    console.error('Error getting payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment status'
    });
  }
};

// Create cash payment for assessment
const createCashPayment = async (req, res) => {
  try {
    const { 
      scheduledDate, 
      scheduledTime, 
      psychologistId, 
      clientId, 
      amount, 
      clientName,
      clientEmail,
      clientPhone,
      assessmentSessionId,
      assessmentType
    } = req.body;

    if (!scheduledDate || !scheduledTime || !psychologistId || !clientId || !amount || !assessmentSessionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields for cash payment'
      });
    }

    // Generate transaction ID
    const txnid = generateTransactionId();

    // Create payment record with status 'cash'
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        transaction_id: txnid,
        client_id: clientId,
        psychologist_id: psychologistId,
        amount: amount,
        currency: 'INR',
        status: 'cash', // Cash payment status
        payment_method: 'cash',
        razorpay_params: {
          notes: {
            scheduledDate: scheduledDate,
            psychologistId: psychologistId,
            clientId: clientId,
            scheduledTime: scheduledTime,
            assessmentSessionId: assessmentSessionId,
            assessmentType: assessmentType || 'assessment'
          }
        },
        assessment_session_id: assessmentSessionId,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (paymentError || !paymentRecord) {
      console.error('Error creating cash payment:', paymentError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create cash payment record'
      });
    }

    // Process payment success (same as online payment)
    // This will mark the assessment session as booked and create the 2 additional sessions
    // Update assessment session status to booked
    const { data: assessmentSession, error: assessError } = await supabaseAdmin
      .from('assessment_sessions')
      .update({
        status: 'booked',
        payment_id: paymentRecord.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', assessmentSessionId)
      .eq('status', 'reserved')
      .select('*')
      .single();

    if (assessError || !assessmentSession) {
      console.error('❌ Assessment session update failed:', assessError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update assessment session after cash payment'
      });
    }

    console.log('✅ Assessment session booked successfully with cash payment:', assessmentSession.id);

    // Block the booked slot from availability
    try {
      const hhmm = (assessmentSession.scheduled_time || '').substring(0,5);
      const { data: avail } = await supabaseAdmin
        .from('availability')
        .select('id, time_slots')
        .eq('psychologist_id', assessmentSession.psychologist_id)
        .eq('date', assessmentSession.scheduled_date)
        .single();
      if (avail && Array.isArray(avail.time_slots)) {
        const filtered = avail.time_slots.filter(t => (typeof t === 'string' ? t.substring(0,5) : String(t).substring(0,5)) !== hhmm);
        if (filtered.length !== avail.time_slots.length) {
          await supabaseAdmin
            .from('availability')
            .update({ time_slots: filtered, updated_at: new Date().toISOString() })
            .eq('id', avail.id);
          console.log('✅ Availability updated to block booked assessment slot', { date: assessmentSession.scheduled_date, time: hhmm });
        }
      }
    } catch (blockErr) {
      console.warn('⚠️ Failed to update availability after assessment booking:', blockErr?.message);
    }

    // Create 2 additional pending sessions (same logic as handlePaymentSuccess)
    try {
      const { data: assessmentData } = await supabaseAdmin
        .from('assessments')
        .select('assessment_price')
        .eq('id', assessmentSession.assessment_id)
        .single();

      const { data: clientData } = await supabaseAdmin
        .from('clients')
        .select('user_id, id')
        .eq('id', assessmentSession.client_id)
        .single();

      const assessmentPrice = assessmentData?.assessment_price || 5000;
      const actualUserId = clientData?.user_id || assessmentSession.user_id;

      const additionalSessions = [
        {
          user_id: actualUserId,
          client_id: assessmentSession.client_id,
          assessment_id: assessmentSession.assessment_id,
          assessment_slug: assessmentSession.assessment_slug,
          psychologist_id: null,
          scheduled_date: null,
          scheduled_time: null,
          amount: assessmentPrice,
          currency: 'INR',
          status: 'pending',
          payment_id: paymentRecord.id,
          session_number: 2,
          created_at: new Date().toISOString()
        },
        {
          user_id: actualUserId,
          client_id: assessmentSession.client_id,
          assessment_id: assessmentSession.assessment_id,
          assessment_slug: assessmentSession.assessment_slug,
          psychologist_id: null,
          scheduled_date: null,
          scheduled_time: null,
          amount: assessmentPrice,
          currency: 'INR',
          status: 'pending',
          payment_id: paymentRecord.id,
          session_number: 3,
          created_at: new Date().toISOString()
        }
      ];

      // Update first session to session_number 1
      await supabaseAdmin
        .from('assessment_sessions')
        .update({ session_number: 1 })
        .eq('id', assessmentSession.id);

      // Insert the 2 additional sessions
      const { data: newSessions, error: insertError } = await supabaseAdmin
        .from('assessment_sessions')
        .insert(additionalSessions)
        .select('*');

      if (insertError) {
        console.error('❌ Error creating additional assessment sessions:', insertError);
      } else {
        console.log('✅ Created 2 additional unassigned assessment sessions (any psychologist can schedule):', newSessions.map(s => ({
          id: s.id,
          psychologist_id: s.psychologist_id,
          status: s.status,
          scheduled_date: s.scheduled_date
        })));
      }
    } catch (error) {
      console.error('❌ Error creating additional assessment sessions:', error);
    }

    // Update payment record
    await supabaseAdmin
      .from('payments')
      .update({ status: 'cash', completed_at: new Date().toISOString() })
      .eq('id', paymentRecord.id);

    return res.json({
      success: true,
      message: 'Assessment booked successfully with cash payment. 2 additional sessions have been created for psychologists to schedule.',
      data: { assessmentSessionId: assessmentSession.id }
    });
    
  } catch (error) {
    console.error('Error creating cash payment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while processing cash payment'
    });
  }
};

module.exports = {
  createPaymentOrder,
  createCashPayment,
  handlePaymentSuccess,
  handlePaymentFailure,
  getPaymentStatus
};
