# WhatsApp Migration Guide: Gupshup → Official Business API

## Overview
This guide helps you migrate from Gupshup WhatsApp API back to the official WhatsApp Business API for better reliability and official support.

## Why Official WhatsApp Business API?
- ✅ **Official Support**: Direct support from Meta/Facebook
- ✅ **Better Reliability**: Official infrastructure and SLA
- ✅ **Advanced Features**: Access to latest WhatsApp features
- ✅ **Global Reach**: Better international message delivery
- ✅ **Enterprise Grade**: Designed for business applications
- ✅ **Template Messages**: Official template message support

## Migration Steps

### 1. Environment Variables Update

**Remove these (old Gupshup API):**
```bash
GUPSHUP_API_KEY=your_gupshup_api_key_here
GUPSHUP_APP_NAME=your_gupshup_app_name_here
GUPSHUP_SOURCE=whatsapp
```

**Add these (new WhatsApp Business API):**
```bash
WHATSAPP_TOKEN=your_whatsapp_access_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_APP_ID=your_meta_app_id_here
WHATSAPP_APP_SECRET=your_meta_app_secret_here
```

### 2. WhatsApp Business API Setup

1. **Create Meta Business Account**: https://business.facebook.com/
2. **Set up WhatsApp Business API**:
   - Go to Meta for Developers: https://developers.facebook.com/
   - Create a new app with WhatsApp Business API
   - Complete business verification process
   - Get your access token and phone number ID
3. **Configure Webhook** (optional):
   - Set up webhook URL for delivery reports
   - Configure message status callbacks

### 3. Code Changes Made

#### Files Updated:
- ✅ `backend/utils/whatsappService.js` - Official WhatsApp Business API service
- ✅ `backend/test-whatsapp.js` - Updated test script
- ✅ `backend/controllers/sessionController.js` - Updated import
- ✅ `backend/controllers/clientController.js` - Updated import  
- ✅ `backend/controllers/paymentController.js` - Updated import
- ✅ `backend/env.example` - Updated environment variables

#### Service Functions:
- `sendWhatsAppText()` - Send basic text messages
- `sendWhatsAppTextWithRetry()` - Send with retry logic and token refresh
- `sendBookingConfirmation()` - Send booking confirmations
- `refreshWhatsAppToken()` - Automatic token refresh

### 4. Testing

Run the test script to verify the setup:
```bash
cd backend
node test-whatsapp.js
```

### 5. Message Format Changes

**Old Format (Gupshup):**
```
🎉 *Your child's therapy session is booked!*

📅 *Date:* October 4, 2025
⏰ *Time:* 1:00 PM - 2:00 PM
🔗 *Join via Google Meet:* https://meet.google.com/...

We look forward to seeing you! 😊

_Powered by Kuttikal Child Therapy_
```

**New Format (Official API):**
```
Your child's therapy session is booked.
Date: October 4, 2025
Time: 1:00 PM - 2:00 PM
Join via Google Meet: https://meet.google.com/...
We look forward to seeing you.
```

## Benefits of Migration

### Reliability
- **Official infrastructure** with Meta's SLA
- **Global delivery** optimization
- **Better error handling** and reporting

### Features
- **Template messages** for structured content
- **Interactive messages** (buttons, lists)
- **Media messages** (images, documents)
- **Delivery reports** and read receipts

### Support
- **Official documentation** and support
- **Regular updates** and new features
- **Enterprise support** options

## Rollback Plan

If you need to rollback to Gupshup:

1. **Restore old environment variables**
2. **Revert controller imports**:
   ```javascript
   const { sendBookingConfirmation, sendWhatsAppTextWithRetry } = require('../utils/gupshupService');
   ```
3. **Restore old test script**

## Support

- **WhatsApp Business API Documentation**: https://developers.facebook.com/docs/whatsapp
- **Meta for Developers**: https://developers.facebook.com/
- **Business Support**: https://business.facebook.com/support

## Next Steps

1. ✅ Set up Meta Business account
2. ✅ Configure WhatsApp Business API
3. ✅ Set environment variables
4. ✅ Test the integration
5. ✅ Deploy to production
6. ✅ Monitor message delivery

---

**Migration completed successfully!** 🎉
Your WhatsApp integration is now powered by the official WhatsApp Business API for better reliability and official support.
