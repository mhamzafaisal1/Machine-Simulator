// config.js - Auto-generated from CLI arguments with environment variables
module.exports = {
    // MongoDB connection settings (centralized)
    mongoUri: 'mongodb://localhost:27017/chitrac',
    dbName: 'chitrac',
    collectionName: 'state-machine', // Renamed from 'state' to 'state-machine'
    countCollectionName: 'count',
    machineCollectionName: 'machine',
    operatorCollectionName: 'operator',
    faultCollectionName: 'fault',
    itemCollectionName: 'item',
    stateTickerCollectionName: 'stateTicker',
    simulatedOperatorsTickerCollectionName: 'simulated-operators-ticker',
    
    // Machine session tracking collection
    machineSessionCollectionName: 'machine-session',
    
    // Operator session tracking collection
    operatorSessionCollectionName: 'operator-session',
    
    // Fault session tracking collection
    faultSessionCollectionName: 'fault-session',
    
        // Additional collections for state data (same data, multiple collections)
    stateMachineDailyCollectionName: 'state-machine-daily',
    stateMachineWeeklyCollectionName: 'state-machine-weekly',
    stateMachineMonthlyCollectionName: 'state-machine-monthly',

    // Additional collections for operator state data (one record per operator)
    stateOperatorCollectionName: 'state-operator',
    stateOperatorDailyCollectionName: 'state-operator-daily',
    stateOperatorWeeklyCollectionName: 'state-operator-weekly',
    stateOperatorMonthlyCollectionName: 'state-operator-monthly',

    // Additional collections for count data (same data, multiple collections)
    countDailyCollectionName: 'count-daily',
    countWeeklyCollectionName: 'count-weekly',
    countMonthlyCollectionName: 'count-monthly',
  
    // Machine data from CLI arguments
    machine: {
      serial: 67798,
      name: 'SPL1',
      ipAddress: '192.168.0.11',
      active: true,
      lanes: 3, // Determined by machine type
      type: 'LPL' // Machine type from CLI
    },
  
    // Note: Operators are now fetched from MongoDB 'operator' collection
    // Items are now fetched from MongoDB 'item' collection
    // No longer using hardcoded operator pool or item IDs
  };
