// worker.js

const { MongoClient } = require('mongodb');
const config = require('./config');
const { getRandomDelay, buildStateRecord, getStationOperators, getActiveStations, getOperatorName } = require('./utils');

async function runSimulator() {
  console.log(`[${new Date().toISOString()}] Starting machine simulator...`);
  console.log(`[${new Date().toISOString()}] Connecting to MongoDB: ${config.mongoUri}`);
  console.log(`[${new Date().toISOString()}] Database: ${config.dbName}, Collections: ${config.collectionName}, ${config.countCollectionName}`);
  
  const client = new MongoClient(config.mongoUri);
  let faultArray = [];
  
  try {
    await client.connect();
    console.log(`[${new Date().toISOString()}] ✅ Successfully connected to MongoDB`);
    
    const db = client.db(config.dbName);
    const stateCollection = db.collection(config.collectionName);
    const countCollection = db.collection(config.countCollectionName);
    // Load all faults into array, sorted by code
    faultArray = await db.collection('fault').find({}).sort({ code: 1 }).toArray();
    console.log(`[${new Date().toISOString()}] ⚡ Loaded ${faultArray.length} faults from fault collection`);
    
    const stateStats = await db.command({ collStats: config.collectionName });
    const countStats = await db.command({ collStats: config.countCollectionName });
    console.log(`[${new Date().toISOString()}] 📊 State collection: ${stateStats.count} documents`);
    console.log(`[${new Date().toISOString()}] 📊 Count collection: ${countStats.count} documents`);
    
    // Variables to track count timeouts for each station
    const countTimeouts = new Map();
    let currentRunningState = null;
    
    async function assignOperatorsForRunningState(db) {
      // Get active stations for this machine
      const activeStations = getActiveStations();
      const machineSerial = config.machine.serial;
      const tickerCollection = db.collection('simulated-operators-ticker');
      const operatorsCollection = db.collection('operator');
      const assignedOperators = [];

      // Get all operator assignments currently in ticker
      const allTicker = await tickerCollection.find({}).toArray();
      // Get all operators from MongoDB, projecting out _id
      const allOperators = await operatorsCollection.find({}, { projection: { _id: 0 } }).toArray();

      for (const station of activeStations) {
        // Find last operator for this machine/station
        const lastAssignment = allTicker.find(
          t => t.machineSerial === machineSerial && t.station === station
        );
        let candidateOperator = null;
        let useLast = false;
        if (lastAssignment && Math.random() < 0.85) {
          // 85%: try to reuse last operator
          candidateOperator = allOperators.find(op => op.code === lastAssignment.operatorId);
          useLast = true;
        } else {
          // 15% or no last: pick a new operator not locked out
          // Exclude operators currently assigned to other machines
          const lockedOutIds = allTicker
            .filter(t => t.machineSerial !== machineSerial)
            .map(t => t.operatorId);
          const availableOperators = allOperators.filter(
            op => !lockedOutIds.includes(op.code)
          );
          // Remove last operator from available if present (to force new)
          if (lastAssignment) {
            const idx = availableOperators.findIndex(op => op.code === lastAssignment.operatorId);
            if (idx !== -1) availableOperators.splice(idx, 1);
          }
          if (availableOperators.length > 0) {
            // Pick random available
            candidateOperator = availableOperators[Math.floor(Math.random() * availableOperators.length)];
          } else if (lastAssignment) {
            // Fallback: reuse last
            candidateOperator = allOperators.find(op => op.code === lastAssignment.operatorId);
            useLast = true;
          }
        }
        // If still no candidate, fallback to any operator
        if (!candidateOperator && allOperators.length > 0) {
          candidateOperator = allOperators[station % allOperators.length];
        }
        // Upsert assignment in ticker
        if (candidateOperator) {
          await tickerCollection.updateOne(
            { operatorId: candidateOperator.code, station: station },
            { $set: { operatorId: candidateOperator.code, machineSerial, station } },
            { upsert: true }
          );
          assignedOperators.push({ id: candidateOperator.code, station });
        } else {
          // Fallback: dummy operator
          assignedOperators.push({ id: -1, station });
        }
      }
      // For inactive stations, assign dummy or -1 as before
      for (let station = 1; station <= 4; station++) {
        if (!activeStations.includes(station)) {
          if (station === 2 && !activeStations.includes(2)) {
            assignedOperators.push({ id: parseInt('9' + machineSerial.toString()), station });
          } else {
            assignedOperators.push({ id: -1, station });
          }
        }
      }
      // Sort by station
      assignedOperators.sort((a, b) => a.station - b.station);
      return assignedOperators;
    }

    // async function writeState(stateType) {
    //   try {
    //     // Clear all count timeouts if machine is stopping
    //     if (stateType === "Timeout" || stateType === "Fault") {
    //       countTimeouts.forEach((timeout, station) => {
    //         clearTimeout(timeout);
    //         console.log(`[${new Date().toISOString()}] 🛑 Stopped count generation for station ${station} (${stateType} state)`);
    //       });
    //       countTimeouts.clear();
    //       currentRunningState = null;
    //     }
    //     let record;
    //     if (stateType === "Running") {
    //       // Use new operator assignment logic
    //       const assignedOperators = await assignOperatorsForRunningState(db);
    //       // Build state record with assigned operators
    //       const statusMap = {
    //         Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
    //         Running: { code: 1, name: "Run", softrolColor: "Green" },
    //         Fault:   { code: Math.floor(Math.random() * 99) + 2, name: "Fault", softrolColor: "Red" }
    //       };
    //       const status = statusMap[stateType];
    //       const items = require('./utils').getRandomItemPerStation();
    //       const targetConfig = config.machine;
    //       record = {
    //         timestamp: new Date(),
    //         machine: {
    //           serial: targetConfig.serial,
    //           name: targetConfig.name,
    //           ipAddress: targetConfig.ipAddress
    //         },
    //         program: {
    //           mode: "smallPiece",
    //           programNumber: 1,
    //           batchNumber: Math.floor(Math.random() * 21) + 20,
    //           accountNumber: 0,
    //           speed: 0,
    //           stations: targetConfig.lanes,
    //           items
    //         },
    //         operators: assignedOperators,
    //         status
    //       };
    //     } else if (stateType === "Fault" && faultArray.length > 0) {
    //       // Use a real fault from the fault array
    //       const faultIdx = Math.floor(Math.random() * Math.min(58, faultArray.length));
    //       const fault = faultArray[faultIdx];
    //       // Build state record with fault info
    //       const items = require('./utils').getRandomItemPerStation();
    //       const targetConfig = config.machine;
    //       record = {
    //         timestamp: new Date(),
    //         machine: {
    //           serial: targetConfig.serial,
    //           name: targetConfig.name,
    //           ipAddress: targetConfig.ipAddress
    //         },
    //         program: {
    //           mode: "smallPiece",
    //           programNumber: 1,
    //           batchNumber: Math.floor(Math.random() * 21) + 20,
    //           accountNumber: 0,
    //           speed: 0,
    //           stations: targetConfig.lanes,
    //           items
    //         },
    //         operators: [], // No operators during fault
    //         status: {
    //           code: fault.code,
    //           name: fault.name || fault.description || "Fault",
    //           softrolColor: "Red",
    //           description: fault.description || undefined
    //         },
    //         fault: fault // Store full fault doc for reference
    //       };
    //     } else {
    //       // Use default logic for Timeout
    //       record = buildStateRecord(stateType);
    //     }
    //     const result = await stateCollection.insertOne(record);
    //     const activeStations = getActiveStations();
    //     // Upsert latest state into stateTicker collection (deep clone fix)
    //     const tickerRecord = JSON.parse(JSON.stringify(record)); // deep clone
    //     delete tickerRecord._id;
    //     console.log(`Upserting stateTicker for serial ${tickerRecord} (no _id)`);
    //     const stateTickerCollection = db.collection('stateTicker');
    //     const upsertResult = await stateTickerCollection.updateOne(
    //       { "machine.serial": tickerRecord.machine.serial },
    //       { $set: tickerRecord },
    //       { upsert: true }
    //     );
    //     console.log(`[${new Date().toISOString()}] ✅ Inserted ${stateType} state`);
    //     console.log(`   📝 Document ID: ${result.insertedId}`);
    //     console.log(`   🕐 Timestamp: ${record.timestamp.toISOString()}`);
    //     console.log(`   🔧 Machine: ${record.machine.name} (${record.machine.serial}) - Type: ${config.machine.type}`);
    //     console.log(`   📊 Status: ${record.status.name} (Code: ${record.status.code})`);
    //     console.log(`   🏭 Active Stations: ${activeStations.join(', ')} (Lanes: ${config.machine.lanes})`);
    //     console.log(`   📈 StateTicker: ${upsertResult.upsertedCount > 0 ? 'Created' : 'Updated'} latest state`);
    //     // Get updated collection count
    //     const updatedStats = await db.command({ collStats: config.collectionName });
    //     console.log(`   📈 Total documents in state collection: ${updatedStats.count}`);
    //     console.log('   ──────────────────────────────────────────────');
    //     // Start count generation if machine is running
    //     if (stateType === "Running") {
    //       currentRunningState = record;
    //       // Start count generation for each active station
    //       record.operators.forEach(operator => {
    //         if (operator.id > 0 && operator.id < 900000) { // Real operator (not dummy or -1)
    //           simulateStationCounts(db, record, operator.station, operator);
    //         }
    //       });
    //     }
    //   } catch (error) {
    //     console.error(`[${new Date().toISOString()}] ❌ Error inserting ${stateType} state:`, error.message);
    //   }
    // }

    async function writeState(stateType) {
      try {
        // Clear timeouts if stopping
        if (stateType === "Timeout" || stateType === "Fault") {
          countTimeouts.forEach((timeout, station) => {
            clearTimeout(timeout);
            console.log(`[${new Date().toISOString()}] 🛑 Stopped count generation for station ${station} (${stateType} state)`);
          });
          countTimeouts.clear();
          currentRunningState = null;
        }
    
        const targetConfig = config.machine;
        const items = require('./utils').getRandomItemPerStation();
        const activeStations = getActiveStations();
        const now = new Date();
    
        let record;
    
        if (stateType === "Running") {
          const assignedOperators = await assignOperatorsForRunningState(db);
          console.log(`[${new Date().toISOString()}] ✅ Assigned operators: ${assignedOperators}`);
          record = {
            timestamp: now,
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
            operators: assignedOperators,
            status: {
              code: 1,
              name: "Run",
              softrolColor: "Green"
            }
          };
    
        } else if (stateType === "Fault") {
          if (!faultArray?.length) {
            throw new Error("faultArray is empty or undefined.");
          }
    
          const faultIdx = Math.floor(Math.random() * Math.min(58, faultArray.length));
          const fault = faultArray[faultIdx];
    
          record = {
            timestamp: now,
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
            operators: [],
            status: {
              code: fault.code,
              name: fault.name || fault.description || "Fault",
              softrolColor: "Red",
              description: fault.description || undefined
            },
            fault
          };
    
        } else {
          // Timeout or fallback
          record = buildStateRecord(stateType);
        }
    
        // Insert into state collection
        const result = await stateCollection.insertOne(record);
    
        // Upsert into stateTicker (remove _id)
        const tickerRecord = JSON.parse(JSON.stringify(record));
        console.log(`[${new Date().toISOString()}] ✅ Ticker record: ${tickerRecord}`);
        delete tickerRecord['_id'];
    
        const stateTickerCollection = db.collection('stateTicker');
        const upsertResult = await stateTickerCollection.updateOne(
          { "machine.serial": tickerRecord.machine.serial },
          { $set: tickerRecord },
          { upsert: true }
        );
    
        // Logging
        console.log(`[${now.toISOString()}] ✅ Inserted ${stateType} state`);
        console.log(`   📝 Document ID: ${result.insertedId}`);
        console.log(`   🕐 Timestamp: ${now.toISOString()}`);
        console.log(`   🔧 Machine: ${record.machine.name} (${record.machine.serial}) - Type: ${config.machine.type}`);
        console.log(`   📊 Status: ${record.status.name} (Code: ${record.status.code})`);
        console.log(`   🏭 Active Stations: ${activeStations.join(', ')} (Lanes: ${config.machine.lanes})`);
        console.log(`   📈 StateTicker: ${upsertResult.upsertedCount > 0 ? 'Created' : 'Updated'} latest state`);
        const updatedStats = await db.command({ collStats: config.collectionName });
        console.log(`   📈 Total documents in state collection: ${updatedStats.count}`);
        console.log('   ──────────────────────────────────────────────');
    
        // Begin count generation
        if (stateType === "Running") {
          currentRunningState = record;
          record.operators.forEach(operator => {
            if (operator.id > 0 && operator.id < 900000) {
              simulateStationCounts(db, record, operator.station, operator);
            }
          });
        }
    
      } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error inserting ${stateType} state:`, error.message);
      }
    }
    

    async function simulateStationCounts(db, runningState, station, operator) {
      const collection = db.collection(config.countCollectionName);
      const delayMs = (Math.floor(Math.random() * (15 - 4 + 1)) + 4) * 1000; // 4-15 sec
    
      const timeout = setTimeout(async () => {
        try {
          // Get operator name from MongoDB
          const operatorName = await getOperatorName(db, operator.id);
          
          // Check for misfeed (1 in 400 chance)
          const isMisfeed = Math.floor(Math.random() * 400) <= 1;
    
          const countRecord = {
            timestamp: new Date(),
            machine: runningState.machine,
            program: runningState.program,
            operator: {
              id: operator.id,
              name: operatorName,
              station: station
            },
            station: station,
            lane: station // Lane matches station
          };
          
          // Add item data only for regular counts (not misfeeds)
          if (!isMisfeed) {
            const itemId = Object.values(runningState.program.items)[0].id;
            countRecord.item = {
              id: itemId,
              name: "None Entered",
              standard: 666
            };
            console.log(`[${new Date().toISOString()}] ✅ Count inserted for station ${station}`);
            console.log(`   📦 Item ID: ${itemId}`);
            console.log(`   👤 Operator: ${operatorName} (${operator.id})`);
            console.log(`   🔧 Machine: ${runningState.machine.name}`);
            console.log(`   🏭 Station: ${station}, Lane: ${station}`);
          } else {
            countRecord.misfeed = true;
            console.log(`[${new Date().toISOString()}] ⚠️ MISFEED recorded at station ${station}`);
            console.log(`   👤 Operator: ${operatorName} (${operator.id})`);
            console.log(`   🔧 Machine: ${runningState.machine.name}`);
            console.log(`   🏭 Station: ${station}, Lane: ${station}`);
          }
    
          await collection.insertOne(countRecord);
    
          const updatedStats = await db.command({ collStats: config.countCollectionName });
          console.log(`   📈 Total documents in count collection: ${updatedStats.count}`);
          console.log('   ──────────────────────────────────────────────');
    
          // Continue count generation for this station if still running
          if (countTimeouts.has(station)) {
            simulateStationCounts(db, runningState, station, operator);
          }
        } catch (error) {
          console.error(`[${new Date().toISOString()}] ❌ Error inserting count for station ${station}:`, error.message);
        }
      }, delayMs);
    
      // Store timeout reference for this station
      countTimeouts.set(station, timeout);
      console.log(`[${new Date().toISOString()}] ⏰ Next count for station ${station} in ${delayMs / 1000} seconds`);
    }
    
    async function simulationLoop() {
      console.log(`[${new Date().toISOString()}] 🚀 Starting simulation loop...`);
      const activeStations = getActiveStations();
      console.log(`[${new Date().toISOString()}] 🏭 Simulating machine type: ${config.machine.type} with active stations: ${activeStations.join(', ')}`);
      
      while (true) {
        await writeState("Timeout");
        const timeoutDelay = getRandomDelay(1, 5);
        console.log(`[${new Date().toISOString()}] ⏰ Waiting ${timeoutDelay/1000/60} minutes before Running state...`);
        await delay(timeoutDelay);

        await writeState("Running");
        const runningDelay = getRandomDelay(2, 90);
        console.log(`[${new Date().toISOString()}] ⏰ Waiting ${runningDelay/1000/60} minutes before next state...`);
        await delay(runningDelay);

        const nextState = Math.random() < 0.5 ? "Timeout" : "Fault";
        await writeState(nextState);
        const finalDelay = getRandomDelay(1, 5);
        console.log(`[${new Date().toISOString()}] ⏰ Waiting ${finalDelay/1000/60} minutes before next cycle...`);
        await delay(finalDelay);
      }
    }

    simulationLoop();
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Failed to connect to MongoDB:`, error.message);
    process.exit(1);
  }
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] 🛑 Received SIGINT, shutting down gracefully...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] 🛑 Received SIGTERM, shutting down gracefully...`);
  process.exit(0);
});

runSimulator();
