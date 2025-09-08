const meetLinkService = require('./utils/meetLinkService');

async function testFullMeetLinkCreation() {
  console.log('🧪 Testing Full Meet Link Creation Flow...');
  
  // Test multiple session scenarios
  const testSessions = [
    {
      summary: 'Morning Therapy Session',
      description: 'Full test of Meet link creation with OAuth',
      startDate: '2025-09-09',
      startTime: '10:00:00', // 10:00 AM IST
      endTime: '10:50:00'    // 10:50 AM IST
    },
    {
      summary: 'Afternoon Therapy Session',
      description: 'Second test session for verification',
      startDate: '2025-09-09',
      startTime: '14:30:00', // 2:30 PM IST
      endTime: '15:20:00'    // 3:20 PM IST
    },
    {
      summary: 'Evening Therapy Session',
      description: 'Third test session for comprehensive testing',
      startDate: '2025-09-09',
      startTime: '19:00:00', // 7:00 PM IST
      endTime: '19:50:00'    // 7:50 PM IST
    }
  ];
  
  console.log(`📅 Testing ${testSessions.length} sessions...`);
  
  for (let i = 0; i < testSessions.length; i++) {
    const session = testSessions[i];
    console.log(`\n🔄 Test ${i + 1}/${testSessions.length}: ${session.summary}`);
    console.log(`📅 Time: ${session.startTime} - ${session.endTime} IST`);
    
    try {
      const result = await meetLinkService.generateSessionMeetLink(session);
      
      if (result.success) {
        console.log(`✅ SUCCESS! Meet link: ${result.meetLink}`);
        console.log(`📅 Method: ${result.method}`);
        console.log(`📅 Event ID: ${result.eventId}`);
        
        if (result.method === 'oauth_calendar') {
          console.log('🎯 Real Google Meet conference created!');
        } else {
          console.log('⚠️ Using fallback method');
        }
      } else {
        console.log(`❌ FAILED: ${result.note}`);
        console.log(`📝 Fallback link: ${result.meetLink}`);
      }
    } catch (error) {
      console.error(`❌ Test ${i + 1} failed:`, error.message);
    }
    
    // Small delay between tests
    if (i < testSessions.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n🎉 Full Meet Link Creation Test Complete!');
}

testFullMeetLinkCreation();
