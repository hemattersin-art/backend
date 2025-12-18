require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function checkMissingPackages() {
  try {
    console.log('🔍 Checking which doctors are missing 3-session and 6-session packages...\n');

    // Get all psychologists
    const { data: psychologists, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('id, first_name, last_name, email')
      .order('first_name');

    if (psychError) {
      console.error('❌ Error fetching psychologists:', psychError);
      process.exit(1);
    }

    if (!psychologists || psychologists.length === 0) {
      console.log('⚠️  No psychologists found in database');
      process.exit(0);
    }

    console.log(`📊 Found ${psychologists.length} psychologists\n`);

    const missingPackages = [];
    const allGood = [];

    // Check each psychologist
    for (const psychologist of psychologists) {
      const { data: packages, error: packagesError } = await supabaseAdmin
        .from('packages')
        .select('id, session_count, name, price')
        .eq('psychologist_id', psychologist.id)
        .in('session_count', [3, 6]);

      if (packagesError) {
        console.error(`❌ Error fetching packages for ${psychologist.first_name} ${psychologist.last_name}:`, packagesError);
        continue;
      }

      const sessionCounts = (packages || []).map(p => p.session_count);
      const has3Session = sessionCounts.includes(3);
      const has6Session = sessionCounts.includes(6);

      const missing = [];
      if (!has3Session) missing.push('3-session');
      if (!has6Session) missing.push('6-session');

      if (missing.length > 0) {
        missingPackages.push({
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`,
          email: psychologist.email,
          missing: missing,
          existingPackages: packages || []
        });
      } else {
        allGood.push({
          id: psychologist.id,
          name: `${psychologist.first_name} ${psychologist.last_name}`
        });
      }
    }

    // Print results
    console.log('='.repeat(80));
    console.log('📋 SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Doctors with all required packages: ${allGood.length}`);
    console.log(`❌ Doctors missing packages: ${missingPackages.length}\n`);

    if (missingPackages.length > 0) {
      console.log('='.repeat(80));
      console.log('❌ DOCTORS MISSING PACKAGES:');
      console.log('='.repeat(80));
      missingPackages.forEach((doc, index) => {
        console.log(`\n${index + 1}. ${doc.name} (ID: ${doc.id})`);
        console.log(`   Email: ${doc.email}`);
        console.log(`   Missing: ${doc.missing.join(', ')}`);
        if (doc.existingPackages.length > 0) {
          console.log(`   Existing packages:`);
          doc.existingPackages.forEach(pkg => {
            console.log(`     - ${pkg.session_count}-session: ${pkg.name} ($${pkg.price})`);
          });
        } else {
          console.log(`   No 3 or 6 session packages found`);
        }
      });
    }

    if (allGood.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('✅ DOCTORS WITH ALL REQUIRED PACKAGES:');
      console.log('='.repeat(80));
      allGood.forEach((doc, index) => {
        console.log(`${index + 1}. ${doc.name} (ID: ${doc.id})`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL COUNT:');
    console.log('='.repeat(80));
    console.log(`Total psychologists: ${psychologists.length}`);
    console.log(`✅ Complete: ${allGood.length}`);
    console.log(`❌ Missing packages: ${missingPackages.length}`);

    // Export JSON for programmatic use
    if (missingPackages.length > 0) {
      console.log('\n📄 JSON output (for programmatic use):');
      console.log(JSON.stringify({
        total: psychologists.length,
        complete: allGood.length,
        missing: missingPackages.length,
        missingDoctors: missingPackages
      }, null, 2));
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

checkMissingPackages();

