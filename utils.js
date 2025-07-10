// utils.js
const config = require('./config');

function getRandomDelay(minMinutes, maxMinutes) {
  return (Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes) * 60 * 1000;
}

function getRandomOperators() {
  const shuffled = config.operatorPool.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 8);
}

// New function to get operator name from MongoDB
async function getOperatorName(db, operatorId) {
  try {
    const operatorsCollection = db.collection('operator');
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
  
  switch (lanes) {
    case 1:
      return [1]; // SPF machines
    case 2:
      return [1, 3]; // Blanket machines (stations 1 and 3)
    case 3:
      return [1, 2, 3]; // LPL machines
    case 4:
      return [1, 2, 3, 4]; // SPL machines
    default:
      return [1]; // Default to single station
  }
}

function getStationOperators(machineConfig = null) {
  const shuffled = config.operatorPool.sort(() => 0.5 - Math.random());
  const operators = [];
  const activeStations = getActiveStations(machineConfig);
  const targetConfig = machineConfig || config.machine;
  
  // Create operators array for all 4 stations (1-4)
  for (let station = 1; station <= 4; station++) {
    if (activeStations.includes(station)) {
      // Active station - assign real operator
      const operatorIndex = (station - 1) * config.operatorsPerStation;
      const operator = shuffled[operatorIndex];
      operators.push({
        id: operator.code,
        station: station
      });
    } else {
      // Inactive station - assign dummy or -1
      if (station === 2 && !activeStations.includes(2)) {
        // Station 2 gets dummy operator (9 + machine serial) for Blanket machines
        operators.push({
          id: parseInt('9' + targetConfig.serial.toString()),
          station: station
        });
      } else {
        // Other inactive stations get -1
        operators.push({
          id: -1,
          station: station
        });
      }
    }
  }
  
  return operators;
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

function buildStateRecord(stateType, machineConfig = null) {
  const statusMap = {
    Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
    Running: { code: 1, name: "Run", softrolColor: "Green" },
    Fault:   { code: Math.floor(Math.random() * 99) + 2, name: "Fault", softrolColor: "Red" }
  };

  const status = stateType === "Fault" ? statusMap.Fault : statusMap[stateType];
  const items = getRandomItemPerStation();
  const operators = getStationOperators(machineConfig);
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
  