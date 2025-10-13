# Google Calendar Conflict Detection

## Overview
The system automatically detects and blocks platform timeslots that conflict with external Google Calendar events to prevent double-booking.

## How It Works

### 1. **Automatic Conflict Detection**
When a psychologist creates or updates their availability:
- The system checks their Google Calendar for any events at those times
- If an external event is found, that timeslot is automatically blocked
- Only the non-conflicting timeslots are saved

### 2. **When Conflicts Are Checked**
Conflicts are automatically detected when:
- ✅ Adding new availability (`POST /api/psychologists/availability`)
- ✅ Updating existing availability (`PUT /api/psychologists/availability`)
- ✅ Setting availability via admin (`POST /api/availability/set`)
- ✅ Manual sync (`POST /api/availability/sync-google-calendar`)

### 3. **Conflict Detection Logic**
The system:
1. Fetches events from the psychologist's Google Calendar for the specified date/time
2. Compares each platform timeslot with calendar events
3. Filters out events created by the platform itself (to avoid circular blocking)
4. Blocks any timeslot that overlaps with an external event

### 4. **User Experience**

**For Psychologists:**
- When creating/updating availability, they'll see a notification if any slots were blocked
- Example: *"⚠️ 2 slot(s) were automatically blocked due to Google Calendar conflicts: 10:00, 14:00"*
- The blocked slots are automatically removed from the availability
- Only the available slots are saved

**For Clients:**
- They only see available timeslots (conflicting slots are never shown)
- No double-booking is possible

## API Endpoints

### Check for Conflicts (Already Integrated)
```javascript
// When psychologist adds/updates availability
POST /api/psychologists/availability
PUT /api/psychologists/availability/{id}

Request:
{
  "date": "2024-10-15",
  "time_slots": ["09:00", "10:00", "11:00", "14:00"]
}

Response:
{
  "success": true,
  "data": {
    "id": 123,
    "date": "2024-10-15",
    "time_slots": ["09:00", "11:00"],  // Only non-conflicting slots
    "blocked_slots": ["10:00", "14:00"],  // Conflicting slots
    "blocked_count": 2
  },
  "message": "Availability updated. 2 slot(s) blocked due to Google Calendar conflicts: 10:00, 14:00"
}
```

### Manual Sync (Existing Endpoint)
```javascript
// Manually sync and block conflicting times
POST /api/availability/sync-google-calendar

Request:
{
  "psychologist_id": "uuid",
  "start_date": "2024-10-01",
  "end_date": "2024-10-31"
}

Response:
{
  "success": true,
  "data": {
    "syncedAt": "2024-10-12T10:30:00Z",
    "totalExternalEvents": 5,
    "blockedSlots": [
      {
        "date": "2024-10-15",
        "time": "10:00",
        "reason": "Doctor Appointment"
      }
    ],
    "errors": []
  }
}
```

### Get Busy Times (Existing Endpoint)
```javascript
// View Google Calendar busy times
GET /api/availability/google-calendar-busy-times?psychologist_id=uuid&start_date=2024-10-01&end_date=2024-10-31

Response:
{
  "success": true,
  "data": [
    {
      "start": "2024-10-15T10:00:00Z",
      "end": "2024-10-15T11:00:00Z",
      "title": "Doctor Appointment",
      "source": "google_calendar",
      "eventId": "abc123"
    }
  ]
}
```

## Configuration

### Session Duration
Currently set to **1 hour** per session. This is used to calculate the end time when checking for conflicts.

Location: 
- `backend/controllers/psychologistController.js` (lines 390, 533)
- `backend/controllers/availabilityController.js` (line 77)

```javascript
const slotEnd = new Date(slotStart);
slotEnd.setHours(slotEnd.getHours() + 1); // 1-hour sessions
```

### External Event Filtering
Platform-created events are filtered out to avoid circular blocking:

```javascript
// In googleCalendarService.js
const externalEvents = busySlots.filter(slot => 
  !slot.title.includes('LittleMinds') && 
  !slot.title.includes('Session') &&
  !slot.title.includes('Therapy')
);
```

## Error Handling

If Google Calendar is unavailable:
- The conflict check fails silently
- The availability is saved without blocking
- An error is logged but the operation continues
- This prevents calendar issues from blocking the platform

## Use Cases

### Use Case 1: Doctor Appointment Conflict
1. Psychologist has a doctor appointment at 2:00 PM on their Google Calendar
2. They try to add availability for 2:00 PM on the platform
3. **Result:** The 2:00 PM slot is automatically blocked and not added

### Use Case 2: External Meeting Booked
1. Client books a session with psychologist at 10:00 AM
2. Later, psychologist gets invited to an external meeting at 10:00 AM
3. They accept the meeting on Google Calendar
4. **Result:** When they next update their availability, the 10:00 AM slot is blocked

### Use Case 3: Multiple Conflicts
1. Psychologist tries to add slots: 9:00, 10:00, 11:00, 14:00, 15:00
2. They have Google Calendar events at 10:00 and 15:00
3. **Result:** Only 9:00, 11:00, and 14:00 are added. They see: *"2 slots blocked: 10:00, 15:00"*

## Technical Implementation

### Backend Files Modified:
1. ✅ `backend/controllers/psychologistController.js`
   - `updateAvailability()` - Checks conflicts before updating
   - `addAvailability()` - Checks conflicts before adding

2. ✅ `backend/controllers/availabilityController.js`
   - `setAvailability()` - Already had conflict checking
   - `syncGoogleCalendar()` - Manual sync endpoint
   - `getGoogleCalendarBusyTimes()` - View busy times

3. ✅ `backend/utils/googleCalendarService.js`
   - `hasTimeConflict()` - Checks single time conflict
   - `getBusyTimeSlots()` - Gets all busy slots
   - `syncCalendarEvents()` - Syncs external events

### Frontend Files Modified:
1. ✅ `frontend/src/app/psychologist/availability/page.js`
   - `handleAddAvailability()` - Shows conflict notification
   - `handleEditAvailability()` - Shows conflict notification

## Testing

### Manual Testing Steps:
1. **Setup:**
   - Psychologist must have Google Calendar connected
   - Create an event on their Google Calendar (e.g., "Test Meeting" at 2:00 PM)

2. **Test Add Availability:**
   - Go to psychologist availability page
   - Try to add 2:00 PM slot
   - Should see: *"1 slot(s) blocked due to Google Calendar conflicts: 14:00"*

3. **Test Update Availability:**
   - Edit existing availability
   - Add the conflicting time
   - Should see the same blocking notification

4. **Verify Database:**
   - Check `availability` table
   - Conflicting slot should NOT be in `time_slots` array

## Future Enhancements
- [ ] Real-time sync via webhooks (Google Calendar push notifications)
- [ ] Configurable session durations per psychologist
- [ ] Bi-directional sync (block time on Google Calendar when platform booking is made)
- [ ] Conflict resolution dashboard for psychologists
- [ ] Email notifications when conflicts are detected

## Notes
- Conflicts are checked at the time of availability creation/update
- The system does NOT continuously monitor for new calendar events
- Psychologists should update their availability regularly if their external calendar changes
- Platform-created calendar events are automatically filtered out to prevent circular blocking

