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
    const filteredOperators = operators.filter(op => op.code.toString().startsWith('1'));
    
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
      { projection: { name: 1, code: 1, active: 1, area: 1, category: 1, department: 1, rate: 1 } }
    );
    if (!operator) return "Unknown";

    // ⭐ Adapt operator to schema format
    const schemaAdapters = require('./schema-adapters');
    const adapted = schemaAdapters.adaptOperatorFromDB(operator);
    return adapted.name_string || adapted.name;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error querying operator name for ID ${operatorId}:`, error.message);
    return "Unknown";
  }
}

// New function to get operator names for multiple operators
async function getOperatorNames(db, operators) {
  const operatorsWithNames = [];

  for (const operator of operators) {
    if (isValidOperatorId(operator.id)) { // Real operator (not dummy or -1)
      const name = await getOperatorName(db, operator.id);
      operatorsWithNames.push({
        ...operator,
        name: name,
        name_string: name // Add backward compatibility
      });
    } else {
      // For dummy operators or -1, keep as is
      operatorsWithNames.push({
        ...operator,
        name: "None",
        name_string: "None"
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
    const filteredOperators = allOperators.filter(op => op.code.toString().startsWith('1'));
    
    const shuffled = filteredOperators.sort(() => 0.5 - Math.random());
    
    const operators = [];
    const activeStations = getActiveStations(machineConfig);
    const targetConfig = machineConfig || config.machine;
    
    // Create operators array for all stations based on machine lanes
    const maxStations = targetConfig.lanes || 1; // Use lanes from machine config, default to 1
    
    for (let station = 1; station <= maxStations; station++) {
      if (activeStations.includes(station)) {
        // Active station - assign real operator
        const operatorIndex = (station - 1) % shuffled.length; // Use modulo to avoid index out of bounds
        const operator = shuffled[operatorIndex];
        operators.push({
          id: operator.code,
          station: station
        });
        console.log(`[${new Date().toISOString()}] 👤 Assigned operator ${operator.code} to lane ${station} (station ${station})`);
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
    const maxStations = (machineConfig || config.machine).lanes || 1;
    
    for (let station = 1; station <= maxStations; station++) {
      operators.push({
        id: -1,
        station: station
      });
    }
    
    return operators;
  }
}



// DEPRECATED: This function is no longer used since items are loaded from MongoDB
// Keeping for backward compatibility but should not be used
function getRandomItemPerStation(machineConfig = null) {
  console.warn(`[${new Date().toISOString()}] ⚠️ getRandomItemPerStation() is deprecated. Items are now loaded from MongoDB.`);
  // Return a fallback structure for backward compatibility
  const items = [{ id: 26, count: 0 }]; // Default fallback item as array, not object
  return items;
}

// New function to load items from MongoDB item collection
async function loadItems(db) {
  try {
    const itemCollection = db.collection(config.itemCollectionName);
    const items = await itemCollection.find({ active: true }).toArray();

    // Validate items
    const validItems = items.filter(item => {
      // Check required fields
      if (!item.number || !item.name || item.standard === undefined) {
        console.warn(`[${new Date().toISOString()}] ⚠️ Skipping item with missing required fields:`, item);
        return false;
      }

      // Validate standard field
      if (typeof item.standard !== 'number' || !isFinite(item.standard) || item.standard <= 0) {
        console.warn(`[${new Date().toISOString()}] ⚠️ Skipping item with invalid standard value:`, item);
        return false;
      }

      return true;
    });

    if (validItems.length === 0) {
      throw new Error('❌ No valid active items found in database');
    }

    // ⭐ Adapt items to schema format
    const schemaAdapters = require('./schema-adapters');
    const adaptedItems = validItems.map(item => schemaAdapters.adaptItemFromDB(item));

    console.log(`[${new Date().toISOString()}] ✅ Loaded ${adaptedItems.length} valid items from database`);
    return adaptedItems;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error loading items from MongoDB:`, error.message);
    throw error;
  }
}

// New function to select a random item from the loaded items
function selectRandomItem(items) {
  if (!items || items.length === 0) {
    throw new Error('❌ No items available for selection');
  }
  
  const randomIndex = Math.floor(Math.random() * items.length);
  const selectedItem = items[randomIndex];
  
  console.log(`[${new Date().toISOString()}] 🎯 Selected item: ${selectedItem.name} (ID: ${selectedItem.number}, Standard: ${selectedItem.standard})`);
  return selectedItem;
}

// New function to determine if item should change based on 85/15 rule
function shouldChangeItem() {
  const randomValue = Math.random() * 100;
  const shouldChange = randomValue >= 95; // 5% chance to change item
  
  console.log(`[${new Date().toISOString()}] 🎲 Item change roll: ${randomValue.toFixed(2)} - ${shouldChange ? 'Changing item' : 'Keeping same item'}`);
  return shouldChange;
}

// New function to calculate timing based on item standard
function calculateItemTiming(item) {
  if (!item || !item.standard) {
    throw new Error('❌ Invalid item for timing calculation');
  }
  
  const secondsPerPiece = 3600 / item.standard;
  const lowRange = secondsPerPiece * 0.75;
  const highRange = secondsPerPiece * 2.5;
  
  // Reduced logging to prevent console spam - only log occasionally
  // console.log(`[${new Date().toISOString()}] ⏱️ Item timing - Standard: ${item.standard} pph, Seconds per piece: ${secondsPerPiece.toFixed(2)}, Range: ${lowRange.toFixed(2)}-${highRange.toFixed(2)}s`);
  
  return {
    secondsPerPiece,
    lowRange,
    highRange
  };
}

// Helper function to validate operator IDs
function isValidOperatorId(id) {
  return typeof id === 'number' && id > 0 && id.toString()[0] !== '9';
}

// Updated to use MongoDB for operators
async function buildStateRecord(db, stateType, machineConfig = null) {
  const statusMap = {
    Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
    Running: { code: 1, name: "Run", softrolColor: "Green" },
    Fault:   { code: 0, name: "Fault", softrolColor: "Red" } // Will be overridden with actual fault code
  };

  let status = stateType === "Fault" ? statusMap.Fault : statusMap[stateType];

  const targetConfig = machineConfig || config.machine; // ✅ Moved here to fix the bug

  // For Fault state, get actual fault from database
  if (stateType === "Fault") {
    try {
      const faultCollection = db.collection(config.faultCollectionName);
      const faults = await faultCollection.find({}).sort({ code: 1 }).toArray();
      if (faults.length > 0) {
        const randomFault = faults[Math.floor(Math.random() * faults.length)];
        status = {
          code: randomFault.code,
          name: randomFault.name || randomFault.description || "Fault",
          softrolColor: "Red"
        };
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error fetching fault from database:`, error.message);
      // Fallback to default fault
      status = { code: 17, name: "Fault", softrolColor: "Red" };
    }
  }

  const items = [{ id: 26, count: 0 }]; // Default fallback item as array, not object

  const operators = await getStationOperators(db, machineConfig);
  const activeStations = getActiveStations(machineConfig);

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
      stations: targetConfig.lanes,
      items
    },
    operators,
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
  getOperatorNames,
  loadItems,
  selectRandomItem,
  shouldChangeItem,
  calculateItemTiming,
  isValidOperatorId
};
  