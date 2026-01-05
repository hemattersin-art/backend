/**
 * Test script to verify reschedule time conversion functionality
 * This tests the convertTo24Hour function used in reschedule
 */

// Test the time conversion function (same logic as in clientController.js)
const convertTo24Hour = (time12Hour) => {
  if (!time12Hour || typeof time12Hour !== 'string') {
    return '00:00';
  }
  
  // If already in 24-hour format, return as is
  if (!time12Hour.includes('AM') && !time12Hour.includes('PM')) {
    const [hours, minutes] = time12Hour.split(':');
    return `${hours.padStart(2, '0')}:${minutes || '00'}`;
  }
  
  // Handle 12-hour format with AM/PM
  const [time, period] = time12Hour.split(' ');
  if (!time || !period) {
    return '00:00';
  }
  
  const [hours, minutes] = time.split(':');
  let hour24 = parseInt(hours);
  
  if (period === 'PM' && hour24 !== 12) {
    hour24 += 12;
  } else if (period === 'AM' && hour24 === 12) {
    hour24 = 0;
  }
  
  return `${hour24.toString().padStart(2, '0')}:${minutes || '00'}`;
};

// Helper function to add minutes (fixed version with day rollover)
const addMinutesToTime = (timeString, minutes) => {
  try {
    const timeParts = timeString.split(':');
    const hours = parseInt(timeParts[0]);
    const mins = parseInt(timeParts[1] || '0');
    
    const totalMinutes = hours * 60 + mins + minutes;
    let newHours = Math.floor(totalMinutes / 60);
    const newMins = totalMinutes % 60;
    
    // Handle day rollover (24 hours = next day, reset to 00)
    if (newHours >= 24) {
      newHours = newHours % 24;
    }
    
    return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}:00`;
  } catch (error) {
    console.error('Error adding minutes to time:', error);
    return timeString;
  }
};

// Test cases
const testCases = [
  { input: '6:00 PM', expected: '18:00', description: '6:00 PM should convert to 18:00' },
  { input: '12:00 PM', expected: '12:00', description: '12:00 PM should convert to 12:00' },
  { input: '12:00 AM', expected: '00:00', description: '12:00 AM should convert to 00:00' },
  { input: '1:00 AM', expected: '01:00', description: '1:00 AM should convert to 01:00' },
  { input: '11:30 PM', expected: '23:30', description: '11:30 PM should convert to 23:30' },
  { input: '9:15 AM', expected: '09:15', description: '9:15 AM should convert to 09:15' },
  { input: '18:00', expected: '18:00', description: 'Already 24-hour format should remain unchanged' },
  { input: '07:00', expected: '07:00', description: 'Already 24-hour format with leading zero should remain unchanged' },
];

console.log('🧪 Testing Time Conversion Function\n');
console.log('=' .repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = convertTo24Hour(testCase.input);
  const success = result === testCase.expected;
  
  if (success) {
    passed++;
    console.log(`✅ Test ${index + 1}: ${testCase.description}`);
    console.log(`   Input: "${testCase.input}" → Output: "${result}"`);
  } else {
    failed++;
    console.log(`❌ Test ${index + 1}: ${testCase.description}`);
    console.log(`   Input: "${testCase.input}"`);
    console.log(`   Expected: "${testCase.expected}"`);
    console.log(`   Got: "${result}"`);
  }
  console.log('');
});

// Test end time calculation
console.log('🧪 Testing End Time Calculation\n');
console.log('=' .repeat(60));

const endTimeTests = [
  { startTime: '18:00', minutes: 60, expected: '19:00:00', description: '18:00 + 60 minutes = 19:00:00' },
  { startTime: '18:00', minutes: 20, expected: '18:20:00', description: '18:00 + 20 minutes = 18:20:00' },
  { startTime: '23:00', minutes: 60, expected: '00:00:00', description: '23:00 + 60 minutes = 00:00:00 (next day)' },
  { startTime: '09:30', minutes: 30, expected: '10:00:00', description: '09:30 + 30 minutes = 10:00:00' },
];

endTimeTests.forEach((testCase, index) => {
  const result = addMinutesToTime(testCase.startTime, testCase.minutes);
  const success = result === testCase.expected;
  
  if (success) {
    passed++;
    console.log(`✅ End Time Test ${index + 1}: ${testCase.description}`);
    console.log(`   Result: "${result}"`);
  } else {
    failed++;
    console.log(`❌ End Time Test ${index + 1}: ${testCase.description}`);
    console.log(`   Expected: "${testCase.expected}"`);
    console.log(`   Got: "${result}"`);
  }
  console.log('');
});

// Test full reschedule flow simulation
console.log('🧪 Testing Full Reschedule Flow Simulation\n');
console.log('=' .repeat(60));

const rescheduleTests = [
  {
    newTime: '6:00 PM',
    isFreeAssessment: false,
    expectedStart: '18:00',
    expectedEnd: '19:00:00',
    description: 'Regular session: 6:00 PM → 18:00 start, 19:00:00 end (60 min)'
  },
  {
    newTime: '6:00 PM',
    isFreeAssessment: true,
    expectedStart: '18:00',
    expectedEnd: '18:20:00',
    description: 'Free assessment: 6:00 PM → 18:00 start, 18:20:00 end (20 min)'
  },
  {
    newTime: '2:30 PM',
    isFreeAssessment: false,
    expectedStart: '14:30',
    expectedEnd: '15:30:00',
    description: 'Regular session: 2:30 PM → 14:30 start, 15:30:00 end (60 min)'
  },
];

rescheduleTests.forEach((testCase, index) => {
  const startTime24 = convertTo24Hour(testCase.newTime);
  const endTime = addMinutesToTime(
    startTime24,
    testCase.isFreeAssessment ? 20 : 60
  );
  
  const success = startTime24 === testCase.expectedStart && endTime === testCase.expectedEnd;
  
  if (success) {
    passed++;
    console.log(`✅ Reschedule Flow Test ${index + 1}: ${testCase.description}`);
    console.log(`   Start Time: "${startTime24}"`);
    console.log(`   End Time: "${endTime}"`);
  } else {
    failed++;
    console.log(`❌ Reschedule Flow Test ${index + 1}: ${testCase.description}`);
    console.log(`   Expected Start: "${testCase.expectedStart}", Got: "${startTime24}"`);
    console.log(`   Expected End: "${testCase.expectedEnd}", Got: "${endTime}"`);
  }
  console.log('');
});

// Summary
console.log('=' .repeat(60));
console.log('📊 Test Summary\n');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Total: ${passed + failed}`);
console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

if (failed === 0) {
  console.log('🎉 All tests passed! The time conversion is working correctly.');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Please review the issues above.');
  process.exit(1);
}

