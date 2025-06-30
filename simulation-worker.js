// simulation-worker.js - Individual machine simulation worker
const { MongoClient } = require('mongodb');
const { getRandomDelay, buildStateRecord, getStationOperators, getActiveStations } = require('./utils');

class MachineSimulator {
  constructor(machineConfig) {
    this.machineConfig = machineConfig;
    this.isRunning = false;
    this.client = null;
    this.countTimeouts = new Map();
    this.currentRunningState = null;
    
    // MongoDB configuration
    this.mongoUri = 'mongodb://localhost:27017/chitrac';
    this.dbName = 'chitrac';
    this.collectionName = 'state';
    this.countCollectionName = 'count';
  }

  async start() {
    if (this.isRunning) {
      console.log(`[${this.getTimestamp()}] ⚠️  Simulator for ${this.machineConfig.name} is already running`);
      return;
    }

    console.log(`[${this.getTimestamp()}] 🚀 Starting simulator for ${this.machineConfig.name} (${this.machineConfig.type})`);
    console.log(`[${this.getTimestamp()}] 📍 Serial: ${this.machineConfig.serial}, IP: ${this.machineConfig.ipAddress}`);
    console.log(`[${this.getTimestamp()}] 🏭 Active Stations: ${this.machineConfig.stations.join(', ')}`);

    try {
      await this.connectToMongoDB();
      this.isRunning = true;
      await this.simulationLoop();
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Failed to start simulator for ${this.machineConfig.name}:`, error.message);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      console.log(`[${this.getTimestamp()}] ⚠️  Simulator for ${this.machineConfig.name} is not running`);
      return;
    }

    console.log(`[${this.getTimestamp()}] 🛑 Stopping simulator for ${this.machineConfig.name}...`);
    
    // Clear all count timeouts
    this.countTimeouts.forEach((timeout, station) => {
      clearTimeout(timeout);
    });
    this.countTimeouts.clear();
    
    this.isRunning = false;
    
    if (this.client) {
      await this.client.close();
      console.log(`[${this.getTimestamp()}] ✅ Disconnected from MongoDB for ${this.machineConfig.name}`);
    }
  }

  getStatus() {
    return {
      machineName: this.machineConfig.name,
      machineSerial: this.machineConfig.serial,
      machineType: this.machineConfig.type,
      isRunning: this.isRunning,
      activeStations: this.machineConfig.stations,
      activeCounts: this.countTimeouts.size
    };
  }

  async connectToMongoDB() {
    this.client = new MongoClient(this.mongoUri);
    await this.client.connect();
    console.log(`[${this.getTimestamp()}] ✅ Connected to MongoDB for ${this.machineConfig.name}`);
  }

  async writeState(stateType) {
    try {
      // Clear all count timeouts if machine is stopping
      if (stateType === "Timeout" || stateType === "Fault") {
        this.countTimeouts.forEach((timeout, station) => {
          clearTimeout(timeout);
          console.log(`[${this.getTimestamp()}] 🛑 Stopped count generation for station ${station} (${stateType} state) - ${this.machineConfig.name}`);
        });
        this.countTimeouts.clear();
        this.currentRunningState = null;
      }
      
      const record = buildStateRecord(stateType, this.machineConfig);
      const db = this.client.db(this.dbName);
      const stateCollection = db.collection(this.collectionName);
      const result = await stateCollection.insertOne(record);
      
      console.log(`[${this.getTimestamp()}] ✅ Inserted ${stateType} state for ${this.machineConfig.name}`);
      console.log(`   📝 Document ID: ${result.insertedId}`);
      console.log(`   🔧 Machine: ${record.machine.name} (${record.machine.serial})`);
      console.log(`   📊 Status: ${record.status.name} (Code: ${record.status.code})`);
      
      // Start count generation if machine is running
      if (stateType === "Running") {
        this.currentRunningState = record;
        // Start count generation for each active station
        record.operators.forEach(operator => {
          if (operator.id > 0 && operator.id < 900000) { // Real operator (not dummy or -1)
            this.simulateStationCounts(record, operator.station, operator);
          }
        });
      }
      
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error inserting ${stateType} state for ${this.machineConfig.name}:`, error.message);
    }
  }

  simulateStationCounts(runningState, station, operator) {
    const delayMs = (Math.floor(Math.random() * (15 - 4 + 1)) + 4) * 1000; // 4-15 sec
  
    const timeout = setTimeout(async () => {
      try {
        const db = this.client.db(this.dbName);
        const collection = db.collection(this.countCollectionName);
        
        // Get item ID for this station (for now, same as first item)
        const itemId = Object.values(runningState.program.items)[0].id;
  
        const countRecord = {
          timestamp: new Date(),
          machine: runningState.machine,
          program: runningState.program,
          operator: {
            id: operator.id,
            name: "None Entered"
          },
          item: {
            id: itemId,
            name: "None Entered",
            standard: 666
          },
          station: station,
          lane: station
        };
  
        await collection.insertOne(countRecord);
        console.log(`[${this.getTimestamp()}] ✅ Count inserted for station ${station} - ${this.machineConfig.name}`);
        console.log(`   📦 Item ID: ${itemId}, Operator: ${operator.id}`);
  
        // Continue count generation for this station if still running
        if (this.countTimeouts.has(station)) {
          this.simulateStationCounts(runningState, station, operator);
        }
      } catch (error) {
        console.error(`[${this.getTimestamp()}] ❌ Error inserting count for station ${station} - ${this.machineConfig.name}:`, error.message);
      }
    }, delayMs);
  
    // Store timeout reference for this station
    this.countTimeouts.set(station, timeout);
    console.log(`[${this.getTimestamp()}] ⏰ Next count for station ${station} in ${delayMs / 1000} seconds - ${this.machineConfig.name}`);
  }

  async simulationLoop() {
    console.log(`[${this.getTimestamp()}] 🚀 Starting simulation loop for ${this.machineConfig.name}...`);
    
    while (this.isRunning) {
      await this.writeState("Timeout");
      const timeoutDelay = getRandomDelay(1, 5);
      console.log(`[${this.getTimestamp()}] ⏰ Waiting ${timeoutDelay/1000/60} minutes before Running state - ${this.machineConfig.name}`);
      await this.delay(timeoutDelay);

      if (!this.isRunning) break;

      await this.writeState("Running");
      const runningDelay = getRandomDelay(2, 90);
      console.log(`[${this.getTimestamp()}] ⏰ Waiting ${runningDelay/1000/60} minutes before next state - ${this.machineConfig.name}`);
      await this.delay(runningDelay);

      if (!this.isRunning) break;

      const nextState = Math.random() < 0.5 ? "Timeout" : "Fault";
      await this.writeState(nextState);
      const finalDelay = getRandomDelay(1, 5);
      console.log(`[${this.getTimestamp()}] ⏰ Waiting ${finalDelay/1000/60} minutes before next cycle - ${this.machineConfig.name}`);
      await this.delay(finalDelay);
    }
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  getTimestamp() {
    return new Date().toISOString();
  }
}

// Export for use as module
module.exports = MachineSimulator;

// If this file is run directly, get machine config from environment or use test machine
if (require.main === module) {
  const { getActiveMachines } = require('./fillmore-machines');
  
  async function startWorker() {
    let machineConfig;
    
    // Check if machine config is provided via environment variable (from process manager)
    if (process.env.MACHINE_CONFIG) {
      try {
        machineConfig = JSON.parse(process.env.MACHINE_CONFIG);
        console.log(`[${new Date().toISOString()}] 📦 Using machine config from environment: ${machineConfig.name}`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Failed to parse MACHINE_CONFIG environment variable:`, error.message);
        process.exit(1);
      }
    } else {
      // Fallback to first active machine for testing
      machineConfig = getActiveMachines()[0];
      console.log(`[${new Date().toISOString()}] 🧪 Using test machine config: ${machineConfig.name}`);
    }
    
    const simulator = new MachineSimulator(machineConfig);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log(`\n[${new Date().toISOString()}] 🛑 Received SIGINT, stopping simulator...`);
      await simulator.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log(`\n[${new Date().toISOString()}] 🛑 Received SIGTERM, stopping simulator...`);
      await simulator.stop();
      process.exit(0);
    });
    
    await simulator.start();
  }
  
  startWorker().catch(console.error);
} 