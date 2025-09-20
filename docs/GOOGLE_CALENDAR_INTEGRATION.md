# Google Calendar Integration for Psychologist Availability

This system integrates with Google Calendar to prevent double bookings when psychologists work on multiple platforms.

## Problem Solved

When psychologists work on multiple therapy platforms, they might book sessions on other websites that get added to their Google Calendar. Without integration, your platform doesn't know about these external bookings and may still show those time slots as available, leading to double bookings.

## Solution Overview

The system now:
1. **Fetches Google Calendar events** for each psychologist
2. **Checks for conflicts** before setting availability
3. **Automatically blocks conflicting times** in your system
4. **Runs background sync** every 30 minutes
5. **Provides manual sync** via API endpoints

## Setup Instructions

### 1. Environment Variables

Add these to your `.env` file:

```env
# Google Calendar API Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5001/api/oauth/google/callback

# Optional: Google Calendar API Key (if using service account)
GOOGLE_API_KEY=your_google_api_key
```

### 2. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:5001/api/oauth/google/callback`
5. Download the credentials JSON file

### 3. Database Schema

The `psychologists` table needs a `google_calendar_credentials` column:

```sql
ALTER TABLE psychologists 
ADD COLUMN google_calendar_credentials JSONB;
```

### 4. Install Dependencies

```bash
npm install googleapis google-auth-library node-cron
```

## API Endpoints

### Manual Calendar Sync

**POST** `/api/availability-controller/sync-google-calendar`

Sync Google Calendar events for a specific psychologist and date range.

```json
{
  "psychologist_id": "123",
  "start_date": "2024-01-01",
  "end_date": "2024-01-31"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "syncedAt": "2024-01-15T10:30:00Z",
    "totalExternalEvents": 5,
    "blockedSlots": [
      {
        "date": "2024-01-20",
        "time": "10:00",
        "reason": "External Therapy Session"
      }
    ],
    "errors": []
  }
}
```

### Get Google Calendar Busy Times

**GET** `/api/availability-controller/google-calendar-busy-times`

Get busy time slots from Google Calendar for a psychologist.

```
GET /api/availability-controller/google-calendar-busy-times?psychologist_id=123&start_date=2024-01-01&end_date=2024-01-31
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "start": "2024-01-20T10:00:00Z",
      "end": "2024-01-20T11:00:00Z",
      "title": "External Therapy Session",
      "source": "google_calendar",
      "eventId": "abc123"
    }
  ]
}
```

### Set Availability (with Google Calendar checking)

**POST** `/api/availability-controller/set`

Set psychologist availability with automatic Google Calendar conflict checking.

```json
{
  "psychologist_id": "123",
  "date": "2024-01-20",
  "time_slots": ["09:00", "10:00", "11:00", "14:00", "15:00"],
  "is_available": true
}
```

If there's a Google Calendar conflict, you'll get an error:
```json
{
  "success": false,
  "error": "Time slots 10:00 conflict with Google Calendar events"
}
```

## How It Works

### 1. Background Sync Service

- Runs every 30 minutes automatically
- Fetches Google Calendar events for all psychologists with credentials
- Blocks conflicting time slots in your availability system
- Logs sync results and errors

### 2. Real-time Conflict Checking

- Before setting availability, checks Google Calendar for conflicts
- Prevents setting time slots that conflict with external events
- Returns specific error messages about conflicting times

### 3. Automatic Token Refresh

- Handles Google OAuth token refresh automatically
- Updates stored credentials when tokens are refreshed
- Continues working even when tokens expire

### 4. Error Handling

- Graceful fallback if Google Calendar is unavailable
- Continues operation even if some psychologists fail to sync
- Detailed error logging for debugging

## Psychologist Setup

Each psychologist needs to:

1. **Connect their Google Calendar** via OAuth flow
2. **Grant calendar read permissions** to your application
3. **Store credentials** in the `google_calendar_credentials` field

The credentials should be stored as JSON:
```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//0...",
  "scope": "https://www.googleapis.com/auth/calendar.readonly",
  "token_type": "Bearer",
  "expiry_date": 1640995200000
}
```

## Monitoring and Logs

The system provides detailed logging:

- ✅ Successful syncs
- ❌ Sync errors
- 🔄 Sync progress
- 📅 Events found and blocked
- ⚠️ Token refresh attempts

Check your server logs for calendar sync activity.

## Troubleshooting

### Common Issues

1. **"Psychologist has no Google Calendar credentials"**
   - Ensure the psychologist has completed OAuth flow
   - Check that credentials are stored in the database

2. **"Failed to sync calendar: Invalid token"**
   - Token may be expired, system will attempt refresh
   - Check Google Cloud Console credentials

3. **"Error checking Google Calendar conflicts"**
   - Google Calendar API may be temporarily unavailable
   - System continues without blocking (failsafe)

### Debug Mode

Enable debug logging by setting:
```env
NODE_ENV=development
```

This provides more detailed error messages and logging.

## Security Considerations

- Google Calendar credentials are stored encrypted in the database
- Only calendar read permissions are requested
- Tokens are automatically refreshed to maintain security
- Failed syncs don't block legitimate bookings (failsafe)

## Performance

- Background sync runs every 30 minutes (configurable)
- Only syncs psychologists with Google Calendar credentials
- Syncs next 30 days of events (configurable)
- Efficient API usage with proper error handling

This integration ensures your platform never double-books psychologists who work on multiple platforms! 🎯
