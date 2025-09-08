const meetLinkService = require('./utils/meetLinkService');

async function debugOAuthTokens() {
  console.log('🔍 Debugging OAuth Token Storage...');
  
  // Wait a moment for async loading to complete
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check if tokens are stored
  console.log('📊 OAuth Tokens Object:', meetLinkService.oauthTokens);
  
  if (meetLinkService.oauthTokens) {
    console.log('✅ OAuth tokens found in memory');
    console.log('📅 Access Token:', meetLinkService.oauthTokens.accessToken ? 'Present' : 'Missing');
    console.log('📅 Refresh Token:', meetLinkService.oauthTokens.refreshToken ? 'Present' : 'Missing');
    console.log('📅 Expiry Date:', new Date(meetLinkService.oauthTokens.expiryDate));
    
    // Test getValidOAuthToken
    const validToken = await meetLinkService.getValidOAuthToken();
    console.log('🔑 Valid Token Result:', validToken ? 'Found' : 'Not found');
  } else {
    console.log('❌ No OAuth tokens found in memory');
  }
}

debugOAuthTokens();
