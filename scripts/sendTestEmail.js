/**
 * Test script to send a sample booking confirmation email
 * 
 * Usage: node backend/scripts/sendTestEmail.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const emailService = require('../utils/emailService');

async function sendTestEmail() {
  try {
    console.log('📧 Sending test booking confirmation email...\n');
    
    // Sample data for the email
    const emailData = {
      to: 'abhishekravi063@gmail.com',
      clientName: 'Abhishek Ravi',
      psychologistName: 'Dr. Liana Sameer',
      scheduledDate: 'Mon, 12 Jan 2026',
      scheduledTime: '9:00 PM (IST)',
      googleMeetLink: 'https://meet.google.com/ebg-edjo-omt',
      googleCalendarLink: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Session+with+Little+Care&dates=20260112T153000Z/20260112T163000Z&details=Your+therapy+session',
      outlookCalendarLink: 'https://outlook.live.com/calendar/0/deeplink/compose?subject=Session+with+Little+Care&startdt=2026-01-12T15:30:00Z&enddt=2026-01-12T16:30:00Z',
      price: 1500,
      packageInfo: {
        totalSessions: 3,
        completedSessions: 0
      }
    };

    await emailService.sendClientConfirmation(emailData);
    
    console.log('✅ Test email sent successfully!');
    console.log(`   To: ${emailData.to}`);
    console.log(`   Subject: Session Confirmed - ${emailData.scheduledDate} at ${emailData.scheduledTime}\n`);
    
  } catch (error) {
    console.error('❌ Error sending test email:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  sendTestEmail();
}

module.exports = { sendTestEmail };

