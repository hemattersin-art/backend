/**
 * Update All Psychologists Password Script
 * 
 * Updates all psychologists' passwords to a strong password: Koott@2025
 * This script uses admin authentication to update passwords.
 * 
 * Usage: node scripts/updateAllPsychologistsPassword.js
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');
const { hashPassword } = require('../utils/helpers');

const NEW_PASSWORD = 'Koott@2025';

async function updateAllPsychologistsPassword() {
  try {
    console.log('🔐 Starting password update for all psychologists...\n');
    console.log(`📝 New password: ${NEW_PASSWORD}\n`);

    // Get all psychologists
    const { data: psychologists, error: fetchError } = await supabaseAdmin
      .from('psychologists')
      .select('id, email, first_name, last_name')
      .order('first_name', { ascending: true });

    if (fetchError) {
      console.error('❌ Error fetching psychologists:', fetchError);
      return;
    }

    if (!psychologists || psychologists.length === 0) {
      console.log('✅ No psychologists found.');
      return;
    }

    console.log(`📊 Found ${psychologists.length} psychologist(s) to update:\n`);
    console.log('='.repeat(100));

    // Hash the new password once
    const hashedPassword = await hashPassword(NEW_PASSWORD);
    console.log('✅ Password hashed successfully\n');

    let successCount = 0;
    let errorCount = 0;
    const results = [];

    // Update each psychologist's password
    for (const psychologist of psychologists) {
      const name = `${psychologist.first_name || ''} ${psychologist.last_name || ''}`.trim() || psychologist.email || 'Unknown';
      const psychologistId = psychologist.id;
      const email = psychologist.email;

      try {
        console.log(`\n🔄 Updating password for: ${name} (ID: ${psychologistId})`);
        console.log(`   Email: ${email || 'N/A'}`);

        let targetUserId = null;
        let userCreated = false;

        // Try to resolve user by email
        if (email) {
          console.log(`   ⚠️  No user_id found, looking up by email...`);
          const { data: userByEmail, error: userLookupError } = await supabaseAdmin
            .from('users')
            .select('id, email')
            .eq('email', email)
            .single();

          if (userLookupError || !userByEmail) {
            // Create a new user for this psychologist
            console.log(`   📝 Creating new user account...`);
            const { data: newUser, error: createUserError } = await supabaseAdmin
              .from('users')
              .insert([{ 
                email: email, 
                password_hash: hashedPassword, 
                role: 'psychologist' 
              }])
              .select('id')
              .single();

            if (createUserError || !newUser) {
              console.error(`   ❌ Failed to create user: ${createUserError?.message || 'Unknown error'}`);
              errorCount++;
              results.push({
                psychologistId,
                name,
                email,
                status: 'error',
                error: `Failed to create user: ${createUserError?.message || 'Unknown error'}`
              });
              continue;
            } else {
              targetUserId = newUser.id;
              userCreated = true;
              console.log(`   ✅ Created new user with ID: ${targetUserId}`);
              
              // Backfill psychologists.user_id
              await supabaseAdmin
                .from('psychologists')
                .update({ user_id: targetUserId, updated_at: new Date().toISOString() })
                .eq('id', psychologistId);
            }
          } else {
            targetUserId = userByEmail.id;
            console.log(`   ✅ Found existing user with ID: ${targetUserId}`);
          }
        }

        if (!targetUserId) {
          console.error(`   ❌ No user_id and no email - cannot update password`);
          errorCount++;
          results.push({
            psychologistId,
            name,
            email,
            status: 'error',
            error: 'No user_id and no email available'
          });
          continue;
        }

        // Update user password in users table
        const { error: userPasswordUpdateError } = await supabaseAdmin
          .from('users')
          .update({ 
            password_hash: hashedPassword, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', targetUserId);

        if (userPasswordUpdateError) {
          console.error(`   ❌ Error updating user password: ${userPasswordUpdateError.message}`);
          errorCount++;
          results.push({
            psychologistId,
            name,
            email,
            status: 'error',
            error: `User password update failed: ${userPasswordUpdateError.message}`
          });
          continue;
        }

        // Update psychologist password_hash (if column exists)
        const { error: psychPwUpdateError } = await supabaseAdmin
          .from('psychologists')
          .update({ 
            password_hash: hashedPassword, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', psychologistId);

        if (psychPwUpdateError) {
          // This is OK - psychologist table might not have password_hash column
          console.log(`   ⚠️  Note: Could not update psychologists.password_hash (this is OK if column doesn't exist)`);
        }

        console.log(`   ✅ Password updated successfully${userCreated ? ' (new user created)' : ''}`);
        successCount++;
        results.push({
          psychologistId,
          name,
          email,
          userId: targetUserId,
          status: 'success',
          userCreated
        });

      } catch (error) {
        console.error(`   ❌ Exception updating password: ${error.message}`);
        errorCount++;
        results.push({
          psychologistId,
          name,
          email,
          status: 'error',
          error: error.message
        });
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n📊 Summary:');
    console.log(`   ✅ Successfully updated: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   📝 Total: ${psychologists.length}`);

    if (errorCount > 0) {
      console.log('\n❌ Errors:');
      results
        .filter(r => r.status === 'error')
        .forEach(r => {
          console.log(`   - ${r.name} (${r.email}): ${r.error}`);
        });
    }

    console.log('\n✅ Password update process completed!');
    console.log(`\n📋 All psychologists can now login with password: ${NEW_PASSWORD}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
updateAllPsychologistsPassword()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

