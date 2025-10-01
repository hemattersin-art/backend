const fetch = require('node-fetch');

/**
 * WhatsApp Business messaging via Meta Graph API
 * Requires env vars:
 * - WHATSAPP_TOKEN: Permanent or long-lived access token
 * - WHATSAPP_PHONE_NUMBER_ID: Phone number ID from WhatsApp Business
 */
async function sendWhatsAppText(toPhoneE164, message) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      console.warn('WhatsApp env not configured; skipping send.');
      return { success: false, skipped: true, reason: 'missing_env' };
    }

    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhoneE164,
        type: 'text',
        text: { body: message }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('WhatsApp send error:', data);
      return { success: false, error: data };
    }
    return { success: true, data };
  } catch (err) {
    console.error('WhatsApp send exception:', err);
    return { success: false, error: err };
  }
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
  return await sendWhatsAppText(toPhoneE164, message);
}

module.exports = {
  sendWhatsAppText,
  sendBookingConfirmation,
};


