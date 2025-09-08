const meetLinkService = require('./utils/meetLinkService');

async function testOAuthTokenRefresh() {
  console.log('🧪 Testing OAuth Token Refresh...');
  
  // Test session data
  const sessionData = {
    summary: 'OAuth Token Refresh Test',
    description: 'Testing if OAuth tokens were refreshed automatically',
    startDate: '2025-09-10',
    startTime: '15:00:00',
    endTime: '15:50:00'
  };
  
  try {
    const result = await meetLinkService.generateSessionMeetLink(sessionData);
    console.log('✅ Meet Link Result:', result);
    
    if (result.success) {
      console.log('🎉 SUCCESS! Real Meet link created:', result.meetLink);
      console.log('📅 Method:', result.method);
      
      if (result.method === 'oauth_calendar') {
        console.log('✅ OAuth method working - tokens were refreshed!');
      } else {
        console.log('⚠️ Using fallback method');
      }
    } else {
      console.log('❌ FAILED:', result.note);
      console.log('📝 Error:', result.error);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testOAuthTokenRefresh();
