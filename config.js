// config.js - Auto-generated from CLI arguments with environment variables
module.exports = {
    // MongoDB connection settings (centralized)
    mongoUri: 'mongodb://localhost:27017/chitrac',
    dbName: 'chitrac',
    collectionName: 'state',
    countCollectionName: 'count',
    machineCollectionName: 'machine',
    operatorCollectionName: 'operator',
    faultCollectionName: 'fault',
    stateTickerCollectionName: 'stateTicker',
    simulatedOperatorsTickerCollectionName: 'simulated-operators-ticker',
  
    // Machine data from CLI arguments
    machine: {
      serial: 67798,
      name: 'SPL1',
      ipAddress: '192.168.0.11',
      active: true,
      lanes: 3, // Determined by machine type
      type: 'LPL' // Machine type from CLI
    },
  
    // Item IDs matching chitrac-api defaults (using 'number' field)
    itemIds: [26, 30, 33], // HospitalSheet, Large Thermal Blanket, Mixed Towels
  
    // Note: Operators are now fetched from MongoDB 'operator' collection
    // No longer using hardcoded operator pool
  };
