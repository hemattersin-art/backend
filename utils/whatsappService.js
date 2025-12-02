const https = require('https');
const { URL } = require('url');

/**
 * WhatsApp messaging via WASenderApi
 * Requires env vars:
 * - WASENDER_API_KEY: Your WASenderApi API key
 */

/**
 * Normalize phone number to ensure it has country code
 * Handles various formats and adds default country code if missing
 * @param {string} phoneNumber - Phone number in any format
 * @param {string} defaultCountryCode - Default country code (default: '+91')
 * @returns {string|null} - Normalized phone number with country code or null if invalid
 */
function normalizePhoneNumber(phoneNumber, defaultCountryCode = '+91') {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return null;
  }

  // Remove all whitespace
  let cleaned = phoneNumber.trim();

  // If empty or just the country code itself, return null
  if (!cleaned || cleaned === defaultCountryCode || cleaned === defaultCountryCode.replace('+', '')) {
    return null;
  }

  // If already starts with +, use as is
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // If starts with country code without + (e.g., "91...")
  if (cleaned.startsWith('91') && cleaned.length > 10) {
    return '+' + cleaned;
  }

  // If starts with 0 (common in India), remove it and add country code
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // If it's a 10-digit number (Indian mobile), add default country code
  if (/^\d{10}$/.test(cleaned)) {
    return defaultCountryCode + cleaned;
  }

  // If it's already a valid international number without +, add +
  if (/^\d{10,15}$/.test(cleaned)) {
    // If it looks like it might already have country code (11+ digits)
    if (cleaned.length >= 11) {
      // Check if it starts with a known country code
      if (cleaned.startsWith('91') && cleaned.length === 12) {
        return '+' + cleaned;
      }
    }
    // For 10 digits, assume it needs country code
    if (cleaned.length === 10) {
      return defaultCountryCode + cleaned;
    }
  }

  // If we can't normalize it, return null
  return null;
}

/**
 * Format phone number to E.164 format if needed.
 * WASenderApi accepts numbers with leading + and country code.
 * @param {string} phoneE164 - Phone number in any common format
 * @returns {string|null} - Normalized E.164 (+<country><number>) or null if invalid
 */
function formatPhoneNumber(phoneE164) {
  if (!phoneE164) return null;
  
  // First normalize to ensure country code exists
  const normalized = normalizePhoneNumber(phoneE164);
  if (!normalized) return null;
  
  // Basic validation for E.164: leading + and 8-15 digits
  const cleaned = normalized.replace(/\s/g, '');
  if (!/^\+\d{8,15}$/.test(cleaned)) {
    console.warn(`⚠️ Phone number not in valid E.164 format: ${cleaned}`);
    return null;
  }

  return cleaned;
}

/**
 * Send WhatsApp text message via WASenderApi
 * @param {string} toPhoneE164 - Phone number in E.164 format (e.g., +919876543210)
 * @param {string} message - Message text to send
 * @returns {Promise<Object>} - { success: boolean, data?: Object, error?: Object, skipped?: boolean, reason?: string }
 */
async function sendWhatsAppText(toPhoneE164, message) {
  return new Promise((resolve) => {
    try {
      const apiKey = process.env.WASENDER_API_KEY;

      if (!apiKey) {
        console.warn('WASenderApi env (WASENDER_API_KEY) not configured; skipping send.');
        return resolve({ success: false, skipped: true, reason: 'missing_env' });
      }

      // Normalize phone number for WASenderApi (E.164 with +)
      const formattedPhone = formatPhoneNumber(toPhoneE164);
      if (!formattedPhone) {
        console.warn('Invalid or incomplete phone number format:', toPhoneE164);
        return resolve({ success: false, skipped: true, reason: 'invalid_phone' });
      }

      console.log(`📱 Formatting phone: ${toPhoneE164} -> ${formattedPhone}`);

      // WASenderApi endpoint
      const apiUrl = 'https://wasenderapi.com/api/send-message';
      const url = new URL(apiUrl);
      
      // Build request body
      const postData = JSON.stringify({
        to: formattedPhone,
        text: message
      });

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          Authorization: `Bearer ${apiKey}`
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data || '{}');

            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('✅ WhatsApp message sent via WASenderApi:', jsonData);
              resolve({ success: true, data: jsonData });
            } else {
              console.error('❌ WASenderApi error:', jsonData);
              resolve({ success: false, error: jsonData });
            }
          } catch (parseErr) {
            console.error('❌ WASenderApi response parse error:', parseErr, 'Raw data:', data);
            resolve({ success: false, error: { message: 'Invalid response', data } });
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ WASenderApi request error:', err);
        resolve({ success: false, error: err });
      });

      req.write(postData);
      req.end();
    } catch (err) {
      console.error('❌ WASenderApi send exception:', err);
      resolve({ success: false, error: err });
    }
  });
}

/**
 * Send WhatsApp message with retry logic
 * @param {string} toPhoneE164 - Phone number in E.164 format
 * @param {string} message - Message text to send
 * @param {number} retryCount - Current retry attempt (internal use)
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>} - { success: boolean, ... }
 */
async function sendWhatsAppTextWithRetry(toPhoneE164, message, retryCount = 0, maxRetries = 2) {
  const result = await sendWhatsAppText(toPhoneE164, message);
  
  // If failed and we haven't exceeded max retries, retry
  if (!result.success && !result.skipped && retryCount < maxRetries) {
    const delay = (retryCount + 1) * 1000; // Exponential backoff: 1s, 2s
    console.log(`🔄 Retrying WhatsApp send (attempt ${retryCount + 1}/${maxRetries}) after ${delay}ms...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return await sendWhatsAppTextWithRetry(toPhoneE164, message, retryCount + 1, maxRetries);
  }
  
  return result;
}

// Helper: format date string (YYYY-MM-DD) to friendly format in IST
function formatFriendlyDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(`${dateStr}T00:00:00+05:30`);
    return d.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  } catch {
    return dateStr;
  }
}

// Helper: format time string (HH:mm or HH:mm:ss) to h:mm AM/PM IST
function formatFriendlyTime(timeStr) {
  if (!timeStr) return '';
  try {
    const [h, m] = timeStr.split(':');
    const date = new Date();
    date.setHours(parseInt(h, 10), parseInt(m || '0', 10), 0, 0);
    return date.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });
  } catch {
    return timeStr;
  }
}

/**
 * Build main booking confirmation message
 * @param {Object} details - { childName, date, time, meetLink }
 * @returns {string} Formatted message
 */
function buildBookingMessage({ childName, date, time, meetLink }) {
  const childLabel = childName || 'your child';
  const friendlyDate = formatFriendlyDate(date);
  const friendlyTime = formatFriendlyTime(time);

  return (
    `🧸 Therapy Session Confirmed!\n\n` +
    `Session details:\n\n` +
    `👧 Child: ${childLabel}\n\n` +
    `📅 Date: ${friendlyDate || date}\n\n` +
    `⏰ Time: ${friendlyTime || time} (IST)\n\n` +
    (meetLink ? `🔗 Google Meet: ${meetLink}\n\n` : '\n') +
    `We look forward to seeing you. 💜`
  );
}

/**
 * Send booking confirmation WhatsApp messages (multi-part)
 * @param {string} toPhoneE164 - Phone number in E.164 format
 * @param {Object} details - { childName, date, time, meetLink, receiptUrl? }
 * @returns {Promise<Object>} - { success: boolean, ... }
 */
async function sendBookingConfirmation(toPhoneE164, details) {
  const {
    childName,
    date,
    time,
    meetLink,
    receiptUrl
  } = details || {};

  const sessionsUrl =
    process.env.CLIENT_SESSIONS_URL ||
    'https://little.care/profile/sessions';

  // 1) Welcome (message 1)
  const welcomeMessage =
    `👋 Welcome to Little Care! 🌈\n\n` +
    `Thank you for booking a therapy session with our child specialists.`;

  // 2) Booking details + Meet link (message 2)
  const bookingMessage = buildBookingMessage({
    childName,
    date,
    time,
    meetLink
  });

  // 3) Preparation / instructions (message 3)
  const instructionMessage =
    `📝 Before the session:\n\n` +
    `• Please be ready at least 10 minutes before your scheduled time.\n\n` +
    `• Ensure a stable internet connection.\n\n` +
    `• Choose a quiet place with good lighting and minimal background noise.\n\n` +
    `• Keep your device charged or connected to power.`;

  // 4) Sessions page link (message 4)
  const sessionsMessage =
    `🔁 For rescheduling, cancellation, or messaging your psychologist, ` +
    `please visit your sessions page:\n` +
    `${sessionsUrl}`;

  // 5) Contact / enquiries (message 5)
  const contactMessage =
    `📞 For any other enquiry or help, you can reach us on:\n` +
    `WhatsApp / Call: +91 95390 07766`;

  // Send as separate messages in order, with a delay between each to respect WASenderApi account protection
  const messages = [
    welcomeMessage,
    bookingMessage,
    instructionMessage,
    sessionsMessage,
    contactMessage
  ];

  let lastResult = null;
  for (let i = 0; i < messages.length; i++) {
    lastResult = await sendWhatsAppTextWithRetry(toPhoneE164, messages[i]);
    // Wait ~5.5s between messages to stay under "1 message per 5 seconds" limit
    if (i < messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5500));
    }
  }

  // 6) Send receipt PDF as document (if available)
  if (receiptUrl) {
    try {
      const apiKey = process.env.WASENDER_API_KEY;
      if (apiKey) {
        const formattedPhone = formatPhoneNumber(toPhoneE164);
        if (formattedPhone) {
          const apiUrl = 'https://wasenderapi.com/api/send-message';
          const url = new URL(apiUrl);

          const postData = JSON.stringify({
            to: formattedPhone,
            text: '🧾 Here is your receipt for the session.',
            documentUrl: receiptUrl,
            fileName: 'receipt.pdf'
          });

          const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              Authorization: `Bearer ${apiKey}`
            }
          };

          await new Promise((resolve) => {
            const req = https.request(options, (res) => {
              let data = '';
              res.on('data', (chunk) => {
                data += chunk;
              });
              res.on('end', () => {
                try {
                  const jsonData = JSON.parse(data || '{}');
                  if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('✅ WhatsApp receipt PDF sent via WASenderApi:', jsonData);
                  } else {
                    console.error('❌ WASenderApi receipt send error:', jsonData);
                  }
                } catch (err) {
                  console.error('❌ WASenderApi receipt response parse error:', err, 'Raw data:', data);
                }
                resolve();
              });
            });

            req.on('error', (err) => {
              console.error('❌ WASenderApi receipt request error:', err);
              resolve();
            });

            req.write(postData);
            req.end();
          });
        }
      }
    } catch (err) {
      console.error('❌ Error sending WhatsApp receipt PDF:', err);
    }
  }

  return lastResult || { success: false, skipped: true, reason: 'no_messages_sent' };
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppTextWithRetry,
  sendBookingConfirmation,
  formatPhoneNumber,
  normalizePhoneNumber, // Export for testing if needed
};
