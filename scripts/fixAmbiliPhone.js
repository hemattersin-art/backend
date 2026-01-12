require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

/**
 * Script to fix Ambili's phone number by removing extra digits
 */
async function fixAmbiliPhone() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔧 FIXING AMBILI PHONE NUMBER');
    console.log('='.repeat(80) + '\n');

    // Step 1: Find Ambili
    console.log('📋 Step 1: Finding Ambili...');
    const { data: psychologists, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('*')
      .or('first_name.ilike.%ambili%,last_name.ilike.%ambili%');

    if (psychError) {
      console.error('❌ Error fetching psychologists:', psychError);
      process.exit(1);
    }

    if (!psychologists || psychologists.length === 0) {
      console.error('❌ No psychologist found with name containing "Ambili"');
      process.exit(1);
    }

    const ambili = psychologists.find(
      p => 
        (p.first_name?.toLowerCase().includes('ambili') || p.last_name?.toLowerCase().includes('ambili'))
    ) || psychologists[0];

    console.log(`✅ Found: ${ambili.first_name || ''} ${ambili.last_name || ''}`);
    console.log(`   Current Phone: ${ambili.phone || 'N/A'}\n`);

    if (!ambili.phone || !ambili.phone.startsWith('+91')) {
      console.log('⚠️  Phone number is not in the expected format. Cannot auto-fix.');
      process.exit(1);
    }

    // Extract digits after +91
    const digitsAfterCountryCode = ambili.phone.substring(3);
    
    if (digitsAfterCountryCode.length === 12) {
      // Remove last 2 digits to get 10 digits
      const correctedPhone = '+91' + digitsAfterCountryCode.substring(0, 10);
      
      console.log('📋 Step 2: Updating phone number...');
      console.log(`   Old: ${ambili.phone}`);
      console.log(`   New: ${correctedPhone}\n`);

      // Update the phone number
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('psychologists')
        .update({ phone: correctedPhone })
        .eq('id', ambili.id)
        .select();

      if (updateError) {
        console.error('❌ Error updating phone number:', updateError);
        process.exit(1);
      }

      console.log('✅ Phone number updated successfully!');
      console.log(`   Updated record:`, updated[0]);
      console.log('\n' + '='.repeat(80) + '\n');
    } else if (digitsAfterCountryCode.length === 10) {
      console.log('✅ Phone number is already in correct format (10 digits after +91)');
    } else {
      console.log(`⚠️  Phone number has ${digitsAfterCountryCode.length} digits after +91. Expected 10.`);
      console.log('   Manual fix required.');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
fixAmbiliPhone();
