/**
 * Concurrent Booking Load Test
 * Simulates multiple users booking the same time slot simultaneously
 * Tests: 5, 10, 20, 30 concurrent requests
 * 
 * Usage: node backend/test-concurrent-bookings.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');
const https = require('https');
const http = require('http');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5001/api';
const TEST_LEVELS = [5, 10, 20, 30]; // Number of concurrent requests
const TEST_PSYCHOLOGIST_ID = process.env.TEST_PSYCHOLOGIST_ID || null; // Set this in .env
const TEST_CLIENT_IDS = []; // Will be populated from database
const TEST_DATE = new Date();
TEST_DATE.setDate(TEST_DATE.getDate() + 1); // Tomorrow
const TEST_TIME = '10:00 AM'; // Same time slot for all

// Test results storage
const testResults = {
  levels: {},
  summary: {
    totalTests: 0,
    successfulBookings: 0,
    failedBookings: 0,
    doubleBookings: 0,
    errors: []
  }
};

/**
 * Get test client IDs (or create test clients)
 */
async function getTestClients(count) {
  try {
    // Get existing clients
    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, user_id')
      .limit(count);

    if (error) {
      console.error('Error fetching clients:', error);
      return [];
    }

    const clientIds = [];
    
    // Use existing clients
    if (clients && clients.length > 0) {
      clients.forEach(client => {
        if (client.user_id) {
          clientIds.push(client.user_id);
        }
      });
    }

    // If we need more, create test clients
    while (clientIds.length < count) {
      const testEmail = `test_client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`;
      
      // Create test user
      const { data: user, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: 'Test123!@#',
        email_confirm: true
      });

      if (userError) {
        console.error('Error creating test user:', userError);
        break;
      }

      // Create test client
      const { data: client, error: clientError } = await supabaseAdmin
        .from('clients')
        .insert([{
          user_id: user.user.id,
          first_name: 'Test',
          last_name: `Client${clientIds.length + 1}`,
          child_name: 'Test Child',
          phone_number: `+9199999999${clientIds.length}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select('user_id')
        .single();

      if (clientError) {
        console.error('Error creating test client:', clientError);
        break;
      }

      clientIds.push(user.user.id);
    }

    return clientIds.slice(0, count);
  } catch (error) {
    console.error('Error in getTestClients:', error);
    return [];
  }
}

/**
 * Get authentication token for a user (using Supabase admin to create session)
 */
async function getAuthToken(userId) {
  try {
    // Get user email
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (userError || !user) {
      console.error('Error getting user:', userError);
      return null;
    }

    // For testing, we'll create a session token using admin API
    // In a real scenario, you'd sign in normally, but for load testing we use admin
    const { data: session, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.user.email
    });

    if (sessionError) {
      // Fallback: create a JWT token manually for testing
      // This is a workaround - in production you'd use proper authentication
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        { 
          id: userId, 
          role: 'client',
          email: user.user.email 
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );
      return token;
    }

    return session?.properties?.hashed_token || null;
  } catch (error) {
    console.error('Error getting auth token:', error);
    // Fallback to JWT
    try {
      const jwt = require('jsonwebtoken');
      return jwt.sign(
        { id: userId, role: 'client' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );
    } catch (jwtError) {
      return null;
    }
  }
}

/**
 * Make HTTP request (using native Node.js)
 */
function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = httpModule.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: jsonData,
            headers: res.headers
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

/**
 * Simulate a booking request
 */
async function simulateBooking(clientUserId, psychologistId, date, time, level) {
  const startTime = Date.now();
  let result = {
    clientId: clientUserId,
    success: false,
    sessionId: null,
    error: null,
    responseTime: 0,
    statusCode: null
  };

  try {
    // Get auth token
    const token = await getAuthToken(clientUserId);
    if (!token) {
      result.error = 'Failed to get auth token';
      result.responseTime = Date.now() - startTime;
      return result;
    }

    // Format date and time
    const dateStr = date.toISOString().split('T')[0];
    
    // Make booking request
    const response = await makeRequest(
      `${BACKEND_URL}/client-controller/book-session`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: {
          psychologist_id: psychologistId,
          scheduled_date: dateStr,
          scheduled_time: time,
          price: 100
        }
      }
    );

    result.responseTime = Date.now() - startTime;
    result.statusCode = response.status;
    
    if (response.data && response.data.success) {
      result.success = true;
      result.sessionId = response.data.data?.id || null;
    } else {
      result.error = response.data?.message || 'Unknown error';
    }

    // Check if it's a double booking error (409 Conflict)
    if (response.status === 409) {
      result.error = 'Double booking prevented (expected)';
      result.doubleBookingPrevented = true;
    }
  } catch (error) {
    result.responseTime = Date.now() - startTime;
    result.error = error.message || 'Request failed';
    result.statusCode = 500;
  }

  return result;
}

/**
 * Run concurrent booking test for a specific level
 */
async function runConcurrentTest(level, psychologistId, date, time) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 TESTING LEVEL: ${level} Concurrent Bookings`);
  console.log(`${'='.repeat(80)}\n`);

  // Get test clients
  console.log(`📋 Getting ${level} test clients...`);
  const clientUserIds = await getTestClients(level);
  
  if (clientUserIds.length < level) {
    console.error(`❌ Could not get enough test clients. Got ${clientUserIds.length}, needed ${level}`);
    return null;
  }

  console.log(`✅ Got ${clientUserIds.length} test clients\n`);

  // Simulate concurrent bookings
  console.log(`🚀 Starting ${level} concurrent booking requests...`);
  console.log(`   Target: Psychologist ${psychologistId}, Date: ${date.toISOString().split('T')[0]}, Time: ${time}\n`);

  const startTime = Date.now();
  const promises = clientUserIds.map((clientUserId, index) => 
    simulateBooking(clientUserId, psychologistId, date, time, level)
      .then(result => ({ ...result, requestIndex: index + 1 }))
  );

  const results = await Promise.allSettled(promises);
  const totalTime = Date.now() - startTime;

  // Process results
  const processedResults = results.map((r, index) => {
    if (r.status === 'fulfilled') {
      return r.value;
    } else {
      return {
        clientId: clientUserIds[index],
        success: false,
        error: r.reason?.message || 'Promise rejected',
        responseTime: 0,
        requestIndex: index + 1
      };
    }
  });

  // Analyze results
  const successful = processedResults.filter(r => r.success);
  const failed = processedResults.filter(r => !r.success);
  const doubleBookings = processedResults.filter(r => r.doubleBookingPrevented);
  const errors = processedResults.filter(r => r.error && !r.doubleBookingPrevented);

  // Get actual sessions created
  const sessionIds = successful.map(r => r.sessionId).filter(Boolean);
  const actualSessions = [];
  
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('id, client_id, psychologist_id, scheduled_date, scheduled_time, status')
      .in('id', sessionIds);

    if (sessions) {
      actualSessions.push(...sessions);
    }
  }

  // Check for duplicate bookings (same psychologist, date, time)
  const { data: allSessions } = await supabaseAdmin
    .from('sessions')
    .select('id, client_id, psychologist_id, scheduled_date, scheduled_time, status')
    .eq('psychologist_id', psychologistId)
    .eq('scheduled_date', date.toISOString().split('T')[0])
    .eq('scheduled_time', time)
    .in('status', ['booked', 'rescheduled', 'confirmed']);

  const duplicateCount = allSessions ? allSessions.length - 1 : 0; // -1 because one is valid

  // Calculate statistics
  const avgResponseTime = processedResults.length > 0
    ? processedResults.reduce((sum, r) => sum + r.responseTime, 0) / processedResults.length
    : 0;
  const minResponseTime = Math.min(...processedResults.map(r => r.responseTime));
  const maxResponseTime = Math.max(...processedResults.map(r => r.responseTime));

  const levelResult = {
    level,
    totalRequests: level,
    successful: successful.length,
    failed: failed.length,
    doubleBookingsPrevented: doubleBookings.length,
    actualSessionsCreated: actualSessions.length,
    duplicateBookings: duplicateCount,
    totalTime,
    avgResponseTime: Math.round(avgResponseTime),
    minResponseTime,
    maxResponseTime,
    results: processedResults,
    sessionIds: sessionIds,
    allSessionsForSlot: allSessions || []
  };

  // Print results
  console.log(`\n📊 RESULTS FOR ${level} CONCURRENT BOOKINGS:`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`✅ Successful Bookings: ${successful.length}`);
  console.log(`❌ Failed Bookings: ${failed.length}`);
  console.log(`🛡️  Double Bookings Prevented: ${doubleBookings.length}`);
  console.log(`⚠️  Actual Sessions Created: ${actualSessions.length}`);
  console.log(`🚨 Duplicate Bookings Detected: ${duplicateCount}`);
  console.log(`⏱️  Total Time: ${totalTime}ms`);
  console.log(`⏱️  Average Response Time: ${Math.round(avgResponseTime)}ms`);
  console.log(`⏱️  Min Response Time: ${minResponseTime}ms`);
  console.log(`⏱️  Max Response Time: ${maxResponseTime}ms`);

  if (duplicateCount > 0) {
    console.log(`\n🚨 CRITICAL: ${duplicateCount} duplicate booking(s) detected!`);
    console.log(`   Sessions for this slot:`);
    allSessions?.forEach((s, i) => {
      console.log(`   ${i + 1}. Session ID: ${s.id}, Client: ${s.client_id}, Status: ${s.status}`);
    });
  } else if (actualSessions.length === 1) {
    console.log(`\n✅ SUCCESS: Only 1 session created (no duplicates)`);
  } else if (actualSessions.length === 0) {
    console.log(`\n⚠️  WARNING: No sessions were created`);
  }

  // Show error breakdown
  if (errors.length > 0) {
    console.log(`\n❌ Error Breakdown:`);
    const errorTypes = {};
    errors.forEach(e => {
      const errorMsg = e.error || 'Unknown error';
      errorTypes[errorMsg] = (errorTypes[errorMsg] || 0) + 1;
    });
    Object.entries(errorTypes).forEach(([error, count]) => {
      console.log(`   - ${error}: ${count}`);
    });
  }

  return levelResult;
}

/**
 * Clean up test data
 */
async function cleanupTestData(sessionIds) {
  console.log(`\n🧹 Cleaning up test data...`);
  
  if (!sessionIds || sessionIds.length === 0) {
    console.log(`   No sessions to clean up`);
    return;
  }

  try {
    // Delete test sessions
    const { error: deleteError } = await supabaseAdmin
      .from('sessions')
      .delete()
      .in('id', sessionIds);

    if (deleteError) {
      console.error(`   ❌ Error deleting sessions:`, deleteError);
    } else {
      console.log(`   ✅ Deleted ${sessionIds.length} test session(s)`);
    }

    // Also clean up any sessions created during testing that match our test criteria
    const testDate = TEST_DATE.toISOString().split('T')[0];
    const { data: remainingSessions } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('scheduled_date', testDate)
      .eq('scheduled_time', TEST_TIME)
      .like('client_id', '%test%'); // Clean up test clients' sessions if any

    if (remainingSessions && remainingSessions.length > 0) {
      const remainingIds = remainingSessions.map(s => s.id);
      await supabaseAdmin
        .from('sessions')
        .delete()
        .in('id', remainingIds);
      console.log(`   ✅ Cleaned up ${remainingIds.length} additional test session(s)`);
    }
  } catch (error) {
    console.error(`   ❌ Error during cleanup:`, error);
  }
}

/**
 * Monitor system resources (simplified - would need actual monitoring in production)
 */
function logSystemInfo() {
  const memUsage = process.memoryUsage();
  console.log(`\n💾 Memory Usage:`);
  console.log(`   RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
  console.log(`   Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  console.log(`   Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
  console.log(`   External: ${Math.round(memUsage.external / 1024 / 1024)}MB`);
}

/**
 * Main test function
 */
async function runLoadTest() {
  console.log('🚀 Starting Concurrent Booking Load Test');
  console.log('='.repeat(80));
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Test Date: ${TEST_DATE.toISOString().split('T')[0]}`);
  console.log(`Test Time: ${TEST_TIME}`);
  console.log('='.repeat(80));

  if (!TEST_PSYCHOLOGIST_ID) {
    console.error('❌ TEST_PSYCHOLOGIST_ID not set in .env file');
    console.log('   Please set TEST_PSYCHOLOGIST_ID in your .env file');
    process.exit(1);
  }

  // Verify psychologist exists
  const { data: psychologist, error: psychError } = await supabaseAdmin
    .from('psychologists')
    .select('id, first_name, last_name, email')
    .eq('id', TEST_PSYCHOLOGIST_ID)
    .single();

  if (psychError || !psychologist) {
    console.error(`❌ Psychologist ${TEST_PSYCHOLOGIST_ID} not found`);
    process.exit(1);
  }

  console.log(`\n👤 Testing with Psychologist: ${psychologist.first_name} ${psychologist.last_name} (${psychologist.email})\n`);

  // Ensure availability exists for test date
  const testDateStr = TEST_DATE.toISOString().split('T')[0];
  const { data: availability } = await supabaseAdmin
    .from('availability')
    .select('id, time_slots')
    .eq('psychologist_id', TEST_PSYCHOLOGIST_ID)
    .eq('date', testDateStr)
    .single();

  if (!availability || !availability.time_slots || !availability.time_slots.includes(TEST_TIME)) {
    console.log(`⚠️  Test time slot not in availability. Adding it...`);
    const timeSlots = availability?.time_slots || [];
    if (!timeSlots.includes(TEST_TIME)) {
      timeSlots.push(TEST_TIME);
      await supabaseAdmin
        .from('availability')
        .upsert({
          psychologist_id: TEST_PSYCHOLOGIST_ID,
          date: testDateStr,
          time_slots: timeSlots,
          is_available: true,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'psychologist_id,date'
        });
      console.log(`✅ Added test time slot to availability\n`);
    }
  }

  const allSessionIds = [];

  // Run tests for each level
  for (const level of TEST_LEVELS) {
    logSystemInfo();
    
    const levelResult = await runConcurrentTest(level, TEST_PSYCHOLOGIST_ID, TEST_DATE, TEST_TIME);
    
    if (levelResult) {
      testResults.levels[level] = levelResult;
      testResults.summary.totalTests += level;
      testResults.summary.successfulBookings += levelResult.successful;
      testResults.summary.failedBookings += levelResult.failed;
      testResults.summary.doubleBookings += levelResult.doubleBookingsPrevented;
      
      if (levelResult.duplicateBookings > 0) {
        testResults.summary.errors.push({
          level,
          message: `${levelResult.duplicateBookings} duplicate booking(s) detected`,
          sessions: levelResult.allSessionsForSlot
        });
      }

      // Collect session IDs for cleanup
      if (levelResult.sessionIds && levelResult.sessionIds.length > 0) {
        allSessionIds.push(...levelResult.sessionIds);
      }

      // Wait a bit between test levels
      if (level < TEST_LEVELS[TEST_LEVELS.length - 1]) {
        console.log(`\n⏳ Waiting 3 seconds before next test level...\n`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  // Final summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 FINAL TEST SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Total Test Levels: ${TEST_LEVELS.length}`);
  console.log(`Total Requests: ${testResults.summary.totalTests}`);
  console.log(`✅ Successful Bookings: ${testResults.summary.successfulBookings}`);
  console.log(`❌ Failed Bookings: ${testResults.summary.failedBookings}`);
  console.log(`🛡️  Double Bookings Prevented: ${testResults.summary.doubleBookings}`);
  console.log(`🚨 Critical Issues: ${testResults.summary.errors.length}`);

  if (testResults.summary.errors.length > 0) {
    console.log(`\n🚨 CRITICAL ISSUES DETECTED:`);
    testResults.summary.errors.forEach((error, index) => {
      console.log(`\n   Issue ${index + 1}: ${error.message}`);
      console.log(`   Level: ${error.level} concurrent requests`);
      if (error.sessions) {
        console.log(`   Sessions created:`);
        error.sessions.forEach((s, i) => {
          console.log(`     ${i + 1}. ID: ${s.id}, Client: ${s.client_id}, Status: ${s.status}`);
        });
      }
    });
  } else {
    console.log(`\n✅ NO CRITICAL ISSUES - All duplicate bookings were prevented!`);
  }

  // Performance summary by level
  console.log(`\n📈 Performance by Level:`);
  Object.entries(testResults.levels).forEach(([level, result]) => {
    console.log(`\n   Level ${level}:`);
    console.log(`     Success Rate: ${((result.successful / result.totalRequests) * 100).toFixed(1)}%`);
    console.log(`     Avg Response: ${result.avgResponseTime}ms`);
    console.log(`     Total Time: ${result.totalTime}ms`);
    console.log(`     Duplicates: ${result.duplicateBookings}`);
  });

  logSystemInfo();

  // Cleanup
  await cleanupTestData(allSessionIds);

  console.log(`\n✅ Load test completed!\n`);
}

// Run the test
runLoadTest()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error in load test:', error);
    process.exit(1);
  });
