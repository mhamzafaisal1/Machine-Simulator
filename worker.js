// worker.js
const { MongoClient } = require('mongodb');
const { mongoUri, dbName, collectionName, countCollectionName } = require('./config');
const { getRandomDelay, buildStateRecord, getRandomOperators } = require('./utils');

async function runSimulator() {
  console.log(`[${new Date().toISOString()}] Starting machine simulator...`);
  console.log(`[${new Date().toISOString()}] Connecting to MongoDB: ${mongoUri}`);
  console.log(`[${new Date().toISOString()}] Database: ${dbName}, Collections: ${collectionName}, ${countCollectionName}`);
  
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log(`[${new Date().toISOString()}] ✅ Successfully connected to MongoDB`);
    
    const db = client.db(dbName);
    const stateCollection = db.collection(collectionName);
    const countCollection = db.collection(countCollectionName);
    
    // Test the connection by getting collection stats
    const stateStats = await db.command({ collStats: collectionName });
    const countStats = await db.command({ collStats: countCollectionName });
    console.log(`[${new Date().toISOString()}] 📊 State collection: ${stateStats.count} documents`);
    console.log(`[${new Date().toISOString()}] 📊 Count collection: ${countStats.count} documents`);
    
    // Variable to track count timeout
    let countTimeout = null;
    let currentRunningState = null;
    
    async function writeState(stateType) {
      try {
        // Clear count timeout if machine is stopping
        if (stateType === "Timeout" || stateType === "Fault") {
          if (countTimeout) {
            clearTimeout(countTimeout);
            countTimeout = null;
            currentRunningState = null;
            console.log(`[${new Date().toISOString()}] 🛑 Stopped count generation (${stateType} state)`);
          }
        }
        
        const record = buildStateRecord(stateType);
        const result = await stateCollection.insertOne(record);
        
        console.log(`[${new Date().toISOString()}] ✅ Inserted ${stateType} state`);
        console.log(`   📝 Document ID: ${result.insertedId}`);
        console.log(`   🕐 Timestamp: ${record.timestamp.toISOString()}`);
        console.log(`   🔧 Machine: ${record.machine.name} (${record.machine.serial})`);
        console.log(`   📊 Status: ${record.status.name} (Code: ${record.status.code})`);
        
        // Get updated collection count
        const updatedStats = await db.command({ collStats: collectionName });
        console.log(`   📈 Total documents in state collection: ${updatedStats.count}`);
        console.log('   ──────────────────────────────────────────────');
        
        // Start count generation if machine is running
        if (stateType === "Running") {
          currentRunningState = record;
          simulateCounts(db, record);
        }
        
      } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error inserting ${stateType} state:`, error.message);
      }
    }
    async function simulateCounts(db, runningState) {
      const collection = db.collection(countCollectionName);
      const delayMs = (Math.floor(Math.random() * (15 - 4 + 1)) + 4) * 1000; // 4-15 sec
    
      countTimeout = setTimeout(async () => {
        try {
          const operatorList = runningState.operators;
          const operator = operatorList[Math.floor(Math.random() * operatorList.length)];
    
          const itemId = Object.values(runningState.program.items)[0].number;
    
          const countRecord = {
            timestamp: new Date(),
            machine: runningState.machine,
            program: runningState.program,
            operator,
            item: {
              id: itemId,
              name: "None Entered",  // Placeholder
              standard: 666          // Placeholder
            },
            station: 1,
            lane: 1
          };
    
          await collection.insertOne(countRecord);
          console.log(`[${new Date().toISOString()}] ✅ Count inserted`);
          console.log(`   📦 Item ID: ${itemId}`);
          console.log(`   👤 Operator: ${operator.name} (${operator.code})`);
          console.log(`   🔧 Machine: ${runningState.machine.name}`);
    
          const updatedStats = await db.command({ collStats: countCollectionName });
          console.log(`   📈 Total documents in count collection: ${updatedStats.count}`);
          console.log('   ──────────────────────────────────────────────');
    
          if (countTimeout) {
            simulateCounts(db, runningState);
          }
        } catch (error) {
          console.error(`[${new Date().toISOString()}] ❌ Error inserting count:`, error.message);
        }
      }, delayMs);
    
      console.log(`[${new Date().toISOString()}] ⏰ Next count in ${delayMs / 1000} seconds`);
    }
    
    async function simulationLoop() {
      console.log(`[${new Date().toISOString()}] 🚀 Starting simulation loop...`);
      
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
