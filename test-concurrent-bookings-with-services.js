/**
 * Comprehensive Concurrent Booking Test with Background Services
 * Tests booking system under load while background services are running
 * Simulates: 5, 10, 20, 30 concurrent bookings
 * Also runs: Calendar sync, availability service in background
 * 
 * Usage: node backend/test-concurrent-bookings-with-services.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabaseAdmin } = require('./config/supabase');
const { formatDate, formatTime } = require('./utils/helpers');
const calendarSyncService = require('./services/calendarSyncService');
const defaultAvailabilityService = require('./utils/defaultAvailabilityService');

// Configuration
const TEST_LEVELS = [5, 10, 20, 30];
const TEST_DATE = new Date();
TEST_DATE.setDate(TEST_DATE.getDate() + 1);
const TEST_TIME = '10:00 AM';
const TEST_TIME_FORMATTED = formatTime(TEST_TIME);

// Background service simulation
let backgroundServicesRunning = false;
let backgroundServiceResults = {
  calendarSyncs: 0,
  availabilityUpdates: 0,
  errors: []
};

/**
 * Simulate background calendar sync (runs every 15 min in production)
 */
async function simulateCalendarSync(psychologistId) {
  try {
    const { data: psychologist } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, google_calendar_credentials')
      .eq('id', psychologistId)
      .single();

    if (!psychologist || !psychologist.google_calendar_credentials) {
      return { success: false, message: 'No Google Calendar credentials' };
    }

    // Run a quick sync (next 21 days)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 21);

    const result = await calendarSyncService.syncPsychologistCalendar(psychologist);
    backgroundServiceResults.calendarSyncs++;
    
    return result;
  } catch (error) {
    backgroundServiceResults.errors.push({
      service: 'calendarSync',
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Simulate background availability update
 */
async function simulateAvailabilityUpdate() {
  try {
    const result = await defaultAvailabilityService.addNextDayAvailability();
    backgroundServiceResults.availabilityUpdates++;
    return result;
  } catch (error) {
    backgroundServiceResults.errors.push({
      service: 'availabilityUpdate',
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Start background services simulation
 */
function startBackgroundServices(psychologistId) {
  if (backgroundServicesRunning) return;
  
  backgroundServicesRunning = true;
  console.log('🔄 Starting background services simulation...\n');

  // Simulate calendar sync every 30 seconds (faster than production 15 min for testing)
  const calendarSyncInterval = setInterval(async () => {
    if (!backgroundServicesRunning) {
      clearInterval(calendarSyncInterval);
      return;
    }
    try {
      await simulateCalendarSync(psychologistId);
      console.log(`   [Background] Calendar sync completed (${backgroundServiceResults.calendarSyncs} total)`);
    } catch (error) {
      console.error(`   [Background] Calendar sync error:`, error.message);
    }
  }, 30000); // Every 30 seconds

  // Simulate availability update every 60 seconds
  const availabilityInterval = setInterval(async () => {
    if (!backgroundServicesRunning) {
      clearInterval(availabilityInterval);
      return;
    }
    try {
      await simulateAvailabilityUpdate();
      console.log(`   [Background] Availability update completed (${backgroundServiceResults.availabilityUpdates} total)`);
    } catch (error) {
      console.error(`   [Background] Availability update error:`, error.message);
    }
  }, 60000); // Every 60 seconds

  // Store intervals for cleanup
  global.testIntervals = [calendarSyncInterval, availabilityInterval];
}

/**
 * Stop background services
 */
function stopBackgroundServices() {
  backgroundServicesRunning = false;
  if (global.testIntervals) {
    global.testIntervals.forEach(interval => clearInterval(interval));
    global.testIntervals = [];
  }
  console.log('\n🛑 Background services stopped\n');
}

/**
 * Get or create test clients
 */
async function getTestClients(count) {
  const clientIds = [];
  
  try {
    const { data: clients } = await supabaseAdmin
      .from('clients')
      .select('id')
      .limit(count);

    if (clients && clients.length > 0) {
      clients.forEach(c => clientIds.push(c.id));
    }

    while (clientIds.length < count) {
      const testEmail = `test_load_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`;
      
      const { data: user, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: 'Test123!@#',
        email_confirm: true
      });

      if (userError) break;

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
 * Simulate direct database insert
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
 * Run concurrent test with background services
 */
async function runConcurrentTestWithServices(level, psychologistId, date, time) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 TEST LEVEL: ${level} Concurrent Bookings + Background Services`);
  console.log(`${'='.repeat(80)}\n`);

  const clientIds = await getTestClients(level);
  if (clientIds.length < level) {
    console.error(`❌ Could not get enough test clients. Got ${clientIds.length}, needed ${level}`);
    return null;
  }

  console.log(`✅ Got ${clientIds.length} test clients\n`);

  const dateStr = formatDate(date);
  const timeStr = formatTime(time);
  console.log(`🎯 Target Slot: ${dateStr} at ${timeStr}\n`);

  // Clean up existing sessions
  const { data: existingBefore } = await supabaseAdmin
    .from('sessions')
    .select('id')
    .eq('psychologist_id', psychologistId)
    .eq('scheduled_date', dateStr)
    .eq('scheduled_time', timeStr)
    .in('status', ['booked', 'rescheduled', 'confirmed']);

  if (existingBefore && existingBefore.length > 0) {
    await supabaseAdmin
      .from('sessions')
      .delete()
      .in('id', existingBefore.map(s => s.id));
  }

  // Start background services if not already running
  if (!backgroundServicesRunning) {
    startBackgroundServices(psychologistId);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Let services start
  }

  // Run concurrent inserts
  console.log(`🚀 Starting ${level} concurrent database inserts (with background services running)...\n`);
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

  // Check actual sessions
  const { data: allSessions } = await supabaseAdmin
    .from('sessions')
    .select('id, client_id, scheduled_date, scheduled_time, status, created_at')
    .eq('psychologist_id', psychologistId)
    .eq('scheduled_date', dateStr)
    .eq('scheduled_time', timeStr)
    .in('status', ['booked', 'rescheduled', 'confirmed'])
    .order('created_at', { ascending: true });

  const duplicateCount = allSessions ? Math.max(0, allSessions.length - 1) : 0;

  // Statistics
  const avgResponseTime = processedResults.length > 0
    ? processedResults.reduce((sum, r) => sum + r.responseTime, 0) / processedResults.length
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
    backgroundServices: {
      calendarSyncs: backgroundServiceResults.calendarSyncs,
      availabilityUpdates: backgroundServiceResults.availabilityUpdates,
      errors: backgroundServiceResults.errors.length
    }
  };

  // Print results
  console.log(`📊 RESULTS FOR ${level} CONCURRENT BOOKINGS:`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`🛡️  Unique Violations: ${uniqueViolations.length}`);
  console.log(`📝 Actual Sessions: ${allSessions ? allSessions.length : 0}`);
  console.log(`🚨 Duplicates: ${duplicateCount}`);
  console.log(`⏱️  Total Time: ${totalTime}ms`);
  console.log(`⏱️  Avg Response: ${Math.round(avgResponseTime)}ms`);
  console.log(`🔄 Background Services:`);
  console.log(`   Calendar Syncs: ${backgroundServiceResults.calendarSyncs}`);
  console.log(`   Availability Updates: ${backgroundServiceResults.availabilityUpdates}`);
  console.log(`   Service Errors: ${backgroundServiceResults.errors.length}`);

  if (duplicateCount > 0) {
    console.log(`\n🚨 CRITICAL: ${duplicateCount} duplicate(s) detected!`);
  } else if (allSessions && allSessions.length === 1) {
    console.log(`\n✅ SUCCESS: Only 1 session created - constraint working!`);
  }

  return levelResult;
}

/**
 * Monitor system resources
 */
function logSystemInfo() {
  const memUsage = process.memoryUsage();
  console.log(`\n💾 Memory: RSS=${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
}

/**
 * Clean up
 */
async function cleanupTestData(sessionIds, psychologistId, date, time) {
  console.log(`\n🧹 Cleaning up...`);
  const dateStr = formatDate(date);
  const timeStr = formatTime(time);
  
  const { data: testSessions } = await supabaseAdmin
    .from('sessions')
    .select('id')
    .eq('psychologist_id', psychologistId)
    .eq('scheduled_date', dateStr)
    .eq('scheduled_time', timeStr)
    .in('status', ['booked', 'rescheduled', 'confirmed']);

  if (testSessions && testSessions.length > 0) {
    await supabaseAdmin
      .from('sessions')
      .delete()
      .in('id', testSessions.map(s => s.id));
    console.log(`   ✅ Deleted ${testSessions.length} test session(s)`);
  }
}

/**
 * Main test
 */
async function runComprehensiveTest() {
  console.log('🚀 Comprehensive Concurrent Booking Test with Background Services');
  console.log('='.repeat(80));
  console.log(`Test Date: ${formatDate(TEST_DATE)}`);
  console.log(`Test Time: ${TEST_TIME}`);
  console.log('='.repeat(80));

  // Get psychologist
  let psychologistId = process.env.TEST_PSYCHOLOGIST_ID;
  let psychologist = null;

  if (!psychologistId) {
    const { data: psychologists } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email, google_calendar_credentials')
      .not('google_calendar_credentials', 'is', null)
      .limit(1);

    if (!psychologists || psychologists.length === 0) {
      console.error('❌ No psychologists with Google Calendar found');
      process.exit(1);
    }

    psychologistId = psychologists[0].id;
    psychologist = psychologists[0];
  } else {
    const { data: psychData } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .eq('id', psychologistId)
      .single();
    psychologist = psychData;
  }

  console.log(`\n👤 Psychologist: ${psychologist.first_name} ${psychologist.last_name} (${psychologist.email})`);
  console.log(`   ID: ${psychologistId}\n`);

  // Ensure availability
  const testDateStr = formatDate(TEST_DATE);
  const { data: availability } = await supabaseAdmin
    .from('availability')
    .select('id, time_slots')
    .eq('psychologist_id', psychologistId)
    .eq('date', testDateStr)
    .single();

  if (!availability || !availability.time_slots || !availability.time_slots.includes(TEST_TIME)) {
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
        }, { onConflict: 'psychologist_id,date' });
    }
  }

  const testResults = {
    levels: {},
    summary: {
      totalTests: 0,
      successful: 0,
      failed: 0,
      duplicates: 0
    }
  };

  const allSessionIds = [];

  // Run tests
  for (const level of TEST_LEVELS) {
    logSystemInfo();
    
    const result = await runConcurrentTestWithServices(level, psychologistId, TEST_DATE, TEST_TIME);
    
    if (result) {
      testResults.levels[level] = result;
      testResults.summary.totalTests += level;
      testResults.summary.successful += result.successful;
      testResults.summary.failed += result.failed;
      testResults.summary.duplicates += result.duplicateBookings;

      if (result.sessionIds) {
        allSessionIds.push(...result.sessionIds);
      }

      if (level < TEST_LEVELS[TEST_LEVELS.length - 1]) {
        console.log(`\n⏳ Waiting 2 seconds...\n`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  // Stop background services
  stopBackgroundServices();

  // Final summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 FINAL SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Total Requests: ${testResults.summary.totalTests}`);
  console.log(`✅ Successful: ${testResults.summary.successful}`);
  console.log(`❌ Failed: ${testResults.summary.failed}`);
  console.log(`🚨 Duplicates: ${testResults.summary.duplicates}`);
  console.log(`🔄 Background Services:`);
  console.log(`   Calendar Syncs: ${backgroundServiceResults.calendarSyncs}`);
  console.log(`   Availability Updates: ${backgroundServiceResults.availabilityUpdates}`);
  console.log(`   Service Errors: ${backgroundServiceResults.errors.length}`);

  if (testResults.summary.duplicates === 0) {
    console.log(`\n✅ SUCCESS: No duplicates - system handles high traffic correctly!`);
  } else {
    console.log(`\n🚨 CRITICAL: ${testResults.summary.duplicates} duplicate(s) detected!`);
  }

  // Performance by level
  console.log(`\n📈 Performance by Level:`);
  Object.entries(testResults.levels).forEach(([level, result]) => {
    console.log(`\n   Level ${level}:`);
    console.log(`     Success: ${result.successful}/${result.totalRequests}`);
    console.log(`     Duplicates: ${result.duplicateBookings} ${result.duplicateBookings > 0 ? '🚨' : '✅'}`);
    console.log(`     Avg Response: ${result.avgResponseTime}ms`);
  });

  logSystemInfo();

  // Cleanup
  await cleanupTestData(allSessionIds, psychologistId, TEST_DATE, TEST_TIME);

  console.log(`\n✅ Comprehensive test completed!\n`);
}

// Run test
runComprehensiveTest()
  .then(() => {
    stopBackgroundServices();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    stopBackgroundServices();
    process.exit(1);
  });
