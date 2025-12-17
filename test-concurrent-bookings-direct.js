/**
 * Direct Concurrent Booking Load Test
 * Tests database-level unique constraint by directly inserting sessions
 * Simulates: 5, 10, 20, 30 concurrent bookings
 * 
 * Usage: node backend/test-concurrent-bookings-direct.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');
const { formatDate, formatTime } = require('./utils/helpers');

// Configuration
const TEST_LEVELS = [5, 10, 20, 30];
const TEST_PSYCHOLOGIST_ID = process.env.TEST_PSYCHOLOGIST_ID || null;
const TEST_DATE = new Date();
TEST_DATE.setDate(TEST_DATE.getDate() + 1); // Tomorrow
const TEST_TIME = '10:00 AM';
const TEST_TIME_FORMATTED = formatTime(TEST_TIME);

// Test results
const testResults = {
  levels: {},
  summary: {
    totalTests: 0,
    successfulInserts: 0,
    failedInserts: 0,
    uniqueConstraintViolations: 0,
    otherErrors: 0,
    duplicateBookings: 0
  }
};

/**
 * Get or create test clients
 */
async function getTestClients(count) {
  const clientIds = [];
  
  try {
    // Get existing clients
    const { data: clients } = await supabaseAdmin
      .from('clients')
      .select('id')
      .limit(count);

    if (clients && clients.length > 0) {
      clients.forEach(c => clientIds.push(c.id));
    }

    // Create more if needed
    while (clientIds.length < count) {
      const testEmail = `test_load_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`;
      
      // Create user
      const { data: user, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: 'Test123!@#',
        email_confirm: true
      });

      if (userError) {
        console.error(`Error creating test user ${clientIds.length + 1}:`, userError.message);
        break;
      }

      // Create client
      const { data: client, error: clientError } = await supabaseAdmin
        .from('clients')
        .insert([{
          user_id: user.user.id,
          first_name: 'Test',
          last_name: `Load${clientIds.length + 1}`,
          child_name: 'Test Child',
          phone_number: `+9199999999${String(clientIds.length).padStart(2, '0')}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select('id')
        .single();

      if (clientError) {
        console.error(`Error creating test client ${clientIds.length + 1}:`, clientError.message);
        // Try to delete the user we just created
        await supabaseAdmin.auth.admin.deleteUser(user.user.id);
        break;
      }

      clientIds.push(client.id);
    }

    return clientIds.slice(0, count);
  } catch (error) {
    console.error('Error in getTestClients:', error);
    return clientIds;
  }
}

/**
 * Simulate a direct database insert (bypassing API)
 */
async function simulateDirectBooking(clientId, psychologistId, date, time) {
  const startTime = Date.now();
  const result = {
    clientId,
    success: false,
    sessionId: null,
    error: null,
    errorCode: null,
    responseTime: 0,
    isUniqueViolation: false
  };

  try {
    const dateStr = formatDate(date);
    const timeStr = formatTime(time);

    // Direct database insert (simulating concurrent booking)
    const { data: session, error: insertError } = await supabaseAdmin
      .from('sessions')
      .insert([{
        client_id: clientId,
        psychologist_id: psychologistId,
        scheduled_date: dateStr,
        scheduled_time: timeStr,
        status: 'booked',
        price: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id')
      .single();

    result.responseTime = Date.now() - startTime;

    if (insertError) {
      result.error = insertError.message;
      result.errorCode = insertError.code;
      
      // Check if it's a unique constraint violation
      if (insertError.code === '23505' || 
          insertError.message?.includes('unique') || 
          insertError.message?.includes('duplicate') ||
          insertError.message?.includes('unique_psychologist_time_slot_active')) {
        result.isUniqueViolation = true;
      }
    } else if (session) {
      result.success = true;
      result.sessionId = session.id;
    }
  } catch (error) {
    result.responseTime = Date.now() - startTime;
    result.error = error.message;
    result.errorCode = error.code;
  }

  return result;
}

/**
 * Run concurrent test for a specific level
 */
async function runConcurrentTest(level, psychologistId, date, time) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 TEST LEVEL: ${level} Concurrent Direct Database Inserts`);
  console.log(`${'='.repeat(80)}\n`);

  // Get test clients
  console.log(`📋 Getting ${level} test clients...`);
  const clientIds = await getTestClients(level);
  
  if (clientIds.length < level) {
    console.error(`❌ Could not get enough test clients. Got ${clientIds.length}, needed ${level}`);
    return null;
  }

  console.log(`✅ Got ${clientIds.length} test clients\n`);

  const dateStr = formatDate(date);
  const timeStr = formatTime(time);
  console.log(`🎯 Target Slot:`);
  console.log(`   Psychologist: ${psychologistId}`);
  console.log(`   Date: ${dateStr}`);
  console.log(`   Time: ${timeStr}\n`);

  // Check existing sessions for this slot before test
  const { data: existingBefore } = await supabaseAdmin
    .from('sessions')
    .select('id')
    .eq('psychologist_id', psychologistId)
    .eq('scheduled_date', dateStr)
    .eq('scheduled_time', timeStr)
    .in('status', ['booked', 'rescheduled', 'confirmed']);

  if (existingBefore && existingBefore.length > 0) {
    console.log(`⚠️  WARNING: ${existingBefore.length} session(s) already exist for this slot`);
    console.log(`   Cleaning them up first...\n`);
    await supabaseAdmin
      .from('sessions')
      .delete()
      .in('id', existingBefore.map(s => s.id));
  }

  // Simulate concurrent inserts
  console.log(`🚀 Starting ${level} concurrent database inserts...\n`);
  const startTime = Date.now();

  const promises = clientIds.map((clientId, index) => 
    simulateDirectBooking(clientId, psychologistId, date, time)
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
        clientId: clientIds[index],
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
  const uniqueViolations = processedResults.filter(r => r.isUniqueViolation);
  const otherErrors = processedResults.filter(r => !r.success && !r.isUniqueViolation);

  // Get actual sessions created
  const sessionIds = successful.map(r => r.sessionId).filter(Boolean);
  
  // Check for duplicate bookings (same psychologist, date, time)
  const { data: allSessions } = await supabaseAdmin
    .from('sessions')
    .select('id, client_id, psychologist_id, scheduled_date, scheduled_time, status, created_at')
    .eq('psychologist_id', psychologistId)
    .eq('scheduled_date', dateStr)
    .eq('scheduled_time', timeStr)
    .in('status', ['booked', 'rescheduled', 'confirmed'])
    .order('created_at', { ascending: true });

  const duplicateCount = allSessions ? Math.max(0, allSessions.length - 1) : 0;

  // Calculate statistics
  const avgResponseTime = processedResults.length > 0
    ? processedResults.reduce((sum, r) => sum + r.responseTime, 0) / processedResults.length
    : 0;
  const minResponseTime = processedResults.length > 0 
    ? Math.min(...processedResults.map(r => r.responseTime))
    : 0;
  const maxResponseTime = processedResults.length > 0
    ? Math.max(...processedResults.map(r => r.responseTime))
    : 0;

  const levelResult = {
    level,
    totalRequests: level,
    successful: successful.length,
    failed: failed.length,
    uniqueViolations: uniqueViolations.length,
    otherErrors: otherErrors.length,
    actualSessionsCreated: allSessions ? allSessions.length : 0,
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
  console.log(`📊 RESULTS FOR ${level} CONCURRENT INSERTS:`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`✅ Successful Inserts: ${successful.length}`);
  console.log(`❌ Failed Inserts: ${failed.length}`);
  console.log(`🛡️  Unique Constraint Violations: ${uniqueViolations.length}`);
  console.log(`⚠️  Other Errors: ${otherErrors.length}`);
  console.log(`📝 Actual Sessions in DB: ${allSessions ? allSessions.length : 0}`);
  console.log(`🚨 Duplicate Bookings: ${duplicateCount}`);
  console.log(`⏱️  Total Time: ${totalTime}ms`);
  console.log(`⏱️  Average Response Time: ${Math.round(avgResponseTime)}ms`);
  console.log(`⏱️  Min Response Time: ${minResponseTime}ms`);
  console.log(`⏱️  Max Response Time: ${maxResponseTime}ms`);

  // Critical analysis
  if (duplicateCount > 0) {
    console.log(`\n🚨 CRITICAL: ${duplicateCount} duplicate booking(s) detected!`);
    console.log(`   The unique constraint FAILED to prevent duplicates!`);
    console.log(`   Sessions created:`);
    allSessions?.forEach((s, i) => {
      const createdAt = new Date(s.created_at).toISOString();
      console.log(`     ${i + 1}. Session ID: ${s.id}, Client: ${s.client_id}, Created: ${createdAt}`);
    });
  } else if (allSessions && allSessions.length === 1) {
    console.log(`\n✅ SUCCESS: Only 1 session created - unique constraint working correctly!`);
    console.log(`   Session ID: ${allSessions[0].id}, Client: ${allSessions[0].client_id}`);
  } else if (allSessions && allSessions.length === 0) {
    console.log(`\n⚠️  WARNING: No sessions were created (all inserts failed)`);
  }

  // Show error breakdown
  if (otherErrors.length > 0) {
    console.log(`\n❌ Other Error Breakdown:`);
    const errorTypes = {};
    otherErrors.forEach(e => {
      const errorMsg = e.error || 'Unknown error';
      const errorKey = `${errorMsg} (Code: ${e.errorCode || 'N/A'})`;
      errorTypes[errorKey] = (errorTypes[errorKey] || 0) + 1;
    });
    Object.entries(errorTypes).forEach(([error, count]) => {
      console.log(`   - ${error}: ${count}`);
    });
  }

  // Show timing distribution
  if (processedResults.length > 0) {
    const responseTimes = processedResults.map(r => r.responseTime).sort((a, b) => a - b);
    const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
    const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
    const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
    
    console.log(`\n⏱️  Response Time Percentiles:`);
    console.log(`   P50 (Median): ${p50}ms`);
    console.log(`   P95: ${p95}ms`);
    console.log(`   P99: ${p99}ms`);
  }

  return levelResult;
}

/**
 * Monitor system resources
 */
function logSystemInfo() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  console.log(`\n💾 System Resources:`);
  console.log(`   RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
  console.log(`   Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  console.log(`   Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
  console.log(`   External: ${Math.round(memUsage.external / 1024 / 1024)}MB`);
  console.log(`   CPU User: ${cpuUsage.user / 1000}ms`);
  console.log(`   CPU System: ${cpuUsage.system / 1000}ms`);
}

/**
 * Clean up test data
 */
async function cleanupTestData(sessionIds, psychologistId, date, time) {
  console.log(`\n🧹 Cleaning up test data...`);
  
  const dateStr = formatDate(date);
  const timeStr = formatTime(time);
  
  try {
    // Delete all test sessions for this slot
    const { data: testSessions } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('psychologist_id', psychologistId)
      .eq('scheduled_date', dateStr)
      .eq('scheduled_time', timeStr)
      .in('status', ['booked', 'rescheduled', 'confirmed']);

    if (testSessions && testSessions.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('sessions')
        .delete()
        .in('id', testSessions.map(s => s.id));

      if (deleteError) {
        console.error(`   ❌ Error deleting sessions:`, deleteError.message);
      } else {
        console.log(`   ✅ Deleted ${testSessions.length} test session(s)`);
      }
    } else {
      console.log(`   ℹ️  No test sessions to clean up`);
    }
  } catch (error) {
    console.error(`   ❌ Error during cleanup:`, error.message);
  }
}

/**
 * Main test function
 */
async function runLoadTest() {
  console.log('🚀 Starting Direct Concurrent Booking Load Test');
  console.log('='.repeat(80));
  console.log(`Test Date: ${formatDate(TEST_DATE)}`);
  console.log(`Test Time: ${TEST_TIME}`);
  console.log('='.repeat(80));

  let psychologistId = TEST_PSYCHOLOGIST_ID;
  let psychologist = null;

  // If no psychologist ID set, get the first one with Google Calendar
  if (!psychologistId) {
    console.log('📋 TEST_PSYCHOLOGIST_ID not set, finding a psychologist with Google Calendar...');
    const { data: psychologists, error: psychListError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .not('google_calendar_credentials', 'is', null)
      .limit(1);

    if (psychListError || !psychologists || psychologists.length === 0) {
      console.error('\n❌ No psychologists with Google Calendar found');
      console.log('   Please set TEST_PSYCHOLOGIST_ID in your .env file');
      console.log('   Or ensure at least one psychologist has Google Calendar connected\n');
      process.exit(1);
    }

    psychologistId = psychologists[0].id;
    psychologist = psychologists[0];
    console.log(`✅ Using psychologist: ${psychologist.first_name} ${psychologist.last_name} (${psychologist.email})\n`);
  } else {
    // Verify psychologist exists
    const { data: psychData, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .eq('id', psychologistId)
      .single();

    if (psychError || !psychData) {
      console.error(`❌ Psychologist ${psychologistId} not found`);
      process.exit(1);
    }

    psychologist = psychData;
  }

  console.log(`\n👤 Testing with Psychologist: ${psychologist.first_name} ${psychologist.last_name} (${psychologist.email})`);
  console.log(`   ID: ${psychologistId}\n`);

  // Ensure availability exists
  const testDateStr = formatDate(TEST_DATE);
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
          psychologist_id: psychologistId,
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
    
    const levelResult = await runConcurrentTest(level, psychologistId, TEST_DATE, TEST_TIME);
    
    if (levelResult) {
      testResults.levels[level] = levelResult;
      testResults.summary.totalTests += level;
      testResults.summary.successfulInserts += levelResult.successful;
      testResults.summary.failedInserts += levelResult.failed;
      testResults.summary.uniqueConstraintViolations += levelResult.uniqueViolations;
      testResults.summary.otherErrors += levelResult.otherErrors;
      
      if (levelResult.duplicateBookings > 0) {
        testResults.summary.duplicateBookings += levelResult.duplicateBookings;
      }

      // Collect session IDs for cleanup
      if (levelResult.sessionIds && levelResult.sessionIds.length > 0) {
        allSessionIds.push(...levelResult.sessionIds);
      }

      // Wait between test levels
      if (level < TEST_LEVELS[TEST_LEVELS.length - 1]) {
        console.log(`\n⏳ Waiting 2 seconds before next test level...\n`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  // Final summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 FINAL TEST SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Test Levels: ${TEST_LEVELS.join(', ')}`);
  console.log(`Total Requests: ${testResults.summary.totalTests}`);
  console.log(`✅ Successful Inserts: ${testResults.summary.successfulInserts}`);
  console.log(`❌ Failed Inserts: ${testResults.summary.failedInserts}`);
  console.log(`🛡️  Unique Constraint Violations: ${testResults.summary.uniqueConstraintViolations}`);
  console.log(`⚠️  Other Errors: ${testResults.summary.otherErrors}`);
  console.log(`🚨 Total Duplicate Bookings: ${testResults.summary.duplicateBookings}`);

  if (testResults.summary.duplicateBookings > 0) {
    console.log(`\n🚨 CRITICAL: ${testResults.summary.duplicateBookings} duplicate booking(s) detected across all tests!`);
    console.log(`   The unique constraint is NOT working correctly!`);
  } else {
    console.log(`\n✅ SUCCESS: No duplicate bookings detected!`);
    console.log(`   The unique constraint is working correctly!`);
  }

  // Performance summary by level
  console.log(`\n📈 Performance by Level:`);
  Object.entries(testResults.levels).forEach(([level, result]) => {
    const successRate = result.totalRequests > 0 
      ? ((result.successful / result.totalRequests) * 100).toFixed(1)
      : 0;
    const constraintRate = result.totalRequests > 0
      ? ((result.uniqueViolations / result.totalRequests) * 100).toFixed(1)
      : 0;
    
    console.log(`\n   Level ${level}:`);
    console.log(`     Success Rate: ${successRate}%`);
    console.log(`     Constraint Violations: ${constraintRate}%`);
    console.log(`     Avg Response: ${result.avgResponseTime}ms`);
    console.log(`     Total Time: ${result.totalTime}ms`);
    console.log(`     Duplicates: ${result.duplicateBookings} ${result.duplicateBookings > 0 ? '🚨' : '✅'}`);
  });

  logSystemInfo();

  // Cleanup
  await cleanupTestData(allSessionIds, psychologistId, TEST_DATE, TEST_TIME);

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
