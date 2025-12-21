/**
 * Script to remove duplicate users
 * Keeps the oldest user (earliest created_at) for each email address
 * Deletes newer duplicates
 * 
 * Usage: node scripts/removeDuplicateUsers.js [--dry-run]
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');
const dayjs = require('dayjs');

// Check if dry run mode
const isDryRun = process.argv.includes('--dry-run');

async function removeDuplicateUsers() {
  try {
    console.log('🔍 Starting duplicate user removal process...');
    if (isDryRun) {
      console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    } else {
      console.log('⚠️  LIVE MODE - Duplicates will be deleted\n');
    }

    // Step 1: Fetch all users from users table
    console.log('Step 1: Fetching all users from users table...');
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, role, created_at')
      .eq('role', 'client')
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

    // Step 3: Combine and group by email
    console.log('Step 3: Grouping users by email...');
    
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

    // Group by email
    const emailGroups = {};
    allUsers.forEach(user => {
      if (!user.email) return;
      const email = user.email.toLowerCase().trim();
      if (!emailGroups[email]) {
        emailGroups[email] = [];
      }
      emailGroups[email].push(user);
    });

    // Find duplicates (emails with more than one user)
    const duplicates = {};
    Object.keys(emailGroups).forEach(email => {
      if (emailGroups[email].length > 1) {
        // Sort by created_at (oldest first)
        emailGroups[email].sort((a, b) => {
          const dateA = new Date(a.created_at || 0);
          const dateB = new Date(b.created_at || 0);
          return dateA - dateB;
        });
        duplicates[email] = emailGroups[email];
      }
    });

    console.log(`✅ Found ${Object.keys(duplicates).length} emails with duplicates\n`);

    // Step 4: Prepare deletion list (keep oldest, delete rest)
    const toDelete = [];
    const toKeep = [];

    Object.keys(duplicates).forEach(email => {
      const group = duplicates[email];
      const keepUser = group[0]; // Oldest (first after sorting)
      const deleteUsers = group.slice(1); // All others

      toKeep.push(keepUser);
      toDelete.push(...deleteUsers.map(u => ({ ...u, keepUser })));
    });

    console.log(`📊 Summary:`);
    console.log(`   Total duplicate emails: ${Object.keys(duplicates).length}`);
    console.log(`   Users to keep: ${toKeep.length}`);
    console.log(`   Users to delete: ${toDelete.length}\n`);

    // Step 5: Show details of duplicates
    console.log('📋 Duplicate Details:');
    Object.keys(duplicates).forEach(email => {
      const group = duplicates[email];
      console.log(`\n   ${email}:`);
      console.log(`      Total: ${group.length} duplicates`);
      console.log(`      Keeping: ${group[0].id} (created: ${group[0].created_at})`);
      console.log(`      Deleting: ${group.slice(1).map(u => u.id).join(', ')}`);
    });

    if (isDryRun) {
      console.log('\n✅ DRY RUN COMPLETE - No changes made');
      console.log(`   Would delete ${toDelete.length} duplicate users`);
      return;
    }

    // Step 6: Confirm deletion
    console.log(`\n⚠️  About to delete ${toDelete.length} duplicate users`);
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 7: Delete duplicates
    console.log('\n🗑️  Starting deletion...\n');
    let deletedCount = 0;
    let errorCount = 0;

    for (const userToDelete of toDelete) {
      try {
        console.log(`   Deleting user ${userToDelete.id} (${userToDelete.email})...`);
        
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

          // Delete related data (if any exists, foreign key constraints will prevent deletion otherwise)
          // Note: We're deleting duplicates, so related data should be minimal or none
          // If there's important data, it should be on the kept user instead
          
          // Delete receipts
          await supabaseAdmin
            .from('receipts')
            .delete()
            .in('session_id', 
              (await supabaseAdmin.from('sessions').select('id').eq('client_id', clientId)).data?.map(s => s.id) || []
            );

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
          await supabaseAdmin
            .from('receipts')
            .delete()
            .in('session_id', 
              (await supabaseAdmin.from('sessions').select('id').eq('client_id', clientId)).data?.map(s => s.id) || []
            );

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
    console.log(`   Kept: ${toKeep.length} (oldest for each email)`);

  } catch (error) {
    console.error('❌ Error in removeDuplicateUsers:', error);
    process.exit(1);
  }
}

// Run the script
removeDuplicateUsers()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

