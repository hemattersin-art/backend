/**
 * Test script to directly test package price update
 * Run with: node scripts/testPackageUpdate.js
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function testPackageUpdate() {
  const psychologistId = 'cf792edb-a1b1-4eec-8bb7-b9ae5364975a'; // Liana Sameer
  const newPrice = 999;

  console.log('🧪 Testing Package Update');
  console.log('Psychologist ID:', psychologistId);
  console.log('New Price:', newPrice);
  console.log('');

  try {
    // Step 0: Get all packages for this psychologist to see the actual IDs
    console.log('📦 Step 0: Fetching all packages for psychologist...');
    const { data: allPackages, error: listError } = await supabaseAdmin
      .from('packages')
      .select('*')
      .eq('psychologist_id', psychologistId)
      .order('session_count', { ascending: true });

    if (listError) {
      console.error('❌ Error fetching packages:', listError);
      return;
    }

    console.log('✅ Found packages:');
    allPackages.forEach((pkg, index) => {
      console.log(`   ${index + 1}. ID: ${pkg.id} (type: ${typeof pkg.id}), Name: ${pkg.name}, Price: ₹${pkg.price}, Sessions: ${pkg.session_count}`);
    });
    console.log('');

    // Find the "Package of 3 Sessions"
    const targetPackage = allPackages.find(pkg => pkg.session_count === 3);
    if (!targetPackage) {
      console.error('❌ Package of 3 Sessions not found');
      return;
    }

    const packageId = targetPackage.id;
    console.log(`📦 Target package: ID=${packageId}, Current price=₹${targetPackage.price}`);
    console.log('');

    // Step 1: Get current package
    console.log('📦 Step 1: Fetching current package...');
    const { data: currentPackage, error: fetchError } = await supabaseAdmin
      .from('packages')
      .select('*')
      .eq('id', packageId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching package:', fetchError);
      return;
    }

    if (!currentPackage) {
      console.error('❌ Package not found');
      return;
    }

    console.log('✅ Current package:', {
      id: currentPackage.id,
      name: currentPackage.name,
      price: currentPackage.price,
      session_count: currentPackage.session_count
    });
    console.log('');

    // Step 2: Update package price
    console.log('📦 Step 2: Updating package price...');
    const { error: updateError } = await supabaseAdmin
      .from('packages')
      .update({ 
        price: newPrice
      })
      .eq('id', packageId);

    if (updateError) {
      console.error('❌ Update error:', updateError);
      console.error('❌ Error details:', JSON.stringify(updateError, null, 2));
      return;
    }

    console.log('✅ Update query executed successfully');
    console.log('');

    // Step 3: Verify the update
    console.log('📦 Step 3: Verifying update...');
    const { data: updatedPackage, error: verifyError } = await supabaseAdmin
      .from('packages')
      .select('*')
      .eq('id', packageId)
      .eq('psychologist_id', psychologistId)
      .single();

    if (verifyError) {
      console.error('❌ Verification error:', verifyError);
      return;
    }

    if (!updatedPackage) {
      console.error('❌ Package not found after update');
      return;
    }

    console.log('✅ Updated package:', {
      id: updatedPackage.id,
      name: updatedPackage.name,
      price: updatedPackage.price,
      session_count: updatedPackage.session_count
    });
    console.log('');

    // Step 4: Check if price actually changed
    if (updatedPackage.price === newPrice) {
      console.log('✅✅✅ SUCCESS: Price updated correctly!');
      console.log(`   Old price: ₹${currentPackage.price}`);
      console.log(`   New price: ₹${updatedPackage.price}`);
    } else {
      console.error('❌❌❌ FAILURE: Price did not update!');
      console.error(`   Expected: ₹${newPrice}`);
      console.error(`   Got: ₹${updatedPackage.price}`);
    }

  } catch (error) {
    console.error('❌ Exception:', error);
    console.error('Stack:', error.stack);
  }

  process.exit(0);
}

testPackageUpdate();

