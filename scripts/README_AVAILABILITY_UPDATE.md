# Update All Psychologists Availability

## Option 1: Using the Admin API Endpoint (Recommended)

You can trigger the update via the admin API endpoint:

```bash
# Make sure your backend server is running
# Then call the endpoint (requires admin authentication)

curl -X POST http://localhost:5001/api/admin/availability/update-all \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

Or use it from the admin panel by adding a button that calls this endpoint.

## Option 2: Run the Script (Requires .env file)

If you have the backend .env file configured:

```bash
cd backend
node scripts/updateAllPsychologistsAvailability.js
```

## What This Does

- Updates ALL existing psychologists in the database
- Adds default availability from today to 3 weeks ahead
- Time slots: 10:00 AM to 1:00 PM and 2:00 PM to 5:00 PM (IST)
- Only adds dates that don't already exist (won't overwrite existing availability)
- Each day gets 8 time slots (10 AM, 11 AM, 12 PM, 1 PM, 2 PM, 3 PM, 4 PM, 5 PM)

## Daily Automatic Updates

The system automatically runs at 12:00 AM daily to add the next day (3 weeks from today) for all psychologists. This is handled by the `dailyAvailabilityService` which starts when the server starts.

