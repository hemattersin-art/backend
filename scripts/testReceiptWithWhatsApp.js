/**
 * Test script to generate a receipt with dummy data and send it via WhatsApp
 * This tests the new receipt template
 * 
 * Usage: node backend/scripts/testReceiptWithWhatsApp.js
 * 
 * Make sure .env file is configured with:
 * - WASENDER_API_KEY
 * - SUPABASE_URL (optional, only needed if generating receipt number)
 * - SUPABASE_SERVICE_ROLE_KEY (optional)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

// Import PDF generation directly (bypasses database dependencies for simple test)
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

async function testReceiptWithWhatsApp() {
  try {
    console.log('🧪 Starting receipt test with WhatsApp...');
    
    // Dummy receipt data
    const dummyReceiptDetails = {
      receipt_number: 'RCP-000001',
      receipt_number_long: 'R-0001',
      session_date: '2025-12-25',
      session_time: '10:00:00',
      session_status: 'booked',
      psychologist_name: 'Dr. John Smith',
      psychologist_email: 'john.smith@example.com',
      psychologist_phone: '+919876543210',
      client_name: 'Test Client',
      client_email: 'test@example.com',
      client_phone: '+919876543211',
      transaction_id: 'TXN123456789',
      amount: '1500',
      payment_date: new Date().toISOString(),
      payment_method: 'Online Payment',
      currency: 'INR',
      item_description: 'Individual Therapy',
      quantity: '1',
      is_package: false
    };

    console.log('📄 Generating receipt PDF with dummy data...');
    
    // Generate PDF
    const pdfBuffer = await generateReceiptPDF(dummyReceiptDetails);
    
    if (!pdfBuffer) {
      throw new Error('Failed to generate PDF');
    }
    
    console.log(`✅ PDF generated successfully, size: ${pdfBuffer.length} bytes`);
    
    // Test phone number
    const testPhone = '+918281540004';
    
    console.log(`📱 Sending receipt PDF via WhatsApp to ${testPhone}...`);
    
    // Send via WhatsApp using the sendBookingConfirmation function
    // We'll use it with just the receipt PDF buffer
    const whatsappDetails = {
      childName: 'Test Child',
      date: dummyReceiptDetails.session_date,
      time: dummyReceiptDetails.session_time,
      meetLink: 'https://meet.google.com/test-link',
      psychologistName: dummyReceiptDetails.psychologist_name,
      receiptPdfBuffer: pdfBuffer,
      receiptNumber: dummyReceiptDetails.receipt_number,
      clientName: dummyReceiptDetails.client_name,
      isFreeAssessment: false,
      packageInfo: null
    };
    
    const result = await sendBookingConfirmation(testPhone, whatsappDetails);
    
    if (result.success) {
      console.log('✅ Receipt sent successfully via WhatsApp!');
      console.log('📊 Result:', JSON.stringify(result, null, 2));
    } else {
      console.error('❌ Failed to send receipt via WhatsApp');
      console.error('Error:', result.error || result.reason);
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testReceiptWithWhatsApp()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

