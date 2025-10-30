/**
 * Test Phase 2 Schema Adapters
 */

const schemaAdapters = require('./schema-adapters');
const schemaValidator = require('./schema-validator');

console.log('🧪 Testing Phase 2 Schema Adapters\n');

// Test 1: Count Adapter
console.log('Test 1: Count Adapter');
const testCount = {
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
    items: [{ id: 26, count: 0 }]
  },
  operator: {
    id: 135812,
    name: 'Ruben Rodriguez',
    station: 1
  },
  item: {
    id: 26,
    name: 'Bath Towels',
    standard: 1800
  },
  station: 1,
  lane: 1
};

const adaptedCount = schemaAdapters.adaptCount(testCount);
const countValid = schemaValidator.validate('count', adaptedCount, { test: 'count' });
console.log(`✅ Count validation: ${countValid ? 'PASS' : 'FAIL'}\n`);

// Test 2: Misfeed Adapter
console.log('Test 2: Misfeed Adapter');
const testMisfeed = {
  ...testCount,
  misfeed: true
};

const adaptedMisfeed = schemaAdapters.adaptMisfeed(testMisfeed);
const misfeedValid = schemaValidator.validate('misfeed', adaptedMisfeed, { test: 'misfeed' });
console.log(`✅ Misfeed validation: ${misfeedValid ? 'PASS' : 'FAIL'}\n`);

// Test 3: Operator Adapter
console.log('Test 3: Operator Adapter');
const testOperator = {
  code: 111222,
  name: 'John Doe',
  rate: 1
};

const adaptedOperator = schemaAdapters.adaptOperator(testOperator);
const operatorValid = schemaValidator.validate('operator', adaptedOperator, { test: 'operator' });
console.log(`✅ Operator validation: ${operatorValid ? 'PASS' : 'FAIL'}\n`);

// Test 4: Machine Adapter
console.log('Test 4: Machine Adapter');
const testMachine = {
  serial: 68012,
  name: 'SPF2',
  active: true,
  ipAddress: '192.168.0.2',
  lanes: 1,
  stations: [1],
  type: 'SPF',
  groups: []
};

const adaptedMachine = schemaAdapters.adaptMachine(testMachine);
const machineValid = schemaValidator.validate('machine', adaptedMachine, { test: 'machine' });
console.log(`✅ Machine validation: ${machineValid ? 'PASS' : 'FAIL'}\n`);

// Test 5: Item Adapter
console.log('Test 5: Item Adapter');
const testItem = {
  number: 26,
  name: 'Bath Towels',
  standard: 1800
};

const adaptedItem = schemaAdapters.adaptItem(testItem);
const itemValid = schemaValidator.validate('item', adaptedItem, { test: 'item' });
console.log(`✅ Item validation: ${itemValid ? 'PASS' : 'FAIL'}\n`);

// Print statistics
console.log('\n📊 Validation Statistics:');
schemaValidator.printStats();

console.log('\n🎯 Summary:');
console.log(`Count: ${countValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Misfeed: ${misfeedValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Operator: ${operatorValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Machine: ${machineValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Item: ${itemValid ? '✅ PASS' : '❌ FAIL'}`);

const allPass = countValid && misfeedValid && operatorValid && machineValid && itemValid;
console.log(`\n${allPass ? '🎉 All tests passed!' : '⚠️ Some tests failed'}`);

process.exit(allPass ? 0 : 1);
