# Google Calendar Integration - Database Setup Guide

## 🎯 Quick Setup Instructions

### Step 1: Add Database Column
Go to your **Supabase Dashboard** and run this SQL command:

```sql
ALTER TABLE psychologists 
ADD COLUMN google_calendar_credentials JSONB DEFAULT NULL;
```

### Step 2: Verify the Column
After adding the column, run this to verify it was created:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'psychologists' 
AND column_name = 'google_calendar_credentials';
```

### Step 3: Restart Your Server
Once the column is added, restart your backend server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm start
```

## 🔧 What This Column Does

The `google_calendar_credentials` column stores:
- `access_token`: For accessing Google Calendar API
- `refresh_token`: For renewing expired access tokens
- `scope`: Permissions granted to the app
- `expiry_date`: When the token expires

## 📊 Expected Result

After adding the column and restarting, you should see:
```
✅ Google Calendar sync service started successfully
✅ Found X psychologists with Google Calendar credentials
🔄 Syncing calendar for psychologist: [Name]
```

## 🚨 Troubleshooting

If you still see the error:
1. **Double-check** the column was added correctly
2. **Refresh** your Supabase dashboard
3. **Verify** you're looking at the correct database
4. **Check** table permissions

## 🎉 Next Steps

Once the column is added:
1. **Test the integration** by setting availability for a psychologist
2. **Configure OAuth2** for psychologists to connect their calendars
3. **Monitor the sync logs** to ensure everything works

---
*This file was generated to help you complete the Google Calendar integration setup.*
