const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

// Get all receipts for a client
const getClientReceipts = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔍 Fetching receipts for user:', userId);
    console.log('🔍 req.user data:', { id: req.user.id, client_id: req.user.client_id, role: req.user.role });

    // Determine client ID: use client_id if available (new system), otherwise use id (old system)
    let clientId = req.user.client_id || userId;
    
    // If still not found, try to lookup client by user_id
    if (!clientId || clientId === userId) {
      const { data: clientData, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', userId)
        .single();
      
      if (!clientError && clientData) {
        clientId = clientData.id;
        console.log('🔍 Found client by user_id:', clientId);
      }
    }
    
    console.log('🔍 Using client ID for receipts:', clientId);

    // 1) Fetch sessions for this client
    const { data: clientSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select('id, client_id, scheduled_date, scheduled_time, status, psychologist_id')
      .eq('client_id', clientId);

    if (sessionsError) {
      console.error('❌ Error fetching client sessions:', sessionsError);
      return res.json(successResponse([], 'No receipts found'));
    }

    console.log('📊 Sessions for client:', clientSessions?.length || 0);
    if (!clientSessions || clientSessions.length === 0) {
      return res.json(successResponse([], 'No receipts found'));
    }

    const sessionIdList = clientSessions.map(s => s.id);
    const sessionMap = new Map(clientSessions.map(s => [s.id, s]));

    // 2) Fetch receipts for those sessions
    const { data: receipts, error: receiptsError } = await supabaseAdmin
      .from('receipts')
      .select('id, receipt_number, file_url, file_size, created_at, session_id, payment_id')
      .in('session_id', sessionIdList)
      .order('created_at', { ascending: false });

    if (receiptsError) {
      console.error('❌ Error fetching receipts:', receiptsError);
      return res.json(successResponse([], 'No receipts found'));
    }

    console.log('📊 Receipts found for client sessions:', receipts?.length || 0);
    if (!receipts || receipts.length === 0) {
      return res.json(successResponse([], 'No receipts found'));
    }

    // 3) Fetch payments for those receipts
    const paymentIdList = receipts.map(r => r.payment_id).filter(Boolean);
    let payments = [];
    if (paymentIdList.length > 0) {
      const { data: paymentsData, error: paymentsError } = await supabaseAdmin
        .from('payments')
        .select('id, transaction_id, amount, status, completed_at')
        .in('id', paymentIdList);
      if (paymentsError) {
        console.error('❌ Error fetching payments:', paymentsError);
      } else {
        payments = paymentsData || [];
      }
    }
    const paymentMap = new Map(payments.map(p => [p.id, p]));

    // 4) Fetch psychologists for display names
    const psychologistIdList = Array.from(new Set(clientSessions.map(s => s.psychologist_id).filter(Boolean)));
    let psychologists = [];
    if (psychologistIdList.length > 0) {
      const { data: psychologistsData, error: psychologistsError } = await supabaseAdmin
        .from('psychologists')
        .select('id, first_name, last_name')
        .in('id', psychologistIdList);
      if (psychologistsError) {
        console.error('❌ Error fetching psychologists:', psychologistsError);
      } else {
        psychologists = psychologistsData || [];
      }
    }
    const psychologistMap = new Map(psychologists.map(p => [p.id, p]));

    // 5) Compose and filter only successful/paid payments
    const composed = receipts
      .map(r => {
        const session = sessionMap.get(r.session_id);
        if (!session) {
          console.log('⚠️ Receipt has no matching session:', r.id, 'session_id:', r.session_id);
          return null;
        }
        
        const payment = paymentMap.get(r.payment_id);
        if (!payment) {
          console.log('⚠️ Receipt has no matching payment:', r.id, 'payment_id:', r.payment_id);
          return null;
        }
        
        // Include receipts for 'success' and 'cash' payment statuses
        const paymentStatus = (payment.status || '').toLowerCase();
        if (paymentStatus !== 'success' && paymentStatus !== 'cash') {
          console.log('⚠️ Receipt payment status is not success/cash:', r.id, 'status:', payment.status);
          return null;
        }
        
        const psych = session.psychologist_id ? psychologistMap.get(session.psychologist_id) : null;
        return {
          id: r.id, // Use receipt ID instead of session ID for proper download
          receipt_id: r.id,
          session_id: session.id,
          receipt_number: r.receipt_number,
          session_date: session.scheduled_date,
          session_time: session.scheduled_time,
          psychologist_name: psych ? `${psych.first_name} ${psych.last_name}` : 'Unknown',
          amount: payment.amount || 0,
          transaction_id: payment.transaction_id || 'N/A',
          payment_date: payment.completed_at || payment.created_at || r.created_at,
          status: session.status,
          file_url: r.file_url,
          file_size: r.file_size
        };
      })
      .filter(Boolean);

    console.log('📊 Composed receipts count:', composed.length);

    res.json(
      successResponse(composed, 'Receipts fetched successfully')
    );

  } catch (error) {
    console.error('Get client receipts error:', error);
    // Return empty array instead of error
    res.json(
      successResponse([], 'No receipts found')
    );
  }
};

// Download receipt as PDF
const downloadReceipt = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const userId = req.user.id;

    console.log('🔍 Download receipt request - receiptId:', receiptId, 'userId:', userId);

    // Get client ID from clients table
    const { data: clientData, error: clientDataError } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', userId)
      .single();

    if (clientDataError || !clientData) {
      console.log('📝 No client profile found');
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = clientData.id;

    // Try to get receipt by receipt ID first (new approach)
    let { data: receipt, error: receiptError } = await supabaseAdmin
      .from('receipts')
      .select('id, receipt_number, file_url, file_path, session_id')
      .eq('id', receiptId)
      .single();

    // Fallback: if not found by ID, try by session_id (backward compatibility)
    if (receiptError || !receipt) {
      console.log('⚠️ Receipt not found by ID, trying by session_id:', receiptId);
      ({ data: receipt, error: receiptError } = await supabaseAdmin
        .from('receipts')
        .select('id, receipt_number, file_url, file_path, session_id')
        .eq('session_id', receiptId)
        .single());
    }

    if (receiptError || !receipt) {
      console.log('❌ Receipt not found:', receiptId, receiptError);
      return res.status(404).json(
        errorResponse('Receipt not found')
      );
    }

    // Verify the session belongs to this client
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('id, client_id')
      .eq('id', receipt.session_id)
      .maybeSingle(); // Use maybeSingle() to avoid error if session doesn't exist

    if (sessionError) {
      // Only log if it's not a "not found" error (PGRST116)
      if (sessionError.code !== 'PGRST116') {
        console.error('❌ Error fetching session:', sessionError);
      } else {
        console.log('ℹ️ Session not found for receipt:', receipt.session_id);
      }
    }

    if (!session || session.client_id !== clientId) {
      console.log('❌ Unauthorized receipt access or session not found');
      return res.status(404).json(
        errorResponse('Receipt not found')
      );
    }

    if (!receipt.file_url) {
      console.log('❌ Receipt has no file URL:', receipt.id);
      return res.status(404).json(
        errorResponse('Receipt file not available')
      );
    }

    console.log('✅ Receipt found, returning download URL:', receipt.file_url);

    // Return JSON with the download URL to match frontend expectations
    return res.json(
      successResponse({ downloadUrl: receipt.file_url }, 'Download URL generated')
    );

  } catch (error) {
    console.error('Download receipt error:', error);
    res.status(500).json(
      errorResponse('Internal server error while downloading receipt')
    );
  }
};

// Generate PDF receipt
const generateReceiptPDF = async (receipt) => {
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50
    });

    const chunks = [];
    let pdfBuffer = null;
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      pdfBuffer = Buffer.concat(chunks);
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
    doc.text(`Receipt Number: RCP-${receipt.id.toString().padStart(6, '0')}`);
    doc.text(`Date: ${new Date(receipt.payment.completed_at).toLocaleDateString('en-IN')}`);
    doc.text(`Time: ${new Date(receipt.payment.completed_at).toLocaleTimeString('en-IN')}`);
    doc.moveDown();

    // Session details
    doc.fontSize(12).font('Helvetica-Bold').text('Session Details:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Date: ${new Date(receipt.scheduled_date).toLocaleDateString('en-IN')}`);
    doc.text(`Time: ${receipt.scheduled_time}`);
    doc.text(`Status: ${receipt.status}`);
    doc.moveDown();

    // Psychologist details
    doc.fontSize(12).font('Helvetica-Bold').text('Therapist:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${receipt.psychologist.first_name} ${receipt.psychologist.last_name}`);
    doc.text(`Email: ${receipt.psychologist.email}`);
    doc.text(`Phone: ${receipt.psychologist.phone_number}`);
    doc.moveDown();

    // Client details
    doc.fontSize(12).font('Helvetica-Bold').text('Client:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${receipt.client.user.first_name} ${receipt.client.user.last_name}`);
    doc.text(`Email: ${receipt.client.user.email}`);
    doc.moveDown();

    // Payment details
    doc.fontSize(12).font('Helvetica-Bold').text('Payment Details:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Transaction ID: ${receipt.payment.transaction_id}`);
    doc.text(`Amount: ₹${receipt.payment.amount}`);
    doc.text(`Payment Date: ${new Date(receipt.payment.completed_at).toLocaleDateString('en-IN')}`);
    doc.moveDown();

    // Footer
    doc.fontSize(10).font('Helvetica').text('Thank you for choosing Little Care for your mental health needs.', { align: 'center' });
    doc.text('For any queries, please contact our support team.', { align: 'center' });

    doc.end();

    // Wait for the PDF to be generated
    return new Promise((resolve, reject) => {
      doc.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          console.log('✅ PDF generated successfully, size:', buffer.length, 'bytes');
          resolve(buffer);
        } catch (error) {
          console.error('❌ Error generating PDF buffer:', error);
          reject(error);
        }
      });
      
      doc.on('error', (error) => {
        console.error('❌ PDF generation error:', error);
        reject(error);
      });
    });

  } catch (error) {
    console.error('❌ Error in generateReceiptPDF:', error);
    throw error;
  }
};

// Get receipt by Razorpay order ID
const getReceiptByOrderId = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    if (!orderId) {
      return res.status(400).json(
        errorResponse('Order ID is required')
      );
    }

    // Get client ID from clients table
    // Clients table has user_id that references users.id
    // Try new system first: lookup by user_id
    let { data: clientData, error: clientDataError } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .single();

    // Fallback to old system: lookup by id (backward compatibility)
    if (clientDataError || !clientData) {
      ({ data: clientData, error: clientDataError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', userId)
        .single());
    }

    if (clientDataError || !clientData) {
      console.log('📝 No client profile found for user:', userId, clientDataError);
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = clientData.id;
    console.log('🔍 User ID:', userId, 'Client ID:', clientId);

    // Find payment by razorpay_order_id
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('id, session_id, client_id, razorpay_order_id, transaction_id, status')
      .eq('razorpay_order_id', orderId)
      .single();

    if (paymentError || !payment) {
      console.log('❌ Payment not found for order:', orderId, paymentError);
      return res.status(404).json(
        errorResponse('Payment not found')
      );
    }

    console.log('🔍 Payment found - Payment client_id:', payment.client_id, 'User client_id:', clientId);

    // Verify the payment belongs to this client
    if (payment.client_id !== clientId) {
      console.log('❌ Unauthorized receipt access - Payment client_id:', payment.client_id, 'does not match user client_id:', clientId);
      return res.status(404).json(
        errorResponse('Receipt not found')
      );
    }

    // Get session details for this payment (even if receipt doesn't exist yet)
    let sessionDetails = null;
    if (payment.session_id) {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .select(`
          id,
          scheduled_date,
          scheduled_time,
          status,
          psychologist:psychologists(
            id,
            first_name,
            last_name
          )
        `)
        .eq('id', payment.session_id)
        .maybeSingle(); // Use maybeSingle() to avoid error if session doesn't exist yet

      if (sessionError) {
        // Only log if it's not a "not found" error (PGRST116)
        if (sessionError.code !== 'PGRST116') {
          console.error('❌ Error fetching session:', sessionError);
        } else {
          console.log('ℹ️ Session not found yet (may still be processing):', payment.session_id);
        }
      } else if (session) {
        sessionDetails = {
          scheduled_date: session.scheduled_date,
          scheduled_time: session.scheduled_time,
          status: session.status,
          psychologist: session.psychologist ? {
            first_name: session.psychologist.first_name,
            last_name: session.psychologist.last_name
          } : null
        };
        console.log('✅ Session details found:', sessionDetails);
      } else {
        console.log('ℹ️ Session not found for payment session_id:', payment.session_id);
      }
    }

    // Get receipt by payment_id (may not exist yet if payment verification is still processing)
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from('receipts')
      .select('id, receipt_number, file_url, file_path, session_id, payment_id, created_at')
      .eq('payment_id', payment.id)
      .single();

    // If receipt doesn't exist yet, return payment and session info anyway
    // This handles the case where payment verification is still processing
    if (receiptError || !receipt) {
      console.log('⚠️ Receipt not found for payment:', payment.id, '- Payment may still be processing');
      return res.json(
        successResponse({
          receipt_available: false,
          payment_status: payment.status || 'pending',
          transaction_id: payment.transaction_id,
          session: sessionDetails, // Include session details even without receipt
          message: 'Receipt is being generated. Please check back in a moment.'
        }, 'Payment found, receipt pending')
      );
    }

    console.log('✅ Receipt found for order:', orderId);

    return res.json(
      successResponse({
        receipt_available: true,
        receipt_number: receipt.receipt_number,
        file_url: receipt.file_url,
        file_path: receipt.file_path,
        created_at: receipt.created_at,
        transaction_id: payment.transaction_id,
        payment_status: payment.status || 'success',
        session: sessionDetails // Include session details
      }, 'Receipt fetched successfully')
    );

  } catch (error) {
    console.error('Get receipt by order ID error:', error);
    res.status(500).json(
      errorResponse('Internal server error while fetching receipt')
    );
  }
};

module.exports = {
  getClientReceipts,
  downloadReceipt,
  getReceiptByOrderId
};
