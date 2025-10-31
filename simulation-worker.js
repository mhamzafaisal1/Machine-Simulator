// simulation-worker.js - Main file for the generating workers.

const { MongoClient } = require('mongodb');
const { DateTime, Duration } = require('luxon');
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
const {
  recalculateAndUpdateCache
} = require('./simulator-cache-builder');
const schemaValidator = require('./schema-validator');
const schemaAdapters = require('./schema-adapters');

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
    // Session tracking properties
    this.currentSessionId = null;
    this.currentSessionStartTime = null;

    // Operator session tracking maps
    this.operatorSessionIdsByOperator = new Map();   // operatorId -> ObjectId
    this.operatorSessionIdsByStation = new Map();    // station -> ObjectId (safer for SPF)
    // Item session tracking map
    this.itemSessionIdsByItem = new Map();           // itemId -> ObjectId
    // Fault session tracking
    this.currentFaultSessionId = null;               // ObjectId for open fault session
    
    // ⭐ IN-MEMORY CACHE ARRAYS (for real-time cache building without DB polling)
    this.cachedMachineSessions = [];                  // Machine sessions for today
    this.cachedFaultSessions = [];                    // Fault sessions for today
    this.cachedOperatorSessions = new Map();          // operatorId -> session array for today
    this.cachedItemSessions = new Map();              // itemId -> session array for today
    this.todayStart = null;                           // Midnight today (for filtering)
    this.cacheUpdateInterval = null;                  // Recurring interval for cache updates
  }

  // Helper method to check if machine is SPF
  isSpf() {
    const type = String(this.machineConfig.type || '').toUpperCase();
    const name = String(this.machineConfig.name || '').toUpperCase();
    return type === 'SPF' || name.startsWith('SPF');
  }

  // Helper method to ensure current item is set before starting sessions
  ensureCurrentItem() {
    if (!this.currentItem) {
      if (!this.items || this.items.length === 0) {
        throw new Error('No active items loaded; cannot start session');
      }
      console.log(`[${this.getTimestamp()}] ⚠️ currentItem is null, calling selectInitialItem() to fix`);
      this.selectInitialItem();

      // Verify the fix worked
      if (!this.currentItem) {
        throw new Error('Failed to set currentItem after calling selectInitialItem()');
      }
      console.log(`[${this.getTimestamp()}] ✅ currentItem fixed: ${this.currentItem.name} (ID: ${this.currentItem.number})`);
    }

    // For SPF machines, also ensure currentItems array is properly maintained
    if (this.isSpf()) {
      if (!this.currentItems || this.currentItems.length === 0) {
        console.log(`[${this.getTimestamp()}] ⚠️ SPF currentItems array is empty, rebuilding from currentItem`);
        this.currentItems = [this.currentItem, this.currentItem, this.currentItem, this.currentItem];
      }

      // Validate that we have exactly 4 items for SPF
      if (this.currentItems.length !== 4) {
        console.warn(`[${this.getTimestamp()}] ⚠️ SPF currentItems array has ${this.currentItems.length} items, expected 4. Rebuilding.`);
        this.currentItems = [this.currentItem, this.currentItem, this.currentItem, this.currentItem];
      }
    }
  }

  // Helper method to build current items array for sessions
  buildCurrentItemsArray() {
    this.ensureCurrentItem();
    const it = this.currentItem;

    // Double-check that we have a valid item
    const itId = it ? (it.number ?? it.id) : undefined;
    if (!it || !itId || !it.name || it.standard === undefined) {
      throw new Error('Current item is invalid or missing required fields');
    }

    const make = () => ({ id: (it.number ?? it.id), name: it.name, standard: it.standard });
    const formatItem = (item) => ({ id: (item.number ?? item.id), name: item.name, standard: item.standard });

    // Use the isSpf() method for consistency
    const isSPF = this.isSpf();

    if (isSPF) {
      // For SPF machines, also ensure currentItems array is properly maintained
      if (!this.currentItems || this.currentItems.length === 0) {
        console.log(`[${this.getTimestamp()}] ⚠️ SPF currentItems array is empty, rebuilding from currentItem`);
        this.currentItems = this.pickDistinct(this.items, 4); // Create 4 copies for SPF
      }

      // Validate that we have exactly 4 items for SPF
      if (this.currentItems.length !== 4) {
        console.warn(`[${this.getTimestamp()}] ⚠️ SPF currentItems array has ${this.currentItems.length} items, expected 4. Rebuilding.`);
        this.currentItems = [it, it, it, it];
      }

      return [formatItem(this.currentItems[0]), formatItem(this.currentItems[1]), formatItem(this.currentItems[2]), formatItem(this.currentItems[3])];
    } else {
      return [make()];
    }
  }

  // Helper method to pick distinct random items
  pickDistinct(items, n) {
    if (!items || items.length === 0) {
      throw new Error('No items available for selection');
    }

    if (items.length < n) {
      console.warn(`[${this.getTimestamp()}] ⚠️ Only ${items.length} items available, but ${n} requested. Will use available items.`);
    }

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
      console.log(`[${this.getTimestamp()}] 📦 Loaded ${this.items.length} items`);

      // Validate that we have enough items for SPF machines
      if (this.isSpf() && this.items.length < 4) {
        console.warn(`[${this.getTimestamp()}] ⚠️ SPF machine requires at least 4 items, but only ${this.items.length} are available`);
      }

      this.selectInitialItem();
      console.log(`[${this.getTimestamp()}] 🎯 Initial item selection complete - currentItem: ${this.currentItem ? this.currentItem.name : 'null'}, isSPF: ${this.isSpf()}`);

      // Assign operators before starting simulation loop to ensure first state has operators
      await this.assignInitialOperators();
      
      // ⭐ Load today's sessions into memory for real-time cache building
      await this.loadTodaysSessions();

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

    // ⭐ Validate adapted faults (non-breaking)
    try {
      const adapted = this.validFaults.map(f => schemaAdapters.adaptFaultFromDB(f));
      let ok = 0;
      for (const af of adapted) {
        if (Number.isFinite(af.id) && schemaValidator.validate('fault', af, { faultCode: af.id })) ok++;
      }
      console.log(`[${this.getTimestamp()}] ✅ Fault schema validation: ${ok}/${adapted.length} adapted faults valid`);
      this.adaptedFaults = adapted; // optional reference
    } catch (e) {
      console.warn(`[${this.getTimestamp()}] ⚠️ Fault validation skipped: ${e.message}`);
    }

    if (this.validFaults.length < 58) {
      console.warn(`[${this.getTimestamp()}] ⚠️ Only ${this.validFaults.length} fault codes found (expected 58)`);
    }
  }

  async loadItems() {
    const db = this.client.db(this.dbName);
    this.items = await loadItems(db);

    // ⭐ PHASE 1: Validate loaded items (non-breaking)
    let validItemCount = 0;
    this.items.forEach(item => {
      // Items are now adapted, so use item.id (which has backward compat with item.number)
      if (schemaValidator.validate('item', item, { itemId: item.id || item.number })) {
        validItemCount++;
      }
    });
    if (validItemCount > 0) {
      console.log(`[${this.getTimestamp()}] ✅ ${validItemCount}/${this.items.length} items passed schema validation`);
    }
  }

  /**
   * ⭐ Loads today's sessions into memory for real-time cache building
   * This eliminates the need for database polling by the cacher service
   */
  async loadTodaysSessions() {
    try {
      console.log(`[${this.getTimestamp()}] 📥 Loading today's sessions into memory for cache building...`);
      
      const db = this.client.db(this.dbName);
      const machineSerial = this.machineConfig.id || this.machineConfig.serial;
      
      // Calculate today's start (midnight in America/Chicago timezone)
      const SYSTEM_TIMEZONE = 'America/Chicago';
      this.todayStart = DateTime.now().setZone(SYSTEM_TIMEZONE).startOf('day').toJSDate();
      const now = new Date();
      
      console.log(`[${this.getTimestamp()}] 🕐 Today starts at: ${this.todayStart.toISOString()}`);
      
      // 1. Load machine sessions for this machine today
      const machineSessionColl = db.collection(config.machineSessionCollectionName);
      this.cachedMachineSessions = await machineSessionColl.find({
        'machine.serial': machineSerial,
        'timestamps.start': { $gte: this.todayStart }
      }).sort({ 'timestamps.start': 1 }).toArray();
      
      console.log(`[${this.getTimestamp()}] ✅ Loaded ${this.cachedMachineSessions.length} machine sessions`);
      
      // 2. Load fault sessions for this machine today
      const faultSessionColl = db.collection(config.faultSessionCollectionName);
      this.cachedFaultSessions = await faultSessionColl.find({
        'machine.serial': machineSerial,
        'timestamps.start': { $gte: this.todayStart }
      }).sort({ 'timestamps.start': 1 }).toArray();
      
      console.log(`[${this.getTimestamp()}] ✅ Loaded ${this.cachedFaultSessions.length} fault sessions`);
      
      // 3. Load operator sessions for this machine today (group by operator ID)
      const operatorSessionColl = db.collection(config.operatorSessionCollectionName);
      const operatorSessions = await operatorSessionColl.find({
        'machine.serial': machineSerial,
        'timestamps.start': { $gte: this.todayStart }
      }).sort({ 'timestamps.start': 1 }).toArray();
      
      // Group by operator ID
      for (const session of operatorSessions) {
        const operatorId = session.operator?.id;
        if (operatorId && operatorId !== -1) {
          if (!this.cachedOperatorSessions.has(operatorId)) {
            this.cachedOperatorSessions.set(operatorId, []);
          }
          this.cachedOperatorSessions.get(operatorId).push(session);
        }
      }
      
      console.log(`[${this.getTimestamp()}] ✅ Loaded ${operatorSessions.length} operator sessions for ${this.cachedOperatorSessions.size} operators`);
      
      // 4. Load item sessions for this machine today (group by item ID)
      const itemSessionColl = db.collection(config.itemSessionCollectionName);
      const itemSessions = await itemSessionColl.find({
        'machine.serial': machineSerial,
        'timestamps.start': { $gte: this.todayStart }
      }).sort({ 'timestamps.start': 1 }).toArray();
      
      // Group by item ID
      for (const session of itemSessions) {
        const itemId = session.item?.id;
        if (itemId) {
          if (!this.cachedItemSessions.has(itemId)) {
            this.cachedItemSessions.set(itemId, []);
          }
          this.cachedItemSessions.get(itemId).push(session);
        }
      }
      
      console.log(`[${this.getTimestamp()}] ✅ Loaded ${itemSessions.length} item sessions for ${this.cachedItemSessions.size} items`);
      console.log(`[${this.getTimestamp()}] 🎉 Session cache initialized successfully!`);
      
      // ⭐ Start the recurring cache update interval
      this.startCacheUpdateInterval();
      
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error loading today's sessions:`, error);
      // Don't throw - simulator can continue without cache, it just won't update cache totals
    }
  }

  /**
   * ⭐ Recalculates and updates daily cache totals using in-memory session data
   * This is called after session updates to keep cache up-to-date in real-time
   */
  async recalculateDailyCacheTotals() {
    try {
      if (!this.todayStart) {
        console.warn(`[${this.getTimestamp()}] ⚠️ todayStart not set, skipping cache recalculation`);
        return;
      }

      const db = this.client.db(this.dbName);
      const now = new Date();
      
      // Recalculate and update cache using in-memory session arrays
      const result = await recalculateAndUpdateCache({
        db,
        machineSerial: this.machineConfig.id || this.machineConfig.serial,
        machineName: this.machineConfig.name,
        machineSessions: this.cachedMachineSessions,
        faultSessions: this.cachedFaultSessions,
        operatorSessionsMap: this.cachedOperatorSessions,
        itemSessionsMap: this.cachedItemSessions,
        queryStart: this.todayStart,
        queryEnd: now
      });
      
      if (result.success) {
        console.log(`[${this.getTimestamp()}] 📊 Cache updated: ${result.recordsUpdated} records (${result.machineTotals} machine, ${result.operatorTotals} operators, ${result.machineItemTotals} machine-items, ${result.itemTotals} items, ${result.operatorItemTotals} operator-items)`);
      } else {
        console.error(`[${this.getTimestamp()}] ❌ Cache update failed: ${result.error}`);
      }
      
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error recalculating daily cache totals:`, error);
      // Don't throw - cache updates are non-critical
    }
  }

  /**
   * ⭐ Starts the recurring cache update interval
   * Cache updates run automatically every N seconds based on config
   */
  startCacheUpdateInterval() {
    // Stop any existing interval
    if (this.cacheUpdateInterval) {
      clearInterval(this.cacheUpdateInterval);
    }

    const intervalMs = (config.cacheUpdateIntervalSeconds || 30) * 1000;
    
    console.log(`[${this.getTimestamp()}] ⏰ Starting cache update interval (every ${config.cacheUpdateIntervalSeconds || 30} seconds)`);
    
    // Set recurring interval
    this.cacheUpdateInterval = setInterval(async () => {
      await this.recalculateDailyCacheTotals();
    }, intervalMs);
  }

  /**
   * ⭐ Stops the cache update interval
   */
  stopCacheUpdateInterval() {
    if (this.cacheUpdateInterval) {
      clearInterval(this.cacheUpdateInterval);
      this.cacheUpdateInterval = null;
      console.log(`[${this.getTimestamp()}] ⏹️ Stopped cache update interval`);
    }
  }

  selectInitialItem() {
    if (this.isSpf()) {
      this.currentItems = this.pickDistinct(this.items, 4);  // exactly four
      // For SPF machines, also set currentItem to the first item for session compatibility
      this.currentItem = this.currentItems[0];
      console.log(`[${this.getTimestamp()}] 🎯 SPF initial items: ${this.currentItems.map(i => i.name).join(', ')}`);
      console.log(`[${this.getTimestamp()}] 🎯 SPF currentItem set to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);

      // Validate that we have the correct number of items for SPF
      if (this.currentItems.length !== 4) {
        console.warn(`[${this.getTimestamp()}] ⚠️ SPF machine has ${this.currentItems.length} items instead of expected 4`);
      }
    } else {
      this.currentItem = selectRandomItem(this.items);       // exactly one
      console.log(`[${this.getTimestamp()}] 🎯 Non-SPF currentItem set to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);
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
      // For SPF machines, also update currentItem to the first item for session compatibility
      this.currentItem = this.currentItems[0];
      console.log(`[${this.getTimestamp()}] 🔁 SPF new items: ${this.currentItems.map(i => i.name).join(', ')}`);
      console.log(`[${this.getTimestamp()}] 🔁 SPF currentItem updated to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);

      // Validate that we have the correct number of items for SPF
      if (this.currentItems.length !== 4) {
        console.warn(`[${this.getTimestamp()}] ⚠️ SPF machine has ${this.currentItems.length} items instead of expected 4 after item change`);
      }
    } else {
      this.currentItem = selectRandomItem(this.items);
      console.log(`[${this.getTimestamp()}] 🔁 Non-SPF currentItem updated to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);
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
    const machineSerial = this.machineConfig.id || this.machineConfig.serial;
    const assignedOperators = [];

    // Read current occupancy ("ticker")
    const ticker = await tickerCollection.find({}, { projection: { operatorId: 1, machineSerial: 1, station: 1 } }).toArray();
    const currentlySimulatedIds = ticker.map(t => t.operatorId).filter(Boolean);

    // Preload all < 500000, then we'll apply the "startsWith('1')" rule in JS
    const allValidByRange = await operatorsCollection.find(
      { code: { $lt: 500000 } },
      { projection: { _id: 0, code: 1, name: 1, rate: 1 } }
    ).toArray();

    // ⭐ Adapt operators to schema format
    const adaptedOperators = allValidByRange.map(op => schemaAdapters.adaptOperatorFromDB(op));

    // ⭐ Validate adapted operators (sample only)
    if (adaptedOperators.length > 0) {
      const sampleOperator = adaptedOperators[0];
      schemaValidator.validate('operator', sampleOperator, { operatorId: sampleOperator.id });
    }

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
        const lastIsAllowed = String(lastAssignment.operatorId).startsWith('1') && adaptedOperators.some(op => op.id === lastAssignment.operatorId);

        if (ok && lastIsAllowed) {
          candidateOperator = adaptedOperators.find(op => op.id === lastAssignment.operatorId) || { id: lastAssignment.operatorId, name: { first: "Unknown", surname: "" }, _rate: 1 };
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
          { projection: { _id: 0, code: 1, name: 1, rate: 1 } }
        ).toArray();

        // Adapt pool operators
        const poolAdapted = poolDb.map(op => schemaAdapters.adaptOperatorFromDB(op));
        const pool = poolAdapted.filter(op => String(op.id).startsWith('1'));

        if (pool.length > 0) {
          candidateOperator = pool[Math.floor(Math.random() * pool.length)];
        } else if (lastAssignment?.operatorId && String(lastAssignment.operatorId).startsWith('1')) {
          // fallback: reuse last if no one else is available and last fits your rule
          candidateOperator = adaptedOperators.find(op => op.id === lastAssignment.operatorId) || { id: lastAssignment.operatorId, name: { first: "Unknown", surname: "" }, _rate: 1 };
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
                { operatorId: candidateOperator.id },                   // operator held elsewhere
                { machineSerial: machineSerial, station: station }       // this station already held
              ]
            },
            {
              $set: {
                operatorId: candidateOperator.id,
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

          // Helper to get full name from structured name object or fallback
          const getFullName = (op) => {
            if (typeof op.name === 'string') return op.name;
            if (op.name && op.name.first) {
              const fullName = `${op.name.first} ${op.name.surname || ''}`.trim();
              return fullName || 'Unknown';
            }
            return 'Unknown';
          };

          // Update our local tracking
          currentlySimulatedIds.push(candidateOperator.id);
          const fullName = getFullName(candidateOperator);
          assignedOperators.push({ id: candidateOperator.id, name: fullName, station, rate: candidateOperator._rate || 1 });
          console.log(`[${this.getTimestamp()}] 👤 ${useLast ? 'Reused' : 'Assigned'} operator ${candidateOperator.id} (${fullName}) to station ${station} on machine ${machineSerial}`);

        } catch (error) {
          if (error.code === 11000) {
            // Someone else grabbed it—pick a different one once
            console.warn(`[${this.getTimestamp()}] ⚠️ Duplicate operator ${candidateOperator.id}; selecting another`);
            const altPoolDb = await operatorsCollection.find(
              { code: { $lt: 500000, $nin: currentlySimulatedIds } },
              { projection: { _id: 0, code: 1, name: 1, rate: 1 } }
            ).toArray();
            const altPoolAdapted = altPoolDb.map(op => schemaAdapters.adaptOperatorFromDB(op));
            const altPool = altPoolAdapted.filter(op => String(op.id).startsWith('1'));
            const alt = altPool.find(op => op.id !== (lastAssignment?.operatorId ?? -1));
            const altFullName = alt ? `${alt.name.first} ${alt.name.surname || ''}`.trim() : "Unknown";
            assignedOperators.push({ id: alt ? alt.id : -1, name: altFullName, rate: alt?._rate || 1 , station });
          } else {
            console.error(`[${this.getTimestamp()}] ❌ Failed to assign operator ${candidateOperator.id} to station ${station}:`, error.message);
            // Fallback to dummy operator
            assignedOperators.push({ id: -1, name: "Dummy", station, rate: 1 });
          }
        }
      } else {
        // Fallback: dummy operator
        assignedOperators.push({ id: -1, name: "Dummy", station, rate: 1 });
        console.log(`[${this.getTimestamp()}] ⚠️ No operator available for station ${station}, using dummy operator`);
      }
    }

    // Sort by station
    assignedOperators.sort((a, b) => a.station - b.station);
    return assignedOperators;
  }

  async cleanupOperatorAssignments() {
    const db = this.client.db(this.dbName);
    const machineSerial = this.machineConfig.id || this.machineConfig.serial;
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

  async startMachineSession(runningState) {
    try {
      const db = this.client.db(this.dbName);
      const sessionCollection = db.collection(config.machineSessionCollectionName);

      // Add explicit logging to verify SPF initialization
      console.log(`[${this.getTimestamp()}] itemsReady=${!!this.currentItem} type=${this.machineConfig.type} name=${this.machineConfig.name}`);

      // Use the new helper method to build current items array
      const currentItems = this.buildCurrentItemsArray();

      // Ensure we have valid items before proceeding
      if (!currentItems || currentItems.length === 0) {
        throw new Error('No valid items available for session; cannot start machine session');
      }

      // Get operator details with names
      const operatorsWithNames = [];
      for (const operator of runningState.operators) {
        if (operator.id !== -1) {
          const operatorName = await getOperatorName(db, operator.id);
          operatorsWithNames.push({
            id: operator.id,
            name: operatorName,
            station: operator.station
          });
        } else {
          operatorsWithNames.push({
            id: operator.id,
            name: "None",
            station: operator.station
          });
        }
      }

      // Create initial session object
      const sessionData = {
        timestamps: {
          start: runningState.timestamp
        },
        counts: [],
        misfeeds: [],
        states: [runningState],
        items: currentItems,
        operators: operatorsWithNames,
        startState: runningState,
        machine: runningState.machine,
        program: {
          mode: "smallPiece",
          programNumber: 1,
          batchNumber: Math.floor(Math.random() * 21) + 20,
          accountNumber: 0,
          speed: 0,
          stations: this.machineConfig.lanes || 1
        },
        // Initialize per-item arrays with zeros
        totalByItem: currentItems.map(() => 0),
        timeCreditByItem: currentItems.map(() => 0)
      };

      // Insert session into database (raw format, not adapted - sessions are too complex for Phase 3/4)
      const result = await sessionCollection.insertOne(sessionData);
      this.currentSessionId = result.insertedId;
      this.currentSessionStartTime = runningState.timestamp;

      console.log(`[${this.getTimestamp()}] 🚀 Started machine session ${this.currentSessionId} for ${this.machineConfig.name}`);

      // Push session to in-memory cache array
      sessionData._id = result.insertedId;
      this.cachedMachineSessions.push(sessionData);
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)

    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error starting machine session:`, error.message);
      this.currentSessionId = null;
      this.currentSessionStartTime = null;
    }
  }

  async startOperatorSessions(runningState) {
    try {
      // Fail fast if operator-session collection name is missing
      if (!config.operatorSessionCollectionName) {
        throw new Error('config.operatorSessionCollectionName is not set');
      }

      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);

      // Add explicit logging to verify SPF initialization
      console.log(`[${this.getTimestamp()}] itemsReady=${!!this.currentItem} type=${this.machineConfig.type} name=${this.machineConfig.name}`);

      // Use the new helper method to build current items array
      const currentItems = this.buildCurrentItemsArray();

      // Ensure we have valid items before proceeding
      if (!currentItems || currentItems.length === 0) {
        throw new Error('No valid items available for session; cannot start operator sessions');
      }

      this.operatorSessionIdsByOperator.clear();
      this.operatorSessionIdsByStation.clear();

      for (const op of runningState.operators) {
        // Skip dummy operators
        if (op.id === -1) continue;

        const opDoc = {
          timestamps: { start: runningState.timestamp },
          counts: [],
          misfeeds: [],
          states: [runningState],
          items: currentItems,
          operator: op,
          startState: runningState,
          machine: runningState.machine,
          program: runningState.program,

          runtime: 0,
          workTime: 0,
          totalCount: 0,
          misfeedCount: 0,
          totalCountByItem: currentItems.map(() => 0),
          timeCreditByItem: currentItems.map(() => 0),
          totalTimeCredit: 0,
        };

        // Insert operator session (raw format, not adapted)
        const res = await coll.insertOne(opDoc);
        this.operatorSessionIdsByOperator.set(op.id, res.insertedId);
        this.operatorSessionIdsByStation.set(op.station, res.insertedId);

        console.log(`[${this.getTimestamp()}] 👤 Started operator session ${res.insertedId} for operator ${op.id} at station ${op.station}`);

        // Push session to in-memory cache array
        opDoc._id = res.insertedId;
        if (!this.cachedOperatorSessions.has(op.id)) {
          this.cachedOperatorSessions.set(op.id, []);
        }
        this.cachedOperatorSessions.get(op.id).push(opDoc);
      }
      
      // ⭐ Cache update scheduled by startMachineSession, no need to call again
      
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error starting operator sessions:`, error.message);
    }
  }

  async startItemSessions(runningState) {
    try {
      if (!config.itemSessionCollectionName) throw new Error('config.itemSessionCollectionName not set');

      const db = this.client.db(this.dbName);
      const coll = db.collection(config.itemSessionCollectionName);
      this.itemSessionIdsByItem.clear();

      // Build item array per spec: SPF=4 items, non‑SPF=1 item. Always store as array.
      const items = this.isSpf()
        ? this.currentItems.map(i => ({ id: (i.number ?? i.id), name: i.name, standard: i.standard }))
        : [{ id: (this.currentItem.number ?? this.currentItem.id), name: this.currentItem.name, standard: this.currentItem.standard }];

      // Operators with names for context
      const operators = [];
      for (const op of (runningState.operators || [])) {
        operators.push({ id: op.id, name: op.id === -1 ? 'None' : await getOperatorName(db, op.id), station: op.station });
      }

      // One item-session per item, as sessions are item-scoped
      for (const it of items) {
        const doc = {
          timestamps: { start: runningState.timestamp },
          counts: [],
          misfeeds: [],
          states: [runningState],
          item: it,
          operators,
          startState: runningState,
          machine: runningState.machine,
          program: runningState.program,
          // Final fields initialized; activeStations == operators.length per spec
          activeStations: (operators || []).length,
          runtime: 0,
          workTime: 0,
          totalCount: 0,
          misfeedCount: 0,
          totalTimeCredit: 0
        };
        // Insert item session (raw format, not adapted)
        const res = await coll.insertOne(doc);
        this.itemSessionIdsByItem.set(it.id, res.insertedId);
        console.log(`[${this.getTimestamp()}] 📦 Started item session ${res.insertedId} for item ${it.id} (${it.name})`);

        // Push session to in-memory cache array
        doc._id = res.insertedId;
        if (!this.cachedItemSessions.has(it.id)) {
          this.cachedItemSessions.set(it.id, []);
        }
        this.cachedItemSessions.get(it.id).push(doc);
      }
      
      // ⭐ Cache update scheduled by startMachineSession, no need to call again
      
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error starting item sessions:`, error.message);
    }
  }

  async updateSessionStats(sessionId = this.currentSessionId) {
    if (!sessionId) return;

    try {
      const db = this.client.db(this.dbName);
      const sessionCollection = db.collection(config.machineSessionCollectionName);

      // Get current session
      const session = await sessionCollection.findOne({ _id: sessionId });
      if (!session) {
        console.warn(`[${this.getTimestamp()}] ⚠️ Session ${sessionId} not found for stats update`);
        return;
      }

      // Calculate end time (use current time for active sessions, or session end time for completed)
      const endTime = session.timestamps.end || new Date();
      const startTime = DateTime.fromJSDate(session.timestamps.start);
      const endDateTime = DateTime.fromJSDate(endTime);

      // Calculate runtime in seconds
      const runtime = endDateTime.diff(startTime, 'seconds').seconds;

      // Calculate work time (runtime * active stations)
      // Don't count dummy operators as "active stations" in machine-session stats
      const activeStations = Array.isArray(session.operators)
        ? session.operators.filter(op => op && op.id !== -1).length
        : 0;
      const workTime = runtime * activeStations;

      // Calculate total counts
      const totalCount = session.counts.length;
      const misfeedCount = session.misfeeds.length;

      // Time-credit normalization (PPM→PPH)
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n < 60 ? n * 60 : n; // treat <60 as PPM => convert to PPH
      };

      // Calculate total time credit and per-item breakdowns
      let totalTimeCredit = 0;
      const totalByItem = [];
      const timeCreditByItem = [];

      if (session.items.length === 1) {
        // Single item type - simple calculation
        const item = session.items[0];
        const pph = normalizePPH(item.standard);
        if (pph > 0) {
          totalTimeCredit = totalCount / (pph / 3600);
          totalByItem.push(totalCount);
          timeCreditByItem.push(totalTimeCredit);
        } else {
          totalByItem.push(0);
          timeCreditByItem.push(0);
        }
      } else {
        // Multiple item types - calculate per item type
        const itemTypeCounts = {};

        // Group counts by item type
        for (const count of session.counts) {
          const itemId = count.item?.id;
          if (itemId) {
            itemTypeCounts[itemId] = (itemTypeCounts[itemId] || 0) + 1;
          }
        }

        // Calculate totals and time credits for each item in the session items array
        for (const item of session.items) {
          const countTotal = itemTypeCounts[item.id] || 0;
          const pph = normalizePPH(item.standard);

          totalByItem.push(countTotal);

          if (pph > 0) {
            const itemTimeCredit = countTotal / (pph / 3600);
            timeCreditByItem.push(itemTimeCredit);
            totalTimeCredit += itemTimeCredit;
          } else {
            timeCreditByItem.push(0);
          }
        }
      }

      // Update session with calculated stats
      const updateData = {
        activeStations,
        runtime: Math.round(runtime),
        workTime: Math.round(workTime),
        totalCount,
        misfeedCount,
        totalTimeCredit: Number(totalTimeCredit.toFixed(2)),
        totalByItem,
        timeCreditByItem
      };

      // If session is completed, also update end timestamp
      if (session.timestamps.end) {
        updateData['timestamps.end'] = session.timestamps.end;
        updateData['endState'] = session.endState;
      }

      await sessionCollection.updateOne(
        { _id: sessionId },
        { $set: updateData }
      );

      // ⭐ Sync in-memory cache array with updated values (don't refetch from DB)
      const sessionIndex = this.cachedMachineSessions.findIndex(s => s._id.equals(sessionId));
      if (sessionIndex !== -1) {
        Object.assign(this.cachedMachineSessions[sessionIndex], updateData);
      }

      // Reduced logging to prevent console spam - only log every 100 updates
      if (totalCount % 100 === 0) {
        console.log(`[${this.getTimestamp()}] 📊 Updated session ${sessionId} stats: runtime=${Math.round(runtime)}s, workTime=${Math.round(workTime)}s, totalCount=${totalCount}, misfeedCount=${misfeedCount}, timeCredit=${Number(totalTimeCredit.toFixed(2))}s`);
      }

    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error updating session stats:`, error.message);
    }
  }

  async recalculateOperatorSession(sessionId) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);
      const s = await coll.findOne({ _id: sessionId });
      if (!s) return;

      const start = DateTime.fromJSDate(s.timestamps.start);
      const end = DateTime.fromJSDate(s.timestamps.end || new Date());
      const runtime = end.diff(start, 'seconds').seconds;

      // Per-operator workTime == runtime (single operator)
      const workTime = runtime;

      const totalCount = s.counts.length;
      const misfeedCount = s.misfeeds.length;

      // Build arrays aligned to s.items order
      const byItem = s.items.map((it) => {
        const countTotal = s.counts.reduce((acc, c) => acc + (c.item?.id === it.id ? 1 : 0), 0);
        const pph = this.normalizePPH(Number(it.standard) || 0);
        const tci = pph > 0 ? countTotal / (pph / 3600) : 0;
        return { countTotal, tci };
      });

      const totalCountByItem = byItem.map(x => x.countTotal);
      const timeCreditByItem = byItem.map(x => Number(x.tci.toFixed(2)));
      const totalTimeCredit = Number(byItem.reduce((a, x) => a + x.tci, 0).toFixed(2));

      const updateData = {
        runtime: Math.round(runtime),
        workTime: Math.round(workTime),
        totalCount,
        misfeedCount,
        totalCountByItem,
        timeCreditByItem,
        totalTimeCredit
      };

      await coll.updateOne(
        { _id: sessionId },
        { $set: updateData }
      );

      // ⭐ Sync in-memory cache array with updated values
      if (s.operator?.id) {
        const opId = s.operator.id;
        if (this.cachedOperatorSessions.has(opId)) {
          const sessions = this.cachedOperatorSessions.get(opId);
          const sessionIndex = sessions.findIndex(sess => sess._id.equals(sessionId));
          if (sessionIndex !== -1) {
            Object.assign(sessions[sessionIndex], updateData);
          }
        }
      }

      // Reduced logging - only log every 100 counts
      if (totalCount % 100 === 0) {
        console.log(`[${this.getTimestamp()}] 📊 Updated operator session ${sessionId} stats: runtime=${Math.round(runtime)}s, totalCount=${totalCount}, misfeedCount=${misfeedCount}, timeCredit=${totalTimeCredit}s`);
      }

    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error recalculating operator session stats:`, error.message);
    }
  }

  // Helper method for PPM to PPH normalization
  normalizePPH(std) {
    const n = Number(std) || 0;
    return n < 60 ? n * 60 : n; // treat <60 as PPM => convert to PPH
  }

  async endMachineSession(endState) {
    if (!this.currentSessionId) return;

    try {
      const db = this.client.db(this.dbName);
      const sessionCollection = db.collection(config.machineSessionCollectionName);

      // Update session with end information
      await sessionCollection.updateOne(
        { _id: this.currentSessionId },
        {
          $set: {
            'timestamps.end': endState.timestamp,
            endState: endState
          },
          $push: {
            states: endState
          }
        }
      );

      // Run final stats calculation
      await this.updateSessionStats();

      console.log(`[${this.getTimestamp()}] 🛑 Ended machine session ${this.currentSessionId} for ${this.machineConfig.name}`);
      
      // ⭐ Sync in-memory cache array with updated session from DB
      const updatedSession = await sessionCollection.findOne({ _id: this.currentSessionId });
      if (updatedSession) {
        const sessionIndex = this.cachedMachineSessions.findIndex(s => s._id.equals(this.currentSessionId));
        if (sessionIndex !== -1) {
          this.cachedMachineSessions[sessionIndex] = updatedSession;
        }
      }

      // Also end any item-sessions tied to this machine session
      await this.endItemSessions(endState);

      // If a fault-session is open, end it now
      if (this.currentFaultSessionId) {
        await this.endFaultSession(endState);
      }
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)

      // Reset session tracking
      this.currentSessionId = null;
      this.currentSessionStartTime = null;
      this.inSession = false; // Ensure flag is always consistent

    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error ending machine session:`, error.message);
    }
  }

  async endOperatorSessions(endState) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);

      for (const [operatorId, opSessionId] of this.operatorSessionIdsByStation) {
        await coll.updateOne(
          { _id: opSessionId },
          {
            $set: {
              'timestamps.end': endState.timestamp,
              endState: endState
            },
            $push: { states: endState }
          }
        );
        await this.recalculateOperatorSession(opSessionId);
        
        // ⭐ Sync in-memory cache array with updated session from DB
        const updatedSession = await coll.findOne({ _id: opSessionId });
        if (updatedSession && updatedSession.operator?.id) {
          const opId = updatedSession.operator.id;
          if (this.cachedOperatorSessions.has(opId)) {
            const sessions = this.cachedOperatorSessions.get(opId);
            const sessionIndex = sessions.findIndex(s => s._id.equals(opSessionId));
            if (sessionIndex !== -1) {
              sessions[sessionIndex] = updatedSession;
            }
          }
        }
      }

      this.operatorSessionIdsByOperator.clear();
      this.operatorSessionIdsByStation.clear();

      console.log(`[${this.getTimestamp()}] 🛑 Ended all operator sessions for machine ${this.machineConfig.name}`);
      
      // ⭐ Cache update will be triggered by endMachineSession

    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error ending operator sessions:`, error.message);
    }
  }

  async closeOpenOperatorSessions(endState) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);

      const filter = {
        "machine.id": this.machineConfig.id || this.machineConfig.serial,
        "timestamps.end": { $exists: false }
      };

      const openIds = await coll.find(filter, { projection: { _id: 1 } }).toArray();
      if (!openIds.length) {
        console.log(`[${this.getTimestamp()}] 🔍 No lingering operator sessions to close for ${this.machineConfig.name}`);
        return;
      }

      console.log(`[${this.getTimestamp()}] 🧹 Closing ${openIds.length} lingering operator sessions for ${this.machineConfig.name}`);

      await Promise.all(
        openIds.map(async ({ _id }) => {
          await coll.updateOne(
            { _id },
            {
              $set: { "timestamps.end": endState.timestamp, endState },
              $push: { states: endState }
            }
          );
          await this.recalculateOperatorSession(_id);
        })
      );
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error closing lingering operator sessions:`, error.message);
    }
  }

  async endItemSessions(endState) {
    try {
      if (!this.itemSessionIdsByItem || this.itemSessionIdsByItem.size === 0) return;
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.itemSessionCollectionName);

      for (const [itemId, sessId] of this.itemSessionIdsByItem) {
        await coll.updateOne(
          { _id: sessId },
          {
            $set: { 'timestamps.end': endState.timestamp, endState },
            $push: { states: endState }
          }
        );
        await this.recalculateItemSession(sessId);
        
        // ⭐ Sync in-memory cache array with updated session from DB
        const updatedSession = await coll.findOne({ _id: sessId });
        if (updatedSession && updatedSession.item?.id) {
          const itmId = updatedSession.item.id;
          if (this.cachedItemSessions.has(itmId)) {
            const sessions = this.cachedItemSessions.get(itmId);
            const sessionIndex = sessions.findIndex(s => s._id.equals(sessId));
            if (sessionIndex !== -1) {
              sessions[sessionIndex] = updatedSession;
            }
          }
        }
      }

      this.itemSessionIdsByItem.clear();
      console.log(`[${this.getTimestamp()}] 🛑 Ended all item sessions for machine ${this.machineConfig.name}`);
      
      // ⭐ Cache recalculation is triggered by endMachineSession, so no need to call here
      
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error ending item sessions:`, error.message);
    }
  }

  async recalculateItemSession(sessionId) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.itemSessionCollectionName);
      const s = await coll.findOne({ _id: sessionId });
      if (!s) return;

      const start = DateTime.fromJSDate(s.timestamps.start);
      const end = DateTime.fromJSDate(s.timestamps.end || new Date());
      const runtime = end.diff(start, 'seconds').seconds;

      const activeStations = Array.isArray(s.operators) ? s.operators.length : 0;
      const workTime = runtime * activeStations;

      const itemId = s.item?.id;
      const totalCount = (s.counts || []).filter(c => c.item?.id === itemId).length;
      const misfeedCount = (s.misfeeds || []).filter(m => m.item?.id === itemId).length;

      const std = Number(s.item?.standard) || 0;
      const pph = std < 60 ? std * 60 : std;
      const totalTimeCredit = pph > 0 ? Number((totalCount / (pph / 3600)).toFixed(2)) : 0;

      const updateData = {
        activeStations,
        runtime: Math.round(runtime),
        workTime: Math.round(workTime),
        totalCount,
        misfeedCount,
        totalTimeCredit
      };

      await coll.updateOne(
        { _id: sessionId },
        { $set: updateData }
      );

      // ⭐ Sync in-memory cache array with updated values
      if (s.item?.id) {
        const itmId = s.item.id;
        if (this.cachedItemSessions.has(itmId)) {
          const sessions = this.cachedItemSessions.get(itmId);
          const sessionIndex = sessions.findIndex(sess => sess._id.equals(sessionId));
          if (sessionIndex !== -1) {
            Object.assign(sessions[sessionIndex], updateData);
          }
        }
      }

      // Reduced logging - only log every 100 counts
      if (totalCount % 100 === 0) {
        console.log(`[${this.getTimestamp()}] 📊 Recalculated item session ${sessionId}: cnt=${totalCount}, tcredit=${totalTimeCredit}s`);
      }
    } catch (error) {
      console.error(`[${this.getTimestamp()}] ❌ Error recalculating item session:`, error.message);
    }
  }

  async writeOperatorStateRecords(record) {
    try {
      const db = this.client.db(this.dbName);

      // Write operator-specific records to all operator collections
      if (record.operators && record.operators.length > 0) {
        for (const operator of record.operators) {
          if (operator.id !== -1) { // Skip dummy operators
            // Create operator-specific record (deep copy to avoid _id conflicts)
            const operatorRecord = JSON.parse(JSON.stringify(record));
            operatorRecord.operators = [operator]; // Single operator instead of array
            delete operatorRecord._id; // Remove _id to get fresh one for each collection

            // Write to main operator collection
            await db.collection(config.stateOperatorCollectionName).insertOne({ ...operatorRecord });

            // Write to additional operator collections (each needs a fresh _id)
            delete operatorRecord._id;
            await db.collection(config.stateOperatorDailyCollectionName).insertOne({ ...operatorRecord });

            delete operatorRecord._id;
            await db.collection(config.stateOperatorWeeklyCollectionName).insertOne({ ...operatorRecord });

            delete operatorRecord._id;
            await db.collection(config.stateOperatorMonthlyCollectionName).insertOne({ ...operatorRecord });
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
      // Leaving Run ends the session on both Timeout and Fault
      this.inSession = false;
      // Don't clear currentRunningState or cleanup operators - preserve session state
    }

    let record;

    if (stateType === "Running") {
      const isNewSession = !this.inSession;     // new session if we were not in-session
      const assignedOperators = isNewSession
        ? await this.assignOperatorsForRunningState()    // 98/2, per station, only here
        : this.currentRunningState.operators;            // keep same operators within the session

      // Add logging after operator assignment
      console.log(`[${this.getTimestamp()}] assignedOperators=${JSON.stringify(assignedOperators)}`);

      this.inSession = true;                    // now we are in-session
      // Build Running record with assigned operators
      const targetConfig = this.machineConfig;

      // Build items array with full details (name, standard) for schema compliance
      const itemsArr = this.buildCurrentItemsArray(); // Returns full item details

      record = {
        timestamp: new Date(),
        machine: targetConfig, // Pass entire adapted machine config
        program: {
          mode: "smallPiece",
          programNumber: 1,
          batchNumber: Math.floor(Math.random() * 21) + 20,
          accountNumber: 0,
          speed: 0,
          stations: targetConfig.lanes,
          items: itemsArr                 // ✅ Full item details (id, name, standard)
        },
        operators: assignedOperators,
        status: { code: 1, name: "Run", softrolColor: "Green" }
      };

      // If a fault session was open, a transition to Run clears it
      if (this.currentFaultSessionId) {
        await this.endFaultSession(record);
      }

      // Start new machine session if this is a new session
      if (isNewSession) {
        await this.startMachineSession(record);
        await this.startOperatorSessions(record);
        await this.startItemSessions(record);          // start item-session(s)
      }
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

      // Build items array with full details for schema compliance
      let itemsArr;
      try {
        itemsArr = this.buildCurrentItemsArray(); // Full item details
      } catch (e) {
        // Fallback if items not ready
        console.warn(`[${this.getTimestamp()}] ⚠️ Could not build items array: ${e.message}, using fallback`);
        itemsArr = [{ id: 26, name: 'Fallback Item', standard: 1800 }];
      }

      record = {
        timestamp: new Date(),
        machine: targetConfig, // Pass entire adapted machine config
        program: prev?.program ?? {
          mode: "smallPiece",
          programNumber: 1,
          batchNumber: Math.floor(Math.random() * 21) + 20,
          accountNumber: 0,
          speed: 0,
          stations: targetConfig.lanes,
          items: itemsArr  // ✅ Full item details (id, name, standard)
        },
        operators: prev?.operators ?? [],
        status
      };

      // End machine session on Fault or Timeout
      if (this.currentSessionId) {
        await this.endMachineSession(record);
        await this.endOperatorSessions(record);
      }

      // Start or end fault sessions appropriately
      if (stateType === "Fault") {
        // Begin a fault-session if none open
        if (!this.currentFaultSessionId) {
          await this.startFaultSession(record);
        }
      } else if (stateType === "Timeout") {
        // Clearing a previous fault
        if (this.currentFaultSessionId) {
          await this.endFaultSession(record);
        }
      }
    }

    const db = this.client.db(this.dbName);

    // ⭐ PHASE 3: Fetch existing ticker document before adapting (preserves additional fields)
    const tickerCollection = db.collection(config.stateTickerCollectionName);
    const existingTicker = await tickerCollection.findOne(
      { "machine.id": this.machineConfig.id || this.machineConfig.serial }
    );

    // Add existing ticker to record for preservation
    if (existingTicker) {
      record._tickerDoc = existingTicker;
    }

    // ⭐ PHASE 3: Adapt state to schema-compliant format (now includes _tickerDoc)
    const adaptedRecord = schemaAdapters.adaptState(record);

    // Validate adapted state (exclude _tickerDoc for validation as it's for internal use only)
    const { _tickerDoc, ...recordForValidation } = adaptedRecord;
    schemaValidator.validate('state', recordForValidation, {
      machineSerial: this.machineConfig.id || this.machineConfig.serial,
      stateType
    });

    // Write to main state-machine collection (using adapted record)
    await db.collection(this.collectionName).insertOne(adaptedRecord);

    // Write to additional state collections (using adapted record, remove _id first)
    const adaptedRecordCopy1 = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordCopy1._id;
    await db.collection(config.stateMachineDailyCollectionName).insertOne(adaptedRecordCopy1);

    const adaptedRecordCopy2 = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordCopy2._id;
    await db.collection(config.stateMachineWeeklyCollectionName).insertOne(adaptedRecordCopy2);

    const adaptedRecordCopy3 = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordCopy3._id;
    await db.collection(config.stateMachineMonthlyCollectionName).insertOne(adaptedRecordCopy3);

    // Write operator-specific records to operator collections (using adapted record)
    await this.writeOperatorStateRecords(adaptedRecord);

    // Update state ticker (using adapted record, query by machine.id since adapted)
    const adaptedRecordForTicker = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordForTicker._id;
    delete adaptedRecordForTicker._tickerDoc; // Remove _tickerDoc from what we write (it's metadata)
    await tickerCollection.updateOne(
      { "machine.id": adaptedRecord.machine.id },  // Query by machine.id (adapted format)
      { $set: adaptedRecordForTicker },
      { upsert: true }
    );

    if (stateType === "Running") {
      this.currentRunningState = record;                // Keep original record (has operator.station)
      record.operators.forEach((op) => {
        if (require('./utils').isValidOperatorId(op.id)) {
          this.simulateStationCounts(record, op.station, op);  // Use original record with station
        }
      });
    }
  }

  async startFaultSession(startState) {
    try {
      if (!config.faultSessionCollectionName) throw new Error('config.faultSessionCollectionName not set');
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.faultSessionCollectionName);

      // Items active when the fault occurred
      const items = this.buildCurrentItemsArray(); // [{id,name,standard}] x1 or x4

      // Operators active when the fault occurred
      const ops = [];
      for (const op of (startState.operators || [])) {
        ops.push({
          id: op.id,
          name: op.id === -1 ? 'None' : await getOperatorName(db, op.id),
          station: op.station
        });
      }

      const doc = {
        timestamps: { start: startState.timestamp },
        items,
        operators: ops,
        states: [startState],
        startState,
        machine: startState.machine,
        program: startState.program,
        activeStations: ops.length
      };

      // Insert fault session (raw format, not adapted)
      const res = await coll.insertOne(doc);
      this.currentFaultSessionId = res.insertedId;
      console.log(`[${this.getTimestamp()}] 🚨 Started fault session ${res.insertedId}`);

      // Push session to in-memory cache array
      doc._id = res.insertedId;
      this.cachedFaultSessions.push(doc);
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)
      
    } catch (e) {
      console.error(`[${this.getTimestamp()}] ❌ Error starting fault session:`, e.message);
    }
  }

  async endFaultSession(endState) {
    try {
      if (!this.currentFaultSessionId) return;
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.faultSessionCollectionName);

      // Push end state and set end timestamp
      await coll.updateOne(
        { _id: this.currentFaultSessionId },
        { $set: { 'timestamps.end': endState.timestamp, endState }, $push: { states: endState } }
      );

      await this.recalculateFaultSession(this.currentFaultSessionId);
      console.log(`[${this.getTimestamp()}] ✅ Ended fault session ${this.currentFaultSessionId}`);
      
      // ⭐ Sync in-memory cache array with updated session from DB
      const updatedSession = await coll.findOne({ _id: this.currentFaultSessionId });
      if (updatedSession) {
        const sessionIndex = this.cachedFaultSessions.findIndex(s => s._id.equals(this.currentFaultSessionId));
        if (sessionIndex !== -1) {
          this.cachedFaultSessions[sessionIndex] = updatedSession;
        }
      }
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)
      
    } catch (e) {
      console.error(`[${this.getTimestamp()}] ❌ Error ending fault session:`, e.message);
    } finally {
      this.currentFaultSessionId = null;
    }
  }

  async recalculateFaultSession(sessionId) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.faultSessionCollectionName);
      const s = await coll.findOne({ _id: sessionId });
      if (!s) return;
      const start = DateTime.fromJSDate(s.timestamps.start);
      const end = DateTime.fromJSDate(s.timestamps.end || new Date());
      const faulttime = end.diff(start, 'seconds').seconds;
      const activeStations = Array.isArray(s.operators) ? s.operators.length : 0;
      const workTimeMissed = faulttime * activeStations;
      
      const updateData = { 
        faulttime: Math.round(faulttime), 
        workTimeMissed: Math.round(workTimeMissed), 
        activeStations 
      };
      
      await coll.updateOne(
        { _id: sessionId },
        { $set: updateData }
      );
      
      // ⭐ Sync in-memory cache array with updated values
      const sessionIndex = this.cachedFaultSessions.findIndex(sess => sess._id.equals(sessionId));
      if (sessionIndex !== -1) {
        Object.assign(this.cachedFaultSessions[sessionIndex], updateData);
      }
      
      // Log only at start/end of fault sessions to reduce spam
      if (s.timestamps.end) {
        console.log(`[${this.getTimestamp()}] 🧮 Recalc fault session ${sessionId}: faulttime=${Math.round(faulttime)}s missed=${Math.round(workTimeMissed)}s`);
      }
    } catch (e) {
      console.error(`[${this.getTimestamp()}] ❌ Error recalculating fault session:`, e.message);
    }
  }

  async simulationLoop() {
    while (this.isRunning) {
      await this.writeState("Timeout");
      await this.delay(getRandomDelay(0.25, 1.25));
      if (!this.isRunning) break;

      await this.writeState("Running");
      await this.delay(getRandomDelay(2, 75));
      if (!this.isRunning) break;

      const nextState = Math.random() < 0.45 ? "Timeout" : "Fault";
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
    
    // ⭐ Stop the cache update interval
    this.stopCacheUpdateInterval();

    const endState = {
      timestamp: new Date(),
      machine: this.machineConfig,
      status: { code: 0, name: "Stopped", softrolColor: "Grey" }
    };

    // End current session if one is active
    if (this.currentSessionId) {
      try {
        await this.endMachineSession(endState);
        await this.endOperatorSessions(endState);
        // await this.endItemSessions(endState);
      } catch (error) {
        console.error(`[${this.getTimestamp()}] ❌ Error ending session on stop:`, error.message);
      }
    }

    // Defensive close for any operator-sessions left open in DB
    await this.closeOpenOperatorSessions(endState);

    // Always close any open fault-session on stop (even if machine session already ended)
    if (this.currentFaultSessionId) {
      await this.endFaultSession(endState);
    }

    // Clean up operator assignments when simulator stops
    await this.cleanupOperatorAssignments();

    await this.client?.close();
    console.log(`[${this.getTimestamp()}] 🛑 Simulator stopped`);
  }

  simulateStationCounts(runningState, station, operator) {
    const rateParam = operator.rate;
    // Choose the correct item for this station
    const itemForThisStation = this.isSpf()
      //? this.currentItems[(Math.max(1, station) - 1) % Math.max(1, this.currentItems.length || 1)]
      ? this.currentItems[Math.floor(Math.random() * 4)]
      : this.currentItem;

    // Calculate timing based on current item
    let timing = calculateItemTiming(itemForThisStation);
    let randomExponential = Math.min(1, ((Math.log(1 - Math.random()) / (-1 * rateParam)) / 5));
    let delayMs = ((randomExponential * (timing.highRange - timing.lowRange)) + timing.lowRange) * 1000;

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
          if (this.isSpf()) {
            const randItem = this.currentItems[Math.floor(Math.random() * 4)];
            countRecord.item = {
              id: (randItem.number ?? randItem.id),
              name: randItem.name,
              standard: randItem.standard
            };
            timing = calculateItemTiming(itemForThisStation);
            let randomExponential = Math.min(1, ((Math.log(1 - Math.random()) / (-1 * rateParam)) / 5));
            delayMs = ((randomExponential * (timing.highRange - timing.lowRange)) + timing.lowRange) * 1000;
          } else {
            countRecord.item = {
              id: (itemForThisStation.number ?? itemForThisStation.id),
              name: itemForThisStation.name,
              standard: itemForThisStation.standard
            };
          }

        } else {
          countRecord.misfeed = true;
          // Attach item to misfeed so item-session can account for it
          if (this.isSpf()) {
            const it = this.currentItems[Math.floor(Math.random() * 4)];
            countRecord.item = { id: (it.number ?? it.id), name: it.name, standard: it.standard };
          } else {
            countRecord.item = { id: (itemForThisStation.number ?? itemForThisStation.id), name: itemForThisStation.name, standard: itemForThisStation.standard };
          }
        }

        // ⭐ PHASE 2: Adapt count/misfeed to schema format
        let adaptedRecord;
        if (isMisfeed) {
          adaptedRecord = schemaAdapters.adaptMisfeed(countRecord);
          // ⭐ Validate adapted misfeed
          schemaValidator.validate('misfeed', adaptedRecord, {
            machineSerial: this.machineConfig.id || this.machineConfig.serial,
            station,
            operatorId: operator.id
          });
        } else {
          adaptedRecord = schemaAdapters.adaptCount(countRecord);
          // ⭐ Validate adapted count
          schemaValidator.validate('count', adaptedRecord, {
            machineSerial: this.machineConfig.id || this.machineConfig.serial,
            station,
            operatorId: operator.id
          });
        }

        // Write to main count collection (using adapted record)
        await collection.insertOne(adaptedRecord);

        // Write to additional count collections (using adapted record)
        await db.collection(config.countDailyCollectionName).insertOne(adaptedRecord);
        await db.collection(config.countWeeklyCollectionName).insertOne(adaptedRecord);
        await db.collection(config.countMonthlyCollectionName).insertOne(adaptedRecord);

        await db.collection(config.stateTickerCollectionName).updateOne(
          { "machine.id": adaptedRecord.machine.id },  // Using adapted record's machine.id
          { $set: { timestamp: new Date() } }
        );

        // Update machine session with new count/misfeed
        if (this.currentSessionId) {
          try {
            const sessionCollection = db.collection(config.machineSessionCollectionName);

            if (isMisfeed) {
              // Add misfeed to session (using adapted record)
              await sessionCollection.updateOne(
                { _id: this.currentSessionId },
                { $push: { misfeeds: adaptedRecord } }
              );
            } else {
              // Add valid count to session (using adapted record)
              await sessionCollection.updateOne(
                { _id: this.currentSessionId },
                { $push: { counts: adaptedRecord } }
              );
            }

            // Recalculate session stats after adding count/misfeed
            await this.updateSessionStats();

          } catch (sessionError) {
            console.error(`[${this.getTimestamp()}] ❌ Error updating session with count:`, sessionError.message);
          }
        }

        // Update operator session with new count/misfeed
        const opSessionId = this.operatorSessionIdsByOperator.get(operator.id) ??
          this.operatorSessionIdsByStation.get(station);

        if (opSessionId) {
          try {
            const opSess = db.collection(config.operatorSessionCollectionName);
            if (isMisfeed) {
              await opSess.updateOne({ _id: opSessionId }, { $push: { misfeeds: adaptedRecord } });
            } else {
              await opSess.updateOne({ _id: opSessionId }, { $push: { counts: adaptedRecord } });
            }
            await this.recalculateOperatorSession(opSessionId);
          } catch (opSessionError) {
            console.error(`[${this.getTimestamp()}] ❌ Error updating operator session with count:`, opSessionError.message);
          }
        }

        // Update item-session for the specific item id (use adapted record's item)
        const itemIdForRecord = adaptedRecord.item?.id;
        if (itemIdForRecord) {
          const itemSessId = this.itemSessionIdsByItem.get(itemIdForRecord);
          if (itemSessId) {
            try {
              const itemColl = db.collection(config.itemSessionCollectionName);
              if (isMisfeed) {
                await itemColl.updateOne({ _id: itemSessId }, { $push: { misfeeds: adaptedRecord } });
              } else {
                await itemColl.updateOne({ _id: itemSessId }, { $push: { counts: adaptedRecord } });
              }
              await this.recalculateItemSession(itemSessId);
            } catch (itemSessionError) {
              console.error(`[${this.getTimestamp()}] ❌ Error updating item session with ${isMisfeed ? 'misfeed' : 'count'}:`, itemSessionError.message);
            }
          }
        }

        if (this.countTimeouts.has(station)) {
          this.simulateStationCounts(runningState, station, operator);
        }
      } catch (err) {
        console.error(`❌ Count error at station ${station}:`, err.message);
      }
    }, delayMs);

    // Delay logging removed to reduce console spam
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



