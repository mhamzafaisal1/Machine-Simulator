#!/usr/bin/env node

// test-operator-uniqueness.js - Test script for operator uniqueness safeguards
const { MongoClient } = require('mongodb');
const config = require('./config');

async function testOperatorUniqueness() {
  console.log('🧪 Testing Operator Uniqueness Safeguards');
  console.log('==========================================');
  console.log(`🔗 Using MongoDB: ${config.mongoUri}/${config.dbName}`);
  
  const client = new MongoClient(config.mongoUri);
  
  try {
    await client.connect();
    console.log('🔗 Connected to MongoDB');
    
    const db = client.db(config.dbName);
    const tickerCollection = db.collection(config.simulatedOperatorsTickerCollectionName);
    const operatorsCollection = db.collection(config.operatorCollectionName);
    
    // Test 1: Check current operator assignments
    console.log('\n📋 Test 1: Current Operator Assignments');
    const currentAssignments = await tickerCollection.find({}).toArray();
    console.log(`✅ Found ${currentAssignments.length} current operator assignments`);
    
    if (currentAssignments.length > 0) {
      console.log('\n   Current Assignments:');
      currentAssignments.forEach(assignment => {
        console.log(`   - Operator ${assignment.operatorId} on Machine ${assignment.machineSerial}, Station ${assignment.station}`);
      });
    }
    
    // Test 2: Check for duplicate operator assignments
    console.log('\n📋 Test 2: Checking for Duplicate Operator Assignments');
    const operatorIds = currentAssignments.map(a => a.operatorId);
    const uniqueOperatorIds = [...new Set(operatorIds)];
    
    if (operatorIds.length === uniqueOperatorIds.length) {
      console.log('✅ No duplicate operator assignments found');
    } else {
      console.log('❌ Duplicate operator assignments detected!');
      const duplicates = operatorIds.filter((id, index) => operatorIds.indexOf(id) !== index);
      console.log(`   Duplicate operators: ${duplicates.join(', ')}`);
    }
    
    // Test 3: Check for operators assigned to multiple machines
    console.log('\n📋 Test 3: Checking for Cross-Machine Operator Conflicts');
    const operatorMachineMap = new Map();
    let hasConflicts = false;
    
    currentAssignments.forEach(assignment => {
      const key = assignment.operatorId;
      if (operatorMachineMap.has(key)) {
        const existing = operatorMachineMap.get(key);
        if (existing.machineSerial !== assignment.machineSerial) {
          console.log(`❌ Operator ${key} assigned to multiple machines: ${existing.machineSerial} and ${assignment.machineSerial}`);
          hasConflicts = true;
        }
      } else {
        operatorMachineMap.set(key, assignment);
      }
    });
    
    if (!hasConflicts) {
      console.log('✅ No cross-machine operator conflicts found');
    }
    
    // Test 4: Check for operators assigned to multiple stations on same machine
    console.log('\n📋 Test 4: Checking for Multi-Station Operator Conflicts');
    const machineStationMap = new Map();
    let hasStationConflicts = false;
    
    currentAssignments.forEach(assignment => {
      const key = `${assignment.machineSerial}-${assignment.operatorId}`;
      if (machineStationMap.has(key)) {
        const existing = machineStationMap.get(key);
        if (existing.station !== assignment.station) {
          console.log(`❌ Operator ${assignment.operatorId} assigned to multiple stations on machine ${assignment.machineSerial}: ${existing.station} and ${assignment.station}`);
          hasStationConflicts = true;
        }
      } else {
        machineStationMap.set(key, assignment);
      }
    });
    
    if (!hasStationConflicts) {
      console.log('✅ No multi-station operator conflicts found');
    }
    
    // Test 5: Validate operator data integrity
    console.log('\n📋 Test 5: Validating Operator Data Integrity');
    const allOperators = await operatorsCollection.find({}, { projection: { code: 1, name: 1 } }).toArray();
    console.log(`✅ Found ${allOperators.length} operators in database`);
    
    const assignedOperatorIds = currentAssignments.map(a => a.operatorId);
    const validOperatorIds = allOperators.map(op => op.code);
    
    const invalidAssignments = assignedOperatorIds.filter(id => !validOperatorIds.includes(id));
    if (invalidAssignments.length > 0) {
      console.log(`❌ Found ${invalidAssignments.length} assignments with invalid operator IDs: ${invalidAssignments.join(', ')}`);
    } else {
      console.log('✅ All operator assignments reference valid operator IDs');
    }
    
    // Test 6: Summary and recommendations
    console.log('\n📋 Test 6: Summary and Recommendations');
    const totalConflicts = (operatorIds.length !== uniqueOperatorIds.length ? 1 : 0) + 
                          (hasConflicts ? 1 : 0) + 
                          (hasStationConflicts ? 1 : 0) + 
                          (invalidAssignments.length > 0 ? 1 : 0);
    
    if (totalConflicts === 0) {
      console.log('🎉 All operator uniqueness checks passed!');
      console.log('   The safeguards are working correctly.');
    } else {
      console.log(`⚠️  Found ${totalConflicts} types of operator conflicts`);
      console.log('   Consider running the simulator to test the new safeguards.');
    }
    
    console.log('\n📊 Statistics:');
    console.log(`   Total assignments: ${currentAssignments.length}`);
    console.log(`   Unique operators assigned: ${uniqueOperatorIds.length}`);
    console.log(`   Total operators available: ${allOperators.length}`);
    console.log(`   Assignment coverage: ${((uniqueOperatorIds.length / allOperators.length) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await client.close();
  }
}

// Run the test
if (require.main === module) {
  testOperatorUniqueness().catch(console.error);
}

module.exports = { testOperatorUniqueness }; 