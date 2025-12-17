# Periodic Services & Scheduled Tasks

This document lists all crawlers, services, and scheduled tasks that run periodically in the backend.

---

## 📅 **Daily Services**

### **1. Daily Calendar Conflict Monitor Service** (NEW)
**File:** `backend/services/dailyCalendarConflictAlert.js`  
**Schedule:** `0 1 * * *` (Every day at 1:00 AM)  
**What it does:**
- 🔍 Checks all psychologists with synced Google Calendar for conflicts
- 📊 Compares Google Calendar events with availability slots (next 21 days)
- 🚨 Detects when calendar events are not properly blocking availability slots
- 📧 Sends email to `abhishekravi063@gmail.com` **only when conflicts are found**
- 📱 Sends WhatsApp to `+91 8281540004` **only when conflicts are found**
- ✅ Includes psychologist details, conflict date, time, and event information
- **Runs on:** Server startup (can be manually triggered) + Daily at 1:00 AM

**Impact:**
- Proactively monitors calendar sync health
- Alerts admin only when issues are detected (no spam)
- Helps identify sync problems before they affect bookings

---

## 📅 **Daily Services (Run at 12:00 AM / Midnight)**

### 1. **Daily Availability Service** 
**File:** `backend/services/dailyAvailabilityService.js`  
**Schedule:** `0 0 * * *` (Every day at 12:00 AM)  
**What it does:**
- ✅ Adds availability slots for the day that is **3 weeks (21 days) from today** for all psychologists
- ✅ Maintains a rolling 3-week availability window
- 🧹 Cleans up past availability records (dates before today) to prevent database bloat
- **Runs on:** Server startup (immediate check) + Daily at midnight

**Impact:**
- Ensures psychologists always have availability slots for the next 21 days
- Automatically removes old availability records

---

### 2. **Daily Free Assessment Availability Service**
**File:** `backend/services/dailyFreeAssessmentService.js`  
**Schedule:** `0 0 * * *` (Every day at 12:00 AM)  
**What it does:**
- ✅ Adds free assessment date configs for the day that is **3 weeks (21 days) from today**
- ✅ Maintains a rolling 3-week window for free assessment bookings
- 🧹 Cleans up past free assessment date configs (dates before today)
- **Runs on:** Server startup (immediate check) + Daily at midnight

**Impact:**
- Ensures free assessment slots are always available for the next 21 days
- Automatically removes old date configs

---

## ⏰ **Hourly Services**

### 3. **Session Reminder Service**
**File:** `backend/services/sessionReminderService.js`  
**Schedule:** `0 * * * *` (Every hour at minute 0, e.g., 1:00, 2:00, 3:00)  
**What it does:**
- 🔔 Checks for sessions scheduled **2 hours from now**
- 📱 Sends WhatsApp reminders to clients about upcoming sessions
- ✅ Only sends reminders for sessions with status: `booked` or `rescheduled`
- ✅ Prevents duplicate reminders by checking the `notifications` table
- **Runs on:** Server startup (after 10 seconds) + Every hour

**Impact:**
- Clients receive timely reminders 2 hours before their sessions
- Reduces no-shows and improves session attendance

---

## 🔄 **Frequent Services (Every 15 Minutes)**

### 4. **Google Calendar Sync Service**
**File:** `backend/services/calendarSyncService.js`  
**Schedule:** `*/15 * * * *` (Every 15 minutes - configurable via `CALENDAR_SYNC_INTERVAL_MINUTES`)  
**What it does:**
- 🔄 Syncs Google Calendar events for all psychologists with connected calendars
- 📅 Fetches external events from Google Calendar (next **21 days / 3 weeks**)
- 🚫 Blocks availability slots that conflict with Google Calendar events
- ✅ Uses incremental sync with sync tokens for efficiency
- ✅ Skips recently synced psychologists to reduce server load
- **Runs on:** Server startup (after 5 seconds) + Every 15 minutes

**Configurable:**
- `CALENDAR_SYNC_INTERVAL_MINUTES` - Default: 15 minutes
- `CALENDAR_SYNC_DAYS` - Default: 21 days (3 weeks)

**Impact:**
- Keeps availability slots in sync with psychologists' Google Calendars
- Prevents double-booking by blocking slots with external events
- Automatically handles calendar changes in near real-time

---

## 🛡️ **Security & Monitoring Services**

### 5. **Security Monitor - Metrics Save**
**File:** `backend/utils/securityMonitor.js`  
**Schedule:** `setInterval` - Every **5 minutes**  
**What it does:**
- 💾 Saves security metrics to database
- 📊 Tracks security events and patterns
- **Runs:** Continuously every 5 minutes

---

### 6. **Security Monitor - Log Cleanup**
**File:** `backend/utils/securityMonitor.js`  
**Schedule:** `setInterval` - Every **24 hours (daily)**  
**What it does:**
- 🧹 Cleans up old security logs
- 📉 Prevents log database bloat
- **Runs:** Daily

---

### 7. **Advanced Bot Detector - Cleanup**
**File:** `backend/utils/advancedBotDetector.js`  
**Schedule:** `setInterval` - Every **1 hour**  
**What it does:**
- 🧹 Cleans up old bot detection data
- 🗑️ Removes expired tracking information
- **Runs:** Every hour

---

### 8. **Security Notifications - Alert Cleanup**
**File:** `backend/utils/securityNotifications.js`  
**Schedule:** `setInterval` - Every **24 hours (daily)**  
**What it does:**
- 🧹 Removes security alerts older than 7 days
- 📉 Prevents alert database bloat
- **Runs:** Daily

---

## 📊 **Summary Table**

| Service | Frequency | Time | Purpose |
|---------|-----------|------|---------|
| **Calendar Conflict Monitor** | Daily | 1:00 AM | Check for sync conflicts, send alerts |
| Daily Availability Service | Daily | 12:00 AM | Add next day (3 weeks out) + cleanup |
| Daily Free Assessment Service | Daily | 12:00 AM | Add next day (3 weeks out) + cleanup |
| Session Reminder Service | Hourly | Every hour (minute 0) | Send 2-hour reminders |
| Google Calendar Sync | Every 15 min | Continuous | Sync calendar events |
| Security Metrics Save | Every 5 min | Continuous | Save security data |
| Security Log Cleanup | Daily | Continuous | Clean old logs |
| Bot Detector Cleanup | Hourly | Continuous | Clean bot data |
| Security Alert Cleanup | Daily | Continuous | Clean old alerts |

---

## 🔧 **Configuration**

All services can be configured via environment variables:

```env
# Calendar Sync
CALENDAR_SYNC_INTERVAL_MINUTES=15  # How often to sync (default: 15 minutes)
CALENDAR_SYNC_DAYS=21              # How many days to sync (default: 21 days / 3 weeks)

# Session Reminders
# Currently hardcoded to 2 hours before session
```

---

## 🚀 **Service Startup**

All services are started automatically when the server starts (see `backend/server.js`):

```javascript
// Start Google Calendar sync service
calendarSyncService.start();

// Start Session Reminder service
sessionReminderService.start();

// Start Daily Availability service
dailyAvailabilityService.start();

// Start Daily Free Assessment Availability service
dailyFreeAssessmentService.start();
```

---

## 📝 **Notes**

1. **Availability Window:** All availability services maintain a **3-week (21-day) rolling window**
2. **Calendar Sync:** Now optimized to sync only **21 days** to match availability window (was 30 days)
3. **Reminder Timing:** Changed from 12 hours to **2 hours** before session
4. **Cleanup Tasks:** All services include cleanup to prevent database bloat
5. **Error Handling:** All services have protection against concurrent runs

