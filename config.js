// config.js - Auto-generated from CLI arguments
module.exports = {
    // MongoDB connection matching chitrac-api structure
    mongoUri: 'mongodb://localhost:27017/chitrac',
    dbName: 'chitrac',
    collectionName: 'state',
    countCollectionName: 'count',
  
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
  
    // Operator pool matching chitrac-api format (using 'code' field instead of 'id')
    operatorPool: [
      { code: 135790, name: "Lilliana Ashca", active: true },
      { code: 135791, name: "Jessica Barrera", active: true },
      { code: 135792, name: "Lashiyah Blakemore", active: true },
      { code: 135793, name: "Paul Carroll", active: true },
      { code: 135794, name: "Martinez Carter", active: true },
      { code: 135795, name: "Maria Changuluisa", active: true },
      { code: 135796, name: "Flor Changuluisa", active: true },
      { code: 135797, name: "Natalie Chavez", active: true },
      { code: 135798, name: "Akura Coleman", active: true },
      { code: 135799, name: "Lakeesha Davis", active: true }
    ],

    // Station-specific operator assignments (operators per station)
    operatorsPerStation: 1 // Number of operators assigned to each station
  };
