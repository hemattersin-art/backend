# Concurrent Booking Analysis & Race Condition Assessment

## 🚨 **CRITICAL ISSUE: Race Condition in Booking System**

### **Current Booking Flow (Vulnerable to Race Conditions)**

```
1. Check Availability (READ)
   ↓
2. Create Session (INSERT)
   ↓
3. Update Availability (UPDATE)
```

**Problem:** These 3 operations are NOT atomic (not in a transaction)

---

## ⚠️ **Scenario: 20 People Booking Same Slot Simultaneously**

### **What Happens Currently:**

1. **All 20 requests arrive at the same time**
2. **All 20 check availability** → All see slot as "available" ✅
3. **All 20 create sessions** → Multiple sessions created for same slot ❌
4. **All 20 update availability** → Last one wins, but damage is done ❌

**Result:** Multiple bookings for the same time slot = **DOUBLE BOOKING**

---

## 📊 **Current System Architecture**

### **Priority & Timing:**

| Operation | Priority | Timing | Real-time? |
|-----------|----------|--------|------------|
| **Booking Check** | HIGH | Immediate | ✅ Yes |
| **Session Creation** | HIGH | Immediate | ✅ Yes |
| **Availability Update** | MEDIUM | After booking | ⚠️ Delayed |
| **Google Calendar Sync** | LOW | Every 15 min | ❌ No (Background) |

### **How Google Calendar Sync Works:**

1. **Runs every 15 minutes** (background cron job)
2. **Fetches events** from Google Calendar (next 21 days)
3. **Updates availability table** to block conflicting slots
4. **Does NOT prevent real-time double bookings**

**Key Point:** Calendar sync is **NOT real-time** - it's a background maintenance task.

---

## 🔍 **Current Code Flow Analysis**

### **Booking Endpoint:** `clientController.bookSession()`

```javascript
// Step 1: Check availability (READ)
const isAvailable = await availabilityService.isTimeSlotAvailable(...);
if (!isAvailable) return error;

// Step 2: Create session (INSERT) - NO UNIQUE CONSTRAINT!
const { data: session } = await supabase
  .from('sessions')
  .insert([sessionData])
  .select()
  .single();

// Step 3: Update availability (UPDATE) - AFTER session creation
await supabase
  .from('availability')
  .update({ time_slots: filtered })
  .eq('id', avail.id);
```

### **Problems Identified:**

1. ❌ **No database transaction** - operations not atomic
2. ❌ **No unique constraint** on `(psychologist_id, scheduled_date, scheduled_time)`
3. ❌ **No row-level locking** - multiple reads can happen simultaneously
4. ❌ **Availability update happens AFTER** session creation
5. ❌ **No optimistic locking** - no version checking

---

## 🛡️ **How to Fix: Recommended Solutions**

### **Solution 1: Database Unique Constraint (RECOMMENDED)**

Add unique constraint to prevent duplicate bookings at database level:

```sql
ALTER TABLE sessions 
ADD CONSTRAINT unique_psychologist_time_slot 
UNIQUE (psychologist_id, scheduled_date, scheduled_time, status) 
WHERE status IN ('booked', 'rescheduled', 'confirmed');
```

**Pros:**
- ✅ Database-level protection (most reliable)
- ✅ Prevents duplicates even in race conditions
- ✅ Fast and efficient

**Cons:**
- ⚠️ Requires database migration
- ⚠️ Need to handle constraint violation errors gracefully

---

### **Solution 2: Optimistic Locking with Availability Table**

Use version/updated_at field to detect concurrent modifications:

```javascript
// 1. Read availability with version
const { data: avail } = await supabase
  .from('availability')
  .select('id, time_slots, updated_at')
  .eq('psychologist_id', psychologist_id)
  .eq('date', scheduled_date)
  .single();

// 2. Check if slot exists
if (!avail.time_slots.includes(scheduled_time)) {
  return error('Slot no longer available');
}

// 3. Create session
const { data: session } = await supabase
  .from('sessions')
  .insert([sessionData])
  .select()
  .single();

// 4. Update availability with version check
const { error: updateError } = await supabase
  .from('availability')
  .update({ 
    time_slots: filtered,
    updated_at: new Date().toISOString()
  })
  .eq('id', avail.id)
  .eq('updated_at', avail.updated_at); // Only update if not changed

if (updateError || !updateError) {
  // Check if update succeeded (0 rows = someone else modified it)
  // Rollback session if needed
}
```

---

### **Solution 3: Database Transaction with Row Locking**

Use PostgreSQL advisory locks or SELECT FOR UPDATE:

```javascript
// Start transaction
await supabase.rpc('begin_transaction');

try {
  // Lock the availability row
  const { data: avail } = await supabase
    .from('availability')
    .select('*')
    .eq('psychologist_id', psychologist_id)
    .eq('date', scheduled_date)
    .single()
    .for('update'); // Row-level lock

  // Check availability
  if (!avail.time_slots.includes(scheduled_time)) {
    throw new Error('Slot not available');
  }

  // Create session
  const { data: session } = await supabase
    .from('sessions')
    .insert([sessionData])
    .select()
    .single();

  // Update availability
  await supabase
    .from('availability')
    .update({ time_slots: filtered })
    .eq('id', avail.id);

  // Commit transaction
  await supabase.rpc('commit_transaction');
} catch (error) {
  // Rollback
  await supabase.rpc('rollback_transaction');
  throw error;
}
```

**Note:** Supabase/PostgREST may not support full transaction control. May need to use raw SQL.

---

### **Solution 4: Application-Level Locking (Redis/Distributed Lock)**

Use Redis or similar for distributed locking:

```javascript
const Redis = require('ioredis');
const redis = new Redis();

async function bookSessionWithLock(...) {
  const lockKey = `booking:${psychologist_id}:${scheduled_date}:${scheduled_time}`;
  
  // Try to acquire lock (expires in 5 seconds)
  const lockAcquired = await redis.set(lockKey, 'locked', 'EX', 5, 'NX');
  
  if (!lockAcquired) {
    return error('Slot is being booked by another user. Please try again.');
  }

  try {
    // Check availability
    // Create session
    // Update availability
  } finally {
    // Release lock
    await redis.del(lockKey);
  }
}
```

---

## 🎯 **Recommended Implementation Strategy**

### **Immediate Fix (Quick):**

1. **Add unique constraint** to sessions table
2. **Handle constraint violations** gracefully in code
3. **Return user-friendly error** when duplicate detected

### **Long-term Fix (Robust):**

1. **Add unique constraint** (database level)
2. **Implement optimistic locking** (application level)
3. **Add retry logic** for failed bookings
4. **Monitor and alert** on constraint violations

---

## 📈 **Impact on Google Calendar Sync**

### **Current Behavior:**

- **Calendar sync runs every 15 minutes** (background)
- **Does NOT prevent real-time double bookings**
- **Only blocks slots** that are already in Google Calendar
- **Updates availability table** for future reference

### **After Fix:**

- **Calendar sync remains background task** (unchanged)
- **Real-time booking protection** handled by database constraints
- **Calendar sync** continues to sync external events
- **No conflict** between sync and bookings

---

## 🔄 **Priority Order of Operations**

### **During High Traffic:**

1. **Booking Request** (HIGHEST) - User action, must be fast
2. **Availability Check** (HIGH) - Must be accurate
3. **Session Creation** (HIGH) - Must be atomic
4. **Availability Update** (MEDIUM) - Can be slightly delayed
5. **Calendar Sync** (LOW) - Background, doesn't block bookings

### **Calendar Sync Priority:**

- **Does NOT block bookings** - runs independently
- **Updates availability** for external events
- **Runs every 15 minutes** - not real-time
- **Does NOT prevent race conditions** in bookings

---

## ✅ **Best Practices for High Traffic**

1. **Database constraints** - First line of defense
2. **Optimistic locking** - Detect concurrent modifications
3. **Retry logic** - Handle transient failures
4. **Rate limiting** - Prevent abuse
5. **Monitoring** - Alert on constraint violations
6. **Graceful degradation** - Fallback if checks fail

---

## 🚨 **Current Risk Level: HIGH**

**Without fixes, the system is vulnerable to:**
- Multiple bookings for same slot
- Double-booking conflicts
- Poor user experience
- Potential revenue loss
- Calendar conflicts

**Recommended Action:** Implement Solution 1 (Unique Constraint) immediately.

