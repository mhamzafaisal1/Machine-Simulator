// utils.js
const config = require('./config');

function getRandomDelay(minMinutes, maxMinutes) {
  return (Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes) * 60 * 1000;
}

function getRandomOperators() {
  const shuffled = config.operatorPool.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 8);
}

function getActiveStations() {
  // Determine active stations based on lanes configuration
  const lanes = config.machine.lanes;
  
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

function getStationOperators() {
  const shuffled = config.operatorPool.sort(() => 0.5 - Math.random());
  const operators = [];
  const activeStations = getActiveStations();
  
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
          id: parseInt('9' + config.machine.serial.toString()),
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

function buildStateRecord(stateType) {
  const statusMap = {
    Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
    Running: { code: 1, name: "Run", softrolColor: "Green" },
    Fault:   { code: Math.floor(Math.random() * 99) + 2, name: "Fault", softrolColor: "Red" }
  };

  const status = stateType === "Fault" ? statusMap.Fault : statusMap[stateType];
  const items = getRandomItemPerStation();
  const operators = getStationOperators();
  const activeStations = getActiveStations();

  return {
    timestamp: new Date(),
    machine: {
      serial: config.machine.serial,
      name: config.machine.name,
      ipAddress: config.machine.ipAddress
    },
    program: {
      mode: "smallPiece",
      programNumber: 1,
      batchNumber: Math.floor(Math.random() * 21) + 20,
      accountNumber: 0,
      speed: 0,
      stations: config.machine.lanes, // Use lanes count as stations
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
  getActiveStations
};
  