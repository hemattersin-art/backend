const meetLinkService = require('./utils/meetLinkService');
const { addMinutesToTime } = require('./utils/helpers');

async function testActualBookingFlow() {
  console.log('🧪 Testing Actual Booking Flow...');
  
  // Simulate the exact data from the payment controller
  const scheduledDate = '2025-09-11';
  const scheduledTime = '14:00:00';
  
  const sessionData = {
    summary: `Therapy Session - ram with irene`,
    description: `Online therapy session between ram and irene marium`,
    startDate: scheduledDate,
    startTime: scheduledTime,
    endTime: addMinutesToTime(scheduledTime, 50) // Add 50 minutes to start time
  };
  
  console.log('📅 Session Data:', sessionData);
  console.log('🔍 addMinutesToTime result:', addMinutesToTime(scheduledTime, 50));
  
  try {
    const result = await meetLinkService.generateSessionMeetLink(sessionData);
    console.log('✅ Meet Link Result:', result);
    
    if (result.success) {
      console.log('🎉 SUCCESS! Real Meet link created:', result.meetLink);
      console.log('📅 Method:', result.method);
      
      if (result.method === 'oauth_calendar') {
        console.log('✅ OAuth method working!');
      } else if (result.method === 'calendar_service_account') {
        console.log('✅ Service account method working!');
      }
    } else {
      console.log('❌ FAILED:', result.note);
      console.log('📝 Error:', result.error);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testActualBookingFlow();
