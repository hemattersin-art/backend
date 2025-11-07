const crypto = require('crypto-js');

// Get frontend URL from environment variables
const getFrontendUrl = () => {
  // If PAYU_SUCCESS_URL is explicitly set, extract base URL from it
  if (process.env.PAYU_SUCCESS_URL) {
    try {
      const url = new URL(process.env.PAYU_SUCCESS_URL);
      const baseUrl = `${url.protocol}//${url.host}`;
      console.log('🔧 Using PAYU_SUCCESS_URL base:', baseUrl);
      return baseUrl;
    } catch (error) {
      console.warn('⚠️ Invalid PAYU_SUCCESS_URL format, using default');
    }
  }
  
  // Always check FRONTEND_PORT first, even in production
  if (process.env.FRONTEND_PORT) {
    const frontendPort = process.env.FRONTEND_PORT;
    const baseUrl = `http://localhost:${frontendPort}`;
    console.log('🔧 Using FRONTEND_PORT from env:', frontendPort);
    return baseUrl;
  }
  
  if (process.env.NODE_ENV === 'development') {
    // Default to 3000 in development
    const frontendPort = '3000';
    console.log('🔧 Using default development port:', frontendPort);
    return `http://localhost:${frontendPort}`;
  }
  
  // Production URL
  console.log('🔧 Using production URL');
  return 'https://kutikkal-one.vercel.app';
};

// PayU Configuration
const PAYU_CONFIG = {
  // Test Environment (for development)
  test: {
    merchantId: process.env.PAYU_TEST_MERCHANT_ID || 'gtKFFx',
    salt: process.env.PAYU_TEST_SALT || '4R38IvwiV57FwVpsgOvTXBdLE4tHUXFW',
    baseUrl: 'https://test.payu.in'
  },
  // Production Environment (for live payments)
  production: {
    merchantId: process.env.PAYU_PROD_MERCHANT_ID,
    salt: process.env.PAYU_PROD_SALT,
    baseUrl: 'https://secure.payu.in'
  }
};

// Get current environment config
const getPayUConfig = () => {
  // Always use TEST mode for now (even in production)
  // Change this to production when you're ready for live payments
  const isProduction = false; // Set to true when ready for live payments
  
  // Get fresh frontend URL each time (not cached)
  const frontendBaseUrl = getFrontendUrl();
  
  const config = {
    ...(isProduction ? PAYU_CONFIG.production : PAYU_CONFIG.test),
    successUrl: process.env.PAYU_SUCCESS_URL || `${frontendBaseUrl}/payment/success`,
    failureUrl: process.env.PAYU_FAILURE_URL || `${frontendBaseUrl}/payment/failure`
  };
  
  console.log('🔧 PayU Environment:', isProduction ? 'PRODUCTION (LIVE PAYMENTS)' : 'TEST MODE (SAFE FOR TESTING)');
  console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
  console.log('🔧 FRONTEND_PORT:', process.env.FRONTEND_PORT || 'not set (using default 3000)');
  console.log('🔧 Frontend Base URL:', frontendBaseUrl);
  console.log('🔧 Using Test Credentials:', !isProduction);
  console.log('🔧 Success URL:', config.successUrl);
  console.log('🔧 Failure URL:', config.failureUrl);
  
  if (!isProduction) {
    console.log('✅ Using PayU TEST mode - payments will not be charged');
  } else {
    console.log('⚠️  Using PayU PRODUCTION mode - REAL MONEY will be charged!');
  }
  
  return config;
};

// Generate PayU hash (updated formula)
const generatePayUHash = (params, salt) => {
  // Updated PayU hash sequence as per their documentation
  const hashSequence = [
    'key', 'txnid', 'amount', 'productinfo', 'firstname', 'email',
    'udf1', 'udf2', 'udf3', 'udf4', 'udf5', 'udf6', 'udf7', 'udf8',
    'udf9', 'udf10'
  ];
  
  let hashString = '';
  hashSequence.forEach(field => {
    hashString += (params[field] || '') + '|';
  });
  hashString += salt;
  
  console.log('🔐 Hash String:', hashString);
  console.log('🔐 Salt:', salt);
  
  const hash = crypto.SHA512(hashString).toString();
  console.log('🔐 Generated Hash:', hash);
  
  return hash;
};

// Generate transaction ID
const generateTransactionId = () => {
  return 'TXN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

// Validate PayU response hash
const validatePayUResponse = (params, salt) => {
  const receivedHash = params.hash;
  const calculatedHash = generatePayUHash(params, salt);
  return receivedHash === calculatedHash;
};

module.exports = {
  getPayUConfig,
  generatePayUHash,
  generateTransactionId,
  validatePayUResponse
};
