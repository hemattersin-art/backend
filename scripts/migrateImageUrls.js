/**
 * Migration Script: Convert Supabase Image URLs to Proxy URLs
 * 
 * This script migrates existing image URLs in the database from direct Supabase URLs
 * to proxy URLs that hide the Supabase project ID.
 * 
 * Usage:
 *   node backend/scripts/migrateImageUrls.js [--dry-run] [--table=blogs] [--frontend-url=https://www.little.care]
 * 
 * Options:
 *   --dry-run: Show what would be changed without actually updating
 *   --table: Specific table to migrate (blogs, counselling_services, etc.)
 *   --frontend-url: Frontend URL for proxy (default: https://www.little.care)
 */

// Try multiple .env file locations
const path = require('path');
const fs = require('fs');

const possibleEnvPaths = [
  path.join(__dirname, '../../.env'),        // Root .env
  path.join(__dirname, '../../../.env'),     // If backend is nested
  path.join(__dirname, '../.env'),           // Backend .env
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

const { convertToProxyUrl } = require('../utils/imageUrlConverter');
const { supabaseAdmin } = require('../config/supabase');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.little.care';
const DRY_RUN = process.argv.includes('--dry-run');
const TABLE_ARG = process.argv.find(arg => arg.startsWith('--table='));
const TARGET_TABLE = TABLE_ARG ? TABLE_ARG.split('=')[1] : null;
const FRONTEND_URL_ARG = process.argv.find(arg => arg.startsWith('--frontend-url='));
const CUSTOM_FRONTEND_URL = FRONTEND_URL_ARG ? FRONTEND_URL_ARG.split('=')[1] : FRONTEND_URL;

// Define tables and their image fields to migrate
const TABLES_TO_MIGRATE = {
  blogs: ['cover_image_url', 'hero_image_url'],
  counselling_services: ['hero_image_url', 'right_image_url', 'mobile_image_url'],
  // Add more tables as needed
  // assessments: ['image_url'],
  // psychologists: ['cover_image_url'],
};

/**
 * Check if URL needs migration (is a Supabase direct URL)
 */
function needsMigration(url) {
  if (!url) return false;
  return url.includes('.supabase.co/storage/v1/object/public/') && !url.includes('/api/images/');
}

/**
 * Migrate image URLs in a specific table
 */
async function migrateTable(tableName, imageFields) {
  console.log(`\n📋 Migrating table: ${tableName}`);
  console.log(`   Fields: ${imageFields.join(', ')}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will update database)'}`);
  
  try {
    // Fetch all records
    const { data: records, error: fetchError } = await supabaseAdmin
      .from(tableName)
      .select('*');

    if (fetchError) {
      console.error(`   ❌ Error fetching records: ${fetchError.message}`);
      return { table: tableName, updated: 0, errors: 1 };
    }

    if (!records || records.length === 0) {
      console.log(`   ℹ️  No records found`);
      return { table: tableName, updated: 0, errors: 0 };
    }

    let updatedCount = 0;
    let errorCount = 0;

    // Process each record
    for (const record of records) {
      const updates = {};
      let hasUpdates = false;

      // Check each image field
      for (const field of imageFields) {
        const currentUrl = record[field];
        if (needsMigration(currentUrl)) {
          const proxyUrl = convertToProxyUrl(currentUrl, CUSTOM_FRONTEND_URL);
          if (proxyUrl) {
            updates[field] = proxyUrl;
            hasUpdates = true;
            console.log(`   🔄 ${record.id || record.slug || 'record'}:`);
            console.log(`      ${field}:`);
            console.log(`         FROM: ${currentUrl}`);
            console.log(`         TO:   ${proxyUrl}`);
          } else {
            console.log(`   ⚠️  ${record.id || record.slug || 'record'}: Failed to convert ${field}`);
            errorCount++;
          }
        }
      }

      // Update the record if there are changes
      if (hasUpdates && !DRY_RUN) {
        const { error: updateError } = await supabaseAdmin
          .from(tableName)
          .update(updates)
          .eq('id', record.id);

        if (updateError) {
          console.error(`   ❌ Error updating record ${record.id}: ${updateError.message}`);
          errorCount++;
        } else {
          updatedCount++;
          console.log(`   ✅ Updated record ${record.id || record.slug || 'record'}`);
        }
      } else if (hasUpdates && DRY_RUN) {
        updatedCount++;
      }
    }

    console.log(`   📊 Summary: ${updatedCount} records ${DRY_RUN ? 'would be' : ''} updated, ${errorCount} errors`);
    return { table: tableName, updated: updatedCount, errors: errorCount };

  } catch (error) {
    console.error(`   ❌ Error migrating table ${tableName}:`, error.message);
    return { table: tableName, updated: 0, errors: 1 };
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('🔄 Image URL Migration Script');
  console.log('================================');
  console.log(`Frontend URL: ${CUSTOM_FRONTEND_URL}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE (will update database)'}`);
  console.log('');

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made to the database');
    console.log('   Run without --dry-run to apply changes\n');
  }

  const tablesToProcess = TARGET_TABLE 
    ? { [TARGET_TABLE]: TABLES_TO_MIGRATE[TARGET_TABLE] || [] }
    : TABLES_TO_MIGRATE;

  if (TARGET_TABLE && !TABLES_TO_MIGRATE[TARGET_TABLE]) {
    console.error(`❌ Error: Table "${TARGET_TABLE}" not found in migration list`);
    console.log(`   Available tables: ${Object.keys(TABLES_TO_MIGRATE).join(', ')}`);
    process.exit(1);
  }

  const results = [];

  // Migrate each table
  for (const [tableName, imageFields] of Object.entries(tablesToProcess)) {
    if (imageFields.length === 0) {
      console.log(`\n⏭️  Skipping ${tableName} (no image fields defined)`);
      continue;
    }
    const result = await migrateTable(tableName, imageFields);
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Migration Summary');
  console.log('='.repeat(50));
  
  const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

  results.forEach(result => {
    console.log(`   ${result.table}: ${result.updated} updated, ${result.errors} errors`);
  });

  console.log(`\n   Total: ${totalUpdated} records ${DRY_RUN ? 'would be' : ''} updated, ${totalErrors} errors`);

  if (DRY_RUN && totalUpdated > 0) {
    console.log('\n💡 To apply these changes, run the script without --dry-run flag');
  } else if (!DRY_RUN && totalUpdated > 0) {
    console.log('\n✅ Migration completed successfully!');
  } else if (totalUpdated === 0) {
    console.log('\nℹ️  No records needed migration');
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run the migration
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { migrateTable, needsMigration };

