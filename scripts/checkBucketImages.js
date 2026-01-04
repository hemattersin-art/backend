/**
 * Script to check all images in storage buckets
 * Verifies that images exist and can be accessed via signed URLs
 * 
 * Usage:
 *   node backend/scripts/checkBucketImages.js [--bucket=counselling-images]
 */

const path = require('path');
const fs = require('fs');

// Try multiple .env file locations
const possibleEnvPaths = [
  path.join(__dirname, '../../.env'),
  path.join(__dirname, '../../../.env'),
  path.join(__dirname, '../.env'),
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}

// Fallback: try loading from environment directly
if (!process.env.SUPABASE_URL) {
  require('dotenv').config();
}

const { supabaseAdmin } = require('../config/supabase');

// Get bucket from command line argument
const BUCKET_ARG = process.argv.find(arg => arg.startsWith('--bucket='));
const TARGET_BUCKET = BUCKET_ARG ? BUCKET_ARG.split('=')[1] : null;

// Buckets to check
const BUCKETS_TO_CHECK = TARGET_BUCKET 
  ? [TARGET_BUCKET]
  : ['counselling-images', 'blog-images', 'profile-pictures', 'static-files'];

/**
 * List all files in a bucket (recursively)
 */
async function listAllFiles(bucket, folder = '', allFiles = []) {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(folder, {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (error) {
      console.error(`❌ Error listing files in ${bucket}/${folder}:`, error.message);
      return allFiles;
    }

    if (!data || data.length === 0) {
      return allFiles;
    }

    for (const item of data) {
      const fullPath = folder ? `${folder}/${item.name}` : item.name;
      
      if (item.id === null) {
        // It's a folder, recurse
        await listAllFiles(bucket, fullPath, allFiles);
      } else {
        // It's a file
        allFiles.push({
          path: fullPath,
          name: item.name,
          size: item.metadata?.size || 0,
          updated: item.updated_at,
          mimetype: item.metadata?.mimetype || 'unknown'
        });
      }
    }

    return allFiles;
  } catch (error) {
    console.error(`❌ Error in listAllFiles for ${bucket}/${folder}:`, error.message);
    return allFiles;
  }
}

/**
 * Test if a file can be accessed via signed URL
 */
async function testFileAccess(bucket, filePath) {
  try {
    // Try to create a signed URL
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(filePath, 3600);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      return {
        accessible: false,
        error: signedUrlError?.message || 'Failed to create signed URL',
        errorCode: signedUrlError?.statusCode || signedUrlError?.error
      };
    }

    // Try to fetch the image
    const response = await fetch(signedUrlData.signedUrl, {
      method: 'HEAD', // Just check if it exists, don't download
      headers: {
        'Accept': 'image/*',
      },
    });

    if (!response.ok) {
      return {
        accessible: false,
        error: `HTTP ${response.status} ${response.statusText}`,
        signedUrl: signedUrlData.signedUrl
      };
    }

    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');

    return {
      accessible: true,
      contentType: contentType,
      contentLength: contentLength,
      signedUrl: signedUrlData.signedUrl
    };
  } catch (error) {
    return {
      accessible: false,
      error: error.message
    };
  }
}

/**
 * Main function to check all buckets
 */
async function checkAllBuckets() {
  console.log('🔍 Checking images in storage buckets...\n');
  console.log('='.repeat(80));

  const results = {
    totalFiles: 0,
    accessibleFiles: 0,
    inaccessibleFiles: 0,
    errors: []
  };

  for (const bucket of BUCKETS_TO_CHECK) {
    console.log(`\n📦 Checking bucket: ${bucket}`);
    console.log('-'.repeat(80));

    try {
      // List all files in the bucket
      const files = await listAllFiles(bucket);
      
      if (files.length === 0) {
        console.log(`   ⚠️  No files found in bucket: ${bucket}`);
        continue;
      }

      console.log(`   📁 Found ${files.length} file(s)`);
      results.totalFiles += files.length;

      // Test each file
      let accessibleCount = 0;
      let inaccessibleCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = `[${i + 1}/${files.length}]`;
        
        process.stdout.write(`   ${progress} Testing: ${file.path}... `);

        const testResult = await testFileAccess(bucket, file.path);

        if (testResult.accessible) {
          accessibleCount++;
          results.accessibleFiles++;
          const size = file.size ? `(${(file.size / 1024).toFixed(2)} KB)` : '';
          console.log(`✅ OK ${size}`);
        } else {
          inaccessibleCount++;
          results.inaccessibleFiles++;
          console.log(`❌ FAILED: ${testResult.error}`);
          results.errors.push({
            bucket,
            file: file.path,
            error: testResult.error,
            errorCode: testResult.errorCode
          });
        }

        // Small delay to avoid rate limiting
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`\n   📊 Summary for ${bucket}:`);
      console.log(`      ✅ Accessible: ${accessibleCount}`);
      console.log(`      ❌ Inaccessible: ${inaccessibleCount}`);
      console.log(`      📁 Total: ${files.length}`);

    } catch (error) {
      console.error(`   ❌ Error checking bucket ${bucket}:`, error.message);
      results.errors.push({
        bucket,
        file: 'N/A',
        error: error.message
      });
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`   Total files checked: ${results.totalFiles}`);
  console.log(`   ✅ Accessible: ${results.accessibleFiles}`);
  console.log(`   ❌ Inaccessible: ${results.inaccessibleFiles}`);
  console.log(`   📁 Buckets checked: ${BUCKETS_TO_CHECK.length}`);

  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS FOUND:');
    console.log('-'.repeat(80));
    results.errors.forEach((err, index) => {
      console.log(`\n${index + 1}. Bucket: ${err.bucket}`);
      console.log(`   File: ${err.file}`);
      console.log(`   Error: ${err.error}`);
      if (err.errorCode) {
        console.log(`   Error Code: ${err.errorCode}`);
      }
    });
  } else {
    console.log('\n✅ All files are accessible!');
  }

  console.log('\n' + '='.repeat(80));
}

// Run the check
checkAllBuckets()
  .then(() => {
    console.log('\n✅ Check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

