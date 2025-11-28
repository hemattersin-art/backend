# Calendar Sync System - How It Works

## Overview
The calendar sync system automatically fetches external Google Calendar events (especially those with Google Meet links) and blocks those time slots in the psychologist's availability.

## Timing & Frequency

### Automatic Sync Schedule
- **Frequency**: Every 30 minutes
- **Cron Expression**: `*/30 * * * *` (runs at :00 and :30 of every hour)
- **Time Range**: Checks current day + next 30 days
- **Startup**: Also runs 5 seconds after server startup

### Manual Sync
- Psychologists can manually trigger sync from Settings page: "Sync Now" button
- Admin can trigger sync via API endpoint

## Complete Flow

### Step 1: Automatic Sync Trigger (Every 30 Minutes)
```
Server Startup → calendarSyncService.start() → Cron Job Scheduled
Every 30 minutes → syncAllPsychologists() runs
```

### Step 2: Fetch All Psychologists with Google Calendar
```javascript
// Gets all psychologists who have connected Google Calendar
SELECT id, first_name, last_name, google_calendar_credentials 
FROM psychologists 
WHERE google_calendar_credentials IS NOT NULL
```

### Step 3: For Each Psychologist - Fetch Google Calendar Events
```javascript
// Date range: Today (00:00) to 30 days from now (23:59:59)
startDate = Today at 00:00:00
endDate = Today + 30 days at 23:59:59

// Fetch events from Google Calendar API
googleCalendarService.getBusyTimeSlots(credentials, startDate, endDate)
```

### Step 4: Filter External Events
The system filters events based on these rules:

**INCLUDED (Will be blocked):**
- ✅ Events with Google Meet links (`hangoutsLink` or `conferenceData.entryPoints`)
- ✅ Manually blocked slots (title contains "🚫 blocked" or "blocked")

**EXCLUDED (Will NOT be blocked):**
- ❌ System events: Contains "littleminds", "little care", or "kuttikal" in title
- ❌ Public holidays: Contains "holiday", "festival", "celebration", "observance" in title
- ❌ Events without Google Meet links (unless manually blocked)

### Step 5: Process Each External Event
For each external event found:

```javascript
1. Extract event date and time
   - eventDate = event.start (in local timezone)
   - eventTime = event.start time (HH:MM format)
   - normalizedEventTime = Convert to 24-hour format (e.g., "2:00 PM" → "14:00")

2. Find availability record for that date
   SELECT id, time_slots 
   FROM availability 
   WHERE psychologist_id = ? AND date = eventDate

3. If availability exists:
   - Normalize each time slot in availability (e.g., "2:00 PM" → "14:00")
   - Compare normalized slot with normalized event time
   - If match found: Remove that slot from time_slots array
   - Update availability record in database

4. Log the blocked slot
```

### Step 6: Update Database
```javascript
// Remove matching time slot from availability
UPDATE availability 
SET time_slots = [remaining slots], updated_at = NOW()
WHERE id = availability.id
```

## Example Flow

**Scenario**: External event "Koott Session - Manju John (Irene)" at 2:00 PM - 3:00 PM on 2025-11-29

1. **30-minute sync runs** → Fetches all Google Calendar events
2. **Event detected**: 
   - Title: "Koott Session - Manju John (Irene)"
   - Time: 14:00 (2:00 PM)
   - Date: 2025-11-29
   - Has Google Meet: ✅ Yes
   - Is system event: ❌ No (doesn't contain "littleminds")
   - Is public holiday: ❌ No
   - **Result**: INCLUDED as external event

3. **Check availability**:
   - Query: `SELECT time_slots FROM availability WHERE psychologist_id = 'irene_id' AND date = '2025-11-29'`
   - Found: `["10:00 AM", "11:00 AM", "2:00 PM", "3:00 PM", "4:00 PM"]`

4. **Normalize and match**:
   - Event time: "14:00" (normalized from 2:00 PM)
   - Slot "2:00 PM" → normalized to "14:00"
   - Match found! ✅

5. **Remove slot**:
   - Updated slots: `["10:00 AM", "11:00 AM", "3:00 PM", "4:00 PM"]`
   - "2:00 PM" removed from availability

6. **Update database**:
   ```sql
   UPDATE availability 
   SET time_slots = '["10:00 AM", "11:00 AM", "3:00 PM", "4:00 PM"]'
   WHERE id = availability_id
   ```

7. **Frontend display**:
   - When user views therapist profile, availability API is called
   - API checks Google Calendar for external events (real-time)
   - External events are filtered out from available slots
   - "2:00 PM" slot is NOT shown to users

## Real-Time Frontend Check

When a user views the therapist profile page:

1. **Frontend calls**: `GET /api/psychologists/:id/availability?date=2025-11-29`
2. **Backend process**:
   - Gets availability from database
   - Fetches Google Calendar events for that date (real-time)
   - Filters external events (with Google Meet)
   - Removes overlapping time slots
   - Returns filtered availability

3. **Result**: User sees only available slots (external events already removed)

## Key Files

- **`backend/services/calendarSyncService.js`**: Main sync service (runs every 30 min)
- **`backend/utils/googleCalendarService.js`**: Google Calendar API wrapper
- **`backend/utils/availabilityCalendarService.js`**: Real-time availability check for frontend
- **`backend/controllers/availabilityController.js`**: API endpoint for availability
- **`backend/controllers/psychologistController.js`**: Psychologist availability endpoint

## Manual Sync

Psychologists can manually trigger sync:
- **Location**: Settings page → Google Calendar section
- **Button**: "Sync Now"
- **Endpoint**: `POST /api/availability-controller/sync-google-calendar`
- **Process**: Same as automatic sync, but triggered immediately

## Time Format Normalization

The system handles different time formats:
- **12-hour format**: "2:00 PM" → normalized to "14:00"
- **24-hour format**: "14:00" → stays "14:00"
- **Range format**: "14:00-15:00" → extracts "14:00"

This ensures matching works regardless of how times are stored.

## Summary

- **Check Frequency**: Every 30 minutes automatically
- **Date Range**: Today + next 30 days
- **Blocking Criteria**: External events with Google Meet links
- **Exclusions**: System events and public holidays
- **Process**: Fetch → Filter → Match → Remove → Update Database
- **Real-time**: Frontend also checks Google Calendar when displaying availability

