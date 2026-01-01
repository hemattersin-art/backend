/**
 * Script to Make All Supabase Storage Buckets Private
 * 
 * This script uses the Supabase Admin API to make all buckets private.
 * 
 * Usage:
 *   node backend/scripts/makeBucketsPrivate.js [--bucket-name=specific-bucket]
 * 
 * Options:
 *   --bucket-name: Make a specific bucket private (e.g., --bucket-name=blog-images)
 *   --dry-run: Show what would be changed without actually changing
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../config/supabase');

const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET_ARG = process.argv.find(arg => arg.startsWith('--bucket-name='));
const TARGET_BUCKET = BUCKET_ARG ? BUCKET_ARG.split('=')[1] : null;

// List of buckets that should be private
const BUCKETS_TO_PRIVATE = [
  'counselling-images',
  'blog-images',
  'profile-pictures',
  'static-files'
];

/**
 * Make a bucket private using Supabase Storage API
 */
async function makeBucketPrivate(bucketName) {
  try {
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would make bucket "${bucketName}" private`);
      return { success: true, bucket: bucketName, dryRun: true };
    }

    // Use Supabase Storage API to update bucket
    // Note: Supabase JS client doesn't have a direct updateBucket method in v1
    // We need to use the REST API directly or use SQL
    
    // Alternative: Use SQL via Supabase client (if you have admin access)
    const { data, error } = await supabaseAdmin
      .from('storage.buckets')
      .update({ public: false })
      .eq('name', bucketName)
      .select();

    if (error) {
      // If direct SQL doesn't work, try REST API approach
      console.log(`   Attempting REST API method for ${bucketName}...`);
      
      // For now, return instruction to use SQL or Dashboard
      return {
        success: false,
        error: `Direct API method not available. Use SQL command or Supabase Dashboard.\nSQL: UPDATE storage.buckets SET public = false WHERE name = '${bucketName}';`
      };
    }

    console.log(`✅ Made bucket "${bucketName}" private`);
    return { success: true, bucket: bucketName, data };
  } catch (error) {
    console.error(`❌ Error making bucket "${bucketName}" private:`, error.message);
    return { success: false, bucket: bucketName, error: error.message };
  }
}

/**
 * Get list of all buckets
 */
async function getAllBuckets() {
  try {
    // Query storage.buckets table
    const { data, error } = await supabaseAdmin
      .from('storage.buckets')
      .select('id, name, public, created_at')
      .order('name');

    if (error) {
      console.error('Error fetching buckets:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error getting buckets:', error);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔒 Making Supabase Storage Buckets Private');
  console.log('='.repeat(50));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will update buckets)'}`);
  console.log('');

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
    console.log('   Run without --dry-run to apply changes\n');
  }

  // Get all buckets
  console.log('📋 Fetching bucket list...');
  const buckets = await getAllBuckets();

  if (buckets.length === 0) {
    console.log('❌ No buckets found or error accessing buckets');
    console.log('   Try using SQL commands directly in Supabase Dashboard → SQL Editor');
    process.exit(1);
  }

  console.log(`Found ${buckets.length} bucket(s):\n`);
  
  // Filter buckets to process
  const bucketsToProcess = TARGET_BUCKET
    ? buckets.filter(b => b.name === TARGET_BUCKET)
    : buckets.filter(b => BUCKETS_TO_PRIVATE.includes(b.name) || b.public === true);

  if (TARGET_BUCKET && bucketsToProcess.length === 0) {
    console.error(`❌ Bucket "${TARGET_BUCKET}" not found`);
    process.exit(1);
  }

  // Show current status
  console.log('Current bucket status:');
  buckets.forEach(bucket => {
    const status = bucket.public ? '🔓 PUBLIC' : '🔒 PRIVATE';
    const willProcess = bucketsToProcess.some(b => b.name === bucket.name);
    const marker = willProcess ? ' ⬅️  Will process' : '';
    console.log(`   ${status} - ${bucket.name}${marker}`);
  });
  console.log('');

  // Process buckets
  const results = [];
  for (const bucket of bucketsToProcess) {
    if (bucket.public === false && !TARGET_BUCKET) {
      console.log(`⏭️  Skipping "${bucket.name}" (already private)`);
      continue;
    }

    const result = await makeBucketPrivate(bucket.name);
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary');
  console.log('='.repeat(50));

  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;

  if (DRY_RUN) {
    console.log(`   ${results.length} bucket(s) would be made private`);
  } else {
    console.log(`   ${successCount} bucket(s) made private`);
    if (errorCount > 0) {
      console.log(`   ${errorCount} error(s)`);
      results.filter(r => !r.success).forEach(r => {
        console.log(`      - ${r.bucket}: ${r.error}`);
      });
    }
  }

  if (DRY_RUN && results.length > 0) {
    console.log('\n💡 To apply these changes:');
    console.log('   1. Run without --dry-run flag, OR');
    console.log('   2. Use SQL command in Supabase Dashboard → SQL Editor:');
    console.log('      UPDATE storage.buckets SET public = false WHERE name IN (\'bucket1\', \'bucket2\');');
    console.log('   3. Or use Supabase Dashboard → Storage → Buckets → Toggle "Public bucket" OFF');
  } else if (errorCount > 0) {
    console.log('\n⚠️  Some buckets could not be updated via API.');
    console.log('   Please use SQL commands or Supabase Dashboard to make them private.');
    console.log('\n   SQL Command:');
    console.log('   UPDATE storage.buckets SET public = false WHERE name IN (\'' + 
                bucketsToProcess.map(b => b.name).join('\', \'') + '\');');
  } else if (!DRY_RUN && successCount > 0) {
    console.log('\n✅ All buckets successfully made private!');
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { makeBucketPrivate, getAllBuckets };

