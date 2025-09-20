# Google Calendar Integration for Psychologists

## 🎯 **How Psychologists Connect Their Google Calendar**

### **Step-by-Step Process:**

#### **1. Access Settings Page**
- Log in to your psychologist dashboard
- Navigate to **Settings** in the sidebar menu
- Scroll down to the **"Google Calendar Integration"** section

#### **2. Connect Google Calendar**
- Click the **"Connect Google Calendar"** button
- You'll be redirected to Google's OAuth2 consent screen
- Sign in with your Google account (the one with your calendar)
- Grant permissions for calendar access
- You'll be redirected back to the platform

#### **3. Automatic Integration**
Once connected, the system will:
- ✅ **Check for conflicts** when you set availability
- ✅ **Sync every 30 minutes** to keep availability current
- ✅ **Block conflicting time slots** automatically
- ✅ **Prevent double bookings** across platforms

---

## 🔧 **Technical Implementation**

### **Frontend Components:**
- **`GoogleCalendarIntegration.jsx`** - Main integration component
- **`/auth/google-calendar/callback/page.js`** - OAuth2 callback handler
- **Updated Settings Page** - Includes calendar integration section

### **Backend API Endpoints:**
- **`POST /api/psychologists/google-calendar/connect`** - Connect calendar
- **`POST /api/psychologists/google-calendar/disconnect`** - Disconnect calendar
- **`GET /api/psychologists/google-calendar/status`** - Check connection status

### **OAuth2 Flow:**
1. **Authorization Request** - Redirect to Google OAuth2
2. **User Consent** - User grants calendar permissions
3. **Authorization Code** - Google returns code to callback
4. **Token Exchange** - Backend exchanges code for access/refresh tokens
5. **Token Storage** - Tokens stored securely in database
6. **Calendar Sync** - Background service starts syncing

---

## 🛡️ **Security & Privacy**

### **What We Access:**
- ✅ **Read-only access** to your calendar events
- ✅ **No modification** of your calendar
- ✅ **No sharing** of your data with third parties

### **What We Store:**
- ✅ **OAuth2 tokens** (encrypted in database)
- ✅ **Connection timestamp**
- ✅ **Sync status**

### **What We Don't Store:**
- ❌ **Calendar event details**
- ❌ **Personal information** from events
- ❌ **Any data** beyond what's needed for conflict checking

---

## 🔄 **How It Works**

### **Real-time Conflict Checking:**
```javascript
// When psychologist sets availability
const hasConflict = await googleCalendarService.hasTimeConflict(
  psychologist.google_calendar_credentials,
  startTime,
  endTime
);

if (hasConflict) {
  return error('Time slot conflicts with Google Calendar event');
}
```

### **Background Sync Service:**
```javascript
// Runs every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  await syncAllPsychologistsCalendars();
});
```

### **Automatic Slot Blocking:**
```javascript
// Remove conflicting time slots
const updatedSlots = availability.time_slots.filter(slot => 
  !isConflictingWithGoogleCalendar(slot)
);
```

---

## 📱 **User Interface**

### **Settings Page Integration:**
- **Connection Status** - Shows if calendar is connected
- **Last Sync Time** - When calendar was last synced
- **Manual Sync Button** - Force immediate sync
- **Disconnect Button** - Remove calendar connection
- **Privacy Information** - Explains what data is accessed

### **Visual Indicators:**
- 🟢 **Green Checkmark** - Calendar connected
- 🟡 **Yellow Warning** - Calendar not connected
- 🔄 **Spinning Icon** - Syncing in progress
- ✅ **Success Message** - Sync completed
- ❌ **Error Message** - Sync failed

---

## 🚀 **Benefits for Psychologists**

### **Prevents Double Bookings:**
- External appointments automatically block time slots
- No more manual calendar checking
- Seamless integration with existing workflow

### **Saves Time:**
- Automatic sync every 30 minutes
- Real-time conflict checking
- No need to manually update availability

### **Professional Management:**
- Maintains professional image
- Reduces scheduling errors
- Improves client experience

---

## 🔧 **Troubleshooting**

### **Common Issues:**

#### **"Failed to connect Google Calendar"**
- Check internet connection
- Ensure Google account has calendar access
- Try disconnecting and reconnecting

#### **"Calendar not syncing"**
- Check if tokens are expired
- Verify Google Calendar permissions
- Contact support if issue persists

#### **"Time slots not being blocked"**
- Ensure calendar has events during those times
- Check if events are marked as "busy"
- Verify sync is running (check last sync time)

### **Support:**
- Check the **Settings** page for connection status
- Use **"Sync Now"** button for manual sync
- Contact support if issues persist

---

## 📋 **Environment Variables Required**

### **Backend (.env):**
```bash
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5001/api/oauth2/callback
GOOGLE_SCOPES=https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events
```

### **Frontend (.env.local):**
```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

---

## 🎉 **Ready to Use!**

The Google Calendar integration is now **fully implemented** and ready for psychologists to use. Simply:

1. **Add the database column** (if not done already)
2. **Configure environment variables**
3. **Restart the server**
4. **Psychologists can now connect their calendars!**

The system will automatically prevent double bookings and keep availability synchronized with external calendars! 🚀
