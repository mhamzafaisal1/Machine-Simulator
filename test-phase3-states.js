/**
 * Test Phase 3 State Adapters
 */

const schemaAdapters = require('./schema-adapters');
const schemaValidator = require('./schema-validator');

console.log('🧪 Testing Phase 3 State Adapters\n');

// Test 1: Running State Adapter
console.log('Test 1: Running State (SPF machine with multiple items)');
const testRunningStateSPF = {
  timestamp: new Date(),
  machine: {
    serial: 68012,
    name: 'SPF2',
    ipAddress: '192.168.0.2'
  },
  program: {
    mode: 'smallPiece',
    programNumber: 1,
    batchNumber: 24,
    accountNumber: 0,
    speed: 0,
    stations: 4,
    items: [
      { id: 26, name: 'Bath Towels', standard: 1800, count: 0 },
      { id: 27, name: 'Hand Towels', standard: 2400, count: 0 },
      { id: 28, name: 'Washcloths', standard: 3600, count: 0 },
      { id: 29, name: 'Bath Mats', standard: 1200, count: 0 }
    ]
  },
  operators: [
    {
      id: 135812,
      name: 'Ruben Rodriguez',
      station: 1,
      rate: 1
    }
  ],
  status: { code: 1, name: 'Run', softrolColor: 'Green' }
};

const adaptedRunningSPF = schemaAdapters.adaptState(testRunningStateSPF);
const runningValidSPF = schemaValidator.validate('state', adaptedRunningSPF, { test: 'running-spf' });
console.log(`✅ Running State (SPF) validation: ${runningValidSPF ? 'PASS' : 'FAIL'}\n`);

// Test 2: Running State (Single item machine)
console.log('Test 2: Running State (Single item machine)');
const testRunningStateSingle = {
  timestamp: new Date(),
  machine: {
    serial: 67798,
    name: 'LPL1',
    ipAddress: '192.168.0.8'
  },
  program: {
    mode: 'smallPiece',
    programNumber: 1,
    batchNumber: 24,
    accountNumber: 0,
    speed: 0,
    stations: 3,
    items: [
      { id: 26, name: 'Bath Towels', standard: 1800, count: 0 }
    ]
  },
  operators: [
    {
      id: 135812,
      name: 'Ruben Rodriguez',
      station: 1,
      rate: 1
    },
    {
      id: 135813,
      name: 'Maria Garcia',
      station: 2,
      rate: 1
    }
  ],
  status: { code: 1, name: 'Run', softrolColor: 'Green' }
};

const adaptedRunningSingle = schemaAdapters.adaptState(testRunningStateSingle);
const runningValidSingle = schemaValidator.validate('state', adaptedRunningSingle, { test: 'running-single' });
console.log(`✅ Running State (Single) validation: ${runningValidSingle ? 'PASS' : 'FAIL'}\n`);

// Test 3: Timeout State
console.log('Test 3: Timeout State');
const testTimeoutState = {
  timestamp: new Date(),
  machine: {
    serial: 68012,
    name: 'SPF2',
    ipAddress: '192.168.0.2'
  },
  program: {
    mode: 'smallPiece',
    programNumber: 1,
    batchNumber: 24,
    accountNumber: 0,
    speed: 0,
    stations: 1,
    items: [
      { id: 26, name: 'Bath Towels', standard: 1800, count: 0 }
    ]
  },
  operators: [],
  status: { code: 0, name: 'Timeout', softrolColor: 'Grey' }
};

const adaptedTimeout = schemaAdapters.adaptState(testTimeoutState);
const timeoutValid = schemaValidator.validate('state', adaptedTimeout, { test: 'timeout' });
console.log(`✅ Timeout State validation: ${timeoutValid ? 'PASS' : 'FAIL'}\n`);

// Test 4: Fault State
console.log('Test 4: Fault State');
const testFaultState = {
  timestamp: new Date(),
  machine: {
    serial: 68012,
    name: 'SPF2',
    ipAddress: '192.168.0.2'
  },
  program: {
    mode: 'smallPiece',
    programNumber: 1,
    batchNumber: 24,
    accountNumber: 0,
    speed: 0,
    stations: 1,
    items: [
      { id: 26, name: 'Bath Towels', standard: 1800, count: 0 }
    ]
  },
  operators: [
    {
      id: 135812,
      name: 'Ruben Rodriguez',
      station: 1,
      rate: 1
    }
  ],
  status: { code: 17, name: 'Motor Fault', softrolColor: 'Red' }
};

const adaptedFault = schemaAdapters.adaptState(testFaultState);
const faultValid = schemaValidator.validate('state', adaptedFault, { test: 'fault' });
console.log(`✅ Fault State validation: ${faultValid ? 'PASS' : 'FAIL'}\n`);

// Print statistics
console.log('\n📊 Validation Statistics:');
schemaValidator.printStats();

console.log('\n🎯 Summary:');
console.log(`Running (SPF): ${runningValidSPF ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Running (Single): ${runningValidSingle ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Timeout: ${timeoutValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Fault: ${faultValid ? '✅ PASS' : '❌ FAIL'}`);

const allPass = runningValidSPF && runningValidSingle && timeoutValid && faultValid;
console.log(`\n${allPass ? '🎉 All state tests passed!' : '⚠️ Some state tests failed'}`);

process.exit(allPass ? 0 : 1);
