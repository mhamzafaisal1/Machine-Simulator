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
  recalculateAndUpdateCache,
  recalculateAndUpdateHourlyCache
} = require('./simulator-cache-builder');
const schemaValidator = require('./schema-validator');
const schemaAdapters = require('./schema-adapters');
const createLogger = require('./logger');

// Build logging database connection string (similar to chitrac-api pattern)
function buildLoggingConnectionString() {
    if (!config.mongoLog || !config.mongoLog.url) {
        return null; // No logging database configured
    }
    
    const logUsername = config.mongoLog.username;
    const logPassword = config.mongoLog.password;
    const logAuthSource = config.mongoLog.authSource || 'admin';
    
    if (!logUsername || !logPassword) {
        return null; // No credentials provided
    }
    
    // URL encode credentials
    const encodedLogUsername = encodeURIComponent(logUsername);
    const encodedLogPassword = encodeURIComponent(logPassword);
    
    let loggerConnectionString;
    
    if (config.mongoLog.url.startsWith('mongodb://')) {
        const urlWithoutScheme = config.mongoLog.url.substring(10);
        const slashIndex = urlWithoutScheme.indexOf('/');
        
        if (slashIndex === -1) {
            // No database in URL
            loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}/${config.mongoLog.db || 'chitrac-logging'}?authSource=${logAuthSource}`;
        } else {
            // Database specified in URL
            loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}?authSource=${logAuthSource}`;
        }
    } else {
        loggerConnectionString = config.mongoLog.url.replace('mongodb://', `mongodb://${encodedLogUsername}:${encodedLogPassword}@`);
        // Add authSource
        if (!loggerConnectionString.includes('?')) {
            loggerConnectionString += `?authSource=${logAuthSource}`;
        } else {
            loggerConnectionString += `&authSource=${logAuthSource}`;
        }
    }
    
    return loggerConnectionString;
}

const logMongoUri = buildLoggingConnectionString();
const logger = createLogger(logMongoUri);

function toMeta(details) {
  if (!details) return undefined;
  if (details instanceof Error) {
    return { error: details.message, stack: details.stack };
  }
  if (typeof details === 'string') {
    return { message: details };
  }
  if (details.error instanceof Error) {
    return { ...details, error: details.error.message, stack: details.error.stack };
  }
  return details;
}

function logWith(level, message, details) {
  const meta = toMeta(details);
  if (logger && typeof logger[level] === 'function') {
    logger[level](message, meta);
  }

  // Only output to console in development mode (errors always logged)
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev || level === 'error') {
    const consoleFn = level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;

    if (meta) {
      consoleFn(message, meta);
    } else {
      consoleFn(message);
    }
  }
}

const logInfo = (message, details) => logWith('info', message, details);
const logWarn = (message, details) => logWith('warn', message, details);
const logError = (message, details) => logWith('error', message, details);

function buildSerialQueryValues(serial) {
  const values = new Set();
  if (serial !== undefined && serial !== null) {
    values.add(serial);
    const numeric = Number(serial);
    if (!Number.isNaN(numeric)) {
      values.add(numeric);
    }
    const str = String(serial);
    values.add(str);
  }
  return [...values];
}

function buildOverlapFilter(serialField, serialValues, dayStart, queryEnd) {
  const dayStartIso = dayStart.toISOString();
  const queryEndIso = queryEnd ? queryEnd.toISOString() : null;

  const startIsDate = {
    $and: [
      { 'timestamps.start': { $type: 'date' } },
      { 'timestamps.start': { $gte: dayStart } },
      ...(queryEnd ? [{ 'timestamps.start': { $lt: queryEnd } }] : [])
    ]
  };

  const startIsString = {
    $and: [
      { 'timestamps.start': { $type: 'string' } },
      { 'timestamps.start': { $gte: dayStartIso } },
      ...(queryEndIso ? [{ 'timestamps.start': { $lt: queryEndIso } }] : [])
    ]
  };

  const overlapDate = {
    $and: [
      { 'timestamps.start': { $type: 'date' } },
      { 'timestamps.start': { $lt: dayStart } },
      {
        $or: [
          { 'timestamps.end': { $exists: false } },
          { 'timestamps.end': null },
          {
            $and: [
              { 'timestamps.end': { $type: 'date' } },
              { 'timestamps.end': { $gte: dayStart } }
            ]
          },
          {
            $and: [
              { 'timestamps.end': { $type: 'string' } },
              { 'timestamps.end': { $gte: dayStartIso } }
            ]
          }
        ]
      }
    ]
  };

  const overlapString = {
    $and: [
      { 'timestamps.start': { $type: 'string' } },
      { 'timestamps.start': { $lt: dayStartIso } },
      {
        $or: [
          { 'timestamps.end': { $exists: false } },
          { 'timestamps.end': null },
          {
            $and: [
              { 'timestamps.end': { $type: 'date' } },
              { 'timestamps.end': { $gte: dayStart } }
            ]
          },
          {
            $and: [
              { 'timestamps.end': { $type: 'string' } },
              { 'timestamps.end': { $gte: dayStartIso } }
            ]
          }
        ]
      }
    ]
  };

  return {
    [serialField]: { $in: serialValues },
    $or: [startIsDate, startIsString, overlapDate, overlapString]
  };
}

function normalizeId(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (typeof value.toString === 'function') return value.toString();
  }
  try {
    return String(value);
  } catch (err) {
    return null;
  }
}

function idsEqual(a, b) {
  const normA = normalizeId(a);
  const normB = normalizeId(b);
  return normA !== null && normB !== null && normA === normB;
}

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
    // SPF station-to-item mapping (fixes random item bug)
    this.itemPerStation = new Map();                 // station -> item object (for SPF machines)
    // Fault session tracking
    this.currentFaultSessionId = null;               // ObjectId for open fault session

    // ⭐ IN-MEMORY CACHE ARRAYS (for real-time cache building without DB polling)
    this.cachedMachineSessions = [];                  // Machine sessions for today
    this.cachedFaultSessions = [];                    // Fault sessions for today
    this.cachedOperatorSessions = new Map();          // operatorId -> session array for today

    // ⭐ MIDNIGHT ROLLOVER FLAGS
    this.midnightShutdownDone = false;                // Tracks if 11:59pm shutdown has happened
    this.wasRunningBeforeMidnight = false;            // Tracks if machine was running before shutdown
    this.operatorsBeforeMidnight = [];                // Stores operators before midnight
    this.itemsBeforeMidnight = [];                    // Stores items before midnight
    this.cachedItemSessions = new Map();              // itemId -> session array for today
    this.todayStart = null;                           // Midnight today (for filtering)
    this.cacheUpdateInterval = null;                  // Recurring interval for cache updates
    this.midnightInterval = null;                     // Recurring interval for midnight checks

    // ⭐ HOURLY ROLLOVER TRACKING
    this.currentHourStart = null;                     // Start of current hour (for hourly totals)
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
      logWarn(`[${this.getTimestamp()}] ⚠️ currentItem is null, calling selectInitialItem() to fix`);
      this.selectInitialItem();

      // Verify the fix worked
      if (!this.currentItem) {
        throw new Error('Failed to set currentItem after calling selectInitialItem()');
      }
      logInfo(`[${this.getTimestamp()}] ✅ currentItem fixed: ${this.currentItem.name} (ID: ${this.currentItem.number})`);
    }

    // For SPF machines, also ensure currentItems array is properly maintained
    if (this.isSpf()) {
      if (!this.currentItems || this.currentItems.length === 0) {
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF currentItems array is empty, rebuilding from currentItem`);
        this.currentItems = [this.currentItem, this.currentItem, this.currentItem, this.currentItem];
      }

      // Validate that we have exactly 4 items for SPF
      if (this.currentItems.length !== 4) {
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF currentItems array has ${this.currentItems.length} items, expected 4. Rebuilding.`);
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
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF currentItems array is empty, rebuilding from currentItem`);
        this.currentItems = this.pickDistinct(this.items, 4); // Create 4 copies for SPF
      }

      // Validate that we have exactly 4 items for SPF
      if (this.currentItems.length !== 4) {
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF currentItems array has ${this.currentItems.length} items, expected 4. Rebuilding.`);
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
      logWarn(`[${this.getTimestamp()}] ⚠️ Only ${items.length} items available, but ${n} requested. Will use available items.`);
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
      logInfo(`[${this.getTimestamp()}] 🚀 Starting simulator for ${this.machineConfig.name}`);
      await this.connectToMongoDB();
      await this.loadFaults();
      await this.loadItems();
      logInfo(`[${this.getTimestamp()}] 📦 Loaded ${this.items.length} items`);

      // Validate that we have enough items for SPF machines
      if (this.isSpf() && this.items.length < 4) {
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF machine requires at least 4 items, but only ${this.items.length} are available`);
      }

      this.selectInitialItem();
      logInfo(`[${this.getTimestamp()}] 🎯 Initial item selection complete - currentItem: ${this.currentItem ? this.currentItem.name : 'null'}, isSPF: ${this.isSpf()}`);

      // Assign operators before starting simulation loop to ensure first state has operators
      await this.assignInitialOperators();
      
      // ⭐ Load today's sessions into memory for real-time cache building
      await this.loadTodaysSessions();

      // ⭐ Schedule automatic midnight shutdown/restart
      this.scheduleMidnightRollover();

      this.isRunning = true;
      await this.simulationLoop();
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Failed to start simulator`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async connectToMongoDB() {
    this.client = new MongoClient(this.mongoUri);
    await this.client.connect();
    logInfo(`[${this.getTimestamp()}] ✅ Connected to MongoDB`, { dbName: this.dbName });
  }

  async loadFaults() {
    const db = this.client.db(this.dbName);
    const faultCollection = db.collection(config.faultCollectionName);
    this.validFaults = await faultCollection.find().sort({ code: 1 }).toArray();
    logInfo(`[${this.getTimestamp()}] ✅ Loaded ${this.validFaults.length} fault types`);

    // ⭐ Validate adapted faults (non-breaking)
    try {
      const adapted = this.validFaults.map(f => schemaAdapters.adaptFaultFromDB(f));
      let ok = 0;
      for (const af of adapted) {
        if (Number.isFinite(af.id) && schemaValidator.validate('fault', af, { faultCode: af.id })) ok++;
      }
      logInfo(`[${this.getTimestamp()}] ✅ Fault schema validation: ${ok}/${adapted.length} adapted faults valid`);
      this.adaptedFaults = adapted; // optional reference
    } catch (e) {
      logWarn(`[${this.getTimestamp()}] ⚠️ Fault validation skipped: ${e.message}`);
    }

    if (this.validFaults.length < 58) {
      logWarn(`[${this.getTimestamp()}] ⚠️ Only ${this.validFaults.length} fault codes found (expected 58)`);
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
      logInfo(`[${this.getTimestamp()}] ✅ ${validItemCount}/${this.items.length} items passed schema validation`);
    }
  }

  /**
   * ⭐ Loads today's sessions into memory for real-time cache building
   * This eliminates the need for database polling by the cacher service
   * @param {boolean} startInterval - Whether to start the cache update interval (default: true)
   */
  async loadTodaysSessions(startInterval = true) {
    try {
      logInfo(`[${this.getTimestamp()}] 📥 Loading today's sessions into memory for cache building...`);

      const db = this.client.db(this.dbName);
      const machineSerial = this.machineConfig.id || this.machineConfig.serial;
      const machineSerialValues = buildSerialQueryValues(machineSerial);
      if (machineSerialValues.length === 0) {
        logWarn(`[${this.getTimestamp()}] ⚠️ Machine serial not available; skipping boot cache hydration`);
        return;
      }

      // Calculate today's start (midnight in America/Chicago timezone)
      const SYSTEM_TIMEZONE = 'America/Chicago';
      this.todayStart = DateTime.now().setZone(SYSTEM_TIMEZONE).startOf('day').toJSDate();
      const now = new Date();

      logInfo(`[${this.getTimestamp()}] 🕐 Today starts at: ${this.todayStart.toISOString()}`);

      // Clear all cache arrays/maps BEFORE reloading
      this.cachedMachineSessions = [];
      this.cachedFaultSessions = [];
      this.cachedOperatorSessions.clear();
      this.cachedItemSessions.clear();

      // 1. Load machine sessions for this machine today
      const machineSessionColl = db.collection(config.machineSessionCollectionName);
      const machineSessionFilter = buildOverlapFilter('machine.id', machineSerialValues, this.todayStart, now);
      const machineSessionsRaw = await machineSessionColl.find(machineSessionFilter)
        .sort({ 'timestamps.start': 1 })
        .toArray();
      this.cachedMachineSessions = machineSessionsRaw.map(session => schemaAdapters.prepareDocFromMongo(session));

      logInfo(`[${this.getTimestamp()}] ✅ Loaded ${this.cachedMachineSessions.length} machine sessions`);

      // 2. Load fault sessions for this machine today
      const faultSessionColl = db.collection(config.faultSessionCollectionName);
      const faultSessionFilter = buildOverlapFilter('machine.id', machineSerialValues, this.todayStart, now);
      const faultSessionsRaw = await faultSessionColl.find(faultSessionFilter)
        .sort({ 'timestamps.start': 1 })
        .toArray();
      this.cachedFaultSessions = faultSessionsRaw.map(session => schemaAdapters.prepareDocFromMongo(session));

      logInfo(`[${this.getTimestamp()}] ✅ Loaded ${this.cachedFaultSessions.length} fault sessions`);

      // 3. Load operator sessions for this machine today (group by operator ID)
      const operatorSessionColl = db.collection(config.operatorSessionCollectionName);
      const operatorSessionFilter = buildOverlapFilter('machine.id', machineSerialValues, this.todayStart, now);
      const operatorSessionsRaw = await operatorSessionColl.find(operatorSessionFilter)
        .sort({ 'timestamps.start': 1 })
        .toArray();
      const operatorSessions = operatorSessionsRaw.map(session => schemaAdapters.prepareDocFromMongo(session));

      // Group by operator ID
      let skippedIncompatible = 0;
      let skippedOldUnclosed = 0;
      for (const session of operatorSessions) {
        // ⭐ FILTER: Skip incompatible old sessions (schema-adapted format with no data)
        // These sessions have:
        // - counts as object {valid: [], misfeed: []} instead of array
        // - item (singular) instead of items (plural)
        // - NO computed fields (totalCount, runtime)
        const countsIsObject = session.counts && typeof session.counts === 'object' && !Array.isArray(session.counts);
        const hasEmptyCounts = countsIsObject &&
                              Array.isArray(session.counts?.valid) &&
                              session.counts.valid.length === 0;
        const lacksComputedFields = !session.totalCount && !session.runtime;

        if (countsIsObject && hasEmptyCounts && lacksComputedFields) {
          skippedIncompatible++;
          continue; // Skip this session
        }

        // ⭐ FIX: Skip old unclosed sessions (stale/abandoned sessions from previous days)
        // These sessions started before today AND have no end timestamp
        // They inflate totals because runtime is calculated as (now - oldStartTime)
        // We only want:
        //   1. Sessions that started today (regardless of end status)
        //   2. Sessions that started before today BUT ended today or later (genuine overlap)
        const sessionStart = session.timestamps?.start ? new Date(session.timestamps.start) : null;
        const sessionEnd = session.timestamps?.end ? new Date(session.timestamps.end) : null;
        const startedBeforeToday = sessionStart && sessionStart < this.todayStart;
        const isUnclosed = !sessionEnd;

        if (startedBeforeToday && isUnclosed) {
          skippedOldUnclosed++;
          continue; // Skip old unclosed session (likely stale/abandoned)
        }

        const operatorId = session.operator?.id;
        if (operatorId && operatorId !== -1) {
          if (!this.cachedOperatorSessions.has(operatorId)) {
            this.cachedOperatorSessions.set(operatorId, []);
          }
          this.cachedOperatorSessions.get(operatorId).push(session);
        }
      }

      logInfo(`[${this.getTimestamp()}] ✅ Loaded ${operatorSessions.length} operator sessions for ${this.cachedOperatorSessions.size} operators (skipped ${skippedIncompatible} incompatible, ${skippedOldUnclosed} old unclosed)`);

      // 4. Load item sessions for this machine today (group by item ID)
      const itemSessionColl = db.collection(config.itemSessionCollectionName);
      const itemSessionFilter = buildOverlapFilter('machine.id', machineSerialValues, this.todayStart, now);
      const itemSessionsRaw = await itemSessionColl.find(itemSessionFilter)
        .sort({ 'timestamps.start': 1 })
        .toArray();
      const itemSessions = itemSessionsRaw.map(session => schemaAdapters.prepareDocFromMongo(session));

      // Group by item ID
      for (const session of itemSessions) {
        // ⭐ FIX: Skip old unclosed sessions (stale/abandoned sessions from previous days)
        // Same logic as operator sessions - prevent runtime inflation from ancient unclosed sessions
        const sessionStart = session.timestamps?.start ? new Date(session.timestamps.start) : null;
        const sessionEnd = session.timestamps?.end ? new Date(session.timestamps.end) : null;
        const startedBeforeToday = sessionStart && sessionStart < this.todayStart;
        const isUnclosed = !sessionEnd;

        if (startedBeforeToday && isUnclosed) {
          continue; // Skip old unclosed session
        }

        const itemId = session.item?.id;
        if (itemId) {
          if (!this.cachedItemSessions.has(itemId)) {
            this.cachedItemSessions.set(itemId, []);
          }
          this.cachedItemSessions.get(itemId).push(session);
        }
      }
      
      logInfo(`[${this.getTimestamp()}] ✅ Loaded ${itemSessions.length} item sessions for ${this.cachedItemSessions.size} items`);
      logInfo(`[${this.getTimestamp()}] 🎉 Session cache initialized successfully!`);

      // ⭐ BOOT-TIME CACHE RECONSTRUCTION
      // If there are existing sessions from midnight to now, rebuild the cache totals
      if (this.cachedMachineSessions.length > 0 || operatorSessions.length > 0 || itemSessions.length > 0) {
        logInfo(`[${this.getTimestamp()}] 📊 Boot-time cache reconstruction: Found existing sessions, rebuilding totals-daily cache...`);

        try {
          // ⭐ Recalculate ALL operator sessions before cache reconstruction
          // This ensures their computed fields have current values at boot time
          // Fixed: Recalculate all sessions (not just open ones) to ensure operators stay in sync with machines
          for (const sessions of this.cachedOperatorSessions.values()) {
            for (const session of sessions) {
              await this.recalculateOperatorSession(session._id);
            }
          }

          logInfo(`[${this.getTimestamp()}] 🔄 Recalculating all item sessions at boot...`);
          let recalcCount = 0;
          for (const sessions of this.cachedItemSessions.values()) {
            for (const session of sessions) {
              await this.recalculateItemSession(session._id);
              recalcCount++;
            }
          }
          logInfo(`[${this.getTimestamp()}] ✅ Recalculated ${recalcCount} item sessions`);


          const result = await recalculateAndUpdateCache({
            db: db,
            machineSerial: machineSerial,
            machineName: this.machineConfig.name,
            machineSessions: this.cachedMachineSessions,
            faultSessions: this.cachedFaultSessions,
            operatorSessionsMap: this.cachedOperatorSessions,
            itemSessionsMap: this.cachedItemSessions,
            queryStart: this.todayStart,
            queryEnd: now
          });

          if (result.success) {
            logInfo(`[${this.getTimestamp()}] ✅ Boot-time cache reconstruction complete: ${result.recordsUpdated} records updated`);
            logInfo(`[${this.getTimestamp()}]    Machine: ${result.machineUpdated ? '✅' : '⏭️'}, Operators: ${result.operatorsUpdated}, Items: ${result.itemsUpdated}`);
            logInfo('Boot-time cache reconstruction complete', {
              machine: this.machineConfig.name,
              recordsUpdated: result.recordsUpdated,
              machineTotals: result.machineTotals,
              operatorTotals: result.operatorTotals,
              itemTotals: result.itemTotals,
              operatorItemTotals: result.operatorItemTotals
            });
          } else {
            logWarn(`[${this.getTimestamp()}] ⚠️ Boot-time cache reconstruction had issues`, {
              machine: this.machineConfig.name,
              error: result.error
            });
          }
        } catch (cacheError) {
          logError(`[${this.getTimestamp()}] ❌ Error during boot-time cache reconstruction`, {
            machine: this.machineConfig.name,
            error: cacheError.message,
            stack: cacheError.stack
          });
          // Don't throw - continue with simulation even if cache rebuild fails
        }
      } else {
        logInfo(`[${this.getTimestamp()}] ℹ️ No existing sessions found from midnight to now, starting fresh`);
      }

      // ⭐ Start the recurring cache update interval (only if requested)
      if (startInterval) {
        this.startCacheUpdateInterval();
      }

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error loading today's sessions`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
      // Don't throw - simulator can continue without cache, it just won't update cache totals
    }
  }

  /**
   * ⭐ Schedules automatic midnight shutdown/restart
   * At 11:59pm: Stop machines and end all sessions
   * At 12:01am: Restart machines that were running
   */
  scheduleMidnightRollover() {
    const SYSTEM_TIMEZONE = 'America/Chicago';

    // Initialize current hour start
    this.currentHourStart = DateTime.now().setZone(SYSTEM_TIMEZONE).startOf('hour').toJSDate();
    logInfo(`[${this.getTimestamp()}] 🕐 Current hour starts at: ${this.currentHourStart.toISOString()}`);

    // Check every minute if we need to do midnight or hourly actions
    this.midnightInterval = setInterval(() => {
      const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
      const hour = now.hour;
      const minute = now.minute;

      // ⭐ Hourly rollover: Update currentHourStart at the start of each hour
      if (minute === 1) {
        const newHourStart = now.startOf('hour').toJSDate();
        if (this.currentHourStart.getTime() !== newHourStart.getTime()) {
          this.currentHourStart = newHourStart;
          logInfo(`[${this.getTimestamp()}] 🕐 Hour changed - new hour starts at: ${this.currentHourStart.toISOString()}`);
        }
      }

      // At 11:59pm, shutdown machines
      if (hour === 23 && minute === 59 && !this.midnightShutdownDone) {
        logInfo(`[${this.getTimestamp()}] 🌙 11:59pm - Initiating midnight shutdown...`);
        this.performMidnightShutdown();
        this.midnightShutdownDone = true;
      }

      // At 12:01am (or up to 12:02am if we missed the exact minute), restart machines
      if (hour === 0 && minute >= 1 && minute <= 2 && this.midnightShutdownDone) {
        logInfo(`[${this.getTimestamp()}] 🌅 12:0${minute}am - Initiating midnight restart...`);
        this.performMidnightRestart();
        this.midnightShutdownDone = false; // Reset for next day
      }

      // Reset flag at 12:03am in case we completely missed the restart window
      if (hour === 0 && minute === 3 && this.midnightShutdownDone) {
        logWarn(`[${this.getTimestamp()}] ⚠️ Missed midnight restart window (12:01-12:02am), resetting flag`);
        this.midnightShutdownDone = false;
      }
    }, 60000); // Check every 60 seconds

    logInfo(`[${this.getTimestamp()}] ⏰ Midnight and hourly rollover scheduler started`);
  }

  /**
   * ⭐ Performs midnight shutdown at 11:59pm
   * Stops machines, ends all sessions, updates cache
   */
  async performMidnightShutdown() {
    try {
      logInfo(`[${this.getTimestamp()}] 🛑 Performing midnight shutdown...`);

      // ⭐ FIX RACE CONDITION: Stop simulation loop and clear all count timers BEFORE ending sessions
      // This prevents count timers from firing while sessions are being closed
      logInfo(`[${this.getTimestamp()}] 🛑 Stopping simulation loop and clearing count timers...`);
      this.countTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.countTimeouts.clear();
      this.isRunning = false;

      // Remember if machine was running
      this.wasRunningBeforeMidnight = this.inSession;
      this.operatorsBeforeMidnight = this.currentRunningState?.operators || [];
      this.itemsBeforeMidnight = this.buildCurrentItemsArray();

      // Create shutdown state
      const shutdownState = {
        timestamp: new Date(),
        machine: this.machineConfig,
        program: this.currentRunningState?.program || {
          mode: "smallPiece",
          programNumber: 1,
          batchNumber: 0,
          accountNumber: 0,
          speed: 0,
          stations: this.machineConfig.lanes || 1
        },
        operators: this.currentRunningState?.operators || [],
        status: { code: 0, name: "Midnight Shutdown", softrolColor: "Grey" }
      };

      // End all sessions (now safe from race condition)
      if (this.currentSessionId) {
        await this.endMachineSession(shutdownState);
      }
      if (this.operatorSessionIdsByStation.size > 0) {
        await this.endOperatorSessions(shutdownState);
      }
      if (this.currentFaultSessionId) {
        await this.endFaultSession(shutdownState);
      }
      await this.closeOpenOperatorSessions(shutdownState);

      // Final cache update for the day
      logInfo(`[${this.getTimestamp()}] 📊 Running final cache update for ${this.todayStart.toISOString().split('T')[0]}...`);
      await recalculateAndUpdateCache({
        db: this.client.db(this.dbName),
        machineSerial: this.machineConfig.id || this.machineConfig.serial,
        machineName: this.machineConfig.name,
        machineSessions: this.cachedMachineSessions,
        faultSessions: this.cachedFaultSessions,
        operatorSessionsMap: this.cachedOperatorSessions,
        itemSessionsMap: this.cachedItemSessions,
        queryStart: this.todayStart,
        queryEnd: new Date()
      });

      logInfo(`[${this.getTimestamp()}] ✅ Midnight shutdown complete. Waiting for 12:01am restart...`);

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error during midnight shutdown`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * ⭐ Performs midnight restart at 12:01am
   * Resets cache, loads new day sessions, restarts machines
   */
  async performMidnightRestart() {
    try {
      const SYSTEM_TIMEZONE = 'America/Chicago';
      const newDayStart = DateTime.now().setZone(SYSTEM_TIMEZONE).startOf('day').toJSDate();

      logInfo(`[${this.getTimestamp()}] 🌅 Performing midnight restart for ${newDayStart.toISOString().split('T')[0]}...`);

      // Update todayStart to new day
      this.todayStart = newDayStart;

      // ✅ FIX: Don't clear cache arrays before reloading - loadTodaysSessions will handle it properly
      // The issue was: clearing arrays removed the session data that was accumulated before midnight
      // Then new sessions started with zeros, causing zero metrics in cache
      // Solution: Let loadTodaysSessions() clear and repopulate with ALL sessions from midnight onwards

      // Reload sessions for new day (this will clear and repopulate the arrays with correct data)
      // ✅ FIX: Pass true to restart the cache update interval after midnight rollover
      await this.loadTodaysSessions(true);

      // Restart machines if they were running before midnight
      if (this.wasRunningBeforeMidnight) {
        logInfo(`[${this.getTimestamp()}] 🔄 Restarting machines that were running before midnight...`);

        // ⭐ FIX: Repopulate itemPerStation for SPF machines (critical for correct item tracking after midnight)
        if (this.isSpf() && this.currentItems && this.currentItems.length === 4) {
          this.itemPerStation.clear();
          const activeStations = getActiveStations(this.machineConfig);
          for (let i = 0; i < activeStations.length && i < this.currentItems.length; i++) {
            const station = activeStations[i];
            const item = this.currentItems[i];
            this.itemPerStation.set(station, item);
            logInfo(`[${this.getTimestamp()}] 🎯 Post-midnight: SPF Station ${station} assigned item: ${item.name} (ID: ${item.number ?? item.id})`);
          }
        }

        const restartState = {
          timestamp: new Date(),
          machine: this.machineConfig,
          program: {
            mode: "smallPiece",
            programNumber: 1,
            batchNumber: Math.floor(Math.random() * 21) + 20,
            accountNumber: 0,
            speed: 0,
            stations: this.machineConfig.lanes || 1,
            items: this.itemsBeforeMidnight
          },
          operators: this.operatorsBeforeMidnight,
          status: { code: 1, name: "Run", softrolColor: "Green" }
        };

        await this.startMachineSession(restartState);
        await this.startOperatorSessions(restartState);
        await this.startItemSessions(restartState);

        // ⭐ RESTART SIMULATION LOOP (fixes race condition - ensures simulation resumes after midnight)
        this.isRunning = true;
        this.simulationLoop(); // Don't await - let it run in background

        logInfo(`[${this.getTimestamp()}] ✅ Machines and simulation loop restarted for new day`);
      }

      logInfo(`[${this.getTimestamp()}] 🎉 Midnight restart complete! Now running on ${newDayStart.toISOString().split('T')[0]}`);

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error during midnight restart`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * ⭐ Recalculates and updates daily cache totals using in-memory session data
   * This is called after session updates to keep cache up-to-date in real-time
   * Note: Day rollover is now handled by scheduleMidnightRollover() at 11:59pm/12:01am
   */
  async recalculateDailyCacheTotals() {
    try {
      if (!this.todayStart) {
        logWarn(`[${this.getTimestamp()}] ⚠️ todayStart not set, skipping cache recalculation`);
        return;
      }

      const db = this.client.db(this.dbName);
      const now = new Date();

      // ⭐ CRITICAL FIX: Recalculate ALL operator sessions before cache update
      // This ensures their computed fields (runtime, workTime, totalCount) have current values
      // Fixed: Recalculate all sessions (not just open ones) to ensure operators stay in sync with machines
      for (const sessions of this.cachedOperatorSessions.values()) {
        for (const session of sessions) {
          await this.recalculateOperatorSession(session._id);
        }
      }

      for (const sessions of this.cachedItemSessions.values()) {
        for (const session of sessions) {
          if (!session.timestamps?.end) {  // Only open sessions
            await this.recalculateItemSession(session._id);
          }
        }
      }

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
        logInfo(`[${this.getTimestamp()}] 📊 Cache updated: ${result.recordsUpdated} records (${result.machineTotals} machine, ${result.operatorTotals} operators, ${result.machineItemTotals} machine-items, ${result.itemTotals} items, ${result.operatorItemTotals} operator-items)`);
      } else {
        logError(`[${this.getTimestamp()}] ❌ Cache update failed`, {
          machine: this.machineConfig.name,
          error: result.error
        });
      }

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error recalculating daily cache totals`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
      // Don't throw - cache updates are non-critical
    }
  }

  /**
   * ⭐ Recalculates and updates hourly cache totals using in-memory session data
   * ✅ FIX: Now builds totals for ALL hours from todayStart to now (not just current hour)
   */
  async recalculateHourlyCacheTotals() {
    try {
      if (!this.todayStart) {
        logWarn(`[${this.getTimestamp()}] ⚠️ todayStart not set, skipping hourly cache recalculation`);
        return;
      }

      const db = this.client.db(this.dbName);
      const now = new Date();

      // Recalculate ALL operator sessions before cache update (not just open ones)
      for (const sessions of this.cachedOperatorSessions.values()) {
        for (const session of sessions) {
          await this.recalculateOperatorSession(session._id);
        }
      }

      for (const sessions of this.cachedItemSessions.values()) {
        for (const session of sessions) {
          if (!session.timestamps?.end) {
            await this.recalculateItemSession(session._id);
          }
        }
      }

      // ✅ FIX: Pass todayStart instead of currentHourStart to build ALL hourly totals
      // Recalculate and update hourly cache using in-memory session arrays
      const result = await recalculateAndUpdateHourlyCache({
        db,
        machineSerial: this.machineConfig.id || this.machineConfig.serial,
        machineName: this.machineConfig.name,
        machineSessions: this.cachedMachineSessions,
        faultSessions: this.cachedFaultSessions,
        operatorSessionsMap: this.cachedOperatorSessions,
        itemSessionsMap: this.cachedItemSessions,
        todayStart: this.todayStart,
        queryEnd: now
      });

      if (result.success) {
        logInfo(`[${this.getTimestamp()}] 📊 Hourly cache updated: ${result.recordsUpdated} records across ${result.hoursProcessed} hours`);
      } else {
        logError(`[${this.getTimestamp()}] ❌ Hourly cache update failed`, {
          machine: this.machineConfig.name,
          error: result.error
        });
      }

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error recalculating hourly cache totals`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
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

    logInfo(`[${this.getTimestamp()}] ⏰ Starting cache update interval (every ${config.cacheUpdateIntervalSeconds || 30} seconds)`);

    // Set recurring interval
    this.cacheUpdateInterval = setInterval(async () => {
      await this.recalculateDailyCacheTotals();
      await this.recalculateHourlyCacheTotals();
    }, intervalMs);
  }

  /**
   * ⭐ Stops the cache update interval
   */
  stopCacheUpdateInterval() {
    if (this.cacheUpdateInterval) {
      clearInterval(this.cacheUpdateInterval);
      this.cacheUpdateInterval = null;
      logInfo(`[${this.getTimestamp()}] ⏹️ Stopped cache update interval`);
    }
  }

  selectInitialItem() {
    if (this.isSpf()) {
      this.currentItems = this.pickDistinct(this.items, 4);  // exactly four
      // For SPF machines, also set currentItem to the first item for session compatibility
      this.currentItem = this.currentItems[0];
      logInfo(`[${this.getTimestamp()}] 🎯 SPF initial items: ${this.currentItems.map(i => i.name).join(', ')}`);
      logInfo(`[${this.getTimestamp()}] 🎯 SPF currentItem set to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);

      // Validate that we have the correct number of items for SPF
      if (this.currentItems.length !== 4) {
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF machine has ${this.currentItems.length} items instead of expected 4`);
      }
    } else {
      this.currentItem = selectRandomItem(this.items);       // exactly one
      logInfo(`[${this.getTimestamp()}] 🎯 Non-SPF currentItem set to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);
    }
  }

  async assignInitialOperators() {
    // Assign operators before the first state is written
    const assignedOperators = await this.assignOperatorsForRunningState();
    this.currentRunningState = {
      operators: assignedOperators
    };
    logInfo(`[${this.getTimestamp()}] 👥 Assigned ${assignedOperators.length} initial operators for ${this.machineConfig.name}`);

    // For SPF machines, assign one fixed item per station (fixes random item bug)
    if (this.isSpf() && this.currentItems && this.currentItems.length === 4) {
      this.itemPerStation.clear();
      const activeStations = getActiveStations(this.machineConfig);
      for (let i = 0; i < activeStations.length && i < this.currentItems.length; i++) {
        const station = activeStations[i];
        const item = this.currentItems[i];
        this.itemPerStation.set(station, item);
        logInfo(`[${this.getTimestamp()}] 🎯 SPF Station ${station} assigned item: ${item.name} (ID: ${item.number ?? item.id})`);
      }
    }
  }

  selectNextItem() {
    if (!shouldChangeItem()) {
      if (this.isSpf()) {
        logInfo(`[${this.getTimestamp()}] 🔄 Keeping current item set`);
      } else {
        logInfo(`[${this.getTimestamp()}] 🔄 Keeping current item: ${this.currentItem.name}`);
      }
      return;
    }

    if (this.isSpf()) {
      this.currentItems = this.pickDistinct(this.items, 4);
      // For SPF machines, also update currentItem to the first item for session compatibility
      this.currentItem = this.currentItems[0];
      logInfo(`[${this.getTimestamp()}] 🔁 SPF new items: ${this.currentItems.map(i => i.name).join(', ')}`);
      logInfo(`[${this.getTimestamp()}] 🔁 SPF currentItem updated to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);

      // Validate that we have the correct number of items for SPF
      if (this.currentItems.length !== 4) {
        logWarn(`[${this.getTimestamp()}] ⚠️ SPF machine has ${this.currentItems.length} items instead of expected 4 after item change`);
      }

      // Update station-to-item mapping when items change (fixes random item bug)
      this.itemPerStation.clear();
      const activeStations = getActiveStations(this.machineConfig);
      for (let i = 0; i < activeStations.length && i < this.currentItems.length; i++) {
        const station = activeStations[i];
        const item = this.currentItems[i];
        this.itemPerStation.set(station, item);
        logInfo(`[${this.getTimestamp()}] 🎯 SPF Station ${station} reassigned item: ${item.name} (ID: ${item.number ?? item.id})`);
      }
    } else {
      this.currentItem = selectRandomItem(this.items);
      logInfo(`[${this.getTimestamp()}] 🔁 Non-SPF currentItem updated to: ${this.currentItem.name} (ID: ${(this.currentItem.number ?? this.currentItem.id)})`);
    }
  }

  getRandomFault() {
    const faultCount = this.validFaults.length;
    if (faultCount === 0) {
      logWarn(`[${this.getTimestamp()}] ⚠️ No fault codes loaded. Using fallback.`);
      return { code: 17, name: "Fault" };
    }

    const index = Math.floor(Math.random() * faultCount);
    const fault = this.validFaults[index];

    if (!fault) {
      logWarn(`[${this.getTimestamp()}] ⚠️ Fault at index ${index} is undefined. Using fallback.`);
      return { code: 17, name: "Fault" };
    }

    logInfo(`[${this.getTimestamp()}] 🔧 Injecting fault: ${fault.code} - ${fault.name}`);
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

          // Update our local tracking (don't modify currentlySimulatedIds - it represents CURRENT state from ticker, not future state)
          const fullName = getFullName(candidateOperator);
          assignedOperators.push({ id: candidateOperator.id, name: fullName, station, rate: candidateOperator._rate || 1 });
          logInfo(`[${this.getTimestamp()}] 👤 ${useLast ? 'Reused' : 'Assigned'} operator ${candidateOperator.id} (${fullName}) to station ${station} on machine ${machineSerial}`);

        } catch (error) {
          if (error.code === 11000) {
            // Someone else grabbed it—pick a different one once
            logWarn(`[${this.getTimestamp()}] ⚠️ Duplicate operator ${candidateOperator.id}; selecting another`);
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
            logError(`[${this.getTimestamp()}] ❌ Failed to assign operator ${candidateOperator.id} to station ${station}`, {
              machine: machineSerial,
              station,
              error: error.message
            });
            // Fallback to dummy operator
            assignedOperators.push({ id: -1, name: "Dummy", station, rate: 1 });
          }
        }
      } else {
        // Fallback: dummy operator
        assignedOperators.push({ id: -1, name: "Dummy", station, rate: 1 });
        logWarn(`[${this.getTimestamp()}] ⚠️ No operator available for station ${station}, using dummy operator`);
      }
    }

    // Sort by station
    assignedOperators.sort((a, b) => a.station - b.station);
    return assignedOperators;
  }

  async cleanupOperatorAssignments() {
    const db = this.client.db(this.dbName);
    const machineSerial = this.machineConfig.id || this.machineConfig.serial;
    const machineSerialValues = buildSerialQueryValues(machineSerial);
    const tickerCollection = db.collection(config.simulatedOperatorsTickerCollectionName);

    try {
      // Remove all operator assignments for this machine
      const deleteFilter = machineSerialValues.length
        ? { machineSerial: { $in: machineSerialValues } }
        : { machineSerial };
      const result = await tickerCollection.deleteMany(deleteFilter);
      if (result.deletedCount > 0) {
        logInfo(`[${this.getTimestamp()}] 🧹 Cleaned up ${result.deletedCount} operator assignments for machine ${machineSerial}`);
      }
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error cleaning up operator assignments for machine ${machineSerial}`, {
        machine: machineSerial,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async startMachineSession(runningState) {
    try {
      const db = this.client.db(this.dbName);
      const sessionCollection = db.collection(config.machineSessionCollectionName);

      // Add explicit logging to verify SPF initialization
      logInfo(`[${this.getTimestamp()}] itemsReady=${!!this.currentItem} type=${this.machineConfig.type} name=${this.machineConfig.name}`);

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

      // Create initial session object (raw format)
      const rawSessionData = {
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

      // ⭐ PHASE 4: Adapt session to schema format before insert
      const adaptedSession = schemaAdapters.adaptSession(rawSessionData, {
        sessionType: 'machine',
        shift: schemaAdapters.createDefaultShift()
      });

      // Validate adapted session (non-breaking)
      schemaValidator.validate('session', adaptedSession, {
        machineSerial: this.machineConfig.id || this.machineConfig.serial,
        sessionType: 'machine'
      });

      // Insert adapted session into database
      const sessionDocForMongo = schemaAdapters.prepareDocForMongo(adaptedSession);
      const result = await sessionCollection.insertOne(sessionDocForMongo);
      this.currentSessionId = result.insertedId;
      this.currentSessionStartTime = runningState.timestamp;

      logInfo(`[${this.getTimestamp()}] 🚀 Started machine session ${this.currentSessionId} for ${this.machineConfig.name}`);

      // Push adapted session to in-memory cache array
      adaptedSession._id = result.insertedId;
      this.cachedMachineSessions.push(adaptedSession);
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error starting machine session`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
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
      logInfo(`[${this.getTimestamp()}] itemsReady=${!!this.currentItem} type=${this.machineConfig.type} name=${this.machineConfig.name}`);

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

        const rawOpDoc = {
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

        // ⭐ Adapt operator session to schema format (fixes schema divergence bug)
        const adaptedOpDoc = schemaAdapters.adaptSession(rawOpDoc, {
          sessionType: 'operator',
          shift: schemaAdapters.createDefaultShift()
        });

        // Insert adapted operator session
        const res = await coll.insertOne(schemaAdapters.prepareDocForMongo(adaptedOpDoc));
        this.operatorSessionIdsByOperator.set(op.id, res.insertedId);
        this.operatorSessionIdsByStation.set(op.station, res.insertedId);

        logInfo(`[${this.getTimestamp()}] 👤 Started operator session ${res.insertedId} for operator ${op.id} at station ${op.station}`);

        // Push adapted session to in-memory cache array
        adaptedOpDoc._id = res.insertedId;
        if (!this.cachedOperatorSessions.has(op.id)) {
          this.cachedOperatorSessions.set(op.id, []);
        }
        this.cachedOperatorSessions.get(op.id).push(adaptedOpDoc);
      }
      
      // ⭐ Cache update scheduled by startMachineSession, no need to call again
      
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error starting operator sessions`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
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
        const rawItemDoc = {
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

        // ⭐ Adapt item session to schema format (fixes schema divergence bug)
        const adaptedItemDoc = schemaAdapters.adaptSession(rawItemDoc, {
          sessionType: 'item',
          shift: schemaAdapters.createDefaultShift()
        });

        // Insert adapted item session
        const res = await coll.insertOne(schemaAdapters.prepareDocForMongo(adaptedItemDoc));
        this.itemSessionIdsByItem.set(it.id, res.insertedId);
        logInfo(`[${this.getTimestamp()}] 📦 Started item session ${res.insertedId} for item ${it.id} (${it.name})`);

        // Push adapted session to in-memory cache array
        adaptedItemDoc._id = res.insertedId;
        if (!this.cachedItemSessions.has(it.id)) {
          this.cachedItemSessions.set(it.id, []);
        }
        this.cachedItemSessions.get(it.id).push(adaptedItemDoc);
      }
      
      // ⭐ Cache update scheduled by startMachineSession, no need to call again
      
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error starting item sessions`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async updateSessionStats(sessionId = this.currentSessionId) {
    if (!sessionId) return;

    try {
      const db = this.client.db(this.dbName);
      const sessionCollection = db.collection(config.machineSessionCollectionName);

      // Get current session
      const sessionDoc = await sessionCollection.findOne({ _id: sessionId });
      const session = sessionDoc ? schemaAdapters.prepareDocFromMongo(sessionDoc) : null;
      if (!session) {
        logWarn(`[${this.getTimestamp()}] ⚠️ Session ${sessionId} not found for stats update`);
        return;
      }

      // Calculate end time (use current time for active sessions, or session end time for completed)
      const endTime = session.timestamps.end || new Date();
      // Handle timestamps that may be Date objects or ISO strings
      const startTime = session.timestamps.start instanceof Date
        ? DateTime.fromJSDate(session.timestamps.start)
        : DateTime.fromISO(session.timestamps.start);
      const endDateTime = endTime instanceof Date
        ? DateTime.fromJSDate(endTime)
        : DateTime.fromISO(endTime);

      // Calculate runtime in seconds
      const runtime = endDateTime.diff(startTime, 'seconds').seconds;

      // Calculate work time (runtime * active stations)
      // Don't count dummy operators as "active stations" in machine-session stats
      let activeStations = Array.isArray(session.operators)
        ? session.operators.filter(op => op && op.id !== -1).length
        : 0;

      // ✅ Fallback to program.stations or machine.lanes if operators array is empty/missing
      if (!activeStations || !Number.isFinite(activeStations)) {
        activeStations = Number.isFinite(session.program?.stations) && session.program.stations > 0
          ? session.program.stations
          : (Number.isFinite(session.machine?.lanes) && session.machine.lanes > 0 ? session.machine.lanes : 1);
      }

      const workTime = runtime * activeStations;

      // Calculate total counts (adapted sessions have counts as object with valid/misfeed arrays)
      const countsValid = session.counts?.valid || [];
      const countsMisfeed = session.counts?.misfeed || [];
      const totalCount = countsValid.length;
      const misfeedCount = countsMisfeed.length;

      // Time-credit normalization (PPM→PPH)
      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n < 60 ? n * 60 : n; // treat <60 as PPM => convert to PPH
      };

      // Calculate total time credit and per-item breakdowns
      let totalTimeCredit = 0;
      const totalByItem = [];
      const timeCreditByItem = [];

      // Handle adapted session format: either session.item (single) or session.items (array)
      const sessionItems = session.items || (session.item ? [session.item] : []);

      if (sessionItems.length === 1) {
        // Single item type - simple calculation
        const item = sessionItems[0];
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
        for (const count of countsValid) {
          const itemId = count.item?.id;
          if (itemId) {
            itemTypeCounts[itemId] = (itemTypeCounts[itemId] || 0) + 1;
          }
        }

        // ✅ FIX: Track processed items to prevent duplicate counting when sessionItems has duplicates
        const processedItems = new Set();

        // Calculate totals and time credits for each item in the session items array
        for (const item of sessionItems) {
          // If this item ID was already processed, push 0 to avoid double-counting
          if (processedItems.has(item.id)) {
            totalByItem.push(0);
            timeCreditByItem.push(0);
            continue;
          }

          processedItems.add(item.id);
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

      // ✅ Update both flat fields (for backward compat) and nested metrics (for schema compliance)
      const dbUpdate = {
        ...updateData,
        // Update nested metrics structure for schema-adapted sessions
        'metrics.timers.run': updateData.runtime,
        'metrics.timers.worked': updateData.workTime,
        'metrics.totals.timeCredit': updateData.totalTimeCredit,
        'metrics.totals.counts.valid': updateData.totalCount,
        'metrics.totals.counts.misfeed': updateData.misfeedCount
      };

      await sessionCollection.updateOne(
        { _id: sessionId },
        { $set: dbUpdate }
      );

      // ⭐ Sync in-memory cache array with updated values (don't refetch from DB)
      const sessionIndex = this.cachedMachineSessions.findIndex(s => idsEqual(s._id, sessionId));
      if (sessionIndex !== -1) {
        Object.assign(this.cachedMachineSessions[sessionIndex], updateData);

        // ✅ Also update nested metrics structure for schema-adapted sessions
        // Create metrics structure if it doesn't exist
        if (!this.cachedMachineSessions[sessionIndex].metrics) {
          this.cachedMachineSessions[sessionIndex].metrics = {};
        }
        if (!this.cachedMachineSessions[sessionIndex].metrics.timers) {
          this.cachedMachineSessions[sessionIndex].metrics.timers = {};
        }
        if (!this.cachedMachineSessions[sessionIndex].metrics.totals) {
          this.cachedMachineSessions[sessionIndex].metrics.totals = { counts: {} };
        }
        if (!this.cachedMachineSessions[sessionIndex].metrics.totals.counts) {
          this.cachedMachineSessions[sessionIndex].metrics.totals.counts = {};
        }

        // Always update the values (don't check if they exist first)
        this.cachedMachineSessions[sessionIndex].metrics.timers.run = updateData.runtime;
        this.cachedMachineSessions[sessionIndex].metrics.timers.worked = updateData.workTime;
        this.cachedMachineSessions[sessionIndex].metrics.totals.timeCredit = updateData.totalTimeCredit;
        this.cachedMachineSessions[sessionIndex].metrics.totals.counts.valid = updateData.totalCount;
        this.cachedMachineSessions[sessionIndex].metrics.totals.counts.misfeed = updateData.misfeedCount;
      }

      // Reduced logging to prevent console spam - only log every 100 updates
      if (totalCount % 100 === 0) {
        logInfo(`[${this.getTimestamp()}] 📊 Updated session ${sessionId} stats: runtime=${Math.round(runtime)}s, workTime=${Math.round(workTime)}s, totalCount=${totalCount}, misfeedCount=${misfeedCount}, timeCredit=${Number(totalTimeCredit.toFixed(2))}s`);
      }

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error updating session stats`, {
        machine: this.machineConfig.name,
        sessionId,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async recalculateOperatorSession(sessionId) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);
      const doc = await coll.findOne({ _id: sessionId });
      const s = doc ? schemaAdapters.prepareDocFromMongo(doc) : null;
      if (!s) return;

      // ⭐ SKIP sessions in incompatible format (old schema-adapted sessions with no data)
      // These sessions have:
      // - counts as object {valid: [], misfeed: []} instead of array
      // - Empty counts.valid array (no usable data)
      // We can't recalculate these because the data structure is incompatible
      const countsIsObject = s.counts && typeof s.counts === 'object' && !Array.isArray(s.counts);
      const hasEmptyCounts = countsIsObject &&
                            Array.isArray(s.counts?.valid) &&
                            s.counts.valid.length === 0;

      if (countsIsObject && hasEmptyCounts) {
        return; // Skip this session, it has no useful data
      }

      // Handle timestamps that may be Date objects or ISO strings
      const start = s.timestamps.start instanceof Date
        ? DateTime.fromJSDate(s.timestamps.start)
        : DateTime.fromISO(s.timestamps.start);
      const endTime = s.timestamps.end || new Date();
      const end = endTime instanceof Date
        ? DateTime.fromJSDate(endTime)
        : DateTime.fromISO(endTime);
      const runtime = end.diff(start, 'seconds').seconds;

      // Per-operator workTime == runtime (single operator)
      const workTime = runtime;

      // Handle both legacy (array) and adapted (object with valid/misfeed) count structures
      const validCounts = Array.isArray(s.counts) ? s.counts : (s.counts?.valid || []);
      const misfeeds = Array.isArray(s.misfeeds) ? s.misfeeds : (s.counts?.misfeed || []);

      const totalCount = validCounts.length;
      const misfeedCount = misfeeds.length;

      // Build arrays aligned to s.items order
      // ✅ FIX: Track counted items to prevent duplicate counting when items array has duplicates
      const countedItems = new Set();

      const byItem = s.items.map((it) => {
        // If this item ID was already counted, return 0 to avoid double-counting
        if (countedItems.has(it.id)) {
          return { countTotal: 0, tci: 0 };
        }

        countedItems.add(it.id);
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

      // ⭐ Sync in-memory cache array with updated values AND counts/misfeeds
      if (s.operator?.id) {
        const opId = s.operator.id;
        if (this.cachedOperatorSessions.has(opId)) {
          const sessions = this.cachedOperatorSessions.get(opId);
          const sessionIndex = sessions.findIndex(sess => idsEqual(sess._id, sessionId));
          if (sessionIndex !== -1) {
            Object.assign(sessions[sessionIndex], updateData);
            // Also sync counts and misfeeds arrays from the database session
            sessions[sessionIndex].counts = s.counts || [];
            sessions[sessionIndex].misfeeds = s.misfeeds || [];
          } else {
            // ⚠️ WARNING: Session not found in cache - this indicates a sync issue
            // FIX: Add the session to the cache to keep them in sync
            logWarn(`[${this.getTimestamp()}] ⚠️ Operator session ${sessionId} not found in cache for operator ${opId} - adding it now`, {
              machine: this.machineConfig.name,
              sessionId: normalizeId(sessionId),
              operatorId: opId,
              cachedSessionIds: sessions.map(sess => normalizeId(sess._id))
            });
            // Add the session to the cache with current values
            const sessionWithUpdates = Object.assign({}, s, updateData);
            sessionWithUpdates.counts = s.counts || [];
            sessionWithUpdates.misfeeds = s.misfeeds || [];
            sessions.push(sessionWithUpdates);
          }
        }
      }

      // Reduced logging - only log every 100 counts
      if (totalCount % 100 === 0) {
        logInfo(`[${this.getTimestamp()}] 📊 Updated operator session ${sessionId} stats: runtime=${Math.round(runtime)}s, totalCount=${totalCount}, misfeedCount=${misfeedCount}, timeCredit=${totalTimeCredit}s`);
      }

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error recalculating operator session stats`, {
        machine: this.machineConfig.name,
        sessionId,
        error: error.message,
        stack: error.stack
      });
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
      // Note: Schema-adapted sessions have states as {start, array, end}, not a flat array
      const schemaAdapters = require('./schema-adapters');
      const adaptedEndState = schemaAdapters.adaptState(endState);

      await sessionCollection.updateOne(
        { _id: this.currentSessionId },
        {
          $set: {
            'timestamps.end': endState.timestamp,
            endState: adaptedEndState,  // Use adapted version (fixes data corruption bug)
            'states.end': adaptedEndState  // Set the end state in the states object
          }
        }
      );

      // Run final stats calculation
      await this.updateSessionStats();

      logInfo(`[${this.getTimestamp()}] 🛑 Ended machine session ${this.currentSessionId} for ${this.machineConfig.name}`);
      
      // ⭐ Sync in-memory cache array with updated session from DB
      const updatedSessionDoc = await sessionCollection.findOne({ _id: this.currentSessionId });
      const updatedSession = updatedSessionDoc ? schemaAdapters.prepareDocFromMongo(updatedSessionDoc) : null;
      if (updatedSession) {
        const sessionIndex = this.cachedMachineSessions.findIndex(s => idsEqual(s._id, this.currentSessionId));
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
      logError(`[${this.getTimestamp()}] ❌ Error ending machine session`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async endOperatorSessions(endState) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);

      // ⭐ FIX: Variable should be named 'station' not 'operatorId' (the Map key is station number)
      for (const [station, opSessionId] of this.operatorSessionIdsByStation) {
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
        const updatedSessionDoc = await coll.findOne({ _id: opSessionId });
        const updatedSession = updatedSessionDoc ? schemaAdapters.prepareDocFromMongo(updatedSessionDoc) : null;
        if (updatedSession && updatedSession.operator?.id) {
          const opId = updatedSession.operator.id;
          if (this.cachedOperatorSessions.has(opId)) {
            const sessions = this.cachedOperatorSessions.get(opId);
            const sessionIndex = sessions.findIndex(s => idsEqual(s._id, opSessionId));
            if (sessionIndex !== -1) {
              sessions[sessionIndex] = updatedSession;
            }
          }
        }
      }

      this.operatorSessionIdsByOperator.clear();
      this.operatorSessionIdsByStation.clear();

      logInfo(`[${this.getTimestamp()}] 🛑 Ended all operator sessions for machine ${this.machineConfig.name}`);
      
      // ⭐ Cache update will be triggered by endMachineSession

    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error ending operator sessions`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async closeOpenOperatorSessions(endState) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.operatorSessionCollectionName);

      const machineSerial = this.machineConfig.id || this.machineConfig.serial;
      const serialValues = buildSerialQueryValues(machineSerial);

      const filter = {
        "machine.id": { $in: serialValues },
        "timestamps.end": { $exists: false }
      };

      const openIds = await coll.find(filter, { projection: { _id: 1 } }).toArray();
      if (!openIds.length) {
        logInfo(`[${this.getTimestamp()}] 🔍 No lingering operator sessions to close for ${this.machineConfig.name}`);
        return;
      }

      logInfo(`[${this.getTimestamp()}] 🧹 Closing ${openIds.length} lingering operator sessions for ${this.machineConfig.name}`);

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
      logError(`[${this.getTimestamp()}] ❌ Error closing lingering operator sessions`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
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
        const updatedSessionDoc = await coll.findOne({ _id: sessId });
        const updatedSession = updatedSessionDoc ? schemaAdapters.prepareDocFromMongo(updatedSessionDoc) : null;
        if (updatedSession && updatedSession.item?.id) {
          const itmId = updatedSession.item.id;
          if (this.cachedItemSessions.has(itmId)) {
            const sessions = this.cachedItemSessions.get(itmId);
            const sessionIndex = sessions.findIndex(s => idsEqual(s._id, sessId));
            if (sessionIndex !== -1) {
              sessions[sessionIndex] = updatedSession;
            }
          }
        }
      }

      this.itemSessionIdsByItem.clear();
      logInfo(`[${this.getTimestamp()}] 🛑 Ended all item sessions for machine ${this.machineConfig.name}`);
      
      // ⭐ Cache recalculation is triggered by endMachineSession, so no need to call here
      
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error ending item sessions`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async recalculateItemSession(sessionId) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.itemSessionCollectionName);
      const doc = await coll.findOne({ _id: sessionId });
      const s = doc ? schemaAdapters.prepareDocFromMongo(doc) : null;
      if (!s) return;

      // Handle timestamps that may be Date objects or ISO strings
      const start = s.timestamps.start instanceof Date
        ? DateTime.fromJSDate(s.timestamps.start)
        : DateTime.fromISO(s.timestamps.start);
      const endTime = s.timestamps.end || new Date();
      const end = endTime instanceof Date
        ? DateTime.fromJSDate(endTime)
        : DateTime.fromISO(endTime);
      const runtime = end.diff(start, 'seconds').seconds;

      const activeStations = Array.isArray(s.operators) ? s.operators.length : 0;
      const workTime = runtime * activeStations;

      // Handle both legacy (array) and adapted (object with valid/misfeed) count structures
      const validCounts = Array.isArray(s.counts) ? s.counts : (s.counts?.valid || []);
      const misfeeds = Array.isArray(s.misfeeds) ? s.misfeeds : (s.counts?.misfeed || []);

      const itemId = s.item?.id;
      const totalCount = validCounts.filter(c => c.item?.id === itemId).length;
      const misfeedCount = misfeeds.filter(m => m.item?.id === itemId).length;

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

      // ⭐ Sync in-memory cache array with updated values AND counts/misfeeds
      if (s.item?.id) {
        const itmId = s.item.id;
        if (this.cachedItemSessions.has(itmId)) {
          const sessions = this.cachedItemSessions.get(itmId);
          const sessionIndex = sessions.findIndex(sess => idsEqual(sess._id, sessionId));
          if (sessionIndex !== -1) {
            Object.assign(sessions[sessionIndex], updateData);
            // Also sync counts and misfeeds arrays from the database session
            sessions[sessionIndex].counts = s.counts || [];
            sessions[sessionIndex].misfeeds = s.misfeeds || [];
          }
        }
      }

      // Reduced logging - only log every 100 counts
      if (totalCount % 100 === 0) {
        logInfo(`[${this.getTimestamp()}] 📊 Recalculated item session ${sessionId}: cnt=${totalCount}, tcredit=${totalTimeCredit}s`);
      }
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error recalculating item session`, {
        machine: this.machineConfig.name,
        sessionId,
        error: error.message,
        stack: error.stack
      });
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
            delete operatorRecord.status; // Remove status for schema compliance

            // Write to main operator collection
            await db.collection(config.stateOperatorCollectionName).insertOne(schemaAdapters.prepareDocForMongo({ ...operatorRecord }));

            // Write to additional operator collections (each needs a fresh _id)
            delete operatorRecord._id;
            await db.collection(config.stateOperatorDailyCollectionName).insertOne(schemaAdapters.prepareDocForMongo({ ...operatorRecord }));

            delete operatorRecord._id;
            await db.collection(config.stateOperatorWeeklyCollectionName).insertOne(schemaAdapters.prepareDocForMongo({ ...operatorRecord }));

            delete operatorRecord._id;
            await db.collection(config.stateOperatorMonthlyCollectionName).insertOne(schemaAdapters.prepareDocForMongo({ ...operatorRecord }));
          }
        }
      }
    } catch (error) {
      logError(`[${this.getTimestamp()}] ❌ Error writing operator state records`, {
        machine: this.machineConfig.name,
        error: error.message,
        stack: error.stack
      });
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
      logInfo(`[${this.getTimestamp()}] assignedOperators=${JSON.stringify(assignedOperators)}`);

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
        logWarn(`[${this.getTimestamp()}] ⚠️ Could not build items array: ${e.message}, using fallback`);
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
    // Include status field for stateTicker, but exclude it from schema validation
    const adaptedRecord = schemaAdapters.adaptState(record, { includeStatus: true });

    // Validate adapted state (exclude _tickerDoc and status for validation)
    const { _tickerDoc, status, ...recordForValidation } = adaptedRecord;
    schemaValidator.validate('state', recordForValidation, {
      machineSerial: this.machineConfig.id || this.machineConfig.serial,
      stateType
    });

    // Write to main state-machine collection (exclude status for schema compliance)
    const { status: removedStatus1, ...adaptedRecordForMain } = adaptedRecord;
    await db.collection(this.collectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecordForMain));

    // Write to additional state collections (exclude status and _id for schema compliance)
    const adaptedRecordCopy1 = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordCopy1._id;
    delete adaptedRecordCopy1.status;
    await db.collection(config.stateMachineDailyCollectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecordCopy1));

    const adaptedRecordCopy2 = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordCopy2._id;
    delete adaptedRecordCopy2.status;
    await db.collection(config.stateMachineWeeklyCollectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecordCopy2));

    const adaptedRecordCopy3 = JSON.parse(JSON.stringify(adaptedRecord));
    delete adaptedRecordCopy3._id;
    delete adaptedRecordCopy3.status;
    await db.collection(config.stateMachineMonthlyCollectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecordCopy3));

    // Write operator-specific records to operator collections (using adapted record)
    await this.writeOperatorStateRecords(adaptedRecord);

    // Update state ticker (selective field updates to preserve operator assignments and custom fields)
    const tickerUpdate = {
      'machine.id': adaptedRecord.machine.id,
      'machine.name': adaptedRecord.machine.name,
      'machine.type': adaptedRecord.machine.type,
      'timestamp': adaptedRecord.timestamp,
      'program': adaptedRecord.program,
      'status': adaptedRecord.status
    };

    // Only update operators if this is a Running state (preserve existing operator assignments otherwise)
    if (stateType === "Running" && adaptedRecord.operators) {
      tickerUpdate['operators'] = adaptedRecord.operators;
    }

    await tickerCollection.updateOne(
      { "machine.id": adaptedRecord.machine.id },  // Query by machine.id (adapted format)
      { $set: schemaAdapters.prepareDocForMongo(tickerUpdate) },
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
      const res = await coll.insertOne(schemaAdapters.prepareDocForMongo(doc));
      this.currentFaultSessionId = res.insertedId;
      logInfo(`[${this.getTimestamp()}] 🚨 Started fault session ${res.insertedId}`);

      // Push session to in-memory cache array
      doc._id = res.insertedId;
      this.cachedFaultSessions.push(schemaAdapters.prepareDocFromMongo(doc));
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)
      
    } catch (e) {
      logError(`[${this.getTimestamp()}] ❌ Error starting fault session`, {
        machine: this.machineConfig.name,
        error: e.message,
        stack: e.stack
      });
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
      logInfo(`[${this.getTimestamp()}] ✅ Ended fault session ${this.currentFaultSessionId}`);
      
      // ⭐ Sync in-memory cache array with updated session from DB
      const updatedSessionDoc = await coll.findOne({ _id: this.currentFaultSessionId });
      const updatedSession = updatedSessionDoc ? schemaAdapters.prepareDocFromMongo(updatedSessionDoc) : null;
      if (updatedSession) {
      const sessionIndex = this.cachedFaultSessions.findIndex(s => idsEqual(s._id, this.currentFaultSessionId));
      if (sessionIndex !== -1) {
        this.cachedFaultSessions[sessionIndex] = updatedSession;
      }
      }
      
      // ⭐ Cache will be updated by recurring interval (no manual trigger needed)
      
    } catch (e) {
      logError(`[${this.getTimestamp()}] ❌ Error ending fault session`, {
        machine: this.machineConfig.name,
        error: e.message,
        stack: e.stack
      });
    } finally {
      this.currentFaultSessionId = null;
    }
  }

  async recalculateFaultSession(sessionId) {
    try {
      const db = this.client.db(this.dbName);
      const coll = db.collection(config.faultSessionCollectionName);
      const doc = await coll.findOne({ _id: sessionId });
      const s = doc ? schemaAdapters.prepareDocFromMongo(doc) : null;
      if (!s) return;
      // Handle timestamps that may be Date objects or ISO strings
      const start = s.timestamps.start instanceof Date
        ? DateTime.fromJSDate(s.timestamps.start)
        : DateTime.fromISO(s.timestamps.start);
      const endTime = s.timestamps.end || new Date();
      const end = endTime instanceof Date
        ? DateTime.fromJSDate(endTime)
        : DateTime.fromISO(endTime);
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
      const sessionIndex = this.cachedFaultSessions.findIndex(sess => idsEqual(sess._id, sessionId));
      if (sessionIndex !== -1) {
        Object.assign(this.cachedFaultSessions[sessionIndex], updateData);
      }
      
      // Log only at start/end of fault sessions to reduce spam
      if (s.timestamps.end) {
        logInfo(`[${this.getTimestamp()}] 🧮 Recalc fault session ${sessionId}: faulttime=${Math.round(faulttime)}s missed=${Math.round(workTimeMissed)}s`);
      }
    } catch (e) {
      logError(`[${this.getTimestamp()}] ❌ Error recalculating fault session`, {
        machine: this.machineConfig.name,
        error: e.message,
        stack: e.stack
      });
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

      // Real-world scenario: 5% chance of fault, 95% chance of normal timeout
      const nextState = Math.random() < 0.05 ? "Fault" : "Timeout";
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

    // ⭐ Stop the midnight rollover interval
    if (this.midnightInterval) {
      clearInterval(this.midnightInterval);
      this.midnightInterval = null;
    }

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
        logError(`[${this.getTimestamp()}] ❌ Error ending session on stop`, {
          machine: this.machineConfig.name,
          error: error.message,
          stack: error.stack
        });
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
    logInfo(`[${this.getTimestamp()}] 🛑 Simulator stopped`);
  }

  simulateStationCounts(runningState, station, operator) {
    const rateParam = operator.rate;
    // Choose the correct item for this station (FIXED per station for SPF machines)
    const itemForThisStation = this.isSpf()
      ? (this.itemPerStation.get(station) || this.currentItems[0] || this.currentItem)
      : this.currentItem;

    // Calculate timing based on current item with correct exponential distribution
    let timing = calculateItemTiming(itemForThisStation);
    // ⭐ FIX: Use proper exponential distribution (removed artificial /5 compression)
    const x = -Math.log(1 - Math.random()) / rateParam;
    const normalized = Math.min(x, 1); // Cap extreme tails
    let delayMs = (timing.lowRange + normalized * (timing.highRange - timing.lowRange)) * 1000;

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
          // Include current item information (use fixed item per station for SPF)
          countRecord.item = {
            id: (itemForThisStation.number ?? itemForThisStation.id),
            name: itemForThisStation.name,
            standard: itemForThisStation.standard
          };
          // Note: Timing already calculated above with correct exponential distribution

        } else {
          countRecord.misfeed = true;
          // Attach item to misfeed so item-session can account for it (use fixed item per station for SPF)
          countRecord.item = {
            id: (itemForThisStation.number ?? itemForThisStation.id),
            name: itemForThisStation.name,
            standard: itemForThisStation.standard
          };
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
        await collection.insertOne(schemaAdapters.prepareDocForMongo(adaptedRecord));

        // Write to additional count collections (using adapted record)
        await db.collection(config.countDailyCollectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecord));
        await db.collection(config.countWeeklyCollectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecord));
        await db.collection(config.countMonthlyCollectionName).insertOne(schemaAdapters.prepareDocForMongo(adaptedRecord));

        await db.collection(config.stateTickerCollectionName).updateOne(
          { "machine.id": adaptedRecord.machine.id },  // Using adapted record's machine.id
          { $set: { timestamp: new Date() } }
        );

        // Update machine session with new count/misfeed
        if (this.currentSessionId) {
          try {
            const sessionCollection = db.collection(config.machineSessionCollectionName);

            if (isMisfeed) {
              // ⭐ PHASE 4: Schema-adapted sessions have counts as object with valid/misfeed arrays
              await sessionCollection.updateOne(
                { _id: this.currentSessionId },
                { $push: { 'counts.misfeed': schemaAdapters.prepareDocForMongo(adaptedRecord) } }
              );
            } else {
              // ⭐ PHASE 4: Schema-adapted sessions have counts as object with valid/misfeed arrays
              await sessionCollection.updateOne(
                { _id: this.currentSessionId },
                { $push: { 'counts.valid': schemaAdapters.prepareDocForMongo(adaptedRecord) } }
              );
            }

            // Recalculate session stats after adding count/misfeed
            await this.updateSessionStats();

          } catch (sessionError) {
            logError(`[${this.getTimestamp()}] ❌ Error updating session with count`, {
              machine: this.machineConfig.name,
              sessionId: this.currentSessionId,
              error: sessionError.message,
              stack: sessionError.stack
            });
          }
        }

        // Update operator session with new count/misfeed
        const opSessionId = this.operatorSessionIdsByOperator.get(operator.id) ??
          this.operatorSessionIdsByStation.get(station);

        if (opSessionId) {
          try {
            const opSess = db.collection(config.operatorSessionCollectionName);
            if (isMisfeed) {
              await opSess.updateOne({ _id: opSessionId }, { $push: { misfeeds: schemaAdapters.prepareDocForMongo(adaptedRecord) } });
            } else {
              await opSess.updateOne({ _id: opSessionId }, { $push: { counts: schemaAdapters.prepareDocForMongo(adaptedRecord) } });
            }
            await this.recalculateOperatorSession(opSessionId);

            // ⭐ Sync in-memory cache with the new count/misfeed
            if (operator && operator.id && this.cachedOperatorSessions.has(operator.id)) {
              const sessions = this.cachedOperatorSessions.get(operator.id);
              const sessionIndex = sessions.findIndex(sess => idsEqual(sess._id, opSessionId));
              if (sessionIndex !== -1) {
                // Add the count/misfeed to the in-memory session
                if (isMisfeed) {
                  if (!sessions[sessionIndex].misfeeds) sessions[sessionIndex].misfeeds = [];
                  sessions[sessionIndex].misfeeds.push(adaptedRecord);
                } else {
                  if (!sessions[sessionIndex].counts) sessions[sessionIndex].counts = [];
                  sessions[sessionIndex].counts.push(adaptedRecord);
                }
              }
            }
          } catch (opSessionError) {
            logError(`[${this.getTimestamp()}] ❌ Error updating operator session with count`, {
              machine: this.machineConfig.name,
              sessionId: opSessionId,
              error: opSessionError.message,
              stack: opSessionError.stack
            });
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
                await itemColl.updateOne({ _id: itemSessId }, { $push: { misfeeds: schemaAdapters.prepareDocForMongo(adaptedRecord) } });
              } else {
                await itemColl.updateOne({ _id: itemSessId }, { $push: { counts: schemaAdapters.prepareDocForMongo(adaptedRecord) } });
              }
              await this.recalculateItemSession(itemSessId);

              // ⭐ Sync in-memory cache with the new count/misfeed
              if (this.cachedItemSessions.has(itemIdForRecord)) {
                const sessions = this.cachedItemSessions.get(itemIdForRecord);
                const sessionIndex = sessions.findIndex(sess => idsEqual(sess._id, itemSessId));
                if (sessionIndex !== -1) {
                  // Add the count/misfeed to the in-memory session
                  if (isMisfeed) {
                    if (!sessions[sessionIndex].misfeeds) sessions[sessionIndex].misfeeds = [];
                    sessions[sessionIndex].misfeeds.push(adaptedRecord);
                  } else {
                    if (!sessions[sessionIndex].counts) sessions[sessionIndex].counts = [];
                    sessions[sessionIndex].counts.push(adaptedRecord);
                  }
                }
              }
            } catch (itemSessionError) {
              logError(`[${this.getTimestamp()}] ❌ Error updating item session with ${isMisfeed ? 'misfeed' : 'count'}`, {
                machine: this.machineConfig.name,
                sessionId: itemSessId,
                error: itemSessionError.message,
                stack: itemSessionError.stack
              });
            }
          }
        }

        if (this.countTimeouts.has(station)) {
          this.simulateStationCounts(runningState, station, operator);
        }
      } catch (err) {
        logError(`❌ Count error at station ${station}`, {
          machine: this.machineConfig.name,
          station,
          error: err.message,
          stack: err.stack
        });
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

startWorker().catch(err => {
  logError('❌ Simulator worker failed to start', {
    error: err.message,
    stack: err.stack
  });
});
}



