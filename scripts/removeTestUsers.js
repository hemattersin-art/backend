/**
 * Script to remove test users
 * Identifies users by email patterns: test, demo, example, fake, sample, dummy
 * 
 * Usage: node scripts/removeTestUsers.js [--dry-run]
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

// Check if dry run mode
const isDryRun = process.argv.includes('--dry-run');

// Test email patterns
const testPatterns = ['test', 'demo', 'example', 'fake', 'sample', 'dummy'];

function isTestUser(email) {
  if (!email) return false;
  const emailLower = email.toLowerCase().trim();
  return testPatterns.some(pattern => emailLower.includes(pattern));
}

async function removeTestUsers() {
  try {
    console.log('🔍 Starting test user removal process...');
    if (isDryRun) {
      console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    } else {
      console.log('⚠️  LIVE MODE - Test users will be deleted\n');
    }

    // Step 1: Fetch all users from users table
    console.log('Step 1: Fetching all users from users table...');
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, role, created_at')
      .order('created_at', { ascending: true });

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    console.log(`✅ Found ${users.length} users in users table\n`);

    // Step 2: Fetch clients without user_id (Google OAuth users)
    console.log('Step 2: Fetching clients without user_id...');
    const { data: clientsWithoutUser, error: clientsError } = await supabaseAdmin
      .from('clients')
      .select('id, email, created_at')
      .is('user_id', null)
      .not('email', 'is', null)
      .order('created_at', { ascending: true });

    if (clientsError) {
      console.warn(`⚠️  Warning: Failed to fetch clients without user_id: ${clientsError.message}`);
    } else {
      console.log(`✅ Found ${clientsWithoutUser?.length || 0} clients without user_id\n`);
    }

    // Step 3: Combine and identify test users
    console.log('Step 3: Identifying test users...');
    
    // Convert clients to user format
    const clientUsers = (clientsWithoutUser || []).map(client => ({
      id: client.id,
      email: client.email,
      role: 'client',
      created_at: client.created_at,
      source: 'clients_table'
    }));

    const allUsers = [
      ...users.map(u => ({ ...u, source: 'users_table' })),
      ...clientUsers
    ];

    // Filter test users (exclude admin and superadmin accounts)
    const testUsers = allUsers.filter(user => 
      isTestUser(user.email) && 
      user.role !== 'admin' && 
      user.role !== 'superadmin'
    );

    // Check if any admin accounts match test patterns (just for info)
    const adminTestUsers = allUsers.filter(user => 
      isTestUser(user.email) && 
      (user.role === 'admin' || user.role === 'superadmin')
    );

    if (adminTestUsers.length > 0) {
      console.log(`⚠️  Note: Found ${adminTestUsers.length} admin/superadmin account(s) with test email patterns (will NOT be deleted):`);
      adminTestUsers.forEach(user => {
        console.log(`   - ${user.email} (Role: ${user.role})`);
      });
      console.log('');
    }

    console.log(`✅ Found ${testUsers.length} test user(s)\n`);

    if (testUsers.length === 0) {
      console.log('✅ No test users found to remove');
      return;
    }

    // Step 4: Show details of test users
    console.log('📋 Test Users Found:');
    testUsers.forEach(user => {
      console.log(`   - ${user.email} (ID: ${user.id}, Created: ${user.created_at}, Source: ${user.source})`);
    });

    if (isDryRun) {
      console.log('\n✅ DRY RUN COMPLETE - No changes made');
      console.log(`   Would delete ${testUsers.length} test user(s)`);
      return;
    }

    // Step 5: Confirm deletion
    console.log(`\n⚠️  About to delete ${testUsers.length} test user(s)`);
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 6: Delete test users
    console.log('\n🗑️  Starting deletion...\n');
    let deletedCount = 0;
    let errorCount = 0;

    for (const userToDelete of testUsers) {
      try {
        console.log(`   Deleting test user ${userToDelete.id} (${userToDelete.email})...`);
        
        // Delete from appropriate table based on source
        if (userToDelete.source === 'users_table') {
          // For users from users table, we need to:
          // 1. Find client record by user_id
          // 2. Delete related data (sessions, payments, receipts, etc.) using client_id
          // 3. Delete client record
          // 4. Delete user record
          
          // Find client record
          const { data: clientRecord } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('user_id', userToDelete.id)
            .maybeSingle();

          const clientId = clientRecord?.id || userToDelete.id; // Fallback to user.id for old system

          // Delete related data
          // Delete receipts
          const { data: sessions } = await supabaseAdmin
            .from('sessions')
            .select('id')
            .eq('client_id', clientId);
          
          if (sessions && sessions.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            await supabaseAdmin
              .from('receipts')
              .delete()
              .in('session_id', sessionIds);
          }

          // Delete payments
          await supabaseAdmin
            .from('payments')
            .delete()
            .eq('client_id', clientId);

          // Delete sessions
          await supabaseAdmin
            .from('sessions')
            .delete()
            .eq('client_id', clientId);

          // Delete assessment sessions
          await supabaseAdmin
            .from('assessment_sessions')
            .delete()
            .eq('client_id', clientId);

          // Delete free assessments
          await supabaseAdmin
            .from('free_assessments')
            .delete()
            .eq('client_id', clientId);

          // Delete client packages
          await supabaseAdmin
            .from('client_packages')
            .delete()
            .eq('client_id', clientId);

          // Delete client profile
          const { error: deleteClientError } = await supabaseAdmin
            .from('clients')
            .delete()
            .eq('user_id', userToDelete.id);

          if (deleteClientError && !deleteClientError.message.includes('not found') && !deleteClientError.message.includes('violates foreign key')) {
            console.warn(`      ⚠️  Could not delete client profile: ${deleteClientError.message}`);
          }

          // Delete from users table
          const { error: deleteUserError } = await supabaseAdmin
            .from('users')
            .delete()
            .eq('id', userToDelete.id);

          if (deleteUserError) {
            throw deleteUserError;
          }
        } else if (userToDelete.source === 'clients_table') {
          // For clients without user_id, delete related data first
          const clientId = userToDelete.id;

          // Delete receipts
          const { data: sessions } = await supabaseAdmin
            .from('sessions')
            .select('id')
            .eq('client_id', clientId);
          
          if (sessions && sessions.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            await supabaseAdmin
              .from('receipts')
              .delete()
              .in('session_id', sessionIds);
          }

          // Delete payments
          await supabaseAdmin
            .from('payments')
            .delete()
            .eq('client_id', clientId);

          // Delete sessions
          await supabaseAdmin
            .from('sessions')
            .delete()
            .eq('client_id', clientId);

          // Delete assessment sessions
          await supabaseAdmin
            .from('assessment_sessions')
            .delete()
            .eq('client_id', clientId);

          // Delete free assessments
          await supabaseAdmin
            .from('free_assessments')
            .delete()
            .eq('client_id', clientId);

          // Delete client packages
          await supabaseAdmin
            .from('client_packages')
            .delete()
            .eq('client_id', clientId);

          // Delete from clients table
          const { error: deleteClientError } = await supabaseAdmin
            .from('clients')
            .delete()
            .eq('id', userToDelete.id);

          if (deleteClientError) {
            throw deleteClientError;
          }
        }

        deletedCount++;
        console.log(`      ✅ Deleted`);
      } catch (error) {
        errorCount++;
        console.error(`      ❌ Error deleting ${userToDelete.id}: ${error.message}`);
      }
    }

    console.log(`\n✅ Deletion complete!`);
    console.log(`   Successfully deleted: ${deletedCount}`);
    console.log(`   Errors: ${errorCount}`);

  } catch (error) {
    console.error('❌ Error in removeTestUsers:', error);
    process.exit(1);
  }
}

// Run the script
removeTestUsers()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

