# Calendar Sync & Blocking System - When It Works

## Overview
The calendar syncing and blocking system operates in **two layers** to ensure external events are always blocked, whether they have Google Meet links or not.

---

## 🕐 Layer 1: Automatic Background Sync

### **When It Runs:**
1. **Every 30 minutes** (automatically)
   - Cron schedule: `*/30 * * * *`
   - Runs at: `:00` and `:30` of every hour (e.g., 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM...)
   
2. **On server startup**
   - Runs 5 seconds after the backend server starts
   - Ensures immediate sync when server restarts

### **What It Does:**
- Fetches all Google Calendar events for **all psychologists** with connected calendars
- Date range: **Today + next 30 days**
- Filters external events (blocks all except system events and public holidays)
- **Updates the database** by removing blocked time slots from the `availability` table
- Runs in the background (doesn't affect user experience)

### **Process Flow:**
```
Server starts → calendarSyncService.start() called
    ↓
Cron job scheduled (every 30 minutes)
    ↓
5 seconds after startup → First sync runs
    ↓
Every 30 minutes → Automatic sync runs
    ↓
For each psychologist:
  1. Fetch Google Calendar events (today + 30 days)
  2. Filter external events (block all except system/public holidays)
  3. Remove matching time slots from availability table
  4. Update database
```

### **Example Timeline:**
- **10:00 AM**: Background sync runs → Blocks external events
- **10:15 AM**: User adds external event to Google Calendar
- **10:30 AM**: Background sync runs → Blocks the new external event
- **11:00 AM**: Background sync runs → Continues monitoring

---

## ⚡ Layer 2: Real-Time Check (On-Demand)

### **When It Runs:**
- **Every time a user visits a therapist profile page**
- Triggered by frontend API call: `GET /api/psychologists/:id/availability`

### **What It Does:**
- Performs a **real-time check** of Google Calendar (not from database)
- Fetches current Google Calendar events directly from Google API
- Filters external events (blocks all except system events and public holidays)
- **Blocks events BEFORE displaying availability** to the user
- Has a **3-second timeout** to prevent slow page loads

### **Process Flow:**
```
User clicks on therapist profile
    ↓
Frontend: GET /api/psychologists/:id/availability
    ↓
Backend: availabilityCalendarService.getPsychologistAvailabilityRange()
    ↓
1. Get availability from database (~50ms)
2. Get booked sessions from database (~50ms)
3. Real-time Google Calendar check (with 3s timeout):
   - Fetch events directly from Google Calendar API
   - Filter external events (block all except system/public holidays)
   - Block overlapping time slots
4. Return filtered availability
    ↓
Frontend displays only available slots
```

### **Example Scenario:**
- **10:15 AM**: User adds external event "Meeting" at 2:00 PM to Google Calendar
- **10:16 AM**: User visits therapist profile page
- **Real-time check**: Fetches Google Calendar → Finds "Meeting" at 2:00 PM → Blocks it
- **User sees**: Availability without 2:00 PM slot (already filtered out)
- **10:30 AM**: Background sync runs → Updates database for future requests

---

## 📅 Date Range Coverage

### **Background Sync:**
- **Start Date**: Today at 00:00:00
- **End Date**: Today + 30 days at 23:59:59
- **Coverage**: Current day + next 30 days

### **Real-Time Check:**
- **Start Date**: Requested start date (from frontend)
- **End Date**: Requested end date (from frontend)
- **Coverage**: Only the date range requested by the user

---

## 🔄 Complete System Flow

### **Scenario: External Event Added Between Syncs**

**Timeline:**
1. **10:00 AM**: Background sync runs → Database updated
2. **10:10 AM**: Psychologist adds external event "Koott Session" at 2:00 PM to Google Calendar
3. **10:15 AM**: User visits therapist profile
   - **Real-time check** runs → Finds "Koott Session" → Blocks 2:00 PM slot
   - User sees availability **without** 2:00 PM
4. **10:30 AM**: Background sync runs → Updates database (removes 2:00 PM from availability table)
5. **10:45 AM**: Another user visits profile
   - **Real-time check** runs → Still finds "Koott Session" → Blocks 2:00 PM slot
   - Database already updated, but real-time check ensures accuracy

---

## 🎯 What Gets Blocked

### **✅ BLOCKED (All External Events):**
- Events with Google Meet links
- Events without Google Meet links (e.g., "H", "G", "D", "F")
- Any event that is NOT a system event and NOT a public holiday

### **❌ NOT BLOCKED:**
- **System events**: Contains "littleminds", "little care", or "kuttikal" in title
- **Public holidays**: Contains "holiday", "festival", "celebration", "observance" in title

---

## ⏱️ Timing Summary

| Event | Frequency | Purpose | Database Updated? |
|-------|-----------|---------|-------------------|
| **Background Sync** | Every 30 minutes | Update database | ✅ Yes |
| **Server Startup** | Once on startup | Initial sync | ✅ Yes |
| **Real-Time Check** | On every profile visit | Block before showing | ❌ No (filters only) |
| **Timeout** | 3 seconds max | Prevent slow loading | N/A |

---

## 🚀 Performance Characteristics

### **Background Sync:**
- **Runs**: Every 30 minutes
- **Duration**: Varies by number of psychologists and events
- **Impact**: None on user experience (runs in background)
- **Database**: Updates availability table directly

### **Real-Time Check:**
- **Runs**: On every profile page visit
- **Duration**: <3 seconds (with timeout protection)
- **Impact**: Minimal (parallel processing, timeout protection)
- **Database**: Does NOT update (only filters for display)

---

## 🔧 Manual Triggers

### **Psychologist Dashboard:**
- Psychologists can manually trigger sync from Settings page
- Button: "Sync Now"
- Updates database immediately

### **Admin API:**
- Admin can trigger sync via API endpoint
- Useful for debugging or immediate updates

---

## 📊 Key Benefits

1. **Reliability**: Two-layer protection ensures events are always blocked
2. **Speed**: Real-time check with timeout ensures fast page loads
3. **Accuracy**: Real-time check catches events added between sync intervals
4. **Efficiency**: Background sync updates database, real-time check filters display
5. **Resilience**: If Google Calendar is slow, page still loads (30-min sync catches it later)

---

## Summary

✅ **Background Sync**: Runs every 30 minutes + on startup → Updates database  
✅ **Real-Time Check**: Runs on every profile visit → Blocks before showing  
✅ **All External Events**: Blocked (with or without Google Meet links)  
✅ **Fast Performance**: 3-second timeout ensures quick page loads  
✅ **Reliable**: Events blocked even if added between sync intervals

The system ensures external events are **always blocked**, whether they're caught by the 30-minute sync or the real-time check!

