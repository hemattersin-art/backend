#!/usr/bin/env node

/**
 * Verification Script for Google Calendar Integration
 * Run this after adding the google_calendar_credentials column
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifySetup() {
  console.log('🔍 Verifying Google Calendar Integration Setup...\n');

  try {
    // Test 1: Check if column exists
    console.log('📋 Test 1: Checking if google_calendar_credentials column exists...');
    
    const { data, error } = await supabase
      .from('psychologists')
      .select('id, first_name, last_name, google_calendar_credentials')
      .limit(1);

    if (error) {
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        console.log('❌ Column google_calendar_credentials does not exist');
        console.log('💡 Please add the column first using the SQL command in SETUP_INSTRUCTIONS.md');
        return;
      }
      console.error('❌ Error:', error.message);
      return;
    }

    console.log('✅ Column google_calendar_credentials exists and is accessible');

    // Test 2: Check psychologists count
    console.log('\n📊 Test 2: Checking psychologists in database...');
    
    const { count, error: countError } = await supabase
      .from('psychologists')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error counting psychologists:', countError.message);
      return;
    }

    console.log(`✅ Found ${count} psychologists in database`);

    // Test 3: Check for psychologists with Google Calendar credentials
    console.log('\n🔗 Test 3: Checking psychologists with Google Calendar credentials...');
    
    const { data: calendarPsychologists, error: calendarError } = await supabase
      .from('psychologists')
      .select('id, first_name, last_name, google_calendar_credentials')
      .not('google_calendar_credentials', 'is', null);

    if (calendarError) {
      console.error('❌ Error checking calendar credentials:', calendarError.message);
      return;
    }

    console.log(`✅ Found ${calendarPsychologists.length} psychologists with Google Calendar credentials`);

    if (calendarPsychologists.length > 0) {
      console.log('📋 Psychologists with calendar integration:');
      calendarPsychologists.forEach(psych => {
        console.log(`   - ${psych.first_name} ${psych.last_name} (${psych.id})`);
      });
    } else {
      console.log('💡 No psychologists have connected their Google Calendar yet');
      console.log('   This is normal - psychologists need to connect their calendars first');
    }

    // Test 4: Check environment variables
    console.log('\n🔧 Test 4: Checking environment variables...');
    
    const requiredVars = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET', 
      'GOOGLE_REDIRECT_URI',
      'GOOGLE_SCOPES'
    ];

    let allVarsPresent = true;
    requiredVars.forEach(varName => {
      const value = process.env[varName];
      if (value && value !== `your_${varName.toLowerCase()}_here`) {
        console.log(`✅ ${varName}: Configured`);
      } else {
        console.log(`❌ ${varName}: Not configured`);
        allVarsPresent = false;
      }
    });

    if (allVarsPresent) {
      console.log('✅ All required environment variables are configured');
    } else {
      console.log('⚠️  Some environment variables need to be configured');
      console.log('   Check your .env file or deployment environment variables');
    }

    // Final result
    console.log('\n🎉 Verification Complete!');
    console.log('📋 Summary:');
    console.log(`   - Database column: ✅ Ready`);
    console.log(`   - Psychologists: ${count} total`);
    console.log(`   - Calendar integration: ${calendarPsychologists.length} connected`);
    console.log(`   - Environment: ${allVarsPresent ? '✅ Ready' : '⚠️  Needs setup'}`);
    
    if (allVarsPresent && calendarPsychologists.length > 0) {
      console.log('\n🚀 Google Calendar integration is ready to use!');
      console.log('   The background sync service will automatically sync calendars every 30 minutes');
    } else {
      console.log('\n📝 Next steps:');
      if (!allVarsPresent) {
        console.log('   1. Configure Google OAuth2 environment variables');
      }
      console.log('   2. Have psychologists connect their Google Calendar');
      console.log('   3. Test the integration by setting availability');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  }
}

// Run verification
verifySetup();
