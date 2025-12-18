# Calendar Sync Conflict Report Explanation

## What Are These Conflicts?

The system detects conflicts between **Google Calendar events** and **availability slots** in the database. These conflicts indicate that the calendar sync is not working perfectly, which could lead to double-booking or unavailable slots showing as available.

---

## Conflict Types

### 1. **"Slot Not Blocked"** 
**Meaning:** An availability slot in the system shows as **available**, but there's a **Google Calendar event** at that same time.

**Problem:** 
- The slot should be blocked (unavailable) because there's already a calendar event
- But it's still showing as available, which could allow double-booking

**Example:**
```
Slot: 10:00 AM on 2025-12-18
Calendar Event: "New Event" (11:30 - 22:30)
```
The slot at 10:00 AM overlaps with the event, so it should be blocked.

---

### 2. **"Event Not Blocking"**
**Meaning:** A **Google Calendar event** exists, but the **availability slots** are still showing as **available** even though they overlap with the event.

**Problem:**
- The calendar event should have automatically blocked those slots during sync
- But the slots remain available, creating a conflict

**Example:**
```
Calendar Event: "Weekly Meeting" (15:00 - 16:00)
Available Slots: 9:00 AM, 10:00 AM
```
The event exists but didn't block the overlapping slots.

---

## Specific Conflicts Found

### **Liana Sameer** (3 conflicts)
1. **Time Zone Issue Detected:**
   - Event: "Therapy Session - Pending with Liana" at **17:00 (5:00 PM)**
   - Conflicting with slots: **11:00 AM** and **12:00 PM**
   - **Issue:** This appears to be a timezone conversion problem. The event at 5:00 PM should not conflict with 11:00 AM slots unless there's a timezone mismatch.

2. **Event Not Blocking:**
   - The event exists but slots at 11:00 AM and 12:00 PM are still available
   - These should be automatically blocked by the calendar sync

---

### **Athulya O** (10 conflicts)
1. **Long-Duration Events:**
   - Event: "New Event" from **11:30 to 22:30** (11 hours long)
   - This event overlaps with multiple slots (8:00 AM, 9:00 AM, 10:00 AM)
   - **Issue:** Very long events should block all overlapping slots

2. **Recurring Events:**
   - Event: "Weekly Meeting" (15:00 - 16:00) on multiple dates
   - **Issue:** Recurring events may not be properly syncing to block availability slots

---

### **Anusmitha Praveen** (1 conflict)
1. **Test Event:**
   - Event: "Test Conflict Event - SIMULATED"
   - **Issue:** This is a test/simulated event that should be removed or the conflict detection should ignore test events

---

## Root Causes

1. **Calendar Sync Not Running:** The automatic calendar sync may not be running frequently enough
2. **Timezone Issues:** Events in different timezones may not be converting correctly
3. **Long-Duration Events:** Events spanning many hours may not be properly blocking all overlapping slots
4. **Recurring Events:** Recurring calendar events may not be syncing correctly
5. **Manual Calendar Edits:** If psychologists manually add events to Google Calendar, they may not sync immediately

---

## Impact

- **Double Booking Risk:** Clients might be able to book slots that are already occupied
- **Confusion:** Psychologists may see available slots when they're actually busy
- **Data Inconsistency:** Database availability doesn't match Google Calendar reality

---

## Recommended Actions

1. **Run Manual Calendar Sync:** Trigger a calendar sync for all psychologists
2. **Check Timezone Settings:** Ensure all events are in IST (Asia/Kolkata)
3. **Review Long Events:** Check if events spanning many hours are legitimate
4. **Remove Test Events:** Delete or mark test/simulated events
5. **Increase Sync Frequency:** Run calendar sync more frequently (currently daily)

---

## How to Fix

The conflicts will be automatically resolved when:
- The calendar sync service runs and updates availability slots
- Psychologists manually sync their calendars
- The conflicting calendar events are removed or cancelled

The system should automatically block slots that overlap with calendar events during the next sync cycle.
