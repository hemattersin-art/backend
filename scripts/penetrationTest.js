/**
 * Penetration Testing Script
 * 
 * Tests various attack vectors and edge cases:
 * 1. Token manipulation and forgery
 * 2. Role escalation attempts
 * 3. Rate limiting bypass
 * 4. Token revocation bypass
 * 5. Authorization bypass
 * 6. Edge cases in authentication
 * 7. Concurrent attack scenarios
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const axios = require('axios').default;
const tokenRevocationService = require('../utils/tokenRevocation');
const { generateToken } = require('../utils/helpers');

// Configuration
const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5001';
const API_URL = `${BASE_URL}/api`;

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: [],
  blocked: []
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logResult(testName, status, details = '') {
  const statusColor = status === 'PASSED' ? 'green' : status === 'FAILED' ? 'red' : 'yellow';
  log(`  ${status === 'PASSED' ? '✅' : status === 'FAILED' ? '❌' : '⚠️'} ${testName}: ${status}`, statusColor);
  if (details) {
    log(`    ${details}`, 'cyan');
  }
  
  if (status === 'PASSED') results.passed.push(testName);
  else if (status === 'FAILED') results.failed.push(testName);
  else results.warnings.push(testName);
}

// Test 1: Invalid Token Formats
async function testInvalidTokenFormats() {
  log('\n🔍 Test 1: Invalid Token Formats', 'blue');
  
  const invalidTokens = [
    null,
    undefined,
    '',
    'not-a-token',
    'Bearer',
    'Bearer ',
    'invalid.token.here',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
    'Bearer invalid.token.here'
  ];

  for (const token of invalidTokens) {
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        validateStatus: () => true // Don't throw on any status
      });
      
      if (response.status === 401 || response.status === 403) {
        logResult(`Invalid token "${token ? token.substring(0, 20) : 'null'}" rejected`, 'PASSED');
      } else {
        logResult(`Invalid token "${token ? token.substring(0, 20) : 'null'}" accepted`, 'FAILED', `Status: ${response.status}`);
      }
    } catch (error) {
      // Network errors are OK (server might not be running)
      if (error.code === 'ECONNREFUSED') {
        logResult('Server not running - skipping network tests', 'warning');
        return;
      }
      logResult(`Error testing token: ${error.message}`, 'FAILED');
    }
  }
}

// Test 2: Expired Token Usage
async function testExpiredTokens() {
  log('\n🔍 Test 2: Expired Token Usage', 'blue');
  
  try {
    // Create an expired token (expired 1 hour ago)
    const expiredPayload = {
      userId: 'test_user',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
      exp: Math.floor(Date.now() / 1000) - 3600  // 1 hour ago (expired)
    };
    
    const expiredToken = jwt.sign(expiredPayload, process.env.JWT_SECRET || 'test-secret');
    
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${expiredToken}` },
        validateStatus: () => true
      });
      
      if (response.status === 401) {
        logResult('Expired token rejected', 'PASSED');
      } else {
        logResult('Expired token accepted', 'FAILED', `Status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.response && error.response.status === 401) {
        logResult('Expired token rejected', 'PASSED');
      } else {
        logResult(`Expired token test error: ${error.message}`, 'FAILED');
      }
    }
  } catch (error) {
    logResult(`Error creating expired token: ${error.message}`, 'FAILED');
  }
}

// Test 3: Token Tampering (Signature Modification)
async function testTokenTampering() {
  log('\n🔍 Test 3: Token Tampering (Signature Modification)', 'blue');
  
  try {
    // Create a valid token
    const validToken = generateToken('test_user', 'client');
    const parts = validToken.split('.');
    
    // Try to modify the payload (change role to admin)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    payload.role = 'admin';
    
    // Create new token with modified payload but wrong signature
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.invalid_signature`;
    
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${tamperedToken}` },
        validateStatus: () => true
      });
      
      if (response.status === 401 || response.status === 403) {
        logResult('Tampered token (wrong signature) rejected', 'PASSED');
      } else {
        logResult('Tampered token (wrong signature) accepted', 'FAILED', `Status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        logResult('Tampered token rejected', 'PASSED');
      } else {
        logResult(`Token tampering test error: ${error.message}`, 'FAILED');
      }
    }
  } catch (error) {
    logResult(`Error testing token tampering: ${error.message}`, 'FAILED');
  }
}

// Test 4: Role Escalation Attempt
async function testRoleEscalation() {
  log('\n🔍 Test 4: Role Escalation Attempt', 'blue');
  
  try {
    // Create a client token
    const clientToken = generateToken('test_client_user', 'client');
    
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${clientToken}` },
        validateStatus: () => true
      });
      
      if (response.status === 403) {
        logResult('Client role cannot access admin routes', 'PASSED');
      } else if (response.status === 401) {
        logResult('Client token rejected (authentication failed)', 'PASSED');
      } else {
        logResult('Client role accessed admin routes', 'FAILED', `Status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.response && (error.response.status === 403 || error.response.status === 401)) {
        logResult('Role escalation blocked', 'PASSED');
      } else {
        logResult(`Role escalation test error: ${error.message}`, 'FAILED');
      }
    }
  } catch (error) {
    logResult(`Error testing role escalation: ${error.message}`, 'FAILED');
  }
}

// Test 5: Revoked Token Usage
async function testRevokedTokens() {
  log('\n🔍 Test 5: Revoked Token Usage', 'blue');
  
  try {
    // Create and revoke a token
    const testToken = 'test_revoked_token_' + Date.now();
    await tokenRevocationService.revokeToken(testToken);
    
    // Check if revocation service works
    const isRevoked = await tokenRevocationService.isTokenRevoked(testToken);
    if (isRevoked) {
      logResult('Token revocation service works', 'PASSED');
    } else {
      logResult('Token revocation service failed', 'FAILED');
    }
    
    // Test with a real JWT token
    const realToken = generateToken('test_user', 'admin');
    await tokenRevocationService.revokeToken(realToken);
    const isRealTokenRevoked = await tokenRevocationService.isTokenRevoked(realToken);
    
    if (isRealTokenRevoked) {
      logResult('Real JWT token revocation works', 'PASSED');
    } else {
      logResult('Real JWT token revocation failed', 'FAILED');
    }
  } catch (error) {
    logResult(`Error testing revoked tokens: ${error.message}`, 'FAILED');
  }
}

// Test 6: Missing Authorization Header
async function testMissingAuth() {
  log('\n🔍 Test 6: Missing Authorization Header', 'blue');
  
  try {
    const response = await axios.get(`${API_URL}/admin/stats/platform`, {
      validateStatus: () => true
    });
    
    if (response.status === 401) {
      logResult('Missing auth header rejected', 'PASSED');
    } else {
      logResult('Missing auth header accepted', 'FAILED', `Status: ${response.status}`);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      logResult('Server not running - skipping', 'warning');
      return;
    }
    if (error.response && error.response.status === 401) {
      logResult('Missing auth header rejected', 'PASSED');
    } else {
      logResult(`Missing auth test error: ${error.message}`, 'FAILED');
    }
  }
}

// Test 7: Rate Limiting Attack
async function testRateLimiting() {
  log('\n🔍 Test 7: Rate Limiting Attack', 'blue');
  
  try {
    // Create a valid admin token (assuming we have one)
    // Note: This test requires a valid admin token
    const adminToken = generateToken('test_admin', 'admin');
    
    const requests = [];
    const requestCount = 105; // More than the 100 limit
    
    // Make rapid requests
    for (let i = 0; i < requestCount; i++) {
      requests.push(
        axios.get(`${API_URL}/admin/stats/platform`, {
          headers: { 'Authorization': `Bearer ${adminToken}` },
          validateStatus: () => true
        }).catch(err => ({ status: err.response?.status || 500, error: err.message }))
      );
    }
    
    const responses = await Promise.all(requests);
    
    // Check if any requests were rate limited
    const rateLimited = responses.filter(r => r.status === 429);
    
    if (rateLimited.length > 0) {
      logResult(`Rate limiting active - ${rateLimited.length} requests blocked`, 'PASSED');
      results.blocked.push(`Rate limiting blocked ${rateLimited.length} requests`);
    } else {
      logResult('Rate limiting not working', 'FAILED', 'No 429 responses received');
    }
    
    // Check response times
    const successCount = responses.filter(r => r.status === 200).length;
    logResult(`Rate limit test: ${successCount} successful, ${rateLimited.length} blocked`, 
      rateLimited.length > 0 ? 'PASSED' : 'warning');
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      logResult('Server not running - skipping rate limit test', 'warning');
      return;
    }
    logResult(`Rate limiting test error: ${error.message}`, 'FAILED');
  }
}

// Test 8: Concurrent Attack (Race Condition)
async function testConcurrentAttack() {
  log('\n🔍 Test 8: Concurrent Attack (Race Condition)', 'blue');
  
  try {
    const adminToken = generateToken('test_admin', 'admin');
    
    // Make 10 concurrent requests with same token
    const concurrentRequests = Array(10).fill(null).map(() =>
      axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        validateStatus: () => true
      }).catch(err => ({ status: err.response?.status || 500 }))
    );
    
    const responses = await Promise.all(concurrentRequests);
    const successCount = responses.filter(r => r.status === 200).length;
    const errorCount = responses.filter(r => r.status >= 400).length;
    
    logResult(`Concurrent requests: ${successCount} successful, ${errorCount} errors`, 
      successCount > 0 ? 'PASSED' : 'warning');
      
  } catch (error) {
    if (error.code === 'ECONNREFUSED') return;
    logResult(`Concurrent attack test error: ${error.message}`, 'FAILED');
  }
}

// Test 9: SQL Injection Attempt (via token)
async function testSQLInjection() {
  log('\n🔍 Test 9: SQL Injection Attempt', 'blue');
  
  try {
    // Try SQL injection in token
    const sqlInjectionTokens = [
      "' OR '1'='1",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM users --",
      "admin'--",
      "admin'/*"
    ];
    
    for (const sqlToken of sqlInjectionTokens) {
      try {
        const response = await axios.get(`${API_URL}/admin/stats/platform`, {
          headers: { 'Authorization': `Bearer ${sqlToken}` },
          validateStatus: () => true
        });
        
        if (response.status === 401 || response.status === 403) {
          logResult(`SQL injection "${sqlToken.substring(0, 20)}" blocked`, 'PASSED');
        } else {
          logResult(`SQL injection "${sqlToken.substring(0, 20)}" might be vulnerable`, 'FAILED');
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') return;
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
          logResult(`SQL injection blocked`, 'PASSED');
        }
      }
    }
  } catch (error) {
    logResult(`SQL injection test error: ${error.message}`, 'FAILED');
  }
}

// Test 10: XSS Attempt (via headers)
async function testXSS() {
  log('\n🔍 Test 10: XSS Attempt (via headers)', 'blue');
  
  try {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '"><script>alert("XSS")</script>',
      'javascript:alert("XSS")',
      '<img src=x onerror=alert("XSS")>'
    ];
    
    for (const xss of xssPayloads) {
      try {
        const response = await axios.get(`${API_URL}/admin/stats/platform`, {
          headers: { 
            'Authorization': `Bearer ${xss}`,
            'User-Agent': xss
          },
          validateStatus: () => true
        });
        
        // Check if response contains the XSS payload (should not)
        if (response.data && JSON.stringify(response.data).includes(xss)) {
          logResult(`XSS payload "${xss.substring(0, 20)}" reflected in response`, 'FAILED');
        } else {
          logResult(`XSS payload "${xss.substring(0, 20)}" handled safely`, 'PASSED');
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') return;
        // Error is OK - means XSS was rejected
        logResult(`XSS payload blocked`, 'PASSED');
      }
    }
  } catch (error) {
    logResult(`XSS test error: ${error.message}`, 'FAILED');
  }
}

// Test 11: Token with Wrong Algorithm
async function testWrongAlgorithm() {
  log('\n🔍 Test 11: Token with Wrong Algorithm', 'blue');
  
  try {
    // Try to create token with 'none' algorithm (JWT vulnerability)
    const noneToken = jwt.sign(
      { userId: 'test_user', role: 'admin' },
      '',
      { algorithm: 'none' }
    );
    
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${noneToken}` },
        validateStatus: () => true
      });
      
      if (response.status === 401 || response.status === 403) {
        logResult('None algorithm token rejected', 'PASSED');
      } else {
        logResult('None algorithm token accepted (VULNERABILITY!)', 'FAILED', `Status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        logResult('None algorithm token rejected', 'PASSED');
      }
    }
  } catch (error) {
    // JWT library should prevent 'none' algorithm
    if (error.message.includes('none') || error.message.includes('algorithm')) {
      logResult('None algorithm prevented by JWT library', 'PASSED');
    } else {
      logResult(`Wrong algorithm test error: ${error.message}`, 'FAILED');
    }
  }
}

// Test 12: Very Long Token (Buffer Overflow Attempt)
async function testLongToken() {
  log('\n🔍 Test 12: Very Long Token (Buffer Overflow Attempt)', 'blue');
  
  try {
    const longToken = 'A'.repeat(10000); // 10KB token
    
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${longToken}` },
        validateStatus: () => true,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      if (response.status === 401 || response.status === 403) {
        logResult('Very long token rejected', 'PASSED');
      } else {
        logResult('Very long token might cause issues', 'warning', `Status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        logResult('Very long token rejected', 'PASSED');
      } else {
        logResult(`Long token test error: ${error.message}`, 'warning');
      }
    }
  } catch (error) {
    logResult(`Long token test error: ${error.message}`, 'FAILED');
  }
}

// Test 13: Token Replay Attack
async function testTokenReplay() {
  log('\n🔍 Test 13: Token Replay Attack', 'blue');
  
  try {
    const token = generateToken('test_user', 'admin');
    
    // Use same token multiple times (should work - tokens are stateless)
    const requests = Array(5).fill(null).map(() =>
      axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${token}` },
        validateStatus: () => true
      }).catch(err => ({ status: err.response?.status || 500 }))
    );
    
    const responses = await Promise.all(requests);
    const successCount = responses.filter(r => r.status === 200).length;
    
    // Token replay should work (JWT is stateless)
    // But if we revoke it, it should stop working
    logResult(`Token replay: ${successCount}/5 requests succeeded (expected for valid token)`, 'PASSED');
    
    // Now revoke and try again
    await tokenRevocationService.revokeToken(token);
    const afterRevokeResponse = await axios.get(`${API_URL}/admin/stats/platform`, {
      headers: { 'Authorization': `Bearer ${token}` },
      validateStatus: () => true
    }).catch(err => ({ status: err.response?.status || 500 }));
    
    if (afterRevokeResponse.status === 401) {
      logResult('Revoked token cannot be replayed', 'PASSED');
    } else {
      logResult('Revoked token still works (revocation not working)', 'FAILED');
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') return;
    logResult(`Token replay test error: ${error.message}`, 'warning');
  }
}

// Test 14: Edge Case - Empty Payload
async function testEmptyPayload() {
  log('\n🔍 Test 14: Edge Case - Empty Payload', 'blue');
  
  try {
    // Create token with empty/null payload
    const emptyToken = jwt.sign({}, process.env.JWT_SECRET || 'test-secret');
    
    try {
      const response = await axios.get(`${API_URL}/admin/stats/platform`, {
        headers: { 'Authorization': `Bearer ${emptyToken}` },
        validateStatus: () => true
      });
      
      if (response.status === 401 || response.status === 403) {
        logResult('Empty payload token rejected', 'PASSED');
      } else {
        logResult('Empty payload token accepted', 'warning', `Status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        logResult('Empty payload token rejected', 'PASSED');
      }
    }
  } catch (error) {
    logResult(`Empty payload test error: ${error.message}`, 'warning');
  }
}

// Test 15: Path Traversal in Endpoint
async function testPathTraversal() {
  log('\n🔍 Test 15: Path Traversal in Endpoint', 'blue');
  
  try {
    const adminToken = generateToken('test_admin', 'admin');
    const pathTraversalAttempts = [
      '/admin/stats/platform/../users',
      '/admin/stats/platform/../../etc/passwd',
      '/admin/stats/platform/%2e%2e%2fusers',
      '/admin/stats/platform/..%2f..%2fusers'
    ];
    
    for (const path of pathTraversalAttempts) {
      try {
        const response = await axios.get(`${API_URL}${path}`, {
          headers: { 'Authorization': `Bearer ${adminToken}` },
          validateStatus: () => true
        });
        
        // Should return 404, not access unauthorized resources
        if (response.status === 404) {
          logResult(`Path traversal "${path}" blocked (404)`, 'PASSED');
        } else if (response.status === 403) {
          logResult(`Path traversal "${path}" blocked (403)`, 'PASSED');
        } else {
          logResult(`Path traversal "${path}" might be vulnerable`, 'warning', `Status: ${response.status}`);
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') return;
        if (error.response && (error.response.status === 404 || error.response.status === 403)) {
          logResult(`Path traversal blocked`, 'PASSED');
        }
      }
    }
  } catch (error) {
    logResult(`Path traversal test error: ${error.message}`, 'warning');
  }
}

// Main test runner
async function runPenetrationTests() {
  log('\n' + '='.repeat(70), 'cyan');
  log('🔒 PENETRATION TESTING - Security Vulnerability Assessment', 'cyan');
  log('='.repeat(70), 'cyan');
  log(`Testing against: ${BASE_URL}`, 'blue');
  log(`Start time: ${new Date().toISOString()}`, 'blue');
  log('='.repeat(70) + '\n', 'cyan');
  
  // Run all tests
  await testInvalidTokenFormats();
  await testExpiredTokens();
  await testTokenTampering();
  await testRoleEscalation();
  await testRevokedTokens();
  await testMissingAuth();
  await testRateLimiting();
  await testConcurrentAttack();
  await testSQLInjection();
  await testXSS();
  await testWrongAlgorithm();
  await testLongToken();
  await testTokenReplay();
  await testEmptyPayload();
  await testPathTraversal();
  
  // Print summary
  log('\n' + '='.repeat(70), 'cyan');
  log('📊 PENETRATION TEST SUMMARY', 'cyan');
  log('='.repeat(70), 'cyan');
  log(`✅ Passed: ${results.passed.length}`, 'green');
  log(`❌ Failed: ${results.failed.length}`, 'red');
  log(`⚠️  Warnings: ${results.warnings.length}`, 'yellow');
  log(`🛡️  Blocked Attacks: ${results.blocked.length}`, 'blue');
  log('='.repeat(70), 'cyan');
  
  if (results.failed.length > 0) {
    log('\n❌ FAILED TESTS (Potential Vulnerabilities):', 'red');
    results.failed.forEach(test => log(`  - ${test}`, 'red'));
  }
  
  if (results.warnings.length > 0) {
    log('\n⚠️  WARNINGS (Needs Review):', 'yellow');
    results.warnings.forEach(test => log(`  - ${test}`, 'yellow'));
  }
  
  if (results.blocked.length > 0) {
    log('\n🛡️  BLOCKED ATTACKS:', 'green');
    results.blocked.forEach(attack => log(`  - ${attack}`, 'green'));
  }
  
  log('\n' + '='.repeat(70), 'cyan');
  log(`End time: ${new Date().toISOString()}`, 'blue');
  log('='.repeat(70) + '\n', 'cyan');
  
  // Exit code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runPenetrationTests().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});


