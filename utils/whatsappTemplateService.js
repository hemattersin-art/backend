/**
 * WhatsApp Template Message Service
 * Handles sending template messages for booking confirmations
 */

const https = require('https');
const { URL } = require('url');

/**
 * Send booking confirmation via template message
 */
async function sendBookingConfirmationTemplate(phoneNumber, bookingDetails) {
  return new Promise((resolve) => {
    try {
      const token = process.env.WHATSAPP_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!token || !phoneNumberId) {
        console.warn('WhatsApp env not configured; skipping template send.');
        return resolve({ success: false, skipped: true, reason: 'missing_env' });
      }

      // For now, use hello_world template (works in test mode)
      // In production, create a custom template like "session_booking_confirmation"
      const templateData = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'template',
        template: {
          name: 'hello_world',
          language: {
            code: 'en_US'
          }
        }
      };

      // TODO: Replace with custom template when approved
      // const templateData = {
      //   messaging_product: 'whatsapp',
      //   to: phoneNumber,
      //   type: 'template',
      //   template: {
      //     name: 'session_booking_confirmation',
      //     language: { code: 'en_US' },
      //     components: [
      //       {
      //         type: 'body',
      //         parameters: [
      //           { type: 'text', text: bookingDetails.clientName },
      //           { type: 'text', text: bookingDetails.date },
      //           { type: 'text', text: bookingDetails.time },
      //           { type: 'text', text: bookingDetails.meetLink }
      //         ]
      //       }
      //     ]
      //   }
      // };

      const url = new URL(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`);
      const postData = JSON.stringify(templateData);

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      console.log('📱 Sending booking confirmation template...');
      console.log(`   To: ${phoneNumber}`);
      console.log(`   Template: hello_world (test mode)`);
      console.log(`   Booking: ${bookingDetails.clientName} - ${bookingDetails.date} ${bookingDetails.time}`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('✅ Booking confirmation template sent successfully');
              console.log(`   Message ID: ${jsonData.messages?.[0]?.id || 'N/A'}`);
              console.log(`   Status: ${jsonData.messages?.[0]?.message_status || 'N/A'}`);
              resolve({ success: true, data: jsonData });
            } else {
              console.error('❌ Booking confirmation template failed:', jsonData);
              resolve({ success: false, error: jsonData });
            }
          } catch (parseErr) {
            console.error('❌ Template response parse error:', parseErr);
            resolve({ success: false, error: { message: 'Invalid response', data } });
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ Template request error:', err);
        resolve({ success: false, error: err });
      });

      req.write(postData);
      req.end();

    } catch (err) {
      console.error('❌ Template send exception:', err);
      resolve({ success: false, error: err });
    }
  });
}

/**
 * Send session reminder template
 */
async function sendSessionReminderTemplate(phoneNumber, sessionDetails) {
  // Similar implementation for session reminders
  return sendBookingConfirmationTemplate(phoneNumber, sessionDetails);
}

/**
 * Send reschedule notification template
 */
async function sendRescheduleTemplate(phoneNumber, rescheduleDetails) {
  // Similar implementation for reschedule notifications
  return sendBookingConfirmationTemplate(phoneNumber, rescheduleDetails);
}

module.exports = {
  sendBookingConfirmationTemplate,
  sendSessionReminderTemplate,
  sendRescheduleTemplate
};
