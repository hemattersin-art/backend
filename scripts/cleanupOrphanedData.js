/**
 * Script to cleanup orphaned data from deleted users
 * Finds and deletes sessions, payments, receipts, etc. that reference non-existent clients/users
 * 
 * Usage: node scripts/cleanupOrphanedData.js [--dry-run]
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

// Check if dry run mode
const isDryRun = process.argv.includes('--dry-run');

async function cleanupOrphanedData() {
  try {
    console.log('🔍 Starting orphaned data cleanup...');
    if (isDryRun) {
      console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    } else {
      console.log('⚠️  LIVE MODE - Orphaned data will be deleted\n');
    }

    let totalDeleted = 0;
    const cleanupStats = {
      receipts: 0,
      payments: 0,
      sessions: 0,
      assessmentSessions: 0,
      freeAssessments: 0,
      clientPackages: 0,
      conversations: 0,
      messages: 0
    };

    // Step 1: Get all existing client IDs
    console.log('Step 1: Fetching all existing clients...');
    const { data: allClients, error: clientsError } = await supabaseAdmin
      .from('clients')
      .select('id');

    if (clientsError) {
      throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    }

    const validClientIds = new Set((allClients || []).map(c => c.id));
    console.log(`✅ Found ${validClientIds.size} valid client IDs\n`);

    // Step 2: Get all existing user IDs
    console.log('Step 2: Fetching all existing users...');
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id');

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    const validUserIds = new Set((allUsers || []).map(u => u.id));
    console.log(`✅ Found ${validUserIds.size} valid user IDs\n`);

    // Step 3: Cleanup receipts (via sessions)
    console.log('Step 3: Checking for orphaned receipts...');
    const { data: allSessions, error: sessionsError } = await supabaseAdmin
      .from('sessions')
      .select('id, client_id');

    if (sessionsError) {
      console.warn(`⚠️  Warning: Failed to fetch sessions: ${sessionsError.message}`);
    } else {
      const validSessionIds = new Set(
        (allSessions || [])
          .filter(s => validClientIds.has(s.client_id))
          .map(s => s.id)
      );

      const { data: allReceipts } = await supabaseAdmin
        .from('receipts')
        .select('id, session_id');

      if (allReceipts) {
        const orphanedReceipts = allReceipts.filter(r => 
          r.session_id && !validSessionIds.has(r.session_id)
        );

        if (orphanedReceipts.length > 0) {
          console.log(`   Found ${orphanedReceipts.length} orphaned receipt(s)`);
          if (!isDryRun) {
            const receiptIds = orphanedReceipts.map(r => r.id);
            const { error } = await supabaseAdmin
              .from('receipts')
              .delete()
              .in('id', receiptIds);
            
            if (error) {
              console.error(`   ❌ Error deleting receipts: ${error.message}`);
            } else {
              cleanupStats.receipts = orphanedReceipts.length;
              totalDeleted += orphanedReceipts.length;
              console.log(`   ✅ Deleted ${orphanedReceipts.length} orphaned receipt(s)`);
            }
          } else {
            cleanupStats.receipts = orphanedReceipts.length;
            console.log(`   Would delete ${orphanedReceipts.length} orphaned receipt(s)`);
          }
        } else {
          console.log(`   ✅ No orphaned receipts found`);
        }
      }
    }
    console.log('');

    // Step 4: Cleanup payments
    console.log('Step 4: Checking for orphaned payments...');
    const { data: allPayments } = await supabaseAdmin
      .from('payments')
      .select('id, client_id');

    if (allPayments) {
      const orphanedPayments = allPayments.filter(p => 
        p.client_id && !validClientIds.has(p.client_id)
      );

      if (orphanedPayments.length > 0) {
        console.log(`   Found ${orphanedPayments.length} orphaned payment(s)`);
        if (!isDryRun) {
          const paymentIds = orphanedPayments.map(p => p.id);
          const { error } = await supabaseAdmin
            .from('payments')
            .delete()
            .in('id', paymentIds);
          
          if (error) {
            console.error(`   ❌ Error deleting payments: ${error.message}`);
          } else {
            cleanupStats.payments = orphanedPayments.length;
            totalDeleted += orphanedPayments.length;
            console.log(`   ✅ Deleted ${orphanedPayments.length} orphaned payment(s)`);
          }
        } else {
          cleanupStats.payments = orphanedPayments.length;
          console.log(`   Would delete ${orphanedPayments.length} orphaned payment(s)`);
        }
      } else {
        console.log(`   ✅ No orphaned payments found`);
      }
    }
    console.log('');

    // Step 5: Cleanup sessions
    console.log('Step 5: Checking for orphaned sessions...');
    if (allSessions) {
      const orphanedSessions = allSessions.filter(s => 
        s.client_id && !validClientIds.has(s.client_id)
      );

      if (orphanedSessions.length > 0) {
        console.log(`   Found ${orphanedSessions.length} orphaned session(s)`);
        if (!isDryRun) {
          const sessionIds = orphanedSessions.map(s => s.id);
          const { error } = await supabaseAdmin
            .from('sessions')
            .delete()
            .in('id', sessionIds);
          
          if (error) {
            console.error(`   ❌ Error deleting sessions: ${error.message}`);
          } else {
            cleanupStats.sessions = orphanedSessions.length;
            totalDeleted += orphanedSessions.length;
            console.log(`   ✅ Deleted ${orphanedSessions.length} orphaned session(s)`);
          }
        } else {
          cleanupStats.sessions = orphanedSessions.length;
          console.log(`   Would delete ${orphanedSessions.length} orphaned session(s)`);
        }
      } else {
        console.log(`   ✅ No orphaned sessions found`);
      }
    }
    console.log('');

    // Step 6: Cleanup assessment sessions
    console.log('Step 6: Checking for orphaned assessment sessions...');
    const { data: allAssessmentSessions } = await supabaseAdmin
      .from('assessment_sessions')
      .select('id, client_id');

    if (allAssessmentSessions) {
      const orphanedAssessmentSessions = allAssessmentSessions.filter(s => 
        s.client_id && !validClientIds.has(s.client_id)
      );

      if (orphanedAssessmentSessions.length > 0) {
        console.log(`   Found ${orphanedAssessmentSessions.length} orphaned assessment session(s)`);
        if (!isDryRun) {
          const assessmentSessionIds = orphanedAssessmentSessions.map(s => s.id);
          const { error } = await supabaseAdmin
            .from('assessment_sessions')
            .delete()
            .in('id', assessmentSessionIds);
          
          if (error) {
            console.error(`   ❌ Error deleting assessment sessions: ${error.message}`);
          } else {
            cleanupStats.assessmentSessions = orphanedAssessmentSessions.length;
            totalDeleted += orphanedAssessmentSessions.length;
            console.log(`   ✅ Deleted ${orphanedAssessmentSessions.length} orphaned assessment session(s)`);
          }
        } else {
          cleanupStats.assessmentSessions = orphanedAssessmentSessions.length;
          console.log(`   Would delete ${orphanedAssessmentSessions.length} orphaned assessment session(s)`);
        }
      } else {
        console.log(`   ✅ No orphaned assessment sessions found`);
      }
    }
    console.log('');

    // Step 7: Cleanup free assessments
    console.log('Step 7: Checking for orphaned free assessments...');
    const { data: allFreeAssessments } = await supabaseAdmin
      .from('free_assessments')
      .select('id, client_id');

    if (allFreeAssessments) {
      const orphanedFreeAssessments = allFreeAssessments.filter(f => 
        f.client_id && !validClientIds.has(f.client_id)
      );

      if (orphanedFreeAssessments.length > 0) {
        console.log(`   Found ${orphanedFreeAssessments.length} orphaned free assessment(s)`);
        if (!isDryRun) {
          const freeAssessmentIds = orphanedFreeAssessments.map(f => f.id);
          const { error } = await supabaseAdmin
            .from('free_assessments')
            .delete()
            .in('id', freeAssessmentIds);
          
          if (error) {
            console.error(`   ❌ Error deleting free assessments: ${error.message}`);
          } else {
            cleanupStats.freeAssessments = orphanedFreeAssessments.length;
            totalDeleted += orphanedFreeAssessments.length;
            console.log(`   ✅ Deleted ${orphanedFreeAssessments.length} orphaned free assessment(s)`);
          }
        } else {
          cleanupStats.freeAssessments = orphanedFreeAssessments.length;
          console.log(`   Would delete ${orphanedFreeAssessments.length} orphaned free assessment(s)`);
        }
      } else {
        console.log(`   ✅ No orphaned free assessments found`);
      }
    }
    console.log('');

    // Step 8: Cleanup client packages
    console.log('Step 8: Checking for orphaned client packages...');
    const { data: allClientPackages } = await supabaseAdmin
      .from('client_packages')
      .select('id, client_id');

    if (allClientPackages) {
      const orphanedClientPackages = allClientPackages.filter(cp => 
        cp.client_id && !validClientIds.has(cp.client_id)
      );

      if (orphanedClientPackages.length > 0) {
        console.log(`   Found ${orphanedClientPackages.length} orphaned client package(s)`);
        if (!isDryRun) {
          const clientPackageIds = orphanedClientPackages.map(cp => cp.id);
          const { error } = await supabaseAdmin
            .from('client_packages')
            .delete()
            .in('id', clientPackageIds);
          
          if (error) {
            console.error(`   ❌ Error deleting client packages: ${error.message}`);
          } else {
            cleanupStats.clientPackages = orphanedClientPackages.length;
            totalDeleted += orphanedClientPackages.length;
            console.log(`   ✅ Deleted ${orphanedClientPackages.length} orphaned client package(s)`);
          }
        } else {
          cleanupStats.clientPackages = orphanedClientPackages.length;
          console.log(`   Would delete ${orphanedClientPackages.length} orphaned client package(s)`);
        }
      } else {
        console.log(`   ✅ No orphaned client packages found`);
      }
    }
    console.log('');

    // Step 9: Cleanup conversations and messages
    console.log('Step 9: Checking for orphaned conversations and messages...');
    const { data: allConversations } = await supabaseAdmin
      .from('conversations')
      .select('id, client_id');

    if (allConversations) {
      const orphanedConversations = allConversations.filter(c => 
        c.client_id && !validClientIds.has(c.client_id)
      );

      if (orphanedConversations.length > 0) {
        console.log(`   Found ${orphanedConversations.length} orphaned conversation(s)`);
        
        // Delete messages first
        const orphanedConversationIds = orphanedConversations.map(c => c.id);
        const { data: orphanedMessages } = await supabaseAdmin
          .from('messages')
          .select('id')
          .in('conversation_id', orphanedConversationIds);

        if (orphanedMessages && orphanedMessages.length > 0) {
          console.log(`   Found ${orphanedMessages.length} orphaned message(s)`);
          if (!isDryRun) {
            const messageIds = orphanedMessages.map(m => m.id);
            const { error: messagesError } = await supabaseAdmin
              .from('messages')
              .delete()
              .in('id', messageIds);
            
            if (messagesError) {
              console.error(`   ❌ Error deleting messages: ${messagesError.message}`);
            } else {
              cleanupStats.messages = orphanedMessages.length;
              totalDeleted += orphanedMessages.length;
              console.log(`   ✅ Deleted ${orphanedMessages.length} orphaned message(s)`);
            }
          } else {
            cleanupStats.messages = orphanedMessages.length;
            console.log(`   Would delete ${orphanedMessages.length} orphaned message(s)`);
          }
        }

        // Then delete conversations
        if (!isDryRun) {
          const { error } = await supabaseAdmin
            .from('conversations')
            .delete()
            .in('id', orphanedConversationIds);
          
          if (error) {
            console.error(`   ❌ Error deleting conversations: ${error.message}`);
          } else {
            cleanupStats.conversations = orphanedConversations.length;
            totalDeleted += orphanedConversations.length;
            console.log(`   ✅ Deleted ${orphanedConversations.length} orphaned conversation(s)`);
          }
        } else {
          cleanupStats.conversations = orphanedConversations.length;
          console.log(`   Would delete ${orphanedConversations.length} orphaned conversation(s)`);
        }
      } else {
        console.log(`   ✅ No orphaned conversations found`);
      }
    }
    console.log('');

    // Summary
    console.log('📊 Cleanup Summary:');
    console.log(`   Receipts: ${cleanupStats.receipts}`);
    console.log(`   Payments: ${cleanupStats.payments}`);
    console.log(`   Sessions: ${cleanupStats.sessions}`);
    console.log(`   Assessment Sessions: ${cleanupStats.assessmentSessions}`);
    console.log(`   Free Assessments: ${cleanupStats.freeAssessments}`);
    console.log(`   Client Packages: ${cleanupStats.clientPackages}`);
    console.log(`   Conversations: ${cleanupStats.conversations}`);
    console.log(`   Messages: ${cleanupStats.messages}`);
    console.log(`   Total Records: ${totalDeleted}`);

    if (isDryRun) {
      console.log('\n✅ DRY RUN COMPLETE - No changes made');
      console.log(`   Would delete ${totalDeleted} orphaned record(s)`);
    } else {
      console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} orphaned record(s)`);
    }

  } catch (error) {
    console.error('❌ Error in cleanupOrphanedData:', error);
    process.exit(1);
  }
}

// Run the script
cleanupOrphanedData()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });


