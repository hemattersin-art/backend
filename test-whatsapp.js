#!/usr/bin/env node

/**
 * Test WhatsApp messaging functionality
 * Usage: node test-whatsapp.js
 */

process.stdout.write('Loading environment...\n');
require('dotenv').config();
const { sendWhatsAppTextWithRetry, sendBookingConfirmation } = require('./utils/whatsappService');

async function testWhatsApp() {
  process.stdout.write('🧪 Testing WhatsApp messaging...\n');
  
  // Test client number (add country code for E.164 format)
  const testPhoneNumber = '918281540004'; // India country code +91
  
  console.log('📱 Test phone number:', testPhoneNumber);
  console.log('🔑 WhatsApp Token exists:', !!process.env.WHATSAPP_TOKEN);
  console.log('📞 Phone Number ID exists:', !!process.env.WHATSAPP_PHONE_NUMBER_ID);
  
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error('❌ Missing WhatsApp environment variables:');
    console.error('   WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? '✅' : '❌');
    console.error('   WHATSAPP_PHONE_NUMBER_ID:', process.env.WHATSAPP_PHONE_NUMBER_ID ? '✅' : '❌');
    return;
  }
  
  try {
    // Test 1: Simple text message
    console.log('\n📤 Test 1: Sending simple text message...');
    const textResult = await sendWhatsAppTextWithRetry(testPhoneNumber, 
      'Hello! This is a test message from Little Care. Your WhatsApp integration is working correctly. 🎉'
    );
    
    if (textResult.success) {
      console.log('✅ Text message sent successfully!');
      console.log('📊 Response:', textResult.data);
    } else if (textResult.skipped) {
      console.log('⏭️ Text message skipped:', textResult.reason);
    } else {
      console.error('❌ Text message failed:', textResult.error);
    }
    
    // Test 2: Booking confirmation message
    console.log('\n📤 Test 2: Sending booking confirmation message...');
    const bookingDetails = {
      childName: 'Test Child',
      date: 'October 4, 2025',
      time: '1:00 PM - 2:00 PM',
      meetLink: 'https://meet.google.com/bqr-qhqw-rbv'
    };
    
    const bookingResult = await sendBookingConfirmation(testPhoneNumber, bookingDetails);
    
    if (bookingResult.success) {
      console.log('✅ Booking confirmation sent successfully!');
      console.log('📊 Response:', bookingResult.data);
    } else if (bookingResult.skipped) {
      console.log('⏭️ Booking confirmation skipped:', bookingResult.reason);
    } else {
      console.error('❌ Booking confirmation failed:', bookingResult.error);
    }
    
    console.log('\n🎉 WhatsApp testing completed!');
    console.log('📱 Check the phone number 8281540004 for messages.');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testWhatsApp().then(() => {
  console.log('\n✨ Test script finished.');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test script crashed:', error);
  process.exit(1);
});
