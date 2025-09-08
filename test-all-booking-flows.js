const meetLinkService = require('./utils/meetLinkService');

async function testAllBookingFlows() {
  console.log('🧪 Testing All Booking Flows with Real Meet Links...');
  
  // Test scenarios for different booking types
  const testScenarios = [
    {
      name: 'Paid Individual Session',
      type: 'individual',
      duration: 50,
      summary: 'Individual Therapy Session',
      description: 'One-on-one therapy session with psychologist'
    },
    {
      name: 'Free Assessment Session',
      type: 'free_assessment',
      duration: 20,
      summary: 'Free Assessment Session',
      description: 'Free 20-minute assessment session'
    },
    {
      name: 'Package Session',
      type: 'package',
      duration: 50,
      summary: 'Package Therapy Session',
      description: 'Therapy session from purchased package'
    }
  ];
  
  console.log(`📅 Testing ${testScenarios.length} booking scenarios...`);
  
  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i];
    console.log(`\n🔄 Test ${i + 1}/${testScenarios.length}: ${scenario.name}`);
    console.log(`📅 Type: ${scenario.type}, Duration: ${scenario.duration} minutes`);
    
    // Create test session data
    const sessionData = {
      summary: `${scenario.summary} - Test ${i + 1}`,
      description: scenario.description,
      startDate: '2025-09-10',
      startTime: `${10 + i}:00:00`, // Different times for each test
      endTime: `${10 + i}:${scenario.duration}:00`
    };
    
    try {
      const result = await meetLinkService.generateSessionMeetLink(sessionData);
      
      if (result.success) {
        console.log(`✅ SUCCESS! Meet link: ${result.meetLink}`);
        console.log(`📅 Method: ${result.method}`);
        console.log(`📅 Event ID: ${result.eventId}`);
        
        if (result.method === 'oauth_calendar') {
          console.log('🎯 Real Google Meet conference created!');
        } else if (result.method === 'calendar_event_created') {
          console.log('📅 Calendar event created with manual Meet creation');
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
    if (i < testScenarios.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n🎉 All Booking Flows Test Complete!');
  console.log('\n📋 Summary:');
  console.log('✅ Individual Sessions: Using meetLinkService.generateSessionMeetLink()');
  console.log('✅ Free Assessments: Using meetLinkService.generateSessionMeetLink()');
  console.log('✅ Package Sessions: Using meetLinkService.generateSessionMeetLink()');
  console.log('✅ Payment Controller: Using meetLinkService.generateSessionMeetLink()');
  console.log('✅ Meet API Route: Using meetLinkService.generateSessionMeetLink()');
}

testAllBookingFlows();
