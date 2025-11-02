const https = require('https');
const { URL } = require('url');

/**
 * WhatsApp Business messaging via UltraMsg API
 * Requires env vars:
 * - ULTRAMSG_INSTANCE_ID: Your UltraMsg instance ID
 * - ULTRAMSG_TOKEN: Your UltraMsg API token
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
 * Format phone number to E.164 format if needed
 * UltraMsg accepts phone numbers with country code (without +)
 * e.g., 919876543210 for +91 9876543210
 * @param {string} phoneE164 - Phone number with country code (e.g., +919876543210)
 * @returns {string|null} - Formatted phone number without + or null if invalid
 */
function formatPhoneNumber(phoneE164) {
  if (!phoneE164) return null;
  
  // First normalize to ensure country code exists
  const normalized = normalizePhoneNumber(phoneE164);
  if (!normalized) return null;
  
  // Remove all non-digit characters (removes + and spaces)
  let cleaned = normalized.replace(/\D/g, '');
  
  // If starts with 0, remove leading 0
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Validate minimum length (should be at least country code + 10 digits for India)
  if (cleaned.length < 12) {
    console.warn(`⚠️ Phone number too short after formatting: ${cleaned}`);
    return null;
  }

  // Validate maximum length (international numbers can be up to 15 digits)
  if (cleaned.length > 15) {
    console.warn(`⚠️ Phone number too long after formatting: ${cleaned}`);
    return null;
  }
  
  return cleaned;
}

/**
 * Send WhatsApp text message via UltraMsg API
 * @param {string} toPhoneE164 - Phone number in E.164 format (e.g., +919876543210)
 * @param {string} message - Message text to send
 * @returns {Promise<Object>} - { success: boolean, data?: Object, error?: Object, skipped?: boolean, reason?: string }
 */
async function sendWhatsAppText(toPhoneE164, message) {
  return new Promise((resolve) => {
    try {
      const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
      const token = process.env.ULTRAMSG_TOKEN;

      if (!instanceId || !token) {
        console.warn('UltraMsg env not configured; skipping send.');
        return resolve({ success: false, skipped: true, reason: 'missing_env' });
      }

      // Format phone number for UltraMsg (normalizes and removes +)
      const formattedPhone = formatPhoneNumber(toPhoneE164);
      if (!formattedPhone) {
        console.warn('Invalid or incomplete phone number format:', toPhoneE164);
        return resolve({ success: false, skipped: true, reason: 'invalid_phone' });
      }

      console.log(`📱 Formatting phone: ${toPhoneE164} -> ${formattedPhone}`);

      // UltraMsg API endpoint
      const apiUrl = `https://api.ultramsg.com/${instanceId}/messages/chat`;
      const url = new URL(apiUrl);
      
      // Build request body
      const postData = JSON.stringify({
        to: formattedPhone,
        body: message
      });

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      // Add token to query string (UltraMsg uses query param for token)
      url.searchParams.set('token', token);
      options.path = url.pathname + url.search;

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            
            // UltraMsg success response usually has "sent" or "success" field
            if (res.statusCode >= 200 && res.statusCode < 300) {
              if (jsonData.sent === true || jsonData.success === true || jsonData.id || jsonData.message === 'ok') {
                console.log('✅ WhatsApp message sent via UltraMsg:', jsonData.id || 'OK');
                resolve({ success: true, data: jsonData });
              } else {
                console.error('⚠️ UltraMsg returned unexpected response:', jsonData);
                resolve({ success: false, error: jsonData });
              }
            } else {
              console.error('❌ UltraMsg API error:', jsonData);
              resolve({ success: false, error: jsonData });
            }
          } catch (parseErr) {
            console.error('❌ UltraMsg response parse error:', parseErr, 'Raw data:', data);
            resolve({ success: false, error: { message: 'Invalid response', data } });
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ UltraMsg request error:', err);
        resolve({ success: false, error: err });
      });

      req.write(postData);
      req.end();
    } catch (err) {
      console.error('❌ UltraMsg send exception:', err);
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

/**
 * Build booking confirmation message
 * @param {Object} details - { childName, date, time, meetLink }
 * @returns {string} Formatted message
 */
function buildBookingMessage({ childName, date, time, meetLink }) {
  const who = childName ? `${childName}'s` : 'your';
  return (
    `Your ${who} therapy session is booked.\n` +
    `Date: ${date}\nTime: ${time}\n` +
    `Join via Google Meet: ${meetLink}\n` +
    `We look forward to seeing you.`
  );
}

/**
 * Send booking confirmation WhatsApp message
 * @param {string} toPhoneE164 - Phone number in E.164 format
 * @param {Object} details - { childName, date, time, meetLink }
 * @returns {Promise<Object>} - { success: boolean, ... }
 */
async function sendBookingConfirmation(toPhoneE164, details) {
  const message = buildBookingMessage(details);
  return await sendWhatsAppTextWithRetry(toPhoneE164, message);
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppTextWithRetry,
  sendBookingConfirmation,
  formatPhoneNumber,
  normalizePhoneNumber, // Export for testing if needed
};
