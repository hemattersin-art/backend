const https = require('https');
const { URL } = require('url');

/**
 * WhatsApp Business messaging via Meta Graph API
 * Requires env vars:
 * - WHATSAPP_TOKEN: Permanent or long-lived access token
 * - WHATSAPP_PHONE_NUMBER_ID: Phone number ID from WhatsApp Business
 * - WHATSAPP_APP_ID: Your Meta app ID (for token refresh)
 * - WHATSAPP_APP_SECRET: Your Meta app secret (for token refresh)
 */

// Token refresh function
async function refreshWhatsAppToken() {
  return new Promise((resolve) => {
    try {
      const appId = process.env.WHATSAPP_APP_ID;
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      const currentToken = process.env.WHATSAPP_TOKEN;

      if (!appId || !appSecret || !currentToken) {
        console.warn('WhatsApp token refresh: Missing required env vars');
        return resolve({ success: false, reason: 'missing_env' });
      }

      const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
      url.searchParams.set('grant_type', 'fb_exchange_token');
      url.searchParams.set('client_id', appId);
      url.searchParams.set('client_secret', appSecret);
      url.searchParams.set('fb_exchange_token', currentToken);

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300 && jsonData.access_token) {
              console.log('✅ WhatsApp token refreshed successfully');
              resolve({ success: true, token: jsonData.access_token, expiresIn: jsonData.expires_in });
            } else {
              console.error('❌ WhatsApp token refresh failed:', jsonData);
              resolve({ success: false, error: jsonData });
            }
          } catch (parseErr) {
            console.error('❌ WhatsApp token refresh parse error:', parseErr);
            resolve({ success: false, error: { message: 'Invalid response', data } });
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ WhatsApp token refresh request error:', err);
        resolve({ success: false, error: err });
      });

      req.end();
    } catch (err) {
      console.error('❌ WhatsApp token refresh exception:', err);
      resolve({ success: false, error: err });
    }
  });
}
async function sendWhatsAppText(toPhoneE164, message) {
  return new Promise((resolve) => {
    try {
      const token = process.env.WHATSAPP_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!token || !phoneNumberId) {
        console.warn('WhatsApp env not configured; skipping send.');
        return resolve({ success: false, skipped: true, reason: 'missing_env' });
      }

      const url = new URL(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`);
      const postData = JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhoneE164,
        type: 'text',
        text: { body: message }
      });

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

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, data: jsonData });
            } else {
              console.error('WhatsApp send error:', jsonData);
              resolve({ success: false, error: jsonData });
            }
          } catch (parseErr) {
            console.error('WhatsApp response parse error:', parseErr);
            resolve({ success: false, error: { message: 'Invalid response', data } });
          }
        });
      });

      req.on('error', (err) => {
        console.error('WhatsApp request error:', err);
        resolve({ success: false, error: err });
      });

      req.write(postData);
      req.end();
    } catch (err) {
      console.error('WhatsApp send exception:', err);
      resolve({ success: false, error: err });
    }
  });
}

// Enhanced send function with automatic token refresh
async function sendWhatsAppTextWithRetry(toPhoneE164, message, retryCount = 0) {
  const result = await sendWhatsAppText(toPhoneE164, message);
  
  // If token expired and we haven't retried yet, try to refresh and retry
  if (!result.success && 
      result.error?.error?.code === 190 && 
      result.error?.error?.error_subcode === 463 && 
      retryCount === 0) {
    
    console.log('🔄 WhatsApp token expired, attempting refresh...');
    const refreshResult = await refreshWhatsAppToken();
    
    if (refreshResult.success) {
      // Update environment variable for this process
      process.env.WHATSAPP_TOKEN = refreshResult.token;
      console.log('✅ Token refreshed, retrying message...');
      
      // Retry the message with new token
      return await sendWhatsAppTextWithRetry(toPhoneE164, message, retryCount + 1);
    } else {
      console.error('❌ Token refresh failed:', refreshResult.error);
      return { success: false, error: 'Token refresh failed', originalError: result.error };
    }
  }
  
  return result;
}

function buildBookingMessage({ childName, date, time, meetLink }) {
  const who = childName ? `${childName}'s` : 'your';
  return (
    `Your ${who} therapy session is booked.\n` +
    `Date: ${date}\nTime: ${time}\n` +
    `Join via Google Meet: ${meetLink}\n` +
    `We look forward to seeing you.`
  );
}

async function sendBookingConfirmation(toPhoneE164, details) {
  const message = buildBookingMessage(details);
  return await sendWhatsAppTextWithRetry(toPhoneE164, message);
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppTextWithRetry,
  sendBookingConfirmation,
  refreshWhatsAppToken,
};


