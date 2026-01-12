require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

/**
 * Script to check Ambili's psychologist details and phone number
 */
async function checkAmbiliPhone() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 CHECKING AMBILI PSYCHOLOGIST DETAILS');
    console.log('='.repeat(80) + '\n');

    // Step 1: Find Ambili by name
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

    // Filter for exact match or closest match
    let ambili = psychologists.find(
      p => 
        (p.first_name?.toLowerCase().includes('ambili') || p.last_name?.toLowerCase().includes('ambili'))
    );

    // If no exact match, use first result
    if (!ambili && psychologists.length > 0) {
      ambili = psychologists[0];
      console.log('⚠️  No exact match found, using closest match:');
    }

    console.log('\n✅ PSYCHOLOGIST DETAILS:');
    console.log('='.repeat(80));
    console.log(`   Full Name: ${ambili.first_name || ''} ${ambili.last_name || ''}`);
    console.log(`   ID: ${ambili.id}`);
    console.log(`   Email: ${ambili.email || 'N/A'}`);
    console.log(`   Phone: ${ambili.phone || 'N/A'}`);
    console.log(`   Phone Length: ${ambili.phone ? ambili.phone.length : 0} characters`);
    
    if (ambili.phone) {
      // Check if it's a valid Indian number
      const phone = ambili.phone.trim();
      if (phone.startsWith('+91')) {
        const digitsAfterCountryCode = phone.substring(3);
        console.log(`   Digits after +91: ${digitsAfterCountryCode.length}`);
        if (digitsAfterCountryCode.length !== 10) {
          console.log(`   ⚠️  WARNING: Invalid Indian phone number format! Expected 10 digits after +91, got ${digitsAfterCountryCode.length}`);
          console.log(`   Current number: ${phone}`);
          console.log(`   Should be: +91${digitsAfterCountryCode.substring(0, 10)} (if first 10 digits are correct)`);
        } else {
          console.log(`   ✅ Phone number format is valid (10 digits after +91)`);
        }
      } else {
        console.log(`   ⚠️  Phone number doesn't start with +91`);
      }
    }
    
    console.log(`   Active: ${ambili.active !== undefined ? ambili.active : 'N/A'}`);
    console.log(`   Created At: ${ambili.created_at || 'N/A'}`);
    console.log(`   Updated At: ${ambili.updated_at || 'N/A'}`);
    console.log('='.repeat(80) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
checkAmbiliPhone();
