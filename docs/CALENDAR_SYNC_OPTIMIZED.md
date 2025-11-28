# Optimized Calendar Sync System - How It Works

## Overview
The system has been optimized to ensure external Google Meet events are blocked in real-time when users visit therapist profiles, while maintaining fast page load times.

## Two-Layer Protection System

### Layer 1: Background Sync (Every 30 Minutes)
- **Frequency**: Automatic every 30 minutes
- **Purpose**: Updates database by removing blocked slots from availability table
- **Date Range**: Today + next 30 days
- **Process**: Runs in background, doesn't affect user experience

### Layer 2: Real-Time Check (When User Visits Profile)
- **Trigger**: When user opens therapist profile page
- **Purpose**: Checks Google Calendar directly and blocks external events BEFORE showing availability
- **Performance**: Optimized with 3-second timeout to prevent slow loading
- **Result**: User sees only available slots (external events already filtered out)

## Optimized Flow When User Visits Therapist Profile

### Step 1: User Opens Profile Page
```
User clicks on therapist profile → Frontend calls availability API
```

### Step 2: Backend Real-Time Check (FAST - <3 seconds)
```javascript
GET /api/psychologists/:id/availability?start_date=...&end_date=...
```

**Backend Process:**
1. **Get availability from database** (fast - ~50ms)
2. **Get booked sessions from database** (fast - ~50ms)
3. **Real-time Google Calendar check** (with 3-second timeout):
   - Fetches Google Calendar events directly
   - Filters external events with Google Meet links
   - Excludes system events and public holidays
   - If timeout (>3s), continues without blocking (30-min sync will catch it)
4. **Filter and block**:
   - Remove booked sessions from availability
   - Remove external Google Meet events from availability
   - Return filtered availability

### Step 3: Frontend Displays
- User sees only available slots
- External events are already blocked
- Page loads quickly (<3 seconds even with Google Calendar check)

## Performance Optimizations

### 1. Timeout Protection
- Google Calendar check has 3-second timeout
- If Google Calendar is slow, page still loads quickly
- Background sync (30-min) will eventually update database

### 2. Removed Redundant Sync Call
- **Before**: Frontend called sync API, then availability API (2 API calls, slow)
- **After**: Frontend calls availability API only (1 API call, fast)
- Availability API does real-time check internally

### 3. Efficient Filtering
- Filter logic runs in-memory (fast)
- Only processes events in the requested date range
- Parallel processing where possible

## Example: User Visits Profile at 10:15 AM

**Scenario**: External event "Koott Session - Manju John" at 2:00 PM was added at 10:10 AM (5 minutes after last sync)

### What Happens:
1. **User opens profile** (10:15 AM)
2. **Frontend calls**: `GET /api/psychologists/:id/availability`
3. **Backend process**:
   - Gets availability from database: `["10:00 AM", "11:00 AM", "2:00 PM", "3:00 PM"]`
   - **Real-time Google Calendar check** (takes ~500ms):
     - Fetches events from Google Calendar
     - Finds "Koott Session - Manju John" at 2:00 PM
     - Has Google Meet: ✅ Yes
     - Is system event: ❌ No
     - Is public holiday: ❌ No
     - **Result**: BLOCKED
   - Filters out 2:00 PM slot
   - Returns: `["10:00 AM", "11:00 AM", "3:00 PM"]`
4. **User sees**: Only available slots (2:00 PM is NOT shown)
5. **Total time**: <1 second (fast!)

## Filter Logic (Applied in Real-Time)

### Events That Are BLOCKED:
- ✅ External events with Google Meet links (`hangoutsLink` or `conferenceData`)
- ✅ Manually blocked slots (title contains "🚫 blocked" or "blocked")

### Events That Are NOT Blocked:
- ❌ System events: Contains "littleminds", "little care", or "kuttikal"
- ❌ Public holidays: Contains "holiday", "festival", "celebration", "observance"
- ❌ Events without Google Meet links (unless manually blocked)

## Timing Summary

| Action | Frequency | Purpose |
|--------|-----------|---------|
| **Background Sync** | Every 30 minutes | Updates database |
| **Real-Time Check** | When user visits profile | Blocks events before showing availability |
| **Timeout** | 3 seconds max | Prevents slow loading |

## Key Benefits

1. **Reliable**: External events blocked even if added between sync intervals
2. **Fast**: Real-time check with timeout ensures quick page loads
3. **Efficient**: Single API call instead of two
4. **Resilient**: If Google Calendar is slow, page still loads (30-min sync catches it later)

## Code Flow

```
User visits profile
    ↓
Frontend: GET /api/psychologists/:id/availability
    ↓
Backend: availabilityCalendarService.getPsychologistAvailabilityRange()
    ↓
1. Get availability from database (fast)
2. Get booked sessions from database (fast)
3. Real-time Google Calendar check (with 3s timeout)
   - Fetch events
   - Filter external Google Meet events
   - Block overlapping slots
4. Return filtered availability
    ↓
Frontend displays only available slots
```

## Summary

✅ **30-minute background sync**: Continues as before (updates database)
✅ **Real-time check**: Happens when user visits profile (blocks before showing)
✅ **Fast performance**: 3-second timeout ensures quick page loads
✅ **Reliable blocking**: External Google Meet events are always blocked

The system is now optimized for both reliability and performance!

