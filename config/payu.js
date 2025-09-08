const crypto = require('crypto-js');

// PayU Configuration
const PAYU_CONFIG = {
  // Test Environment (for development)
  test: {
    merchantId: process.env.PAYU_TEST_MERCHANT_ID || 'gtKFFx',
    salt: process.env.PAYU_TEST_SALT || 'eCwWELxi',
    baseUrl: 'https://test.payu.in',
    successUrl: process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3000/api/payment/result' 
      : (process.env.PAYU_SUCCESS_URL || 'https://kuttikal.vercel.app/api/payment/result'),
    failureUrl: process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3000/api/payment/result' 
      : (process.env.PAYU_FAILURE_URL || 'https://kuttikal.vercel.app/api/payment/result')
  },
  // Production Environment (for live payments)
  production: {
    merchantId: process.env.PAYU_PROD_MERCHANT_ID,
    salt: process.env.PAYU_PROD_SALT,
    baseUrl: 'https://secure.payu.in',
    successUrl: process.env.PAYU_SUCCESS_URL || 'https://kuttikal.vercel.app/api/payment/result',
    failureUrl: process.env.PAYU_FAILURE_URL || 'https://kuttikal.vercel.app/api/payment/result'
  }
};

// Get current environment config
const getPayUConfig = () => {
  // Use production mode when NODE_ENV is production AND production credentials are available
  const isProduction = process.env.NODE_ENV === 'production' && 
                      process.env.PAYU_PROD_MERCHANT_ID && 
                      process.env.PAYU_PROD_SALT;
  const config = isProduction ? PAYU_CONFIG.production : PAYU_CONFIG.test;
  
  console.log('🔧 PayU Environment:', isProduction ? 'PRODUCTION' : 'TEST');
  console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
  console.log('🔧 PAYU_PROD_MERCHANT_ID:', process.env.PAYU_PROD_MERCHANT_ID ? 'SET' : 'NOT SET');
  console.log('🔧 PAYU_PROD_SALT:', process.env.PAYU_PROD_SALT ? 'SET' : 'NOT SET');
  console.log('🔧 Success URL:', config.successUrl);
  console.log('🔧 Failure URL:', config.failureUrl);
  
  // Validate that we have the required credentials
  if (!config.merchantId || !config.salt) {
    console.error('❌ PayU credentials missing! Using test credentials as fallback.');
    console.error('❌ Missing:', {
      merchantId: !config.merchantId,
      salt: !config.salt
    });
  }
  
  return config;
};

// Generate PayU hash
const generatePayUHash = (params, salt) => {
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
  
  return crypto.SHA512(hashString).toString();
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
