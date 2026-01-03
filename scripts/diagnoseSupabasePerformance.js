/**
 * Diagnostic script to identify Supabase performance issues
 * Run: node backend/scripts/diagnoseSupabasePerformance.js
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function diagnoseSupabasePerformance() {
  console.log('🔍 Diagnosing Supabase Performance Issues...\n');
  
  // Test 1: Basic connection
  console.log('1️⃣ Testing basic connection...');
  const startTime = Date.now();
  try {
    const { data, error, count } = await supabaseAdmin
      .from('assessments')
      .select('id', { count: 'exact', head: true });
    
    const connectionTime = Date.now() - startTime;
    console.log(`   ✅ Connection successful (${connectionTime}ms)`);
    console.log(`   📊 Total assessments: ${count || 0}`);
    
    if (connectionTime > 1000) {
      console.log(`   ⚠️  WARNING: Slow connection (${connectionTime}ms) - possible egress throttling`);
    }
  } catch (err) {
    console.log(`   ❌ Connection failed: ${err.message}`);
    return;
  }

  // Test 2: Query by slug (the actual query used)
  console.log('\n2️⃣ Testing assessment query by slug...');
  const testSlug = 'adhd-vanderbilt'; // Common assessment slug
  const queryStart = Date.now();
  try {
    const { data, error } = await supabaseAdmin
      .from('assessments')
      .select('*')
      .eq('slug', testSlug)
      .eq('status', 'published')
      .single();
    
    const queryTime = Date.now() - queryStart;
    console.log(`   ✅ Query completed (${queryTime}ms)`);
    
    if (queryTime > 1000) {
      console.log(`   🔴 CRITICAL: Query took ${queryTime}ms - this is the bottleneck!`);
      console.log(`   💡 Possible causes:`);
      console.log(`      - Missing database indexes (run EXPLAIN ANALYZE in Supabase)`);
      console.log(`      - Egress limit exceeded (check Supabase dashboard)`);
      console.log(`      - Large row size (SELECT * fetches all columns)`);
      console.log(`      - Network latency to Supabase region`);
    } else if (queryTime > 500) {
      console.log(`   ⚠️  WARNING: Query is slow (${queryTime}ms)`);
    } else {
      console.log(`   ✅ Query performance is acceptable (${queryTime}ms)`);
    }
    
    if (error) {
      console.log(`   ❌ Query error: ${error.message}`);
      if (error.code === 'PGRST116') {
        console.log(`   ℹ️  Assessment not found (this is normal if slug doesn't exist)`);
      }
    } else if (data) {
      console.log(`   ✅ Found assessment: ${data.hero_title || data.slug}`);
      // Check row size
      const rowSize = JSON.stringify(data).length;
      console.log(`   📦 Row size: ${(rowSize / 1024).toFixed(2)} KB`);
      if (rowSize > 100 * 1024) {
        console.log(`   ⚠️  WARNING: Large row size (${(rowSize / 1024).toFixed(2)} KB) - consider selecting specific columns`);
      }
    }
  } catch (err) {
    console.log(`   ❌ Query failed: ${err.message}`);
  }

  // Test 3: Check for indexes
  console.log('\n3️⃣ Checking database indexes...');
  try {
    // Try to get query plan (if possible)
    console.log('   ℹ️  To check indexes, run this in Supabase SQL Editor:');
    console.log('   ```sql');
    console.log(`   EXPLAIN ANALYZE SELECT * FROM assessments WHERE slug = '${testSlug}' AND status = 'published';`);
    console.log('   ```');
    console.log('   Look for "Index Scan" (good) vs "Seq Scan" (bad - needs index)');
  } catch (err) {
    console.log(`   ⚠️  Could not check indexes: ${err.message}`);
  }

  // Test 4: Check Supabase region/connection
  console.log('\n4️⃣ Checking Supabase configuration...');
  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl) {
    console.log(`   ✅ Supabase URL: ${supabaseUrl}`);
    const region = supabaseUrl.match(/\.supabase\.co/);
    if (region) {
      console.log(`   ℹ️  Region: ${supabaseUrl.split('.')[0].split('//')[1] || 'Unknown'}`);
      console.log(`   💡 If backend is far from Supabase region, this causes latency`);
    }
  } else {
    console.log(`   ❌ SUPABASE_URL not set`);
  }

  // Test 5: Egress limit check
  console.log('\n5️⃣ Egress Limit Check...');
  console.log('   ℹ️  Supabase Free Plan Limits:');
  console.log('      - 2 GB database size');
  console.log('      - 2 GB bandwidth/month');
  console.log('      - 50,000 monthly active users');
  console.log('   📊 To check egress usage:');
  console.log('      1. Go to Supabase Dashboard → Settings → Usage');
  console.log('      2. Check "Bandwidth" section');
  console.log('      3. If near/over limit, requests will be throttled');
  console.log('   💡 If egress is full:');
  console.log('      - Upgrade to Pro plan ($25/month)');
  console.log('      - Implement aggressive caching');
  console.log('      - Use CDN for static assets');
  console.log('      - Optimize queries to return less data');

  // Test 6: Multiple queries (test throttling)
  console.log('\n6️⃣ Testing for rate limiting/throttling...');
  const times = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    try {
      await supabaseAdmin
        .from('assessments')
        .select('id', { count: 'exact', head: true });
      times.push(Date.now() - start);
    } catch (err) {
      console.log(`   ❌ Query ${i + 1} failed: ${err.message}`);
    }
  }
  
  if (times.length > 0) {
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    console.log(`   📊 Query times: min=${minTime}ms, avg=${avgTime.toFixed(0)}ms, max=${maxTime}ms`);
    
    if (maxTime > minTime * 2) {
      console.log(`   ⚠️  WARNING: Inconsistent query times suggest throttling`);
    }
  }

  console.log('\n✅ Diagnosis complete!');
  console.log('\n📋 Next Steps:');
  console.log('   1. Check Supabase Dashboard → Settings → Usage for egress limits');
  console.log('   2. Run EXPLAIN ANALYZE in Supabase SQL Editor to check indexes');
  console.log('   3. Check backend logs for Supabase errors');
  console.log('   4. Consider upgrading to Pro plan if egress is the issue');
}

// Run diagnosis
diagnoseSupabasePerformance().catch(console.error);

