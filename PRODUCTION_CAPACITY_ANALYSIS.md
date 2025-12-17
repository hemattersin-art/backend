# Production Capacity Analysis (2GB RAM on Render)

## 📊 **Memory Usage Breakdown**

### **Base System Memory (Node.js + Express + Dependencies)**

| Component | Estimated Memory |
|-----------|------------------|
| Node.js Runtime | ~50-80MB |
| Express Server | ~10-20MB |
| Supabase Client | ~5-10MB |
| Dependencies (dayjs, jwt, etc.) | ~10-20MB |
| **Base Total** | **~75-130MB** |

### **Per Booking Request Memory**

| Operation | Memory per Request |
|-----------|-------------------|
| Request Handler | ~2-5MB |
| Database Query | ~1-2MB |
| Session Creation | ~0.5-1MB |
| Availability Update | ~0.5-1MB |
| **Per Request Total** | **~4-9MB** |

### **Background Services Memory**

| Service | Memory Usage | Frequency |
|---------|--------------|-----------|
| Calendar Sync Service | ~10-20MB | Every 15 min |
| Session Reminder Service | ~5-10MB | Every hour |
| Daily Availability Service | ~5-10MB | Daily at 12 AM |
| Daily Free Assessment Service | ~5-10MB | Daily at 12 AM |
| Security Monitor | ~5-10MB | Continuous |
| Bot Detector | ~5-10MB | Continuous |
| **Background Services Total** | **~35-70MB** |

### **Peak Memory Calculation**

```
Base System:            ~100MB (average)
Background Services:   ~50MB (average)
Booking Requests:       ~6MB per request (average)
Safety Margin (20%):    ~230MB
─────────────────────────────────
Available for Requests: ~1,620MB
```

---

## 🎯 **Maximum Concurrent Bookings Calculation**

### **Conservative Estimate (Safe for Production):**

```
Available Memory: 1,620MB
Memory per Request: 6MB
─────────────────────────
Maximum Concurrent: ~270 requests
```

**Recommended Production Limit: 200-250 concurrent bookings**

### **Optimistic Estimate (Peak Capacity):**

```
Available Memory: 1,620MB
Memory per Request: 4MB (optimized)
─────────────────────────
Maximum Concurrent: ~400 requests
```

**Peak Capacity: 300-350 concurrent bookings**

---

## ⚠️ **Real-World Constraints**

### **1. Database Connection Pool**

- Supabase/PostgreSQL connection limits
- Default: ~10-20 connections per instance
- **Bottleneck:** Database connections, not memory

### **2. Network Latency**

- Supabase API response times
- Average: ~200-400ms per request
- **Impact:** Slower under high load

### **3. Google Calendar API Rate Limits**

- 1,000 requests per 100 seconds per user
- **Impact:** Calendar sync may slow down during high traffic

### **4. CPU Usage**

- 2GB RAM typically comes with limited CPU
- High concurrency increases CPU usage
- **Impact:** Response times may increase

---

## 📈 **Realistic Production Capacity**

### **Recommended Limits:**

| Scenario | Concurrent Bookings | Memory Usage | Status |
|----------|---------------------|--------------|--------|
| **Normal Traffic** | 50-100 | ~400-700MB | ✅ Safe |
| **High Traffic** | 100-200 | ~700-1,300MB | ✅ Safe |
| **Peak Traffic** | 200-250 | ~1,300-1,600MB | ⚠️ Monitor |
| **Maximum** | 250-300 | ~1,600-1,900MB | 🚨 Risk |

### **With All Services Running:**

| Service State | Available for Bookings | Max Concurrent |
|--------------|------------------------|----------------|
| **All services idle** | ~1,900MB | ~300 bookings |
| **Calendar sync running** | ~1,880MB | ~295 bookings |
| **All services active** | ~1,850MB | ~290 bookings |
| **Peak load (all active)** | ~1,800MB | ~280 bookings |

**Safe Production Limit: 200-250 concurrent bookings**

---

## 🔄 **How Services Interact During High Traffic**

### **Scenario: 200 Concurrent Bookings + Services Running**

1. **Booking Requests (200)**
   - Memory: ~1,200MB
   - CPU: High
   - Database: High load

2. **Calendar Sync (Every 15 min)**
   - Memory: +20MB
   - CPU: Medium
   - **Impact:** Minimal (~1% slowdown)

3. **Session Reminder (Every hour)**
   - Memory: +10MB
   - CPU: Low
   - **Impact:** Negligible

4. **Availability Service (Daily)**
   - Memory: +10MB
   - CPU: Low
   - **Impact:** Negligible

**Total Memory: ~1,240MB (within 2GB limit)** ✅

---

## 🚨 **Bottlenecks (Not Memory)**

### **1. Database Connection Pool**

**Limit:** ~10-20 concurrent connections  
**Impact:** More critical than memory  
**Solution:** Connection pooling, request queuing

### **2. Supabase API Rate Limits**

**Limit:** Varies by plan  
**Impact:** May throttle under extreme load  
**Solution:** Implement request queuing/retry logic

### **3. Network Latency**

**Impact:** Response times increase with load  
**Solution:** Optimize queries, use caching

---

## 💡 **Optimization Recommendations**

### **1. Request Queuing (For 200+ Concurrent)**

```javascript
// Implement request queue for high traffic
const bookingQueue = new Queue('bookings', {
  limiter: {
    max: 50, // Process 50 bookings per second
    duration: 1000
  }
});
```

### **2. Database Connection Pooling**

```javascript
// Increase connection pool size
const pool = new Pool({
  max: 20, // Maximum connections
  idleTimeoutMillis: 30000
});
```

### **3. Caching**

- Cache availability data (Redis/Memory)
- Reduce database queries
- **Impact:** Can handle 2-3x more requests

### **4. Rate Limiting**

```javascript
// Prevent abuse
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10 // 10 bookings per user per 15 min
});
```

---

## 📊 **Production Capacity Summary**

### **Memory-Based Capacity:**

| Metric | Value |
|--------|-------|
| **Base System** | ~100MB |
| **Background Services** | ~50MB |
| **Available for Requests** | ~1,850MB |
| **Memory per Request** | ~6MB |
| **Theoretical Maximum** | **~300 concurrent bookings** |

### **Realistic Production Limits:**

| Traffic Level | Concurrent Bookings | Memory | Status |
|---------------|---------------------|--------|--------|
| **Low** | 0-50 | <500MB | ✅ Very Safe |
| **Normal** | 50-100 | 500-700MB | ✅ Safe |
| **High** | 100-200 | 700-1,300MB | ✅ Safe |
| **Peak** | 200-250 | 1,300-1,600MB | ⚠️ Monitor |
| **Maximum** | 250-300 | 1,600-1,900MB | 🚨 Risk |

### **Recommended Production Settings:**

- **Target:** 100-150 concurrent bookings (comfortable)
- **Peak:** 200-250 concurrent bookings (monitor closely)
- **Maximum:** 300 concurrent bookings (emergency only)

---

## ✅ **Conclusion**

### **Answer: Maximum ~250-300 Concurrent Bookings**

**With all crawlers/services running:**

1. ✅ **Memory is NOT the bottleneck** - 2GB is sufficient
2. ⚠️ **Database connections** - More likely bottleneck
3. ⚠️ **Network latency** - May slow down under load
4. ✅ **Background services** - Minimal impact (~50MB total)

### **Safe Production Capacity:**

- **Normal Operations:** 100-150 concurrent bookings
- **Peak Traffic:** 200-250 concurrent bookings
- **Emergency:** Up to 300 concurrent bookings

### **Monitoring Recommendations:**

1. Monitor memory usage (alert at 1.8GB)
2. Monitor database connection pool
3. Monitor response times (alert if >1 second)
4. Implement request queuing for 200+ concurrent

**The system can handle significant traffic even with 2GB RAM constraint!** ✅
