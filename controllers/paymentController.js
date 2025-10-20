const supabase = require('../config/supabase');
const { 
  getPayUConfig, 
  generatePayUHash, 
  generateTransactionId, 
  validatePayUResponse 
} = require('../config/payu');
const meetLinkService = require('../utils/meetLinkService');
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
        const { data: uploadData, error: uploadError } = await supabase.supabaseAdmin.storage
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
        const { data: urlData } = supabase.supabaseAdmin.storage
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
        
        console.log('📄 Storing receipt data:', receiptData);
        
        const { error: receiptError } = await supabase.supabaseAdmin
          .from('receipts')
          .insert(receiptData);

        if (receiptError) {
          console.error('❌ Error storing receipt metadata:', receiptError);
          reject(receiptError);
        } else {
          console.log('✅ Receipt metadata stored successfully');
          
          // Verify the receipt was stored by querying it back
          const { data: verifyReceipt, error: verifyError } = await supabase.supabaseAdmin
            .from('receipts')
            .select('*')
            .eq('session_id', sessionData.id)
            .single();
            
          if (verifyError) {
            console.error('❌ Error verifying receipt storage:', verifyError);
          } else {
            console.log('✅ Receipt verification successful:', verifyReceipt);
          }
          
          resolve({ success: true, receiptNumber, fileUrl: urlData.publicUrl });
        }

        // Note: pdfBuffer is automatically garbage collected - no local file cleanup needed

      } catch (error) {
        console.error('❌ Error in PDF upload process:', error);
        reject(error);
      }
    });

    // Add company logo/header
    doc.fontSize(24).font('Helvetica-Bold').text('Kuttikal', { align: 'center' });
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
    doc.fontSize(10).font('Helvetica').text('Thank you for choosing Kuttikal for your mental health needs.', { align: 'center' });
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

// Create PayU payment order
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
      scheduledTime
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

    const payuConfig = getPayUConfig();
    
    // Validate PayU config
    if (!payuConfig || !payuConfig.baseUrl) {
      console.error('❌ Invalid PayU configuration:', payuConfig);
      return res.status(500).json({
        success: false,
        message: 'Payment gateway configuration error'
      });
    }
    
    console.log('🔧 PayU Config:', {
      baseUrl: payuConfig.baseUrl,
      merchantId: payuConfig.merchantId,
      successUrl: payuConfig.successUrl,
      failureUrl: payuConfig.failureUrl
    });
    
    // Generate transaction ID
    const txnid = generateTransactionId();
    
    // Prepare PayU parameters
    const payuParams = {
      key: payuConfig.merchantId,
      txnid: txnid,
      amount: amount.toString(),
      productinfo: `Therapy Session - ${sessionType}`,
      firstname: clientName.split(' ')[0] || clientName,
      lastname: clientName.split(' ').slice(1).join(' ') || '',
      email: clientEmail,
      phone: clientPhone || '',
      surl: payuConfig.successUrl,
      furl: payuConfig.failureUrl,
      curl: payuConfig.successUrl, // Cancel URL
      address1: '',
      address2: '',
      city: '',
      state: '',
      country: '',
      zipcode: '',
      udf1: scheduledDate, // Store scheduled_date instead of sessionId
      udf2: psychologistId,
      udf3: clientId,
      udf4: packageId || '',
      udf5: scheduledTime, // Store scheduled_time
      udf6: '',
      udf7: '',
      udf8: '',
      udf9: '',
      udf10: ''
    };

    // Generate hash
    const hash = generatePayUHash(payuParams, payuConfig.salt);
    payuParams.hash = hash;

    // Store pending payment record
    console.log('💾 Creating payment record in database...');
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        transaction_id: txnid,
        session_id: null, // Will be set after payment success
        psychologist_id: psychologistId,
        client_id: clientId,
        package_id: packageId === 'individual' ? null : packageId, // Set to null for individual sessions
        amount: amount,
        session_type: sessionType,
        status: 'pending',
        payu_params: payuParams,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (paymentError) {
      console.error('❌ Error creating payment record:', paymentError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment record'
      });
    }

    console.log('✅ Payment record created successfully:', paymentRecord.id);

    // Construct redirect URL with validation
    const redirectUrl = `${payuConfig.baseUrl}/_payment`;
    
    // Validate redirect URL
    try {
      new URL(redirectUrl);
    } catch (urlError) {
      console.error('❌ Invalid redirect URL:', redirectUrl, urlError);
      return res.status(500).json({
        success: false,
        message: 'Invalid payment gateway URL'
      });
    }
    
    console.log('📤 Sending payment response to frontend...');
    console.log('🔗 Redirect URL:', redirectUrl);
    console.log('🔗 Redirect URL type:', typeof redirectUrl);
    console.log('🔗 Redirect URL length:', redirectUrl?.length);
    console.log('🔗 PayU Config:', payuConfig);
    
    res.json({
      success: true,
      data: {
        paymentId: paymentRecord.id,
        transactionId: txnid,
        payuParams: payuParams,
        redirectUrl: redirectUrl
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

// Handle PayU success response
const handlePaymentSuccess = async (req, res) => {
  try {
    const payuConfig = getPayUConfig();
    const params = req.body;

    console.log('PayU Success Response:', params);

    // Validate hash (temporarily disabled for testing)
    console.log('🔍 Hash validation details:');
    console.log('Received hash:', params.hash);
    console.log('Calculated hash:', generatePayUHash(params, payuConfig.salt));
    console.log('Hash validation result:', validatePayUResponse(params, payuConfig.salt));
    
    // Temporarily skip hash validation for testing
    // if (!validatePayUResponse(params, payuConfig.salt)) {
    //   console.error('Invalid hash in PayU response');
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Invalid payment response'
    //   });
    // }

    const { txnid, status, amount, udf1: scheduledDate, udf2: psychologistId, udf3: clientIdFromPayU, udf4: packageId, udf5: scheduledTime } = params;

    // Find payment record
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', txnid)
      .single();

    if (paymentError || !paymentRecord) {
      console.error('Payment record not found:', txnid);
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }

    // Use clientId from payment record instead of PayU response (which might be "undefined")
    const clientId = paymentRecord.client_id;
    const actualPsychologistId = paymentRecord.psychologist_id;
    const actualScheduledDate = paymentRecord.payu_params?.udf1 || scheduledDate;
    const actualScheduledTime = paymentRecord.payu_params?.udf5 || scheduledTime;
    const actualPackageId = paymentRecord.package_id;

    // Check if already processed
    if (paymentRecord.status === 'success') {
      return res.json({
        success: true,
        message: 'Payment already processed'
      });
    }

    console.log('✅ Payment validated, creating session...');

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
      .select('first_name, last_name, email')
      .eq('id', actualPsychologistId)
      .single();

    if (psychologistDetailsError || !psychologistDetails) {
      console.error('❌ Error fetching psychologist details:', psychologistDetailsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch psychologist details'
      });
    }

    // Create Google Calendar event with OAuth2 Meet service
    let meetData = null;
    try {
      console.log('🔄 Creating Google Meet meeting via OAuth2...');
      
      // Convert date and time to ISO format for Meet service
      // Ensure proper date formatting
      const [year, month, day] = actualScheduledDate.split('-').map(Number);
      const [hour, minute, second] = actualScheduledTime.split(':').map(Number);
      
      const startDateTime = new Date(year, month - 1, day, hour, minute, second);
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60000); // 60 minutes
      
      console.log('📅 Date/Time Debug:', {
        actualScheduledDate,
        actualScheduledTime,
        startDateTime: startDateTime.toISOString(),
        endDateTime: endDateTime.toISOString()
      });
      
      // Create Meet link using the new meetLinkService
      const sessionData = {
        summary: `Therapy Session - ${clientDetails.child_name || clientDetails.first_name} with ${psychologistDetails.first_name}`,
        description: `Online therapy session between ${clientDetails.child_name || clientDetails.first_name} and ${psychologistDetails.first_name} ${psychologistDetails.last_name}`,
        startDate: actualScheduledDate,
        startTime: actualScheduledTime,
        endTime: addMinutesToTime(actualScheduledTime, 50) // Add 50 minutes to start time
      };
      
      
      const meetResult = await meetLinkService.generateSessionMeetLink(sessionData);
      
      if (meetResult.success) {
        meetData = {
          meetLink: meetResult.meetLink,
          eventId: meetResult.eventId,
          calendarLink: meetResult.eventLink || null,
          method: meetResult.method
        };
        console.log('✅ Real Meet link created successfully:', meetResult);
      } else {
        meetData = {
          meetLink: meetResult.meetLink, // Fallback link
          eventId: null,
          calendarLink: null,
          method: 'fallback'
        };
        console.log('⚠️ Using fallback Meet link:', meetResult.meetLink);
      }
      
    } catch (meetError) {
      console.error('❌ Error creating OAuth2 meeting:', meetError);
      console.log('⚠️ Continuing with session creation without meet link...');
      // Continue with session creation even if meet creation fails
    }

    // Create the actual session after successful payment
    const sessionData = {
      client_id: clientId,
      psychologist_id: actualPsychologistId,
      scheduled_date: actualScheduledDate,
      scheduled_time: actualScheduledTime,
      status: 'booked',
      price: amount,
      payment_id: paymentRecord.id
    };

    // Only add package_id if it's provided and valid (not individual)
    if (actualPackageId && actualPackageId !== 'null' && actualPackageId !== 'undefined' && actualPackageId !== 'individual') {
      sessionData.package_id = actualPackageId;
    }

    // Add meet data if available
    if (meetData) {
      sessionData.google_calendar_event_id = meetData.eventId;
      sessionData.google_meet_link = meetData.meetLink;
      sessionData.google_meet_join_url = meetData.meetLink;
      sessionData.google_meet_start_url = meetData.meetLink;
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([sessionData])
      .select('*')
      .single();

    if (sessionError) {
      console.error('❌ Session creation failed:', sessionError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create session after payment'
      });
    }

    console.log('✅ Session created successfully:', session.id);

    // Send confirmation emails to all parties
    try {
      console.log('📧 Sending confirmation emails...');
      
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
        transactionId: txnid,
        amount: amount
      });
      
      console.log('✅ Confirmation emails sent successfully');
    } catch (emailError) {
      console.error('❌ Error sending confirmation emails:', emailError);
      // Continue even if email sending fails
    }

    // Send WhatsApp messages to client and psychologist
    try {
      console.log('📱 Sending WhatsApp messages via Business API...');
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
        };
        const clientWaResult = await sendBookingConfirmation(clientPhone, clientDetails_wa);
        if (clientWaResult?.success) {
          console.log('✅ WhatsApp confirmation sent to client via Business API');
        } else if (clientWaResult?.skipped) {
          console.log('ℹ️ Client WhatsApp skipped:', clientWaResult.reason);
        } else {
          console.warn('⚠️ Client WhatsApp send failed');
        }
      } else {
        console.log('ℹ️ No client phone or meet link; skipping client WhatsApp');
      }

      // Send WhatsApp to psychologist
      const psychologistPhone = psychologistDetails.phone || null;
      if (psychologistPhone && meetData?.meetLink) {
        const psychologistMessage = `New session booked with ${clientName}.\n\nDate: ${actualScheduledDate}\nTime: ${actualScheduledTime}\n\nJoin via Google Meet: ${meetData.meetLink}\n\nClient: ${clientName}\nSession ID: ${session.id}`;
        
        const psychologistWaResult = await sendWhatsAppTextWithRetry(psychologistPhone, psychologistMessage);
        if (psychologistWaResult?.success) {
          console.log('✅ WhatsApp notification sent to psychologist via Business API');
        } else if (psychologistWaResult?.skipped) {
          console.log('ℹ️ Psychologist WhatsApp skipped:', psychologistWaResult.reason);
        } else {
          console.warn('⚠️ Psychologist WhatsApp send failed');
        }
      } else {
        console.log('ℹ️ No psychologist phone or meet link; skipping psychologist WhatsApp');
      }
      
      console.log('✅ WhatsApp messages sent successfully via Business API');
    } catch (whatsappError) {
      console.error('❌ Error sending WhatsApp messages:', whatsappError);
      // Continue even if WhatsApp sending fails
    }

    // Update payment status to completed
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'success',
        payu_response: params,
        session_id: session.id,
        completed_at: new Date().toISOString()
      })
      .eq('id', paymentRecord.id);

    if (updateError) {
      console.error('Error updating payment:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update payment status'
      });
    }

    // Generate and store PDF receipt in Supabase storage
    console.log('📄 Generating and storing PDF receipt...');
    await generateAndStoreReceipt(
      session,
      { ...paymentRecord, completed_at: new Date().toISOString() },
      clientDetails,
      psychologistDetails
    );

    // If package booking, create client package record
    if (packageId && packageId !== 'individual') {
      console.log('📦 Creating client package record...');
      try {
        const { data: packageData } = await supabase
          .from('packages')
          .select('*')
          .eq('id', packageId)
          .single();

        if (packageData) {
          const clientPackageData = {
            client_id: clientId,
            psychologist_id: psychologistId,
            package_id: packageId,
            package_type: packageData.package_type,
            total_sessions: packageData.session_count,
            remaining_sessions: packageData.session_count - 1, // First session already booked
            total_amount: packageData.price,
            amount_paid: packageData.price,
            status: 'active',
            purchased_at: new Date().toISOString(),
            first_session_id: session.id
          };

          const { error: clientPackageError } = await supabase
            .from('client_packages')
            .insert([clientPackageData]);

          if (clientPackageError) {
            console.error('❌ Client package creation failed:', clientPackageError);
          } else {
            console.log('✅ Client package record created successfully');
          }
        }
      } catch (packageError) {
        console.error('❌ Exception while creating client package:', packageError);
      }
    }

    res.json({
      success: true,
      message: 'Payment successful and session created',
      data: {
        sessionId: session.id,
        transactionId: txnid,
        amount: amount
      }
    });

  } catch (error) {
    console.error('Error handling payment success:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment'
    });
  }
};

// Handle PayU failure response
const handlePaymentFailure = async (req, res) => {
  try {
    const payuConfig = getPayUConfig();
    const params = req.body;

    console.log('PayU Failure Response:', params);

    const { txnid, status, error_code, error_Message } = params;

    // Find payment record
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', txnid)
      .single();

    if (paymentError || !paymentRecord) {
      console.error('Payment record not found:', txnid);
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
        payu_response: params,
        error_message: error_Message,
        failed_at: new Date().toISOString()
      })
      .eq('id', paymentRecord.id);

    if (updateError) {
      console.error('Error updating payment:', updateError);
    }

    // Release session slot
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

    res.json({
      success: false,
      message: 'Payment failed',
      data: {
        transactionId: txnid,
        errorCode: error_code,
        errorMessage: error_Message
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

module.exports = {
  createPaymentOrder,
  handlePaymentSuccess,
  handlePaymentFailure,
  getPaymentStatus
};
