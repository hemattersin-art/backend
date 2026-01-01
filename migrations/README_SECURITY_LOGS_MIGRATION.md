# Security Logs Migration Guide

## Overview
Security logs have been moved from file system (`security-logs.json`) to database (`security_logs` table) for better persistence, querying, and automatic cleanup.

## Migration Steps

### 1. Run Database Migration

Execute the SQL migration to create the `security_logs` table:

**Option A: Via Supabase Dashboard (Recommended)**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **SQL Editor**
4. Copy and paste the contents of `backend/migrations/create_security_logs_table.sql`
5. Click **Run** to execute the migration

**Option B: Via Supabase CLI**
```bash
supabase db push
# Or manually:
psql -h <your-db-host> -U postgres -d postgres -f backend/migrations/create_security_logs_table.sql
```

### 2. Verify Migration

Check that the table was created:
```sql
SELECT * FROM security_logs LIMIT 1;
```

If the query runs without error, the migration was successful.

### 3. (Optional) Clean Up Old Files

After verifying that security logs are being written to the database, you can optionally delete the old file-based logs:

```bash
# Backup first (optional)
cp backend/utils/security-logs.json backend/utils/security-logs.json.backup

# Delete old files (optional - they won't be used anymore)
rm backend/utils/security-logs.json
rm backend/utils/security-metrics.json
```

**Note**: The old files won't cause any issues if left in place - they're simply not used anymore.

## What Changed

### Before (File System)
- Logs stored in: `backend/utils/security-logs.json`
- Limited to 1000 entries
- Manual cleanup required
- No SQL querying

### After (Database)
- Logs stored in: `security_logs` table (Supabase)
- Unlimited entries (with automatic cleanup)
- Automatic weekly cleanup (deletes logs older than 7 days)
- Full SQL querying support
- Better for compliance and analysis

## Automatic Cleanup

The cleanup job runs automatically:
- **Frequency**: Weekly (every 7 days)
- **Retention**: Logs older than 1 week are deleted
- **Job**: `backend/jobs/securityLogsCleanupJob.js`
- **Started**: Automatically on server startup

## Verification

After migration, verify logs are being written:

1. **Check server logs** - Look for: `🔒 Security log saved: ...`
2. **Query database**:
   ```sql
   SELECT COUNT(*) FROM security_logs;
   ```
3. **Use view script**:
   ```bash
   node backend/scripts/viewSecurityLogs.js
   ```

## Rollback (If Needed)

If you need to rollback:

1. The old file-based code is still compatible
2. Simply revert the `securityMonitor.js` changes
3. The old `security-logs.json` file will be used again

However, this is not recommended as the database approach is superior.

## Support

If you encounter issues:
1. Check server console for error messages
2. Verify `security_logs` table exists
3. Check database connection
4. Review `backend/utils/securityMonitor.js` for errors

