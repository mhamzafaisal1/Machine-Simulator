// utils.js
const config = require('./config');

function getRandomDelay(minMinutes, maxMinutes) {
  return (Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes) * 60 * 1000;
}

// Updated to use MongoDB instead of hardcoded config
async function getRandomOperators(db) {
  try {
    const operatorsCollection = db.collection(config.operatorCollectionName);
    const operators = await operatorsCollection.find({}, { projection: { _id: 0 } }).toArray();
    
    // Filter out operators starting with 9
    const filteredOperators = operators.filter(op => !op.code.toString().startsWith('9'));
    
    const shuffled = filteredOperators.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 8);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error fetching operators from MongoDB:`, error.message);
    // Fallback to empty array if MongoDB fails
    return [];
  }
}

// New function to get operator name from MongoDB
async function getOperatorName(db, operatorId) {
  try {
    const operatorsCollection = db.collection(config.operatorCollectionName);
    const operator = await operatorsCollection.findOne(
      { code: operatorId },
      { projection: { name: 1 } }
    );
    return operator ? operator.name : "Unknown";
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error querying operator name for ID ${operatorId}:`, error.message);
    return "Unknown";
  }
}

// New function to get operator names for multiple operators
async function getOperatorNames(db, operators) {
  const operatorsWithNames = [];
  
  for (const operator of operators) {
    if (operator.id > 0 && operator.id < 900000) { // Real operator (not dummy or -1)
      const name = await getOperatorName(db, operator.id);
      operatorsWithNames.push({
        ...operator,
        name: name
      });
    } else {
      // For dummy operators or -1, keep as is
      operatorsWithNames.push({
        ...operator,
        name: "None"
      });
    }
  }
  
  return operatorsWithNames;
}

function getActiveStations(machineConfig = null) {
  // Use provided machine config or fall back to default config
  const targetConfig = machineConfig || config.machine;
  
  // If machine config has stations array, use it directly
  if (targetConfig.stations && Array.isArray(targetConfig.stations)) {
    return targetConfig.stations;
  }
  
  // Otherwise, determine active stations based on lanes configuration
  const lanes = targetConfig.lanes;
  
  // Each lane gets its own station (1, 2, 3, 4 based on number of lanes)
  const activeStations = [];
  for (let i = 1; i <= lanes; i++) {
    activeStations.push(i);
  }
  
  return activeStations;
}

// Updated to use MongoDB instead of hardcoded config
async function getStationOperators(db, machineConfig = null) {
  try {
    const operatorsCollection = db.collection(config.operatorCollectionName);
    const allOperators = await operatorsCollection.find({}, { projection: { _id: 0 } }).toArray();
    
    // Filter out operators starting with 9
    const filteredOperators = allOperators.filter(op => !op.code.toString().startsWith('9'));
    
    const shuffled = filteredOperators.sort(() => 0.5 - Math.random());
    
    const operators = [];
    const activeStations = getActiveStations(machineConfig);
    const targetConfig = machineConfig || config.machine;
    
    // Create operators array for all 4 stations (1-4)
    for (let station = 1; station <= 4; station++) {
      if (activeStations.includes(station)) {
        // Active station - assign real operator
        const operatorIndex = (station - 1) % shuffled.length; // Use modulo to avoid index out of bounds
        const operator = shuffled[operatorIndex];
        operators.push({
          id: operator.code,
          station: station
        });
      } else {
        // Inactive station - assign -1 (no operator)
        operators.push({
          id: -1,
          station: station
        });
      }
    }
    
    return operators;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error fetching operators from MongoDB:`, error.message);
    // Fallback to dummy operators if MongoDB fails
    const operators = [];
    const activeStations = getActiveStations(machineConfig);
    
    for (let station = 1; station <= 4; station++) {
      operators.push({
        id: -1,
        station: station
      });
    }
    
    return operators;
  }
}

function getRandomItemId() {
  return config.itemIds[Math.floor(Math.random() * config.itemIds.length)];
}

function getRandomItemPerStation() {
  // For now, same item across all stations (can be extended for SPF flexibility)
  const itemId = getRandomItemId();
  const items = {};
  for (let i = 0; i < 8; i++) {
    items[i.toString()] = { id: itemId, count: 0 };
  }
  return items;
}

// Updated to use MongoDB for operators
async function buildStateRecord(db, stateType, machineConfig = null) {
  const statusMap = {
    Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
    Running: { code: 1, name: "Run", softrolColor: "Green" },
    Fault:   { code: Math.floor(Math.random() * 99) + 2, name: "Fault", softrolColor: "Red" }
  };

  const status = stateType === "Fault" ? statusMap.Fault : statusMap[stateType];
  const items = getRandomItemPerStation();
  const operators = await getStationOperators(db, machineConfig);
  const activeStations = getActiveStations(machineConfig);
  const targetConfig = machineConfig || config.machine;

  return {
    timestamp: new Date(),
    machine: {
      serial: targetConfig.serial,
      name: targetConfig.name,
      ipAddress: targetConfig.ipAddress
    },
    program: {
      mode: "smallPiece",
      programNumber: 1,
      batchNumber: Math.floor(Math.random() * 21) + 20,
      accountNumber: 0,
      speed: 0,
      stations: targetConfig.lanes, // Use lanes count as stations
      items
    },
    operators: operators,
    status
  };
}

module.exports = {
  getRandomDelay,
  buildStateRecord,
  getRandomOperators,
  getStationOperators,
  getRandomItemPerStation,
  getActiveStations,
  getOperatorName,
  getOperatorNames
};
  