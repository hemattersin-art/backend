const meetLinkService = require('./utils/meetLinkService');

async function testTimeFormatFix() {
  console.log('🧪 Testing Time Format Fix...');
  
  // Test with inconsistent time format (like in the logs)
  const sessionData = {
    summary: 'Time Format Test Session',
    description: 'Testing time format consistency',
    startDate: '2025-09-11',
    startTime: '14:00:00', // With seconds
    endTime: '14:50'       // Without seconds (this was causing the issue)
  };
  
  console.log('📅 Session Data:', sessionData);
  
  try {
    const result = await meetLinkService.generateSessionMeetLink(sessionData);
    console.log('✅ Meet Link Result:', result);
    
    if (result.success) {
      console.log('🎉 SUCCESS! Real Meet link created:', result.meetLink);
      console.log('📅 Method:', result.method);
      
      if (result.method === 'oauth_calendar') {
        console.log('✅ OAuth method working with fixed time format!');
      } else if (result.method === 'calendar_service_account') {
        console.log('✅ Service account method working with fixed time format!');
      }
    } else {
      console.log('❌ FAILED:', result.note);
      console.log('📝 Error:', result.error);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testTimeFormatFix();
