/**
 * Script to get upcoming sessions for a user by email
 * Usage: node scripts/getSessionsByEmail.js abhishekravi063@gmail.com
 */

require('dotenv').config();
const supabase = require('../config/supabase').supabaseAdmin;
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const relativeTime = require('dayjs/plugin/relativeTime');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

async function getSessionsByEmail(email) {
  try {
    console.log(`\n🔍 Searching for sessions for email: ${email}\n`);

    // Step 1: Find the user/client by email
    // Check users table first (new system)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('email', email.toLowerCase().trim())
      .single();

    let clientId = null;

    if (user && !userError) {
      console.log(`✅ Found user in users table:`, { id: user.id, email: user.email, role: user.role });
      
      if (user.role === 'client') {
        // Find client record
        const { data: client, error: clientError } = await supabase
          .from('clients')
          .select('id, email, first_name, last_name')
          .eq('user_id', user.id)
          .single();

        if (client && !clientError) {
          clientId = client.id;
          console.log(`✅ Found client record:`, { id: client.id, name: `${client.first_name} ${client.last_name}` });
        } else {
          console.log(`⚠️  User found but no client record found for user_id: ${user.id}`);
        }
      }
    } else {
      // Check clients table (old system)
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, email, first_name, last_name')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (client && !clientError) {
        clientId = client.id;
        console.log(`✅ Found client in clients table (old system):`, { id: client.id, name: `${client.first_name} ${client.last_name}` });
      } else {
        console.log(`❌ No user or client found with email: ${email}`);
        return;
      }
    }

    if (!clientId) {
      console.log(`❌ Could not determine client ID for email: ${email}`);
      return;
    }

    // Step 2: Get all sessions for this client
    console.log(`\n📅 Fetching sessions for client_id: ${clientId}\n`);

    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        status,
        psychologist:psychologists(
          id,
          first_name,
          last_name,
          area_of_expertise
        )
      `)
      .eq('client_id', clientId)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (sessionsError) {
      console.error('❌ Error fetching sessions:', sessionsError);
      return;
    }

    if (!sessions || sessions.length === 0) {
      console.log(`❌ No sessions found for this client`);
      return;
    }

    console.log(`✅ Found ${sessions.length} total session(s)\n`);

    // Step 3: Filter for upcoming sessions
    const now = dayjs().tz('Asia/Kolkata');
    const upcomingSessions = [];

    sessions.forEach(session => {
      if (!session.scheduled_date || !session.scheduled_time) {
        return;
      }

      // Skip completed, cancelled, no_show sessions
      if (['completed', 'cancelled', 'no_show', 'noshow'].includes(session.status)) {
        return;
      }

      // Parse session time
      const timeStr = session.scheduled_time || '00:00:00';
      const timeOnly = timeStr.split(' ')[0];
      const sessionDateTime = dayjs(`${session.scheduled_date}T${timeOnly}`, 'YYYY-MM-DDTHH:mm:ss').tz('Asia/Kolkata');
      const sessionEndDateTime = sessionDateTime.add(50, 'minute'); // 50 minutes duration

      // Check if session hasn't ended yet
      if (sessionEndDateTime.isAfter(now)) {
        upcomingSessions.push({
          ...session,
          sessionDateTime: sessionDateTime.format('YYYY-MM-DD HH:mm:ss'),
          sessionEndDateTime: sessionEndDateTime.format('YYYY-MM-DD HH:mm:ss'),
          timeUntil: sessionDateTime.fromNow()
        });
      }
    });

    // Sort by nearest time first
    upcomingSessions.sort((a, b) => {
      const dateA = dayjs(a.sessionDateTime, 'YYYY-MM-DD HH:mm:ss');
      const dateB = dayjs(b.sessionDateTime, 'YYYY-MM-DD HH:mm:ss');
      return dateA - dateB;
    });

    console.log(`\n📋 Upcoming Sessions (${upcomingSessions.length}):\n`);
    console.log('═'.repeat(100));

    if (upcomingSessions.length === 0) {
      console.log('No upcoming sessions found.');
    } else {
      upcomingSessions.forEach((session, index) => {
        const psychologist = session.psychologist;
        const psychologistName = psychologist 
          ? `${psychologist.first_name} ${psychologist.last_name}` 
          : 'N/A';

        console.log(`\n${index + 1}. Session ID: ${session.id}`);
        console.log(`   Date: ${session.scheduled_date}`);
        console.log(`   Time: ${session.scheduled_time}`);
        console.log(`   Status: ${session.status}`);
        console.log(`   Psychologist: ${psychologistName}`);
        console.log(`   Session Start: ${session.sessionDateTime} IST`);
        console.log(`   Session End: ${session.sessionEndDateTime} IST`);
        console.log(`   Time Until: ${session.timeUntil}`);
        console.log(`   ─`.repeat(50));
      });
    }

    console.log('\n' + '═'.repeat(100) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.log('Usage: node scripts/getSessionsByEmail.js <email>');
  console.log('Example: node scripts/getSessionsByEmail.js abhishekravi063@gmail.com');
  process.exit(1);
}

getSessionsByEmail(email).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

