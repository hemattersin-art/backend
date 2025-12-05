/**
 * One-time script to update the default assessment psychologist password
 * Run this with: node backend/scripts/updateAssessmentPsychologistPassword.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { supabaseAdmin } = require('../config/supabase');
const { hashPassword } = require('../utils/helpers');

const DEFAULT_ASSESSMENT_DOCTOR_EMAIL = process.env.FREE_ASSESSMENT_PSYCHOLOGIST_EMAIL || 'koottfordeveloper@gmail.com';
const DEFAULT_PASSWORD = process.env.FREE_ASSESSMENT_PSYCHOLOGIST_PASSWORD || 'koott@123';

async function updatePassword() {
  try {
    console.log('🔍 Looking for assessment psychologist:', DEFAULT_ASSESSMENT_DOCTOR_EMAIL);
    
    // Find the psychologist
    const { data: psychologist, error: findError } = await supabaseAdmin
      .from('psychologists')
      .select('id, email, first_name, last_name')
      .eq('email', DEFAULT_ASSESSMENT_DOCTOR_EMAIL)
      .single();

    if (findError || !psychologist) {
      console.error('❌ Assessment psychologist not found:', findError?.message || 'Not found');
      console.log('ℹ️ The account will be created automatically on the next free assessment booking.');
      process.exit(1);
    }

    console.log('✅ Found psychologist:', {
      id: psychologist.id,
      email: psychologist.email,
      name: `${psychologist.first_name} ${psychologist.last_name}`
    });

    // Hash the new password
    console.log('🔐 Hashing password...');
    const passwordHash = await hashPassword(DEFAULT_PASSWORD);

    // Update the password
    console.log('🔄 Updating password...');
    const { error: updateError } = await supabaseAdmin
      .from('psychologists')
      .update({ password_hash: passwordHash })
      .eq('id', psychologist.id);

    if (updateError) {
      console.error('❌ Failed to update password:', updateError);
      process.exit(1);
    }

    console.log('✅ Password updated successfully!');
    console.log('📧 Email:', DEFAULT_ASSESSMENT_DOCTOR_EMAIL);
    console.log('🔑 Password:', DEFAULT_PASSWORD);
    console.log('ℹ️ You can now log in with these credentials.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updatePassword();

