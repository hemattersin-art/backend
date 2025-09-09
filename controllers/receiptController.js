const supabase = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

// Get all receipts for a client
const getClientReceipts = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔍 Fetching receipts for user:', userId);

    // Get client ID from clients table
    const { data: clientData, error: clientDataError } = await supabase.supabaseAdmin
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (clientDataError || !clientData) {
      console.log('📝 No client profile found, returning empty receipts');
      return res.json(
        successResponse([], 'No receipts found')
      );
    }

    const clientId = clientData.id;
    console.log('🔍 Fetching receipts for client:', clientId);

    // 1) Fetch sessions for this client
    const { data: clientSessions, error: sessionsError } = await supabase.supabaseAdmin
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
    const { data: receipts, error: receiptsError } = await supabase.supabaseAdmin
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
      const { data: paymentsData, error: paymentsError } = await supabase.supabaseAdmin
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
      const { data: psychologistsData, error: psychologistsError } = await supabase.supabaseAdmin
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

    // 5) Compose and filter only successful payments
    const composed = receipts
      .map(r => {
        const session = sessionMap.get(r.session_id);
        const payment = paymentMap.get(r.payment_id);
        if (!session || !payment) return null;
        if ((payment.status || '').toLowerCase() !== 'success') return null;
        const psych = session.psychologist_id ? psychologistMap.get(session.psychologist_id) : null;
        return {
          id: session.id,
          receipt_number: r.receipt_number,
          session_date: session.scheduled_date,
          session_time: session.scheduled_time,
          psychologist_name: psych ? `${psych.first_name} ${psych.last_name}` : 'Unknown',
          amount: payment.amount || 0,
          transaction_id: payment.transaction_id || 'N/A',
          payment_date: payment.completed_at || r.created_at,
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

    // Get client ID from clients table
    const { data: clientData, error: clientDataError } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (clientDataError || !clientData) {
      console.log('📝 No client profile found');
      return res.status(404).json(
        errorResponse('Client profile not found')
      );
    }

    const clientId = clientData.id;

    // Get the receipt data from receipts table
    const { data: receipt, error } = await supabase
      .from('receipts')
      .select(`
        id,
        receipt_number,
        file_url,
        file_path,
        session:sessions(
          id,
          client_id
        )
      `)
      .eq('session.id', receiptId)
      .eq('session.client_id', clientId)
      .single();

    if (error || !receipt) {
      console.log('❌ Receipt not found:', error);
      return res.status(404).json(
        errorResponse('Receipt not found')
      );
    }

    console.log('✅ Receipt found, redirecting to stored PDF:', receipt.file_url);

    // Redirect to the stored PDF URL
    res.redirect(receipt.file_url);

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
    doc.fontSize(24).font('Helvetica-Bold').text('Kuttikal', { align: 'center' });
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
    doc.fontSize(10).font('Helvetica').text('Thank you for choosing Kuttikal for your mental health needs.', { align: 'center' });
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

module.exports = {
  getClientReceipts,
  downloadReceipt
};
