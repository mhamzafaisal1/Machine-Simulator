// utils.js
const config = require('./config');

function getRandomDelay(minMinutes, maxMinutes) {
  return (Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes) * 60 * 1000;
}

function getRandomOperators() {
  const shuffled = config.operatorPool.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 8);
}

function getRandomItemId() {
  return config.itemIds[Math.floor(Math.random() * config.itemIds.length)];
}

function buildStateRecord(stateType) {
  const statusMap = {
    Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
    Running: { code: 1, name: "Run", softrolColor: "Green" },
    Fault:   { code: Math.floor(Math.random() * 99) + 2, name: "Fault", softrolColor: "Red" }
  };

  const status = stateType === "Fault" ? statusMap.Fault : statusMap[stateType];
  const itemNumber = getRandomItemId();
  const items = {};
  for (let i = 0; i < 8; i++) {
    items[i.toString()] = { number: itemNumber, count: 0 };
  }

  return {
    timestamp: new Date(),
    machine: {
      serial: config.machine.serial,
      name: config.machine.name,
      ipAddress: config.machine.ipAddress,
      active: config.machine.active,
      lanes: config.machine.lanes
    },
    program: {
      mode: "smallPiece",
      programNumber: 1,
      batchNumber: Math.floor(Math.random() * 21) + 20,
      accountNumber: 0,
      speed: 0,
      stations: 0,
      items
    },
    operators: getRandomOperators(),
    status
  };
}

module.exports = {
  getRandomDelay,
  buildStateRecord,
  getRandomOperators
};
  