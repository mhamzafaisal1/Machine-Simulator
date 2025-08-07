// test-config.js
const config = require('./config');
const { getActiveStations, getStationOperators, buildStateRecord } = require('./utils');

console.log('🧪 Testing Multi-Station Simulator Configuration\n');

// Test different machine configurations
const testMachines = [
  { name: 'SPF2', serial: 68012, lanes: 1, type: 'SPF' },
  { name: 'LPL1', serial: 67798, lanes: 3, type: 'LPL' },
  { name: 'Blanket1', serial: 67801, lanes: 2, type: 'Blanket' },
  { name: 'SPL1', serial: 67800, lanes: 4, type: 'SPL' }
];

testMachines.forEach(testMachine => {
  console.log(`\n🔧 Testing ${testMachine.name} (${testMachine.type}):`);
  console.log(`   Serial: ${testMachine.serial}, Lanes: ${testMachine.lanes}`);
  
  // Temporarily update config for testing
  const originalConfig = { ...config.machine };
  config.machine = { ...config.machine, ...testMachine };
  
  const activeStations = getActiveStations();
  console.log(`   Active Stations: ${activeStations.join(', ')}`);
  
  const operators = getStationOperators();
  console.log(`   Operators:`);
  operators.forEach(op => {
    const status = op.id.toString().startsWith('1') ? '✅ Active' : '❌ Inactive';
    console.log(`     Station ${op.station}: ${op.id} ${status}`);
  });
  
  // Test state record
  const stateRecord = buildStateRecord('Running');
  console.log(`   Program Stations: ${stateRecord.program.stations}`);
  console.log(`   Items: All lanes use item ID ${Object.values(stateRecord.program.items)[0].id}`);
  
  // Restore original config
  config.machine = originalConfig;
});

console.log('\n✅ Configuration test complete!'); 