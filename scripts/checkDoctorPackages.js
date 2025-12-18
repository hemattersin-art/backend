require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function checkDoctorPackages(psychologistId) {
  try {
    // Get psychologist info
    const { data: psychologist, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .eq('id', psychologistId)
      .single();

    if (psychError || !psychologist) {
      console.error('❌ Error fetching psychologist:', psychError);
      process.exit(1);
    }

    console.log(`\n🔍 Checking packages for: ${psychologist.first_name} ${psychologist.last_name}`);
    console.log(`   ID: ${psychologist.id}`);
    console.log(`   Email: ${psychologist.email}\n`);

    // Get all packages for this psychologist
    const { data: packages, error: packagesError } = await supabaseAdmin
      .from('packages')
      .select('id, name, session_count, price, description, package_type, discount_percentage, created_at')
      .eq('psychologist_id', psychologist.id)
      .order('session_count', { ascending: true });

    if (packagesError) {
      console.error('❌ Error fetching packages:', packagesError);
      process.exit(1);
    }

    console.log('='.repeat(80));
    console.log('📦 PACKAGES:');
    console.log('='.repeat(80));

    if (!packages || packages.length === 0) {
      console.log('⚠️  No packages found for this psychologist\n');
      
      console.log('='.repeat(80));
      console.log('✅ REQUIRED PACKAGES CHECK:');
      console.log('='.repeat(80));
      console.log('3-session package: ❌ Missing');
      console.log('6-session package: ❌ Missing');
      console.log('\n❌ Missing: 3-session, 6-session');
      
      console.log('\n' + '='.repeat(80));
      console.log('📄 JSON output:');
      console.log('='.repeat(80));
      console.log(JSON.stringify({
        psychologist: {
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`,
          email: psychologist.email
        },
        packages: [],
        requiredPackages: {
          has3Session: false,
          has6Session: false
        }
      }, null, 2));
    } else {
      console.log(`Total packages: ${packages.length}\n`);
      
      packages.forEach((pkg, index) => {
        console.log(`${index + 1}. ${pkg.name || `Package of ${pkg.session_count} Sessions`}`);
        console.log(`   Session Count: ${pkg.session_count}`);
        console.log(`   Price: $${pkg.price}`);
        if (pkg.discount_percentage > 0) {
          console.log(`   Discount: ${pkg.discount_percentage}%`);
        }
        console.log(`   Description: ${pkg.description || 'N/A'}`);
        console.log(`   Package Type: ${pkg.package_type || 'N/A'}`);
        console.log(`   Package ID: ${pkg.id}`);
        console.log(`   Created: ${new Date(pkg.created_at).toLocaleString()}`);
        console.log('');
      });

      // Check for required packages
      const sessionCounts = packages.map(p => p.session_count);
      const has3Session = sessionCounts.includes(3);
      const has6Session = sessionCounts.includes(6);

      console.log('='.repeat(80));
      console.log('✅ REQUIRED PACKAGES CHECK:');
      console.log('='.repeat(80));
      console.log(`3-session package: ${has3Session ? '✅ Present' : '❌ Missing'}`);
      console.log(`6-session package: ${has6Session ? '✅ Present' : '❌ Missing'}`);
      
      if (has3Session && has6Session) {
        console.log('\n✅ All required packages are present!');
      } else {
        const missing = [];
        if (!has3Session) missing.push('3-session');
        if (!has6Session) missing.push('6-session');
        console.log(`\n❌ Missing: ${missing.join(', ')}`);
      }

      console.log('\n' + '='.repeat(80));
      console.log('📄 JSON output:');
      console.log('='.repeat(80));
      console.log(JSON.stringify({
        psychologist: {
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`,
          email: psychologist.email
        },
        packages: packages || [],
        requiredPackages: {
          has3Session: has3Session,
          has6Session: has6Session
        }
      }, null, 2));
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Get psychologist ID from command line argument or use Liana's ID
const psychologistId = process.argv[2] || 'cf792edb-a1b1-4eec-8bb7-b9ae5364975a';
checkDoctorPackages(psychologistId);

