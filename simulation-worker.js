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
    this.currentItem = null; // Currently selected item for non-SPF machines
    this.currentItems = []; // Array to store 4 items for SPF machines
    this.mongoUri = config.mongoUri;
    this.dbName = config.dbName;
    this.collectionName = config.collectionName;
    this.countCollectionName = config.countCollectionName;
    this.inSession = false;
  }

  // Helper method to check if machine is SPF
  isSpf() {
    return String(this.machineConfig.type).toUpperCase() === 'SPF';
  }

  // Helper method to pick distinct random items
  pickDistinct(items, n) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(n, copy.length));
  }

  async start() {
    if (this.isRunning) return;

    try {
      console.log(`[${this.getTimestamp()}] 🚀 Starting simulator for ${this.machineConfig.name}`);
      await this.connectToMongoDB();
      await this.loadFaults();
      await this.loadItems();
      this.selectInitialItem();
      
      // Assign operators before starting simulation loop to ensure first state has operators
      await this.assignInitialOperators();
      
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
    if (this.isSpf()) {
      this.currentItems = this.pickDistinct(this.items, 4);  // exactly four
      console.log(`[${this.getTimestamp()}] 🎯 SPF initial items: ${this.currentItems.map(i => i.name).join(', ')}`);
    } else {
      this.currentItem = selectRandomItem(this.items);       // exactly one
    }
  }

  async assignInitialOperators() {
    // Assign operators before the first state is written
    const assignedOperators = await this.assignOperatorsForRunningState();
    this.currentRunningState = {
      operators: assignedOperators
    };
    console.log(`[${this.getTimestamp()}] 👥 Assigned ${assignedOperators.length} initial operators for ${this.machineConfig.name}`);
  }

  selectNextItem() {
    if (!shouldChangeItem()) {
      if (this.isSpf()) {
        console.log(`[${this.getTimestamp()}] 🔄 Keeping current item set`);
      } else {
        console.log(`[${this.getTimestamp()}] 🔄 Keeping current item: ${this.currentItem.name}`);
      }
      return;
    }
    
    if (this.isSpf()) {
      this.currentItems = this.pickDistinct(this.items, 4);
      console.log(`[${this.getTimestamp()}] 🔁 SPF new items: ${this.currentItems.map(i => i.name).join(', ')}`);
    } else {
      this.currentItem = selectRandomItem(this.items);
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
    const tickerCollection = db.collection(config.simulatedOperatorsTickerCollectionName);
    const operatorsCollection = db.collection(config.operatorCollectionName);
    const activeStations = getActiveStations(this.machineConfig);
    const machineSerial = this.machineConfig.serial;
    const assignedOperators = [];

    // Read current occupancy ("ticker")
    const ticker = await tickerCollection.find({}, { projection: { operatorId: 1, machineSerial: 1, station: 1 } }).toArray();
    const currentlySimulatedIds = ticker.map(t => t.operatorId).filter(Boolean);

    // Preload all < 500000, then we'll apply the "startsWith('1')" rule in JS
    const allValidByRange = await operatorsCollection.find(
      { code: { $lt: 500000 } },
      { projection: { _id: 0, code: 1, name: 1 } }
    ).toArray();

    for (const station of activeStations) {
      // Find last operator for this machine/station
      const lastAssignment = ticker.find(
        t => t.machineSerial === machineSerial && t.station === station
      );
      let candidateOperator = null;
      let useLast = false;

      // 98% chance reuse last per station if still "available" to this station/machine
      if (lastAssignment && Math.random() < 0.98) {
        const stillClaimed = ticker.find(t => t.operatorId === lastAssignment.operatorId);
        const ok = !stillClaimed || (stillClaimed.machineSerial === machineSerial && stillClaimed.station === station);

        // also enforce your "startsWith('1')" rule
        const lastIsAllowed = String(lastAssignment.operatorId).startsWith('1') && allValidByRange.some(op => op.code === lastAssignment.operatorId);

        if (ok && lastIsAllowed) {
          candidateOperator = { code: lastAssignment.operatorId, name: allValidByRange.find(op => op.code === lastAssignment.operatorId)?.name || "Unknown" };
          useLast = true;
        }
      }

      if (!candidateOperator) {
        // Need a NEW operator:
        // Exclude currently simulated and exclude last (to force a change if last existed)
        const unavailable = new Set(currentlySimulatedIds);
        if (lastAssignment?.operatorId) unavailable.add(lastAssignment.operatorId);

        // DB filter for range + occupancy, then JS filter for "startsWith('1')"
        const poolDb = await operatorsCollection.find(
          { code: { $lt: 500000, $nin: Array.from(unavailable) } },
          { projection: { _id: 0, code: 1, name: 1 } }
        ).toArray();

        const pool = poolDb.filter(op => String(op.code).startsWith('1'));

        if (pool.length > 0) {
          candidateOperator = pool[Math.floor(Math.random() * pool.length)];
        } else if (lastAssignment?.operatorId && String(lastAssignment.operatorId).startsWith('1')) {
          // fallback: reuse last if no one else is available and last fits your rule
          candidateOperator = { code: lastAssignment.operatorId, name: allValidByRange.find(op => op.code === lastAssignment.operatorId)?.name || "Unknown" };
          useLast = true;
        }
      }

      // Upsert into ticker (atomic). Handle dup key by a quick fallback.
      if (candidateOperator) {
        try {
          // Use findOneAndUpdate with upsert for atomic operation
          const result = await tickerCollection.findOneAndUpdate(
            {
              $or: [
                { operatorId: candidateOperator.code },                   // operator held elsewhere
                { machineSerial: machineSerial, station: station }       // this station already held
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
          currentlySimulatedIds.push(candidateOperator.code);
          assignedOperators.push({ id: candidateOperator.code, name: candidateOperator.name, station });
          console.log(`[${this.getTimestamp()}] 👤 ${useLast ? 'Reused' : 'Assigned'} operator ${candidateOperator.code} (${candidateOperator.name}) to station ${station} on machine ${machineSerial}`);

        } catch (error) {
          if (error.code === 11000) {
            // Someone else grabbed it—pick a different one once
            console.warn(`[${this.getTimestamp()}] ⚠️ Duplicate operator ${candidateOperator.code}; selecting another`);
            const altPoolDb = await operatorsCollection.find(
              { code: { $lt: 500000, $nin: currentlySimulatedIds } },
              { projection: { _id: 0, code: 1, name: 1 } }
            ).toArray();
            const altPool = altPoolDb.filter(op => String(op.code).startsWith('1'));
            const alt = altPool.find(op => op.code !== (lastAssignment?.operatorId ?? -1));
            assignedOperators.push({ id: alt ? alt.code : -1, name: alt ? alt.name : "Unknown", station });
          } else {
            console.error(`[${this.getTimestamp()}] ❌ Failed to assign operator ${candidateOperator.code} to station ${station}:`, error.message);
            // Fallback to dummy operator
            assignedOperators.push({ id: -1, name: "Dummy", station });
          }
        }
      } else {
        // Fallback: dummy operator
        assignedOperators.push({ id: -1, name: "Dummy", station });
        console.log(`[${this.getTimestamp()}] ⚠️ No operator available for station ${station}, using dummy operator`);
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

  async writeOperatorStateRecords(record) {
    try {
      const db = this.client.db(this.dbName);
      
      // Write operator-specific records to all operator collections
      if (record.operators && record.operators.length > 0) {
        for (const operator of record.operators) {
          if (operator.id !== -1) { // Skip dummy operators
            // Create operator-specific record
            const operatorRecord = {
              ...record,
              operators: [operator] // Single operator instead of array
            };
            
            // Write to main operator collection
            await db.collection(config.stateOperatorCollectionName).insertOne(operatorRecord);
            
            // Write to additional operator collections
            await db.collection(config.stateOperatorDailyCollectionName).insertOne(operatorRecord);
            await db.collection(config.stateOperatorWeeklyCollectionName).insertOne(operatorRecord);
            await db.collection(config.stateOperatorMonthlyCollectionName).insertOne(operatorRecord);
          }
        }
      }
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error writing operator state records:`, error.message);
      // Don't throw - keep this separate from main state writes
    }
  }

  async writeState(stateType) {
    if (stateType === "Timeout" || stateType === "Fault") {
      this.countTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.countTimeouts.clear();
       if (stateType === "Timeout") {
           this.inSession = false;                 // end of session happens on Timeout
         }
      // Don't clear currentRunningState or cleanup operators - preserve session state
    }

    let record;

    if (stateType === "Running") {
      const isNewSession = !this.inSession;     // new session if we were not in-session
      const assignedOperators = isNewSession
        ? await this.assignOperatorsForRunningState()    // 98/2, per station, only here
        : this.currentRunningState.operators;            // keep same operators within the session
      
        this.inSession = true;                    // now we are in-session
      // Build Running record with assigned operators
      const targetConfig = this.machineConfig;
      
      // Build items array with correct cardinality
      let itemsArr;
      if (this.isSpf()) {
        // exactly four entries (or fewer if DB has <4)
        itemsArr = this.currentItems.map(i => ({ id: i.number, count: 0 }));
        while (itemsArr.length < 4) itemsArr.push({ id: this.currentItems[0].number, count: 0 }); // pad to 4 if needed
      } else {
        // exactly one entry for all non-SPF machines
        itemsArr = [{ id: this.currentItem.number, count: 0 }];
      }

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
          items: itemsArr                 // ✅ now an ARRAY with correct cardinality
        },
        operators: assignedOperators,
        status: { code: 1, name: "Run", softrolColor: "Green" }
      };
    } else {
      // Fault/Timeout reuse operators + program/items from last Running
      const prev = this.currentRunningState;
      const targetConfig = this.machineConfig;
      const status = stateType === "Fault"
        ? (() => { 
            const f = this.getRandomFault(); 
            return { code: f.code, name: f.name, softrolColor: "Red" }; 
          })()
        : { code: 0, name: "Timeout", softrolColor: "Grey" };

      record = {
        timestamp: new Date(),
        machine: {
          serial: targetConfig.serial,
          name: targetConfig.name,
          ipAddress: targetConfig.ipAddress
        },
        program: prev?.program ?? {
          mode: "smallPiece",
          programNumber: 1,
          batchNumber: Math.floor(Math.random() * 21) + 20,
          accountNumber: 0,
          speed: 0,
          stations: targetConfig.lanes,
          items: this.isSpf()
            ? (this.currentItems.length ? this.currentItems.map(i => ({ id: i.number, count: 0 })) : [{ id: 26, count: 0 }, { id: 26, count: 0 }, { id: 26, count: 0 }, { id: 26, count: 0 }])
            : (this.currentItem ? [{ id: this.currentItem.number, count: 0 }] : [{ id: 26, count: 0 }])
        },
        operators: prev?.operators ?? [],
        status
      };
    }

    const db = this.client.db(this.dbName);

    // Write to main state-machine collection
    await db.collection(this.collectionName).insertOne(record);

    // Write to additional state collections (simple data copying)
    await db.collection(config.stateMachineDailyCollectionName).insertOne(record);
    await db.collection(config.stateMachineWeeklyCollectionName).insertOne(record);
    await db.collection(config.stateMachineMonthlyCollectionName).insertOne(record);
    delete record._id;

    // Write operator-specific records to operator collections
    await this.writeOperatorStateRecords(record);

    // Update state ticker
    await db.collection(config.stateTickerCollectionName).updateOne(
      { "machine.serial": record.machine.serial },
      { $set: record },
      { upsert: true }
    );

    if (stateType === "Running") {
      this.currentRunningState = record;                // only update on Running
      record.operators.forEach((op) => {
        if (require('./utils').isValidOperatorId(op.id)) {
          this.simulateStationCounts(record, op.station, op);
        }
      });
    }
  }

  async simulationLoop() {
    while (this.isRunning) {
      await this.writeState("Timeout");
      await this.delay(getRandomDelay(0.25, 1.25));
      if (!this.isRunning) break;

      await this.writeState("Running");
      await this.delay(getRandomDelay(2, 90));
      if (!this.isRunning) break;

      const nextState = Math.random() < 0.5 ? "Timeout" : "Fault";
      await this.writeState(nextState);

      // Select next item when machine stops (before delay)
      this.selectNextItem();

      await this.delay(getRandomDelay(0.25, 1.25));
    }
  }

  async stop() {
    if (!this.isRunning) return;
    this.countTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.countTimeouts.clear();
    this.isRunning = false;
    
    // Clean up operator assignments when simulator stops
    await this.cleanupOperatorAssignments();
    
    await this.client?.close();
    console.log(`[${this.getTimestamp()}] 🛑 Simulator stopped`);
  }

  simulateStationCounts(runningState, station, operator) {
    // Choose the correct item for this station
    const itemForThisStation = this.isSpf()
      ? this.currentItems[(Math.max(1, station) - 1) % Math.max(1, this.currentItems.length || 1)]
      : this.currentItem;
    
    // Calculate timing based on current item
    const timing = calculateItemTiming(itemForThisStation);
    const delayMs = (Math.floor(Math.random() * (timing.highRange - timing.lowRange + 1)) + timing.lowRange) * 1000;

    const timeout = setTimeout(async () => {
      try {
        const db = this.client.db(this.dbName);
        const collection = db.collection(this.countCollectionName);
        // Use the operator name that's already stored in the operator object
        const operatorName = operator.name || await getOperatorName(db, operator.id);
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
            id: itemForThisStation.number,
            name: itemForThisStation.name,
            standard: itemForThisStation.standard
          };
        } else {
          countRecord.misfeed = true;
        }

        // Write to main count collection
        await collection.insertOne(countRecord);

        // Write to additional count collections (simple data copying)
        await db.collection(config.countDailyCollectionName).insertOne(countRecord);
        await db.collection(config.countWeeklyCollectionName).insertOne(countRecord);
        await db.collection(config.countMonthlyCollectionName).insertOne(countRecord);

        await db.collection(config.stateTickerCollectionName).updateOne(
          { "machine.serial": countRecord.machine.serial },
          { $set: {timestamp: new Date() } }
        );

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



