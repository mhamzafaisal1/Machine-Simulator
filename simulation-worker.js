// simulation-worker.js - Main file for the generating workers.

const { MongoClient } = require('mongodb');
const {
  getRandomDelay,
  buildStateRecord,
  getStationOperators,
  getActiveStations,
  getOperatorName,
  loadItems,
  selectRandomItem,
  shouldChangeItem,
  calculateItemTiming
} = require('./utils');
const config = require('./config');

class MachineSimulator {
  constructor(machineConfig) {
    this.machineConfig = machineConfig;
    this.isRunning = false;
    this.client = null;
    this.countTimeouts = new Map();
    this.currentRunningState = null;
    this.validFaults = [];
    this.items = []; // Array to store loaded items
    this.currentItem = null; // Currently selected item
    this.mongoUri = config.mongoUri;
    this.dbName = config.dbName;
    this.collectionName = config.collectionName;
    this.countCollectionName = config.countCollectionName;
  }

  async start() {
    if (this.isRunning) return;

    try {
      console.log(`[${this.getTimestamp()}] 🚀 Starting simulator for ${this.machineConfig.name}`);
      await this.connectToMongoDB();
      await this.loadFaults();
      await this.loadItems();
      this.selectInitialItem();
      this.isRunning = true;
      await this.simulationLoop();
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Failed to start simulator:`, error.message);
      throw error;
    }
  }

  async connectToMongoDB() {
    this.client = new MongoClient(this.mongoUri);
    await this.client.connect();
    console.log(`[${this.getTimestamp()}] ✅ Connected to MongoDB`);
  }

  async loadFaults() {
    const db = this.client.db(this.dbName);
    const faultCollection = db.collection(config.faultCollectionName);
    this.validFaults = await faultCollection.find().sort({ code: 1 }).toArray();
    console.log(`[${this.getTimestamp()}] ✅ Loaded ${this.validFaults.length} fault types`);

    if (this.validFaults.length < 58) {
      console.warn(`[${this.getTimestamp()}] ⚠️ Only ${this.validFaults.length} fault codes found (expected 58)`);
    }
  }

  async loadItems() {
    const db = this.client.db(this.dbName);
    this.items = await loadItems(db);
  }

  selectInitialItem() {
    this.currentItem = selectRandomItem(this.items);
  }

  selectNextItem() {
    if (shouldChangeItem()) {
      this.currentItem = selectRandomItem(this.items);
    } else {
      console.log(`[${this.getTimestamp()}] 🔄 Keeping current item: ${this.currentItem.name}`);
    }
  }

  getRandomFault() {
    const faultCount = this.validFaults.length;
    if (faultCount === 0) {
      console.warn(`[${this.getTimestamp()}] ⚠️ No fault codes loaded. Using fallback.`);
      return { code: 17, name: "Fault" };
    }

    const index = Math.floor(Math.random() * faultCount);
    const fault = this.validFaults[index];

    if (!fault) {
      console.warn(`[${this.getTimestamp()}] ⚠️ Fault at index ${index} is undefined. Using fallback.`);
      return { code: 17, name: "Fault" };
    }

    console.log(`[${this.getTimestamp()}] 🔧 Injecting fault: ${fault.code} - ${fault.name}`);
    return fault;
  }

  async assignOperatorsForRunningState() {
    const db = this.client.db(this.dbName);
    const activeStations = getActiveStations(this.machineConfig);
    const machineSerial = this.machineConfig.serial;
    const tickerCollection = db.collection(config.simulatedOperatorsTickerCollectionName);
    const operatorsCollection = db.collection(config.operatorCollectionName);
    const assignedOperators = [];

    // Get all operator assignments currently in ticker
    const allTicker = await tickerCollection.find({}).toArray();
    // Get all operators from MongoDB, projecting out _id
    const allOperators = await operatorsCollection.find({}, { projection: { _id: 0 } }).toArray();

    // Filter out operators starting with 9
    const filteredOperators = allOperators.filter(op => !op.code.toString().startsWith('9'));
    console.log(`[${this.getTimestamp()}] 📊 Filtered operators: ${allOperators.length} total, ${filteredOperators.length} available (excluded ${allOperators.length - filteredOperators.length} starting with 9)`);

    // Create a map of currently assigned operators for quick lookup
    const currentlyAssignedOperators = new Map();
    allTicker.forEach(assignment => {
      currentlyAssignedOperators.set(assignment.operatorId, {
        machineSerial: assignment.machineSerial,
        station: assignment.station
      });
    });

    for (const station of activeStations) {
      // Find last operator for this machine/station
      const lastAssignment = allTicker.find(
        t => t.machineSerial === machineSerial && t.station === station
      );
      let candidateOperator = null;
      let useLast = false;
      
      if (lastAssignment && Math.random() < 0.85) {
        // 85%: try to reuse last operator
        const lastOperator = filteredOperators.find(op => op.code === lastAssignment.operatorId);
        
        // Check if last operator is still available (not assigned to other machines/lanes)
        const currentAssignment = currentlyAssignedOperators.get(lastAssignment.operatorId);
        if (lastOperator && (!currentAssignment || 
            (currentAssignment.machineSerial === machineSerial && currentAssignment.station === station))) {
          candidateOperator = lastOperator;
          useLast = true;
        }
      }
      
      if (!candidateOperator) {
        // 15% or no last or last operator unavailable: pick a new operator
        // Get all currently assigned operator IDs (across all machines and lanes)
        const allAssignedOperatorIds = Array.from(currentlyAssignedOperators.keys());
        
        // Filter out operators that are currently assigned anywhere
        const availableOperators = filteredOperators.filter(
          op => !allAssignedOperatorIds.includes(op.code)
        );
        
        // Remove last operator from available if present (to force new)
        if (lastAssignment) {
          const idx = availableOperators.findIndex(op => op.code === lastAssignment.operatorId);
          if (idx !== -1) availableOperators.splice(idx, 1);
        }
        
        if (availableOperators.length > 0) {
          // Pick random available operator
          candidateOperator = availableOperators[Math.floor(Math.random() * availableOperators.length)];
        } else if (lastAssignment) {
          // Emergency fallback: reuse last operator even if assigned elsewhere
          candidateOperator = filteredOperators.find(op => op.code === lastAssignment.operatorId);
          useLast = true;
          console.log(`[${this.getTimestamp()}] ⚠️ Emergency fallback: reusing operator ${lastAssignment.operatorId} despite conflicts`);
        }
      }
      
      // Final fallback: use any operator if still no candidate
      if (!candidateOperator && filteredOperators.length > 0) {
        candidateOperator = filteredOperators[station % filteredOperators.length];
        console.log(`[${this.getTimestamp()}] ⚠️ Final fallback: using operator ${candidateOperator.code} for station ${station}`);
      }
      
      // Assign operator with atomic upsert to prevent race conditions
      if (candidateOperator) {
        try {
          // Use findOneAndUpdate with upsert for atomic operation
          const result = await tickerCollection.findOneAndUpdate(
            { 
              $or: [
                { operatorId: candidateOperator.code },
                { machineSerial: machineSerial, station: station }
              ]
            },
            { 
              $set: { 
                operatorId: candidateOperator.code, 
                machineSerial, 
                station,
                lastUpdated: new Date()
              } 
            },
            { 
              upsert: true,
              returnDocument: 'after'
            }
          );
          
          // Update our local tracking
          currentlyAssignedOperators.set(candidateOperator.code, {
            machineSerial: machineSerial,
            station: station
          });
          
          assignedOperators.push({ id: candidateOperator.code, station });
          console.log(`[${this.getTimestamp()}] 👤 Assigned operator ${candidateOperator.code} to station ${station} on machine ${machineSerial}${useLast ? ' (reused)' : ' (new)'}`);
          
        } catch (error) {
          console.error(`[${this.getTimestamp()}] ❌ Failed to assign operator ${candidateOperator.code} to station ${station}:`, error.message);
          // Fallback to dummy operator
          assignedOperators.push({ id: -1, station });
        }
      } else {
        // Fallback: dummy operator
        assignedOperators.push({ id: -1, station });
        console.log(`[${this.getTimestamp()}] ⚠️ No operator available for station ${station}, using dummy operator`);
      }
    }
    
    // For inactive stations, assign dummy or -1 as before
    // For inactive stations, assign -1 (no operator)
    for (let station = 1; station <= machineLanes; station++) {
      if (!activeStations.includes(station)) {
        assignedOperators.push({ id: -1, station });
      }
    }
    
    // Sort by station
    assignedOperators.sort((a, b) => a.station - b.station);
    return assignedOperators;
  }

  async cleanupOperatorAssignments() {
    const db = this.client.db(this.dbName);
    const machineSerial = this.machineConfig.serial;
    const tickerCollection = db.collection(config.simulatedOperatorsTickerCollectionName);
    
    try {
      // Remove all operator assignments for this machine
      const result = await tickerCollection.deleteMany({ machineSerial: machineSerial });
      if (result.deletedCount > 0) {
        console.log(`[${this.getTimestamp()}] 🧹 Cleaned up ${result.deletedCount} operator assignments for machine ${machineSerial}`);
      }
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error cleaning up operator assignments for machine ${machineSerial}:`, error.message);
    }
  }

  async writeState(stateType) {
    if (stateType === "Timeout" || stateType === "Fault") {
      this.countTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.countTimeouts.clear();
      this.currentRunningState = null;
      
      // Clean up operator assignments when machine stops running
      await this.cleanupOperatorAssignments();
    }

    let record;
    
    if (stateType === "Running") {
      // Use new operator assignment logic for Running state
      const assignedOperators = await this.assignOperatorsForRunningState();
      
      // Build state record with assigned operators
      const statusMap = {
        Timeout: { code: 0, name: "Timeout", softrolColor: "Grey" },
        Running: { code: 1, name: "Run", softrolColor: "Green" },
        Fault:   { code: 0, name: "Fault", softrolColor: "Red" } // Will be overridden with actual fault code
      };
      const status = statusMap[stateType];
      
      // Use current item for all stations
      const items = {};
      const maxStations = targetConfig.lanes || 1;
      for (let i = 0; i < maxStations; i++) {
        items[i.toString()] = { 
          id: this.currentItem.number, 
          count: 0 
        };
      }
      const targetConfig = this.machineConfig;
      
      record = {
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
        operators: assignedOperators,
        status
      };
    } else {
      // Use updated buildStateRecord function for Timeout and Fault states
      const db = this.client.db(this.dbName);
      record = await require('./utils').buildStateRecord(db, stateType, this.machineConfig);

      if (stateType === "Fault") {
        const fault = this.getRandomFault();
        record.status.code = fault.code;
        record.status.name = fault.name;
      }
    }

    const db = this.client.db(this.dbName);
    await db.collection(this.collectionName).insertOne(record);
    delete record._id;

    await db.collection(config.stateTickerCollectionName).updateOne(
      { "machine.serial": record.machine.serial },
      { $set: record },
      { upsert: true }
    );

    if (stateType === "Running") {
      this.currentRunningState = record;
      record.operators.forEach((op) => {
        if (op.id > 0 && op.id < 900000) {
          this.simulateStationCounts(record, op.station, op);
        }
      });
    }
  }

  async simulationLoop() {
    while (this.isRunning) {
      await this.writeState("Timeout");
      await this.delay(getRandomDelay(1, 5));
      if (!this.isRunning) break;

      await this.writeState("Running");
      await this.delay(getRandomDelay(2, 90));
      if (!this.isRunning) break;

      const nextState = Math.random() < 0.5 ? "Timeout" : "Fault";
      await this.writeState(nextState);
      
      // Select next item when machine stops (before delay)
      this.selectNextItem();
      
      await this.delay(getRandomDelay(1, 5));
    }
  }

  async stop() {
    if (!this.isRunning) return;
    this.countTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.countTimeouts.clear();
    this.isRunning = false;
    await this.client?.close();
    console.log(`[${this.getTimestamp()}] 🛑 Simulator stopped`);
  }

  simulateStationCounts(runningState, station, operator) {
    // Calculate timing based on current item
    const timing = calculateItemTiming(this.currentItem);
    const delayMs = (Math.floor(Math.random() * (timing.highRange - timing.lowRange + 1)) + timing.lowRange) * 1000;

    const timeout = setTimeout(async () => {
      try {
        const db = this.client.db(this.dbName);
        const collection = db.collection(this.countCollectionName);
        const operatorName = await getOperatorName(db, operator.id);
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
          lane: station
        };

        if (!isMisfeed) {
          // Include current item information
          countRecord.item = {
            id: this.currentItem.number,
            name: this.currentItem.name,
            standard: this.currentItem.standard
          };
        } else {
          countRecord.misfeed = true;
        }

        await collection.insertOne(countRecord);

        if (this.countTimeouts.has(station)) {
          this.simulateStationCounts(runningState, station, operator);
        }
      } catch (err) {
        console.error(`❌ Count error at station ${station}:`, err.message);
      }
    }, delayMs);

    this.countTimeouts.set(station, timeout);
  }

  delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  getTimestamp() {
    return new Date().toISOString();
  }
}

module.exports = MachineSimulator;

if (require.main === module) {
  const { getActiveMachines } = require('./fillmore-machines');

  async function startWorker() {
    const config = process.env.MACHINE_CONFIG
      ? JSON.parse(process.env.MACHINE_CONFIG)
      : getActiveMachines()[0];

    const simulator = new MachineSimulator(config);

    process.on('SIGINT', async () => {
      await simulator.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await simulator.stop();
      process.exit(0);
    });

    await simulator.start();
  }

  startWorker().catch(console.error);
}
