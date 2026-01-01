require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { supabaseAdmin } = require('../config/supabase');
const { hashPassword } = require('../utils/helpers');

/**
 * Create Finance User
 * Creates a finance user with login credentials
 * Usage: node scripts/createFinanceUser.js
 */

async function createFinanceUser() {
  try {
    const financeEmail = process.env.FINANCE_EMAIL || 'finance@littlecare.com';
    const financePassword = process.env.FINANCE_PASSWORD || 'Finance@123';
    const financeFirstName = process.env.FINANCE_FIRST_NAME || 'Finance';
    const financeLastName = process.env.FINANCE_LAST_NAME || 'Manager';

    console.log('🔐 Creating Finance User...\n');

    // Check if finance user already exists
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, email, role')
      .eq('email', financeEmail)
      .single();

    if (existingUser && !checkError) {
      if (existingUser.role === 'finance') {
        console.log('✅ Finance user already exists:');
        console.log(`   Email: ${financeEmail}`);
        console.log(`   Role: ${existingUser.role}`);
        console.log(`   ID: ${existingUser.id}`);
        console.log('\n💡 To update password, delete the user first or update manually.');
        return;
      } else {
        console.log('⚠️  User exists but with different role:', existingUser.role);
        console.log('   Please update the role manually or use a different email.');
        return;
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(financePassword);

    // Create finance user
    const { data: newUser, error: createError } = await supabaseAdmin
      .from('users')
      .insert([{
        email: financeEmail,
        password_hash: hashedPassword,
        role: 'finance',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id, email, role, created_at')
      .single();

    if (createError) {
      console.error('❌ Error creating finance user:', createError);
      if (createError.code === '23505') {
        console.error('   User with this email already exists.');
      }
      throw createError;
    }

    console.log('✅ Finance user created successfully!\n');
    console.log('📋 Login Credentials:');
    console.log('─'.repeat(50));
    console.log(`Email: ${financeEmail}`);
    console.log(`Password: ${financePassword}`);
    console.log(`Role: finance`);
    console.log(`User ID: ${newUser.id}`);
    console.log('─'.repeat(50));
    console.log('\n⚠️  IMPORTANT: Save these credentials securely!');
    console.log('   Change the password after first login.');
    console.log('\n💡 To use custom credentials, set environment variables:');
    console.log('   FINANCE_EMAIL=your-email@example.com');
    console.log('   FINANCE_PASSWORD=YourSecurePassword123');
    console.log('   FINANCE_FIRST_NAME=Finance');
    console.log('   FINANCE_LAST_NAME=Manager');

  } catch (error) {
    console.error('❌ Failed to create finance user:', error.message);
    process.exit(1);
  }
}

// Run the script
createFinanceUser();

