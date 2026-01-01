require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

/**
 * Test script to check total packages for Dr. Liana Sammer
 * and detect any duplicate packages
 */
async function checkLianaSammerPackages() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 CHECKING PACKAGES FOR DR. LIANA SAMMER');
    console.log('='.repeat(80) + '\n');

    // Step 1: Find Liana Sammer by name
    console.log('📋 Step 1: Finding Dr. Liana Sammer...');
    const { data: psychologists, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .or('first_name.ilike.%liana%,last_name.ilike.%sammer%');

    if (psychError) {
      console.error('❌ Error fetching psychologists:', psychError);
      process.exit(1);
    }

    if (!psychologists || psychologists.length === 0) {
      console.error('❌ No psychologist found with name containing "Liana" or "Sammer"');
      process.exit(1);
    }

    // Filter for exact match or closest match
    let lianaSammer = psychologists.find(
      p => 
        (p.first_name?.toLowerCase().includes('liana') && p.last_name?.toLowerCase().includes('sammer'))
    );

    // If no exact match, use first result
    if (!lianaSammer && psychologists.length > 0) {
      lianaSammer = psychologists[0];
      console.log('⚠️  No exact match found, using closest match:');
    }

    console.log(`✅ Found: ${lianaSammer.first_name || ''} ${lianaSammer.last_name || ''}`);
    console.log(`   ID: ${lianaSammer.id}`);
    console.log(`   Email: ${lianaSammer.email || 'N/A'}\n`);

    // Step 2: Get all packages for this psychologist
    console.log('📦 Step 2: Fetching all packages...');
    const { data: packages, error: packagesError } = await supabaseAdmin
      .from('packages')
      .select('id, name, session_count, price, description, package_type, discount_percentage, created_at, updated_at')
      .eq('psychologist_id', lianaSammer.id)
      .order('created_at', { ascending: false });

    if (packagesError) {
      console.error('❌ Error fetching packages:', packagesError);
      process.exit(1);
    }

    console.log(`✅ Found ${packages.length} total package(s)\n`);

    // Step 3: Display all packages
    console.log('='.repeat(80));
    console.log('📦 ALL PACKAGES:');
    console.log('='.repeat(80));
    
    if (packages.length === 0) {
      console.log('⚠️  No packages found for this psychologist\n');
    } else {
      packages.forEach((pkg, index) => {
        console.log(`\n${index + 1}. ${pkg.name || `Package of ${pkg.session_count} Sessions`}`);
        console.log(`   Package ID: ${pkg.id}`);
        console.log(`   Session Count: ${pkg.session_count}`);
        console.log(`   Price: ₹${pkg.price || 0}`);
        if (pkg.discount_percentage && pkg.discount_percentage > 0) {
          console.log(`   Discount: ${pkg.discount_percentage}%`);
        }
        console.log(`   Package Type: ${pkg.package_type || 'N/A'}`);
        console.log(`   Description: ${pkg.description || 'N/A'}`);
        console.log(`   Created: ${new Date(pkg.created_at).toLocaleString()}`);
        if (pkg.updated_at) {
          console.log(`   Updated: ${new Date(pkg.updated_at).toLocaleString()}`);
        }
      });
    }

    // Step 4: Check for duplicates
    console.log('\n' + '='.repeat(80));
    console.log('🔍 DUPLICATE DETECTION:');
    console.log('='.repeat(80));

    if (packages.length === 0) {
      console.log('⚠️  No packages to check for duplicates\n');
    } else {
      // Group packages by key attributes to find duplicates
      const duplicateGroups = {};
      const duplicateKeys = [];

      packages.forEach((pkg, index) => {
        // Create a key based on session_count, price, and package_type
        const key = `${pkg.session_count}_${pkg.price}_${pkg.package_type || 'null'}`;
        
        if (!duplicateGroups[key]) {
          duplicateGroups[key] = [];
        }
        duplicateGroups[key].push({
          index: index + 1,
          id: pkg.id,
          name: pkg.name,
          session_count: pkg.session_count,
          price: pkg.price,
          package_type: pkg.package_type,
          created_at: pkg.created_at
        });

        // If more than one package has the same key, it's a potential duplicate
        if (duplicateGroups[key].length > 1 && !duplicateKeys.includes(key)) {
          duplicateKeys.push(key);
        }
      });

      if (duplicateKeys.length === 0) {
        console.log('✅ No duplicates found! All packages are unique.\n');
      } else {
        console.log(`⚠️  Found ${duplicateKeys.length} potential duplicate group(s):\n`);
        
        duplicateKeys.forEach((key, groupIndex) => {
          const group = duplicateGroups[key];
          const [sessionCount, price, packageType] = key.split('_');
          
          console.log(`\n📌 Duplicate Group ${groupIndex + 1}:`);
          console.log(`   Criteria: ${sessionCount} sessions, ₹${price}, Type: ${packageType === 'null' ? 'N/A' : packageType}`);
          console.log(`   Count: ${group.length} package(s)\n`);
          
          group.forEach((pkg, pkgIndex) => {
            console.log(`   ${pkgIndex + 1}. Package #${pkg.index}`);
            console.log(`      ID: ${pkg.id}`);
            console.log(`      Name: ${pkg.name || 'N/A'}`);
            console.log(`      Created: ${new Date(pkg.created_at).toLocaleString()}`);
          });
        });
      }

      // Additional check: exact duplicates (same ID appearing multiple times - shouldn't happen)
      const packageIds = packages.map(p => p.id);
      const uniqueIds = new Set(packageIds);
      if (packageIds.length !== uniqueIds.size) {
        console.log('\n⚠️  WARNING: Found duplicate package IDs! This should not happen.');
        const idCounts = {};
        packageIds.forEach(id => {
          idCounts[id] = (idCounts[id] || 0) + 1;
        });
        Object.entries(idCounts).forEach(([id, count]) => {
          if (count > 1) {
            console.log(`   Package ID ${id} appears ${count} times`);
          }
        });
      }
    }

    // Step 5: Summary statistics
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY STATISTICS:');
    console.log('='.repeat(80));
    
    if (packages.length > 0) {
      const sessionCounts = packages.map(p => p.session_count).filter(Boolean);
      const prices = packages.map(p => p.price).filter(Boolean);
      const packageTypes = packages.map(p => p.package_type).filter(Boolean);
      
      console.log(`Total Packages: ${packages.length}`);
      console.log(`Unique Session Counts: ${[...new Set(sessionCounts)].sort((a, b) => a - b).join(', ')}`);
      console.log(`Price Range: ₹${Math.min(...prices)} - ₹${Math.max(...prices)}`);
      console.log(`Package Types: ${[...new Set(packageTypes)].join(', ') || 'N/A'}`);
      
      // Count by session_count
      const countBySessions = {};
      packages.forEach(pkg => {
        const count = pkg.session_count || 0;
        countBySessions[count] = (countBySessions[count] || 0) + 1;
      });
      
      console.log('\nPackages by Session Count:');
      Object.entries(countBySessions)
        .sort(([a], [b]) => Number(a) - Number(b))
        .forEach(([sessions, count]) => {
          console.log(`   ${sessions} sessions: ${count} package(s)`);
        });
    }

    // Step 6: JSON output for programmatic use
    console.log('\n' + '='.repeat(80));
    console.log('📄 JSON OUTPUT:');
    console.log('='.repeat(80));
    
    const duplicateGroups = {};
    packages.forEach(pkg => {
      const key = `${pkg.session_count}_${pkg.price}_${pkg.package_type || 'null'}`;
      if (!duplicateGroups[key]) {
        duplicateGroups[key] = [];
      }
      duplicateGroups[key].push({
        id: pkg.id,
        name: pkg.name,
        session_count: pkg.session_count,
        price: pkg.price,
        package_type: pkg.package_type,
        created_at: pkg.created_at
      });
    });

    const duplicates = Object.entries(duplicateGroups)
      .filter(([key, group]) => group.length > 1)
      .map(([key, group]) => ({
        criteria: key,
        count: group.length,
        packages: group
      }));

    const output = {
      psychologist: {
        id: lianaSammer.id,
        name: `${lianaSammer.first_name || ''} ${lianaSammer.last_name || ''}`.trim(),
        email: lianaSammer.email
      },
      totalPackages: packages.length,
      packages: packages.map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        session_count: pkg.session_count,
        price: pkg.price,
        package_type: pkg.package_type,
        discount_percentage: pkg.discount_percentage,
        created_at: pkg.created_at,
        updated_at: pkg.updated_at
      })),
      duplicates: duplicates,
      hasDuplicates: duplicates.length > 0,
      summary: {
        uniqueSessionCounts: [...new Set(packages.map(p => p.session_count).filter(Boolean))].sort((a, b) => a - b),
        priceRange: packages.length > 0 ? {
          min: Math.min(...packages.map(p => p.price).filter(Boolean)),
          max: Math.max(...packages.map(p => p.price).filter(Boolean))
        } : null,
        packageTypes: [...new Set(packages.map(p => p.package_type).filter(Boolean))]
      }
    };

    console.log(JSON.stringify(output, null, 2));
    console.log('\n' + '='.repeat(80));
    console.log('✅ Check completed successfully!');
    console.log('='.repeat(80) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
checkLianaSammerPackages();

