/**
 * Master script to setup test users and run security tests
 * 
 * Usage: node backend/scripts/runSecurityTestsWithUsers.js
 */

const { setupTestUsers } = require('./setupTestUsers');
const { runAllTests } = require('./securityTestSuite');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

async function main() {
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.cyan}SECURITY TEST SUITE - WITH TEST USERS${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
  
  try {
    // Step 1: Setup test users and get tokens
    console.log(`${colors.cyan}Step 1: Setting up test users...${colors.reset}\n`);
    await setupTestUsers();
    
    // Wait a moment for tokens to be saved
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 2: Run security tests
    console.log(`\n${colors.cyan}Step 2: Running security tests...${colors.reset}\n`);
    await runAllTests();
    
    console.log(`\n${colors.green}✅ All tests completed!${colors.reset}\n`);
  } catch (error) {
    console.error(`\n${colors.red}❌ Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };

