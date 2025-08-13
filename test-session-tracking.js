// test-session-tracking.js - Test script for machine session tracking
const MachineSimulator = require('./simulation-worker');
const config = require('./config');

async function testSessionTracking() {
  console.log('🧪 Testing Machine Session Tracking...\n');
  
  // Create a test machine configuration
  const testMachineConfig = {
    serial: 99999,
    name: 'TEST-MACHINE',
    ipAddress: '192.168.0.999',
    active: true,
    lanes: 2,
    type: 'TEST'
  };
  
  const simulator = new MachineSimulator(testMachineConfig);
  
  try {
    console.log('1️⃣ Starting simulator...');
    await simulator.start();
    
    // Let it run for a short time to generate some data
    console.log('2️⃣ Letting simulator run for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('3️⃣ Stopping simulator...');
    await simulator.stop();
    
    console.log('\n✅ Session tracking test completed!');
    console.log('📊 Check the machine-session collection in MongoDB to see the created sessions.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testSessionTracking().catch(console.error);
}

module.exports = { testSessionTracking };
