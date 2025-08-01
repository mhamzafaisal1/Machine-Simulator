#!/usr/bin/env node

// test-mongo-integration.js - Test script for MongoDB machine data integration
const { getMachines, getActiveMachines, validateAllMachines, clearCache } = require('./fillmore-machines');

async function testMongoIntegration() {
  console.log('🧪 Testing MongoDB Machine Data Integration');
  console.log('===========================================');
  
  try {
    // Test 1: Fetch all machines
    console.log('\n📋 Test 1: Fetching all machines from MongoDB...');
    const allMachines = await getMachines();
    console.log(`✅ Successfully fetched ${allMachines.length} machines`);
    
    allMachines.forEach((machine, index) => {
      console.log(`   ${index + 1}. ${machine.name} (${machine.type}) - ${machine.lanes} lanes - Stations: [${machine.stations.join(', ')}]`);
    });
    
    // Test 2: Get active machines only
    console.log('\n📋 Test 2: Fetching active machines only...');
    const activeMachines = await getActiveMachines();
    console.log(`✅ Found ${activeMachines.length} active machines`);
    
    activeMachines.forEach((machine, index) => {
      console.log(`   ${index + 1}. ${machine.name} (${machine.type}) - ${machine.lanes} lanes - Active: ${machine.active}`);
    });
    
    // Test 3: Validate machine configurations
    console.log('\n📋 Test 3: Validating machine configurations...');
    await validateAllMachines();
    
    // Test 4: Test caching
    console.log('\n📋 Test 4: Testing cache functionality...');
    console.log('   Fetching machines again (should use cache)...');
    const cachedMachines = await getMachines();
    console.log(`✅ Cached fetch returned ${cachedMachines.length} machines`);
    
    console.log('   Clearing cache...');
    clearCache();
    
    console.log('   Fetching machines after cache clear...');
    const freshMachines = await getMachines();
    console.log(`✅ Fresh fetch returned ${freshMachines.length} machines`);
    
    // Test 5: Show machine type distribution
    console.log('\n📋 Test 5: Machine type distribution...');
    const machineTypes = {};
    allMachines.forEach(machine => {
      machineTypes[machine.type] = (machineTypes[machine.type] || 0) + 1;
    });
    
    Object.entries(machineTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} machine(s)`);
    });
    
    // Test 6: Show lanes distribution
    console.log('\n📋 Test 6: Lanes distribution...');
    const lanesDistribution = {};
    allMachines.forEach(machine => {
      lanesDistribution[machine.lanes] = (lanesDistribution[machine.lanes] || 0) + 1;
    });
    
    Object.entries(lanesDistribution).forEach(([lanes, count]) => {
      console.log(`   ${lanes} lane(s): ${count} machine(s)`);
    });
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n🎯 Summary:');
    console.log(`   Total machines: ${allMachines.length}`);
    console.log(`   Active machines: ${activeMachines.length}`);
    console.log(`   Machine types: ${Object.keys(machineTypes).length}`);
    console.log(`   Lanes configurations: ${Object.keys(lanesDistribution).length}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testMongoIntegration().catch(console.error);
}

module.exports = { testMongoIntegration }; 