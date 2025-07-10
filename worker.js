// worker.js
const { MongoClient } = require('mongodb');
const config = require('./config');
const { getRandomDelay, buildStateRecord, getStationOperators, getActiveStations, getOperatorName } = require('./utils');

async function runSimulator() {
  console.log(`[${new Date().toISOString()}] Starting machine simulator...`);
  console.log(`[${new Date().toISOString()}] Connecting to MongoDB: ${config.mongoUri}`);
  console.log(`[${new Date().toISOString()}] Database: ${config.dbName}, Collections: ${config.collectionName}, ${config.countCollectionName}`);
  
  const client = new MongoClient(config.mongoUri);
  
  try {
    await client.connect();
    console.log(`[${new Date().toISOString()}] ✅ Successfully connected to MongoDB`);
    
    const db = client.db(config.dbName);
    const stateCollection = db.collection(config.collectionName);
    const countCollection = db.collection(config.countCollectionName);
    
    // Test the connection by getting collection stats
    const stateStats = await db.command({ collStats: config.collectionName });
    const countStats = await db.command({ collStats: config.countCollectionName });
    console.log(`[${new Date().toISOString()}] 📊 State collection: ${stateStats.count} documents`);
    console.log(`[${new Date().toISOString()}] 📊 Count collection: ${countStats.count} documents`);
    
    // Variables to track count timeouts for each station
    const countTimeouts = new Map();
    let currentRunningState = null;
    
    async function writeState(stateType) {
      try {
        // Clear all count timeouts if machine is stopping
        if (stateType === "Timeout" || stateType === "Fault") {
          countTimeouts.forEach((timeout, station) => {
            clearTimeout(timeout);
            console.log(`[${new Date().toISOString()}] 🛑 Stopped count generation for station ${station} (${stateType} state)`);
          });
          countTimeouts.clear();
          currentRunningState = null;
        }
        
        const record = buildStateRecord(stateType);
        const result = await stateCollection.insertOne(record);
        delete record['_id'];
        const activeStations = getActiveStations();
        
        // Upsert latest state into stateTicker collection
        const stateTickerCollection = db.collection('stateTicker');
        const upsertResult = await stateTickerCollection.updateOne(
          { "machine.serial": record.machine.serial },
          { $set: record },
          { upsert: true }
        );
        
        console.log(`[${new Date().toISOString()}] ✅ Inserted ${stateType} state`);
        console.log(`   📝 Document ID: ${result.insertedId}`);
        console.log(`   🕐 Timestamp: ${record.timestamp.toISOString()}`);
        console.log(`   🔧 Machine: ${record.machine.name} (${record.machine.serial}) - Type: ${config.machine.type}`);
        console.log(`   📊 Status: ${record.status.name} (Code: ${record.status.code})`);
        console.log(`   🏭 Active Stations: ${activeStations.join(', ')} (Lanes: ${config.machine.lanes})`);
        console.log(`   📈 StateTicker: ${upsertResult.upsertedCount > 0 ? 'Created' : 'Updated'} latest state`);
        
        // Get updated collection count
        const updatedStats = await db.command({ collStats: config.collectionName });
        console.log(`   📈 Total documents in state collection: ${updatedStats.count}`);
        console.log('   ──────────────────────────────────────────────');
        
        // Start count generation if machine is running
        if (stateType === "Running") {
          currentRunningState = record;
          // Start count generation for each active station
          record.operators.forEach(operator => {
            if (operator.id > 0 && operator.id < 900000) { // Real operator (not dummy or -1)
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
