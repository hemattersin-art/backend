const meetLinkService = require('./utils/meetLinkService');

async function testPersistentMeetLinkCreation() {
  console.log('🧪 Testing Persistent Meet Link Creation...');
  
  // Test session data with IST times
  const sessionData = {
    summary: 'Persistent Meet Link Test Session',
    description: 'Testing Meet link creation with persistent OAuth tokens',
    startDate: '2025-09-09',
    startTime: '18:00:00', // 6:00 PM IST
    endTime: '18:50:00'    // 6:50 PM IST (50 minutes later)
  };
  
  console.log('📅 Session Data:', sessionData);
  
  try {
    const result = await meetLinkService.generateSessionMeetLink(sessionData);
    console.log('✅ Meet Link Result:', result);
    
    if (result.success) {
      console.log('🎉 SUCCESS! Real Meet link created:', result.meetLink);
      console.log('📅 Method used:', result.method);
      console.log('📅 Event ID:', result.eventId);
      console.log('📅 Calendar Link:', result.eventLink);
      
      if (result.method === 'oauth_calendar') {
        console.log('✅ OAuth method working perfectly with persistent tokens!');
        console.log('🎯 Real Google Meet conference created!');
      } else if (result.method === 'calendar_service_account') {
        console.log('⚠️ Using service account method');
      } else {
        console.log('⚠️ Using fallback method');
      }
    } else {
      console.log('❌ FAILED! Using fallback:', result.meetLink);
      console.log('📝 Error:', result.error);
      console.log('📝 Note:', result.note);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testPersistentMeetLinkCreation();
