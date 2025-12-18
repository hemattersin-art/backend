require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function deleteDuplicatePackages(psychologistId) {
  try {
    console.log(`\n🗑️  Deleting duplicate packages for psychologist: ${psychologistId}\n`);

    // Get all packages for this psychologist
    const { data: packages, error: packagesError } = await supabaseAdmin
      .from('packages')
      .select('id, name, session_count, price, created_at')
      .eq('psychologist_id', psychologistId)
      .order('session_count', { ascending: true })
      .order('created_at', { ascending: true });

    if (packagesError) {
      console.error('❌ Error fetching packages:', packagesError);
      process.exit(1);
    }

    if (!packages || packages.length === 0) {
      console.log('⚠️  No packages found');
      process.exit(0);
    }

    console.log(`📦 Found ${packages.length} packages\n`);

    // Group packages by session_count
    const packagesBySession = {};
    packages.forEach(pkg => {
      if (!packagesBySession[pkg.session_count]) {
        packagesBySession[pkg.session_count] = [];
      }
      packagesBySession[pkg.session_count].push(pkg);
    });

    const packagesToDelete = [];
    const packagesToKeep = [];

    // For each session count, keep the first (oldest) and mark others as duplicates
    Object.keys(packagesBySession).forEach(sessionCount => {
      const sessionPackages = packagesBySession[sessionCount];
      if (sessionPackages.length > 1) {
        // Keep the first one (oldest)
        packagesToKeep.push(sessionPackages[0]);
        // Mark the rest as duplicates
        for (let i = 1; i < sessionPackages.length; i++) {
          packagesToDelete.push(sessionPackages[i]);
        }
      } else {
        packagesToKeep.push(sessionPackages[0]);
      }
    });

    if (packagesToDelete.length === 0) {
      console.log('✅ No duplicate packages found. All packages are unique.\n');
      process.exit(0);
    }

    console.log('='.repeat(80));
    console.log('📋 PACKAGES TO DELETE (Duplicates):');
    console.log('='.repeat(80));
    packagesToDelete.forEach((pkg, index) => {
      console.log(`${index + 1}. ${pkg.name || `Package of ${pkg.session_count} Sessions`}`);
      console.log(`   ID: ${pkg.id}`);
      console.log(`   Price: $${pkg.price}`);
      console.log(`   Created: ${new Date(pkg.created_at).toLocaleString()}`);
      console.log('');
    });

    console.log('='.repeat(80));
    console.log('✅ PACKAGES TO KEEP:');
    console.log('='.repeat(80));
    packagesToKeep.forEach((pkg, index) => {
      console.log(`${index + 1}. ${pkg.name || `Package of ${pkg.session_count} Sessions`}`);
      console.log(`   ID: ${pkg.id}`);
      console.log(`   Price: $${pkg.price}`);
      console.log(`   Created: ${new Date(pkg.created_at).toLocaleString()}`);
      console.log('');
    });

    // Check if any packages to delete are being used in sessions
    console.log('='.repeat(80));
    console.log('🔍 Checking if packages are in use...');
    console.log('='.repeat(80));

    const packagesInUse = [];
    for (const pkg of packagesToDelete) {
      const { data: sessions, error: sessionsError } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('package_id', pkg.id)
        .limit(1);

      if (sessionsError) {
        console.error(`❌ Error checking sessions for package ${pkg.id}:`, sessionsError);
        continue;
      }

      if (sessions && sessions.length > 0) {
        packagesInUse.push(pkg);
        console.log(`⚠️  Package ${pkg.id} (${pkg.name}) is being used in sessions - SKIPPING deletion`);
      }
    }

    // Remove packages in use from deletion list
    const safeToDelete = packagesToDelete.filter(pkg => 
      !packagesInUse.some(inUse => inUse.id === pkg.id)
    );

    if (safeToDelete.length === 0) {
      console.log('\n⚠️  No packages can be safely deleted (all are in use)\n');
      process.exit(0);
    }

    if (packagesInUse.length > 0) {
      console.log(`\n⚠️  ${packagesInUse.length} package(s) are in use and will NOT be deleted\n`);
    }

    // Delete the duplicate packages
    console.log('='.repeat(80));
    console.log(`🗑️  Deleting ${safeToDelete.length} duplicate package(s)...`);
    console.log('='.repeat(80));

    let deletedCount = 0;
    let errorCount = 0;

    for (const pkg of safeToDelete) {
      const { error: deleteError } = await supabaseAdmin
        .from('packages')
        .delete()
        .eq('id', pkg.id);

      if (deleteError) {
        console.error(`❌ Error deleting package ${pkg.id}:`, deleteError);
        errorCount++;
      } else {
        console.log(`✅ Deleted package ${pkg.id} (${pkg.name})`);
        deletedCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(80));
    console.log(`Total packages found: ${packages.length}`);
    console.log(`Packages to keep: ${packagesToKeep.length}`);
    console.log(`Packages to delete: ${packagesToDelete.length}`);
    console.log(`Packages in use (skipped): ${packagesInUse.length}`);
    console.log(`Successfully deleted: ${deletedCount}`);
    console.log(`Errors: ${errorCount}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Get psychologist ID from command line argument or use Liana's ID
const psychologistId = process.argv[2] || 'cf792edb-a1b1-4eec-8bb7-b9ae5364975a';
deleteDuplicatePackages(psychologistId);

