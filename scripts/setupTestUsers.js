/**
 * Setup Test Users for Security Testing
 * 
 * Creates dummy users for different roles and retrieves their authentication tokens
 */

// Load environment variables
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const { hashPassword } = require('../utils/helpers');
const axios = require('axios');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5001';
const API_BASE = `${BASE_URL}/api`;

// Test password that meets policy requirements
const TEST_PASSWORD = 'TestPassword123!@#';

// Test users configuration
const testUsers = {
  client: {
    email: 'testclient@security.test',
    password: TEST_PASSWORD,
    role: 'client',
    profile: {
      first_name: 'Test',
      last_name: 'Client',
      phone_number: '+919876543210',
      child_name: 'Test Child',
      child_age: 8
    }
  },
  psychologist: {
    email: 'testpsychologist@security.test',
    password: TEST_PASSWORD,
    role: 'psychologist',
    profile: {
      first_name: 'Test',
      last_name: 'Psychologist',
      phone: '+919876543211',
      experience_years: 5,
      description: 'Test psychologist for security testing',
      ug_college: 'Test University',
      pg_college: 'Test Graduate School',
      phd_college: null,
      area_of_expertise: []
    }
  },
  admin: {
    email: 'testadmin@security.test',
    password: TEST_PASSWORD,
    role: 'admin',
    profile: {
      first_name: 'Test',
      last_name: 'Admin'
    }
  },
  superadmin: {
    email: 'testsuperadmin@security.test',
    password: TEST_PASSWORD,
    role: 'superadmin',
    profile: {
      first_name: 'Test',
      last_name: 'SuperAdmin'
    }
  }
};

// Cleanup old test users
async function cleanupTestUsers() {
  console.log('🧹 Cleaning up old test users...');
  
  const emails = Object.values(testUsers).map(u => u.email);
  
  for (const email of emails) {
    // Delete from users table (cascades to other tables)
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email);
    
    if (users && users.length > 0) {
      for (const user of users) {
        await supabaseAdmin.from('users').delete().eq('id', user.id);
        console.log(`  ✓ Deleted user: ${email}`);
      }
    }
    
    // Also clean up psychologists table (standalone)
    const { data: psychologists } = await supabaseAdmin
      .from('psychologists')
      .select('id')
      .eq('email', email);
    
    if (psychologists && psychologists.length > 0) {
      for (const psych of psychologists) {
        await supabaseAdmin.from('psychologists').delete().eq('id', psych.id);
        console.log(`  ✓ Deleted psychologist: ${email}`);
      }
    }
  }
}

// Create client user
async function createClient(userConfig) {
  console.log(`\n👤 Creating client user: ${userConfig.email}`);
  
  const hashedPassword = await hashPassword(userConfig.password);
  
  // Create user
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .insert([{
      email: userConfig.email,
      password_hash: hashedPassword,
      role: 'client'
    }])
    .select('id, email, role')
    .single();
  
  if (userError) {
    throw new Error(`Failed to create client user: ${userError.message}`);
  }
  
  // Create client profile
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .insert([{
      user_id: user.id,
      first_name: userConfig.profile.first_name,
      last_name: userConfig.profile.last_name,
      phone_number: userConfig.profile.phone_number,
      child_name: userConfig.profile.child_name,
      child_age: userConfig.profile.child_age
    }])
    .select('id')
    .single();
  
  if (clientError) {
    // Cleanup user if profile creation fails
    await supabaseAdmin.from('users').delete().eq('id', user.id);
    throw new Error(`Failed to create client profile: ${clientError.message}`);
  }
  
  console.log(`  ✓ Client created: ${user.id}`);
  return user;
}

// Create psychologist user
async function createPsychologist(userConfig) {
  console.log(`\n👨‍⚕️ Creating psychologist user: ${userConfig.email}`);
  
  const hashedPassword = await hashPassword(userConfig.password);
  
  // Create psychologist (standalone table)
  const { data: psychologist, error: psychError } = await supabaseAdmin
    .from('psychologists')
    .insert([{
      email: userConfig.email,
      password_hash: hashedPassword,
      first_name: userConfig.profile.first_name,
      last_name: userConfig.profile.last_name,
      phone: userConfig.profile.phone,
      experience_years: userConfig.profile.experience_years || 0,
      description: userConfig.profile.description || '',
      ug_college: userConfig.profile.ug_college || 'Test University',
      pg_college: userConfig.profile.pg_college || null,
      phd_college: userConfig.profile.phd_college || null,
      area_of_expertise: userConfig.profile.area_of_expertise || []
    }])
    .select('id, email')
    .single();
  
  if (psychError) {
    throw new Error(`Failed to create psychologist: ${psychError.message}`);
  }
  
  console.log(`  ✓ Psychologist created: ${psychologist.id}`);
  return psychologist;
}

// Create admin/superadmin user
async function createAdmin(userConfig) {
  console.log(`\n👑 Creating ${userConfig.role} user: ${userConfig.email}`);
  
  const hashedPassword = await hashPassword(userConfig.password);
  
  // Create user
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .insert([{
      email: userConfig.email,
      password_hash: hashedPassword,
      role: userConfig.role
    }])
    .select('id, email, role')
    .single();
  
  if (userError) {
    throw new Error(`Failed to create ${userConfig.role} user: ${userError.message}`);
  }
  
  console.log(`  ✓ ${userConfig.role} created: ${user.id}`);
  return user;
}

// Check if backend server is running
async function checkServerRunning() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    return true;
  } catch (error) {
    // Try a simple API endpoint
    try {
      await axios.get(`${API_BASE}/auth/login`, { timeout: 3000, validateStatus: () => true });
      return true;
    } catch (e) {
      return false;
    }
  }
}

// Get authentication token by logging in
async function getToken(email, password) {
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      email,
      password
    }, { timeout: 10000 });
    
    if (response.data && response.data.data && response.data.data.token) {
      return response.data.data.token;
    }
    
    throw new Error('Token not found in response');
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      throw new Error(`Cannot connect to backend server at ${BASE_URL}. Please ensure the server is running.`);
    }
    if (error.response) {
      throw new Error(`Login failed: ${error.response.data?.message || error.response.statusText}`);
    }
    throw new Error(`Login failed: ${error.message}`);
  }
}

// Main setup function
async function setupTestUsers() {
  console.log('🚀 Setting up test users for security testing...\n');
  
  try {
    // Check if backend server is running
    console.log(`🔍 Checking if backend server is running at ${BASE_URL}...`);
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      throw new Error(`Backend server is not running at ${BASE_URL}. Please start the server first with 'npm start' or 'node server.js'`);
    }
    console.log('  ✓ Backend server is running\n');
    
    // Cleanup old test users
    await cleanupTestUsers();
    
    // Wait a bit to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const tokens = {};
    
    // Create client user
    const clientUser = await createClient(testUsers.client);
    tokens.client = await getToken(testUsers.client.email, testUsers.client.password);
    console.log(`  ✓ Client token obtained`);
    
    // Create psychologist user
    const psychologistUser = await createPsychologist(testUsers.psychologist);
    tokens.psychologist = await getToken(testUsers.psychologist.email, testUsers.psychologist.password);
    console.log(`  ✓ Psychologist token obtained`);
    
    // Create admin user
    const adminUser = await createAdmin(testUsers.admin);
    tokens.admin = await getToken(testUsers.admin.email, testUsers.admin.password);
    console.log(`  ✓ Admin token obtained`);
    
    // Create superadmin user
    const superadminUser = await createAdmin(testUsers.superadmin);
    tokens.superadmin = await getToken(testUsers.superadmin.email, testUsers.superadmin.password);
    console.log(`  ✓ Superadmin token obtained`);
    
    console.log('\n✅ All test users created successfully!\n');
    
    // Save tokens to file for use by test suite
    const fs = require('fs');
    const path = require('path');
    const tokensFile = path.join(__dirname, 'testTokens.json');
    
    fs.writeFileSync(tokensFile, JSON.stringify({
      tokens,
      users: {
        client: { id: clientUser.id, email: testUsers.client.email },
        psychologist: { id: psychologistUser.id, email: testUsers.psychologist.email },
        admin: { id: adminUser.id, email: testUsers.admin.email },
        superadmin: { id: superadminUser.id, email: testUsers.superadmin.email }
      },
      created_at: new Date().toISOString()
    }, null, 2));
    
    console.log(`📝 Tokens saved to: ${tokensFile}\n`);
    
    return { tokens, users: { client: clientUser, psychologist: psychologistUser, admin: adminUser, superadmin: superadminUser } };
  } catch (error) {
    console.error('\n❌ Error setting up test users:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  setupTestUsers()
    .then(() => {
      console.log('✅ Setup complete!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupTestUsers, testUsers };

