const https = require('https');
const { URL } = require('url');
const { supabaseAdmin } = require('../config/supabase');

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
    // Time is already in IST format (HH:MM), just format it directly without timezone conversion
    const [h, m] = timeStr.split(':');
    const hours = parseInt(h, 10);
    const minutes = parseInt(m || '0', 10);
    
    // Convert to 12-hour format with AM/PM
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const displayMinutes = minutes.toString().padStart(2, '0');
    
    return `${displayHours}:${displayMinutes} ${period}`;
  } catch {
    return timeStr;
  }
}

/**
 * Build main booking confirmation message
 * @param {Object} details - { childName, date, time, meetLink, psychologistName?, isFreeAssessment?, packageInfo? }
 * @returns {string} Formatted message
 */
function buildBookingMessage({ childName, date, time, meetLink, psychologistName = null, isFreeAssessment = false, packageInfo = null }) {
  const friendlyDate = formatFriendlyDate(date);
  const friendlyTime = formatFriendlyTime(time);
  const sessionType = isFreeAssessment ? 'Free Assessment' : 'Therapy Session';

  // Only include child line if childName is provided and not empty/null/'Pending'
  const hasChildName = childName && 
    childName.trim() !== '' && 
    childName.toLowerCase() !== 'pending';
  
  const childLine = hasChildName ? `👧 Child: ${childName}\n\n` : '';

  // Psychologist name line (if provided) - no Dr. prefix
  const psychologistLine = psychologistName && psychologistName.trim() 
    ? `👨‍⚕️ Therapist: ${psychologistName.trim()}\n\n` 
    : '';

  // Package information line
  let packageLine = '';
  if (packageInfo && packageInfo.totalSessions) {
    const completed = packageInfo.completedSessions || 0;
    const remaining = packageInfo.remainingSessions || 0;
    packageLine = `📦 Package Session: ${completed}/${packageInfo.totalSessions} completed, ${remaining} remaining\n\n`;
  }

  // Build join meet button/link - formatted as clickable link
  const joinMeetButton = meetLink 
    ? `\n\n🔗 *Join Meet:*\n${meetLink}\n\n` 
    : '';

  return (
    `🧸 ${sessionType} Confirmed!\n\n` +
    `Session details:\n\n` +
    childLine +
    psychologistLine +
    (packageLine || '') +
    `📅 Date: ${friendlyDate || date}\n\n` +
    `⏰ Time: ${friendlyTime || time} (IST)\n\n` +
    joinMeetButton +
    `We look forward to seeing you. 💜`
  );
}

/**
 * Send booking confirmation WhatsApp messages (multi-part)
 * @param {string} toPhoneE164 - Phone number in E.164 format
 * @param {Object} details - { childName, date, time, meetLink, psychologistName?, receiptUrl?, isFreeAssessment?, packageInfo? }
 * @returns {Promise<Object>} - { success: boolean, ... }
 */
async function sendBookingConfirmation(toPhoneE164, details) {
  const {
    childName,
    date,
    time,
    meetLink,
    psychologistName,
    receiptUrl, // Legacy support - for old receipts stored in storage
    receiptPdfBuffer, // New: PDF buffer (will be discarded after sending)
    receiptNumber, // Receipt number for reference
    clientName, // Client name (first_name + last_name) for receipt filename
    isFreeAssessment = false,
    packageInfo = null
  } = details || {};

  // Message 1: Welcome + Session Details (with Join Meet button)
  const welcomeAndDetailsMessage = (isFreeAssessment
    ? `👋 Welcome to Little Care! 🌈\n\n` +
      `Thank you for booking a free assessment with our child specialists.\n\n`
    : packageInfo
    ? `👋 Welcome to Little Care! 🌈\n\n` +
      `Thank you for booking your next package session with our child specialists.\n\n`
    : `👋 Welcome to Little Care! 🌈\n\n` +
      `Thank you for booking a therapy session with our child specialists.\n\n`) +
    buildBookingMessage({
      childName,
      date,
      time,
      meetLink,
      psychologistName,
      isFreeAssessment,
      packageInfo
    });

  // Message 2: Before session reminders + Contact info
  const remindersAndContactMessage =
    `📝 Before the session:\n\n` +
    `• Please be ready at least 10 minutes before your scheduled time.\n\n` +
    `• Ensure a stable internet connection.\n\n` +
    `• Choose a quiet place with good lighting and minimal background noise.\n\n` +
    `• Keep your device charged or connected to power.\n\n` +
    `📞 For any other enquiry or help, you can reach us on:\n` +
    `WhatsApp / Call: +91 95390 07766`;

  // Send as 3 separate messages in order, with a delay between each to respect WASenderApi account protection
  const messages = [
    welcomeAndDetailsMessage,
    remindersAndContactMessage
  ];

  let lastResult = null;
  // Send first 2 text messages
  for (let i = 0; i < messages.length; i++) {
    lastResult = await sendWhatsAppTextWithRetry(toPhoneE164, messages[i]);
    // Wait ~5.5s between messages to stay under "1 message per 5 seconds" limit
    if (i < messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5500));
    }
  }

  // Message 3: Send receipt PDF as document (if available)
  // Wait before sending receipt to maintain proper message order
  if (receiptUrl || receiptPdfBuffer) {
    await new Promise(resolve => setTimeout(resolve, 5500));
  }
  // Note: WASender API requires a URL, so if we only have a buffer, we skip WhatsApp receipt
  // The receipt is still sent via email with the PDF attachment
  if (receiptUrl) {
    // Legacy: Receipt stored in storage (old system)
    try {
      const apiKey = process.env.WASENDER_API_KEY;
      if (apiKey) {
        const formattedPhone = formatPhoneNumber(toPhoneE164);
        if (formattedPhone) {
          const apiUrl = 'https://wasenderapi.com/api/send-message';
          const url = new URL(apiUrl);

          // Generate filename using client name if available (sanitized for filesystem)
          let fileName = 'receipt';
          if (details?.clientName) {
            // Sanitize client name: replace spaces with hyphens, remove special characters
            const sanitizedName = details.clientName
              .trim()
              .replace(/\s+/g, '-') // Replace spaces with hyphens
              .replace(/[^a-zA-Z0-9\-_]/g, '') // Remove special characters except hyphens and underscores
              .substring(0, 50); // Limit length to 50 characters
            fileName = sanitizedName || 'receipt';
          }

          const postData = JSON.stringify({
            to: formattedPhone,
            text: '🧾 Here is your receipt for the session.',
            documentUrl: receiptUrl,
            fileName: `${fileName}.pdf`
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
  } else if (receiptPdfBuffer) {
    // New system: PDF buffer available - temporarily upload to storage for WhatsApp
    // Upload, send via WhatsApp, then delete immediately (not stored permanently)
    try {
      const apiKey = process.env.WASENDER_API_KEY;
      if (apiKey) {
        const formattedPhone = formatPhoneNumber(toPhoneE164);
        if (formattedPhone) {
          console.log('📤 Temporarily uploading receipt PDF to storage for WhatsApp delivery...');
          
          // Generate unique temporary filename with timestamp to avoid conflicts
          const timestamp = Date.now();
          const tempFileName = `temp/${receiptNumber || `receipt-${timestamp}`}.pdf`;
          
          // Try uploading to receipts bucket first, fallback to other buckets if needed
          let bucketName = 'receipts';
          let uploadData = null;
          let uploadError = null;
          
          // Upload PDF buffer to Supabase storage temporarily
          // Note: File must be in a public bucket or we need to create a signed URL
          ({ data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from(bucketName)
            .upload(tempFileName, receiptPdfBuffer, {
              contentType: 'application/pdf',
              cacheControl: '0', // No cache
              upsert: false
            }));

          // If receipts bucket doesn't exist, try using a common bucket as fallback
          if (uploadError && (uploadError.message?.includes('Bucket') || uploadError.message?.includes('not found'))) {
            console.warn('⚠️ Receipts bucket not found, trying profile-pictures bucket as fallback...');
            bucketName = 'profile-pictures'; // Common bucket that likely exists
            ({ data: uploadData, error: uploadError } = await supabaseAdmin.storage
              .from(bucketName)
              .upload(tempFileName, receiptPdfBuffer, {
                contentType: 'application/pdf',
                cacheControl: '0',
                upsert: false
              }));
          }

          if (uploadError) {
            console.error('❌ Could not upload receipt PDF temporarily for WhatsApp. Receipt sent via email only.');
            console.error('   Error:', uploadError.message);
          } else {
            try {
              // Create a signed URL with 10 minutes expiration (secure alternative to public URL)
              // This allows WASender to download the file without making the bucket public
              const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
                .from(bucketName)
                .createSignedUrl(tempFileName, 600); // 600 seconds = 10 minutes
              
              if (signedUrlError || !signedUrlData?.signedUrl) {
                console.error('❌ Could not create signed URL for receipt:', signedUrlError);
                // Fallback: try public URL if bucket is public
                const { data: urlData } = supabaseAdmin.storage
                  .from(bucketName)
                  .getPublicUrl(tempFileName);
                var publicUrl = urlData?.publicUrl;
              } else {
                var publicUrl = signedUrlData.signedUrl;
                console.log(`✅ Created signed URL for receipt (expires in 10 minutes)`);
              }
              
              if (publicUrl) {
                console.log(`✅ Receipt PDF uploaded temporarily, sending via WhatsApp...`);
                console.log(`   Temporary file URL: ${publicUrl.substring(0, 80)}...`);
                console.log(`   Note: File will be deleted in 10 minutes to allow WASender to download`);
                
                // Send via WhatsApp using the temporary URL
                const apiUrl = 'https://wasenderapi.com/api/send-message';
                const url = new URL(apiUrl);

                // Generate filename using client name (sanitized for filesystem)
                let fileName = 'Receipt';
                if (clientName) {
                  // Sanitize client name: replace spaces with hyphens, remove special characters
                  const sanitizedName = clientName
                    .trim()
                    .replace(/\s+/g, '-') // Replace spaces with hyphens
                    .replace(/[^a-zA-Z0-9\-_]/g, '') // Remove special characters except hyphens and underscores
                    .substring(0, 50); // Limit length to 50 characters
                  fileName = sanitizedName || 'Receipt';
                } else {
                  // Fallback to receipt number if client name not available
                  fileName = `Receipt-${receiptNumber || 'receipt'}`;
                }

                const postData = JSON.stringify({
                  to: formattedPhone,
                  text: '🧾 Here is your receipt for the session.',
                  documentUrl: publicUrl,
                  fileName: `${fileName}.pdf`
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
                  const req = https.request(options, async (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                      data += chunk;
                    });
                    res.on('end', async () => {
                      try {
                        const jsonData = JSON.parse(data || '{}');
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                          console.log('✅ WhatsApp receipt PDF sent via WASenderApi:', jsonData);
                          
                          // WASender downloads the file asynchronously after receiving our request
                          // Schedule deletion after 10 minutes to match signed URL expiration
                          // We don't await this - it runs in the background
                          setTimeout(async () => {
                            try {
                              const { error: deleteError } = await supabaseAdmin.storage
                                .from(bucketName)
                                .remove([tempFileName]);
                              
                              if (deleteError) {
                                console.warn('⚠️ Could not delete temporary receipt file:', deleteError.message);
                              } else {
                                console.log('🗑️ Temporary receipt file deleted after 10 minutes (WASender download window)');
                              }
                            } catch (deleteErr) {
                              console.warn('⚠️ Error deleting temporary receipt file:', deleteErr);
                            }
                          }, 10 * 60 * 1000); // 10 minutes (matches signed URL expiration)
                          
                          console.log('⏳ Temporary file will be deleted in 10 minutes to allow WASender to download');
                          
                        } else {
                          console.error('❌ WASenderApi receipt send error:', jsonData);
                          // On error, wait a shorter time (30 seconds) before deleting
                          setTimeout(async () => {
                            try {
                              await supabaseAdmin.storage.from(bucketName).remove([tempFileName]);
                              console.log('🗑️ Temporary receipt file deleted after error');
                            } catch (deleteErr) {
                              console.warn('⚠️ Error deleting temporary receipt file:', deleteErr);
                            }
                          }, 30000); // 30 seconds on error
                        }
                      } catch (err) {
                        console.error('❌ WASenderApi receipt response parse error:', err, 'Raw data:', data);
                        // On parse error, wait 30 seconds before deleting
                        setTimeout(async () => {
                          try {
                            await supabaseAdmin.storage.from(bucketName).remove([tempFileName]);
                            console.log('🗑️ Temporary receipt file deleted after parse error');
                          } catch (deleteErr) {
                            console.warn('⚠️ Error deleting temporary receipt file:', deleteErr);
                          }
                        }, 30000);
                      }
                      
                      resolve();
                    });
                  });

                  req.on('error', async (err) => {
                    console.error('❌ WASenderApi receipt request error:', err);
                    
                    // On request error, schedule deletion after 30 seconds
                    setTimeout(async () => {
                      try {
                        await supabaseAdmin.storage.from(bucketName).remove([tempFileName]);
                        console.log('🗑️ Temporary receipt file deleted after request error');
                      } catch (deleteErr) {
                        console.warn('⚠️ Error deleting temporary receipt file:', deleteErr);
                      }
                    }, 30000); // 30 seconds on error
                    
                    resolve();
                  });

                  req.write(postData);
                  req.end();
                });
              } else {
                console.error('❌ Could not get public URL for temporary receipt. Receipt sent via email only.');
                // Clean up upload
                await supabaseAdmin.storage.from(bucketName).remove([tempFileName]);
              }
            } catch (sendError) {
              console.error('❌ Error sending receipt via WhatsApp:', sendError);
              // Clean up upload
              try {
                await supabaseAdmin.storage.from(bucketName).remove([tempFileName]);
              } catch (cleanupErr) {
                console.warn('⚠️ Error cleaning up temporary file:', cleanupErr);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('❌ Error processing WhatsApp receipt PDF:', err);
      console.log('   Receipt sent via email with PDF attachment');
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
