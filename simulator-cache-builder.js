// simulator-cache-builder.js - Real-time cache building logic for simulator
// This module builds and updates cache totals using in-memory session data
// Eliminates need for database polling by calculating on-demand

const { DateTime } = require('luxon');
const schemaValidator = require('./schema-validator');
const config = require('./config');
const createLogger = require('./logger');

// Build logging database connection string (similar to simulation-worker.js)
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
    const url = config.mongoLog.url;
    
    // ✅ FIX: Properly handle both mongodb:// and mongodb+srv:// URLs
    if (url.startsWith('mongodb://')) {
        const urlWithoutScheme = url.substring(10);
        const slashIndex = urlWithoutScheme.indexOf('/');
        
        if (slashIndex === -1) {
            // No database in URL
            loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}/${config.mongoLog.db || 'chitrac-logging'}?authSource=${logAuthSource}`;
        } else {
            // Database specified in URL
            loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}?authSource=${logAuthSource}`;
        }
    } else if (url.startsWith('mongodb+srv://')) {
        // ✅ FIX: Handle mongodb+srv:// URLs properly
        const urlWithoutScheme = url.substring(14); // 'mongodb+srv://' is 14 chars
        const slashIndex = urlWithoutScheme.indexOf('/');
        const questionIndex = urlWithoutScheme.indexOf('?');
        
        // Extract host part (everything before / or ?)
        const hostEnd = slashIndex !== -1 ? slashIndex : (questionIndex !== -1 ? questionIndex : urlWithoutScheme.length);
        const hostPart = urlWithoutScheme.substring(0, hostEnd);
        const restPart = urlWithoutScheme.substring(hostEnd);
        
        // Build connection string with credentials
        loggerConnectionString = `mongodb+srv://${encodedLogUsername}:${encodedLogPassword}@${hostPart}${restPart}`;
        
        // Add authSource parameter
        if (questionIndex === -1) {
            // No existing query params
            loggerConnectionString += `?authSource=${logAuthSource}`;
        } else {
            // Query params exist, append authSource
            loggerConnectionString += `&authSource=${logAuthSource}`;
        }
    } else {
        // Fallback: try to inject credentials using string replacement
        // This handles edge cases but may not work for all URL formats
        loggerConnectionString = url.replace(/^(mongodb\+?srv?:\/\/)/, `$1${encodedLogUsername}:${encodedLogPassword}@`);
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

function logInfo(message, details) {
    if (logger && typeof logger.info === 'function') {
        logger.info(message, details);
    }
}

function logWarn(message, details) {
    if (logger && typeof logger.warn === 'function') {
        logger.warn(message, details);
    }
}

function logError(message, details) {
    if (logger && typeof logger.error === 'function') {
        logger.error(message, details);
    }
}

const SYSTEM_TIMEZONE = 'America/Chicago';

// --- Normalizers for legacy vs schema-adapted sessions ---
// These handle sessions BEFORE updateSessionStats runs (raw schema-adapted format)
// and AFTER updateSessionStats runs (with computed metrics.*)

function getCountsValid(s) {
  // Try computed metrics first
  if (Number.isFinite(s.metrics?.totals?.counts?.valid)) return s.metrics.totals.counts.valid;
  if (Number.isFinite(s.totalCount)) return s.totalCount;
  // Fall back to raw arrays
  if (Array.isArray(s.counts)) return s.counts.length;                          // legacy
  if (Array.isArray(s.counts?.valid)) return s.counts.valid.length;             // adapted
  return 0;
}

function getCountsMisfeed(s) {
  // Try computed metrics first
  if (Number.isFinite(s.metrics?.totals?.counts?.misfeed)) return s.metrics.totals.counts.misfeed;
  if (Number.isFinite(s.misfeedCount)) return s.misfeedCount;
  // Fall back to raw arrays
  if (Array.isArray(s.misfeeds)) return s.misfeeds.length;                      // legacy
  if (Array.isArray(s.counts?.misfeed)) return s.counts.misfeed.length;         // adapted
  return 0;
}

function getRuntimeSeconds(s) {
  // Try computed metrics first
  if (Number.isFinite(s.metrics?.timers?.run)) return s.metrics.timers.run;
  if (Number.isFinite(s.runtime)) return s.runtime;
  // Fall back to deriving from timestamps
  const start = s.timestamps?.start ? new Date(s.timestamps.start) : null;
  const end = new Date(s.timestamps?.end || Date.now());
  return start ? Math.max(0, (end - start) / 1000) : 0;
}

function resolveActiveStations(s) {
  // Primary: Use computed activeStations if already calculated
  if (Number.isFinite(s.activeStations) && s.activeStations > 0) return s.activeStations;

  // Secondary: Count real operators (this is the MOST RELIABLE method)
  // This correctly handles SPF (1 operator) and multi-lane machines (N operators)
  if (Array.isArray(s.operators)) {
    const n = s.operators.filter(op => op && op.id !== -1).length;
    if (n > 0) return n;
  }

  // ⚠️ DO NOT USE program.stations or machine.lanes as fallback!
  // Reason: SPF machines have machine.lanes=4 but activeStations=1
  // Using these fields would cause 4x inflation of workTime

  // Last resort: default to 1 station
  return 1;
}

function getWorkedSeconds(s) {
  // prefer computed metrics
  if (Number.isFinite(s.metrics?.timers?.worked)) return s.metrics.timers.worked;
  if (Number.isFinite(s.workTime)) return s.workTime;

  // ✅ FIX: For operator sessions, workTime = runtime (single operator, don't multiply by stations)
  // Operator sessions have operator.id (singular), machine sessions have operators array (plural)
  const isOperatorSession = s.operator?.id !== undefined && s.operator?.id !== -1;
  if (isOperatorSession) {
    // For operator sessions, workTime equals runtime (one operator per session)
    return getRuntimeSeconds(s);
  }

  // For machine sessions: derive from runtime * resolved stations
  const runtime = getRuntimeSeconds(s);
  const stations = resolveActiveStations(s);
  return runtime * stations;
}

function normalizePPH(std) {
  const n = Number(std) || 0;
  return n < 60 ? n * 60 : n; // PPM -> PPH
}

function getTimeCreditSeconds(s) {
  // Try computed metrics first
  if (Number.isFinite(s.metrics?.totals?.timeCredit)) return s.metrics.totals.timeCredit;
  if (Number.isFinite(s.totalTimeCredit)) return s.totalTimeCredit;

  // Fall back to computing from items and counts
  const validCount = getCountsValid(s);
  const items = Array.isArray(s.items) && s.items.length > 0
    ? s.items
    : (s.item ? [s.item] : []);

  if (!items.length || validCount === 0) return 0;

  // For single item, simple calculation
  if (items.length === 1) {
    const pph = normalizePPH(items[0]?.standard);
    return pph > 0 ? validCount / (pph / 3600) : 0;
  }

  // For multiple items, try to use per-item arrays
  if (Array.isArray(s.totalByItem) && Array.isArray(s.timeCreditByItem)) {
    return s.timeCreditByItem.reduce((sum, tc) => sum + (tc || 0), 0);
  }

  // Otherwise distribute counts evenly (approximation)
  let total = 0;
  for (const it of items) {
    const pph = normalizePPH(it?.standard);
    if (pph > 0) {
      const itemCount = validCount / items.length; // rough approximation
      total += itemCount / (pph / 3600);
    }
  }
  return total;
}

/**
 * Helper function to calculate overlap factor between session and query window
 */
function overlap(sStart, sEnd, wStart, wEnd) {
  const ss = new Date(sStart);
  const se = new Date(sEnd || wEnd);
  const os = ss > wStart ? ss : wStart;
  const oe = se < wEnd ? se : wEnd;
  const ovSec = Math.max(0, (oe - os) / 1000);
  const fullSec = Math.max(0, (se - ss) / 1000);
  const f = fullSec > 0 ? ovSec / fullSec : 0;
  return { ovSec, fullSec, factor: f };
}

/**
 * Safe number extraction
 */
function safe(n) {
  return (typeof n === "number" && isFinite(n) ? n : 0);
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

/**
 * Builds hourly totals for a machine using in-memory session arrays
 * @param {Object} options
 * @param {Number} options.machineSerial - Machine serial number
 * @param {String} options.machineName - Machine name
 * @param {Array} options.machineSessions - In-memory machine sessions for today
 * @param {Array} options.faultSessions - In-memory fault sessions for today
 * @param {Date} options.queryStart - Start of hour
 * @param {Date} options.queryEnd - Current time
 * @returns {Object} Hourly totals record
 */
function buildMachineHourlyTotal({ machineSerial, machineName, machineSessions, faultSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
    let runtimeSec = 0, workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of machineSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const runtime = getRuntimeSeconds(s);
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      runtimeSec += safe(runtime) * factor;
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    // Calculate fault time and count
    let faultTimeSec = 0;
    let totalFaults = 0;

    for (const fs of faultSessions) {
      const sStart = fs.timestamps?.start;
      const sEnd = fs.timestamps?.end || queryEnd;
      const { ovSec, fullSec } = overlap(sStart, sEnd, queryStart, queryEnd);

      if (ovSec === 0) continue;
      else totalFaults += 1;

      const ft = safe(fs.faulttime);
      if (ft > 0 && fullSec > 0) {
        const factor = ovSec / fullSec;
        faultTimeSec += ft * factor;
      } else {
        faultTimeSec += ovSec;
      }
    }

    // Calculate paused time with proper clamping
    const windowMs = queryEnd - queryStart;
    const runtimeMs = Math.round(runtimeSec * 1000);
    const faultTimeMs = Math.round(faultTimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);

    const nonRunMs = Math.max(0, windowMs - runtimeMs);
    const faultClampedMs = Math.min(faultTimeMs, nonRunMs);
    const pausedTimeMs = Math.max(0, nonRunMs - faultClampedMs);

    // Create hour string in local timezone
    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, { zone: SYSTEM_TIMEZONE }).toUTC().toJSDate();

    return {
      _id: `machine-${machineSerial}-${dateHourStr}`,
      entityType: 'machine',
      machineSerial: machineSerial,
      machineName: machineName,
      date: dateStr,
      dateHourStr: dateHourStr,
      hour: hour,
      dateObj: dateObj,

      // Time metrics (in milliseconds)
      runtimeMs: runtimeMs,
      faultTimeMs: faultClampedMs,
      workedTimeMs: workedTimeMs,
      pausedTimeMs: pausedTimeMs,

      // Count metrics (rounded)
      totalFaults: totalFaults,
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,

      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building machine hourly total for machine ${machineSerial}`, { error: error.message, stack: error.stack, machineSerial });
    return null;
  }
}

/**
 * Builds daily totals for a machine using in-memory session arrays
 * @param {Object} options
 * @param {Number} options.machineSerial - Machine serial number
 * @param {String} options.machineName - Machine name
 * @param {Array} options.machineSessions - In-memory machine sessions for today
 * @param {Array} options.faultSessions - In-memory fault sessions for today
 * @param {Date} options.queryStart - Start of day
 * @param {Date} options.queryEnd - Current time
 * @returns {Object} Daily totals record
 */
function buildMachineDailyTotal({ machineSerial, machineName, machineSessions, faultSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
    let runtimeSec = 0, workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of machineSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      // ✅ Use normalizers to handle both computed metrics and raw schema-adapted format
      const runtime = getRuntimeSeconds(s);
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      runtimeSec += safe(runtime) * factor;
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    // Calculate fault time and count
    let faultTimeSec = 0;
    let totalFaults = 0;

    for (const fs of faultSessions) {
      const sStart = fs.timestamps?.start;
      const sEnd = fs.timestamps?.end || queryEnd;
      const { ovSec, fullSec } = overlap(sStart, sEnd, queryStart, queryEnd);
      
      if (ovSec === 0) continue;
      else totalFaults += 1; // Only count overlapping faults
      
      const ft = safe(fs.faulttime);
      if (ft > 0 && fullSec > 0) {
        const factor = ovSec / fullSec;
        faultTimeSec += ft * factor;
      } else {
        faultTimeSec += ovSec;
      }
    }

    // Calculate paused time with proper clamping
    const windowMs = queryEnd - queryStart;
    const runtimeMs = Math.round(runtimeSec * 1000);
    const faultTimeMs = Math.round(faultTimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    
    // Clamp downtime so totals never exceed the window
    const nonRunMs = Math.max(0, windowMs - runtimeMs);
    const faultClampedMs = Math.min(faultTimeMs, nonRunMs);
    const pausedTimeMs = Math.max(0, nonRunMs - faultClampedMs);
    
    // Create date string and ensure timezone consistency
    const dateStr = queryStart.toISOString().split('T')[0];
    // Ensure dateObj stores UTC midnight for the local date (timezone-aware conversion)
    const dateObj = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).toUTC().startOf('day').toJSDate();

    return {
      _id: `machine-${machineSerial}-${dateStr}`,
      entityType: 'machine',
      machineSerial: machineSerial,
      machineName: machineName,
      date: dateStr,
      dateObj: dateObj,
      
      // Time metrics (in milliseconds)
      runtimeMs: runtimeMs,
      faultTimeMs: faultClampedMs,
      workedTimeMs: workedTimeMs,
      pausedTimeMs: pausedTimeMs,
      
      // Count metrics (rounded)
      totalFaults: totalFaults,
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,
      
      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building machine daily total for machine ${machineSerial}`, { error: error.message, stack: error.stack, machineSerial });
    return null;
  }
}

/**
 * Builds daily totals for operator-machine combinations using in-memory session arrays
 * @param {Object} options
 * @param {Number} options.operatorId - Operator ID
 * @param {String} options.operatorName - Operator name
 * @param {Number} options.machineSerial - Machine serial number
 * @param {String} options.machineName - Machine name
 * @param {Array} options.operatorSessions - In-memory operator sessions for this operator-machine combo
 * @param {Date} options.queryStart - Start of day
 * @param {Date} options.queryEnd - Current time
 * @returns {Object} Operator daily totals record
 */
function buildOperatorMachineDailyTotal({ operatorId, operatorName, machineSerial, machineName, operatorSessions, queryStart, queryEnd }) {
  try {
    // ✅ FIX: Track both runtime and workTime separately
    let runtimeSec = 0;      // ← ADD: Track actual session runtime
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of operatorSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      // ✅ Extract both runtime and workTime
      const runtime = getRuntimeSeconds(s);     // ← ADD: Get session duration
      const workTime = getWorkedSeconds(s);     // For operators, workTime = runtime (single operator)
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      runtimeSec += safe(runtime) * factor;     // ← ADD: Accumulate runtime
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    // For operators:
    // - runtimeMs = total time operator was in sessions
    // - workedTimeMs = runtime (for single operator, worked = runtime)
    // - pausedTimeMs = time in session but not actively working (should be 0 or near 0)
    const runtimeMs = Math.round(runtimeSec * 1000);      // ← FIX: Use actual runtime
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0; // Operators don't have separate fault tracking
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);  // ← FIX: Use runtime as base, not window
    
    // Create date string and ensure timezone consistency
    const dateStr = queryStart.toISOString().split('T')[0];
    // Ensure dateObj stores UTC midnight for the local date (timezone-aware conversion)
    const dateObj = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).toUTC().startOf('day').toJSDate();

    return {
      _id: `operator-machine-${operatorId}-${machineSerial}-${dateStr}`,
      entityType: 'operator-machine',
      operatorId: operatorId,
      operatorName: operatorName,
      machineSerial: machineSerial,
      machineName: machineName,
      date: dateStr,
      dateObj: dateObj,
      
      // Time metrics (in milliseconds)
      runtimeMs: runtimeMs,
      faultTimeMs: faultTimeMs,
      workedTimeMs: workedTimeMs,
      pausedTimeMs: pausedTimeMs,
      
      // Count metrics (rounded)
      totalFaults: 0, // Operators don't have separate fault tracking
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,
      
      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building operator daily total for operator ${operatorId} on machine ${machineSerial}`, { error: error.message, stack: error.stack, operatorId, machineSerial });
    return null;
  }
}

/**
 * Builds hourly totals for operator-machine combinations using in-memory session arrays
 */
function buildOperatorMachineHourlyTotal({ operatorId, operatorName, machineSerial, machineName, operatorSessions, queryStart, queryEnd }) {
  try {
    let runtimeSec = 0, workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of operatorSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);
      const runtime = getRuntimeSeconds(s);
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      runtimeSec += safe(runtime) * factor;
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    const runtimeMs = Math.round(runtimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0;
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);

    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, { zone: SYSTEM_TIMEZONE }).toUTC().toJSDate();

    return {
      _id: `operator-machine-${operatorId}-${machineSerial}-${dateHourStr}`,
      entityType: 'operator-machine',
      operatorId, operatorName, machineSerial, machineName,
      date: dateStr, dateHourStr, hour, dateObj,
      runtimeMs, faultTimeMs, workedTimeMs, pausedTimeMs,
      totalFaults: 0, totalCounts: Math.round(totalCounts), totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building operator hourly total for operator ${operatorId} on machine ${machineSerial}`, { error: error.message, stack: error.stack, operatorId, machineSerial });
    return null;
  }
}

/**
 * Builds hourly totals for item-machine combinations
 */
function buildItemMachineHourlyTotal({ itemId, itemName, machineSerial, machineName, itemSessions, queryStart, queryEnd }) {
  try {
    let totalRuntimeSec = 0, workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0, itemStandard = 0;
    let maxActiveStations = 0;

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);
      const runtime = getRuntimeSeconds(s);
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);
      const sessionStations = resolveActiveStations(s);

      if (sessionStations > maxActiveStations) maxActiveStations = sessionStations;

      totalRuntimeSec += safe(runtime) * factor;
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;

      if (!itemStandard && s.item?.standard) itemStandard = s.item.standard;
    }

    const runtimeMs = Math.round(totalRuntimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);

    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, { zone: SYSTEM_TIMEZONE }).toUTC().toJSDate();

    return {
      _id: `machine-item-${machineSerial}-${itemId}-${dateHourStr}`,
      entityType: 'machine-item',
      itemId, itemName: itemName || `Item ${itemId}`,
      machineSerial, machineName: machineName || `Serial ${machineSerial}`,
      date: dateStr, dateHourStr, hour, dateObj,
      runtimeMs, faultTimeMs: 0, workedTimeMs, pausedTimeMs,
      activeStations: maxActiveStations || 1,
      totalFaults: 0, totalCounts: Math.round(totalCounts), totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs, itemStandard,
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building item-machine hourly total for item ${itemId} on machine ${machineSerial}`, { error: error.message, stack: error.stack, itemId, machineSerial });
    return null;
  }
}

/**
 * Builds hourly totals for items (plant-wide)
 */
function buildItemHourlyTotal({ itemId, itemName, itemStandard, machineSerial, itemSessions, queryStart, queryEnd, source = 'simulator' }) {
  try {
    let workedTimeSec = 0, timeCreditSec = 0, totalRuntimeSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);
      const runtime = getRuntimeSeconds(s);

      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
      totalRuntimeSec += safe(runtime) * factor;
    }

    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const runtimeMs = Math.round(totalRuntimeSec * 1000);

    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, { zone: SYSTEM_TIMEZONE }).toUTC().toJSDate();

    // ✅ FIX: Include machineSerial in _id to prevent overwrites across machines
    // Each machine creates its own record, then we aggregate in the query
    return {
      _id: `item-${itemId}-${machineSerial}-${dateHourStr}`,
      entityType: 'item',
      itemId, itemName: itemName || `Item ${itemId}`,
      date: dateStr, dateHourStr, hour, dateObj,
      runtimeMs, workedTimeMs, totalTimeCreditMs: timeCreditMs,
      totalCounts: Math.round(totalCounts), totalMisfeeds: Math.round(totalMisfeeds),
      itemStandard, contributingMachine: machineSerial, source,
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building item hourly total for item ${itemId}`, { error: error.message, stack: error.stack, itemId });
    return null;
  }
}

/**
 * Builds hourly totals for operator-item combinations
 */
function buildOperatorItemHourlyTotal({ operatorId, operatorName, itemId, itemName, machineSerial, machineName, operatorSessions, queryStart, queryEnd, source = 'simulator' }) {
  try {
    let timeCreditSec = 0, totalCounts = 0, totalMisfeeds = 0, itemStandard = 0;

    for (const s of operatorSessions) {
      const itemIndex = s.items?.findIndex(it => it.id === itemId);
      if (itemIndex === -1 || itemIndex === undefined) continue;

      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);
      const countForItem = safe(s.totalCountByItem?.[itemIndex] || 0);
      const timeCreditForItem = safe(s.timeCreditByItem?.[itemIndex] || 0);

      totalCounts += countForItem * factor;
      timeCreditSec += timeCreditForItem * factor;

      const misfeedsArray = s.counts?.misfeed || s.misfeeds || [];
      const misfeedsForItem = misfeedsArray.filter(m => m.item?.id === itemId).length;
      totalMisfeeds += misfeedsForItem * factor;

      if (!itemStandard && s.items?.[itemIndex]?.standard) itemStandard = s.items[itemIndex].standard;
    }

    const timeCreditMs = Math.round(timeCreditSec * 1000);

    const hourDt = DateTime.fromJSDate(queryStart, { zone: SYSTEM_TIMEZONE });
    const dateStr = hourDt.toFormat('yyyy-MM-dd');
    const hour = hourDt.hour;
    const dateHourStr = `${dateStr}-${hour.toString().padStart(2, '0')}`;
    const dateObj = DateTime.fromISO(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`, { zone: SYSTEM_TIMEZONE }).toUTC().toJSDate();

    return {
      _id: `operator-item-${operatorId}-${itemId}-${machineSerial}-${dateHourStr}`,
      entityType: 'operator-item',
      operatorId, operatorName, itemId, itemName: itemName || `Item ${itemId}`,
      machineSerial, machineName,
      date: dateStr, dateHourStr, hour, dateObj,
      totalTimeCreditMs: timeCreditMs,
      totalCounts: Math.round(totalCounts), totalMisfeeds: Math.round(totalMisfeeds),
      itemStandard, source,
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building operator-item hourly total for operator ${operatorId} and item ${itemId}`, { error: error.message, stack: error.stack, operatorId, itemId });
    return null;
  }
}

/**
 * Builds daily totals for item-machine combinations using in-memory session arrays
 * Note: This requires counts data which we'll get from the session counts arrays
 * @param {Object} options
 * @param {Number} options.itemId - Item ID
 * @param {String} options.itemName - Item name
 * @param {Number} options.machineSerial - Machine serial number
 * @param {String} options.machineName - Machine name
 * @param {Array} options.itemSessions - In-memory item sessions for this item-machine combo
 * @param {Date} options.queryStart - Start of day
 * @param {Date} options.queryEnd - Current time
 * @returns {Object} Item daily totals record
 */
function buildItemMachineDailyTotal({ itemId, itemName, machineSerial, machineName, itemSessions, queryStart, queryEnd }) {
  try {
    // ✅ FIX: Track runtime, workTime, and activeStations
    let totalRuntimeSec = 0;  // ← ADD: Track actual session runtime
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;
    let maxActiveStations = 0;  // ← ADD: Track max active stations

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      // ✅ Extract runtime, workTime, and activeStations
      const runtime = getRuntimeSeconds(s);    // ← ADD: Get session duration
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      // ← ADD: Track maximum active stations for this item
      const sessionStations = resolveActiveStations(s);
      if (sessionStations > maxActiveStations) {
        maxActiveStations = sessionStations;
      }

      totalRuntimeSec += safe(runtime) * factor;  // ← ADD: Accumulate runtime
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;

      // Get item standard from first session
      if (!itemStandard && s.item?.standard) {
        itemStandard = s.item.standard;
      }
    }

    // ✅ FIX: Calculate times correctly
    const runtimeMs = Math.round(totalRuntimeSec * 1000);  // ← FIX: Use actual runtime
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0; // Items don't track separate faults
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);  // ← FIX: Use runtime as base
    
    // Create date string and ensure timezone consistency
    const dateStr = queryStart.toISOString().split('T')[0];
    // Ensure dateObj stores UTC midnight for the local date (timezone-aware conversion)
    const dateObj = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).toUTC().startOf('day').toJSDate();

    return {
      _id: `machine-item-${machineSerial}-${itemId}-${dateStr}`,
      entityType: 'machine-item',
      itemId: itemId,
      itemName: itemName || `Item ${itemId}`,
      machineSerial: machineSerial,
      machineName: machineName || `Serial ${machineSerial}`,
      date: dateStr,
      dateObj: dateObj,

      // Time metrics (in milliseconds)
      runtimeMs: runtimeMs,
      faultTimeMs: faultTimeMs,
      workedTimeMs: workedTimeMs,
      pausedTimeMs: pausedTimeMs,

      // ← ADD: Active stations field
      activeStations: maxActiveStations || 1,  // Default to 1 if no sessions

      // Count metrics
      totalFaults: 0,
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      totalTimeCreditMs: timeCreditMs,

      // Additional machine-item specific metrics
      itemStandard: itemStandard,

      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building item-machine daily total for item ${itemId} on machine ${machineSerial}`, { error: error.message, stack: error.stack, itemId, machineSerial });
    return null;
  }
}

/**
 * Builds daily totals for items aggregated across the machine (plant-wide when combined with other simulators)
 * @param {Object} options
 * @param {Number} options.itemId - Item ID
 * @param {String} options.itemName - Item name
 * @param {Number} options.itemStandard - Item standard (PPH)
 * @param {Number} options.machineSerial - Machine serial number (for tracking contribution)
 * @param {Array} options.itemSessions - In-memory item sessions for this item
 * @param {Date} options.queryStart - Start of day
 * @param {Date} options.queryEnd - Current time
 * @param {String} options.source - Data source ('simulator', 'cache', or 'datafeed')
 * @returns {Object} Item daily totals record (for atomic aggregation across machines)
 */
function buildItemDailyTotal({ itemId, itemName, itemStandard, machineSerial, itemSessions, queryStart, queryEnd, source = 'simulator' }) {
  try {
    // Calculate totals for this item from all sessions on this machine
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let totalRuntimeSec = 0;

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      // ✅ Use normalizers to handle both computed metrics and raw schema-adapted format
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);
      const runtime = getRuntimeSeconds(s);

      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
      totalRuntimeSec += safe(runtime) * factor;
    }

    // Convert to milliseconds
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const runtimeMs = Math.round(totalRuntimeSec * 1000);
    
    // Create date string and ensure timezone consistency
    const dateStr = queryStart.toISOString().split('T')[0];
    // Ensure dateObj stores UTC midnight for the local date (timezone-aware conversion)
    const dateObj = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).toUTC().startOf('day').toJSDate();

    // ✅ FIX: Include machineSerial in _id to prevent overwrites across machines
    // Each machine creates its own record, then we aggregate in the query
    return {
      _id: `item-${itemId}-${machineSerial}-${dateStr}`,
      entityType: 'item',
      itemId: itemId,
      itemName: itemName || `Item ${itemId}`,
      date: dateStr,
      dateObj: dateObj,
      
      // Per-machine totals (aggregated in queries across all machines)
      runtimeMs: runtimeMs,
      workedTimeMs: workedTimeMs,
      totalTimeCreditMs: timeCreditMs,
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      
      // Item-specific metrics
      itemStandard: itemStandard,
      
      // Track machine contribution (for debugging)
      contributingMachine: machineSerial,
      
      // Data provenance
      source: source,
      
      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building item daily total for item ${itemId}`, { error: error.message, stack: error.stack, itemId });
    return null;
  }
}

/**
 * Builds daily totals for operator-item combinations using in-memory session arrays
 * @param {Object} options
 * @param {Number} options.operatorId - Operator ID
 * @param {String} options.operatorName - Operator name
 * @param {Number} options.itemId - Item ID
 * @param {String} options.itemName - Item name
 * @param {Number} options.machineSerial - Machine serial number
 * @param {String} options.machineName - Machine name
 * @param {Array} options.operatorSessions - In-memory operator sessions for this operator
 * @param {Date} options.queryStart - Start of day
 * @param {Date} options.queryEnd - Current time
 * @param {String} options.source - Data source ('simulator', 'cache', or 'datafeed')
 * @returns {Object} Operator-item daily totals record
 */
function buildOperatorItemDailyTotal({ operatorId, operatorName, itemId, itemName, machineSerial, machineName, operatorSessions, queryStart, queryEnd, source = 'simulator' }) {
  try {
    // ✅ FIX: Don't track workedTime for operator-item combos (ambiguous for SPF)
    // Only track time-credit (unambiguous metric) and counts
    let timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;

    for (const s of operatorSessions) {
      // Find the index of this item in the session's items array
      const itemIndex = s.items?.findIndex(it => it.id === itemId);

      if (itemIndex === -1 || itemIndex === undefined) {
        // This session doesn't involve this item, skip
        continue;
      }

      // Get the overlap factor for this session
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      // Get per-item metrics (aligned with s.items array)
      const countForItem = safe(s.totalCountByItem?.[itemIndex] || 0);
      const timeCreditForItem = safe(s.timeCreditByItem?.[itemIndex] || 0);

      totalCounts += countForItem * factor;
      timeCreditSec += timeCreditForItem * factor;

      // Count misfeeds for this specific item
      const misfeedsArray = s.counts?.misfeed || s.misfeeds || [];
      const misfeedsForItem = misfeedsArray.filter(m => m.item?.id === itemId).length;
      totalMisfeeds += misfeedsForItem * factor;

      // Get item standard
      if (!itemStandard && s.items?.[itemIndex]?.standard) {
        itemStandard = s.items[itemIndex].standard;
      }
    }

    // Convert to milliseconds
    const timeCreditMs = Math.round(timeCreditSec * 1000);

    // Create date string
    const dateStr = queryStart.toISOString().split('T')[0];
    const dateObj = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).toUTC().startOf('day').toJSDate();

    return {
      _id: `operator-item-${operatorId}-${itemId}-${machineSerial}-${dateStr}`,
      entityType: 'operator-item',
      operatorId: operatorId,
      operatorName: operatorName,
      itemId: itemId,
      itemName: itemName || `Item ${itemId}`,
      machineSerial: machineSerial,
      machineName: machineName,
      date: dateStr,
      dateObj: dateObj,

      // ✅ FIX: Remove workedTimeMs (ambiguous), keep only time-credit (unambiguous)
      // Time metrics (in milliseconds)
      totalTimeCreditMs: timeCreditMs,

      // Count metrics (rounded)
      totalCounts: Math.round(totalCounts),
      totalMisfeeds: Math.round(totalMisfeeds),
      
      // Additional item-specific metrics
      itemStandard: itemStandard,
      
      // Data provenance (for debugging hybrid merges)
      source: source,
      
      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    logError(`Error building operator-item daily total for operator ${operatorId} and item ${itemId}`, { error: error.message, stack: error.stack, operatorId, itemId });
    return null;
  }
}

/**
 * Upserts daily totals to cache collection
 * ✅ FIX: Now uses $set for ALL entity types to prevent double-counting
 * Reason: Cache updates run every 30 seconds, so $inc would accumulate incorrectly
 * Instead, we recalculate totals from scratch each time
 * @param {Object} db - MongoDB database instance
 * @param {Array} dailyTotals - Array of daily total records to upsert
 * @param {String} collectionName - Collection name (default: 'totals-daily')
 */
async function upsertDailyTotalsToCache(db, dailyTotals, collectionName = 'totals-daily') {
  try {
    if (!dailyTotals || dailyTotals.length === 0) {
      logWarn(`[${new Date().toISOString()}] ⚠️ No daily totals to upsert`);
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const cacheCollection = db.collection(collectionName);

    logInfo(`[${new Date().toISOString()}] 🔄 Upserting ${dailyTotals.length} records to ${collectionName}...`);

    // ✅ FIX: Use $set for ALL entity types (no more $inc)
    // Prepare bulk operations for upsert
    const ops = dailyTotals.map(total => {
      return {
        updateOne: {
          filter: { _id: total._id },
          update: {
            $set: total  // ← SIMPLE: Just replace the entire document
          },
          upsert: true
        }
      };
    });

    // Execute bulk write
    const result = await cacheCollection.bulkWrite(ops, { ordered: false });
    
    logInfo(`[${new Date().toISOString()}] ✅ Upserted ${result.upsertedCount} new, modified ${result.modifiedCount} existing records`);
    
    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    logError(`[${new Date().toISOString()}] ❌ Error upserting daily totals to cache`, { error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Recalculates and updates all cache totals for a machine using in-memory session data
 * This is the main method called after session updates
 * @param {Object} options
 * @param {Object} options.db - MongoDB database instance
 * @param {Number} options.machineSerial - Machine serial number
 * @param {String} options.machineName - Machine name
 * @param {Array} options.machineSessions - In-memory machine sessions array
 * @param {Array} options.faultSessions - In-memory fault sessions array
 * @param {Map} options.operatorSessionsMap - Map of operatorId -> session array
 * @param {Map} options.itemSessionsMap - Map of itemId -> session array
 * @param {Date} options.queryStart - Start of day (midnight)
 * @param {Date} options.queryEnd - Current time
 */
async function recalculateAndUpdateCache({
  db,
  machineSerial,
  machineName,
  machineSessions,
  faultSessions,
  operatorSessionsMap,
  itemSessionsMap,
  queryStart,
  queryEnd
}) {
  try {
    logInfo(`[${new Date().toISOString()}] 🔧 Recalculating cache for machine ${machineSerial} using ${machineSessions.length} machine sessions, ${operatorSessionsMap.size} operators, ${itemSessionsMap.size} items`);

    const dailyTotals = [];

    // 1. Build machine daily total
    const machineDailyTotal = buildMachineDailyTotal({
      machineSerial,
      machineName,
      machineSessions,
      faultSessions,
      queryStart,
      queryEnd
    });
    
    if (machineDailyTotal) {
      dailyTotals.push(machineDailyTotal);
      logInfo(`[${new Date().toISOString()}] ✅ Built machine total: ${machineDailyTotal.totalCounts} counts, ${machineDailyTotal.runtimeMs}ms runtime`);
    }

    // 2. Build operator-machine daily totals
    for (const [operatorId, sessions] of operatorSessionsMap.entries()) {
      if (sessions.length === 0) continue;
      
      const operatorName = sessions[0]?.operator?.name || `Operator ${operatorId}`;
      
      const operatorDailyTotal = buildOperatorMachineDailyTotal({
        operatorId,
        operatorName,
        machineSerial,
        machineName,
        operatorSessions: sessions,
        queryStart,
        queryEnd
      });
      
      if (operatorDailyTotal) {
        dailyTotals.push(operatorDailyTotal);
      }
    }

    // 3. Build item-machine daily totals
    for (const [itemId, sessions] of itemSessionsMap.entries()) {
      if (sessions.length === 0) continue;
      
      const itemName = sessions[0]?.item?.name || `Item ${itemId}`;
      
      const itemDailyTotal = buildItemMachineDailyTotal({
        itemId,
        itemName,
        machineSerial,
        machineName,
        itemSessions: sessions,
        queryStart,
        queryEnd
      });
      
      if (itemDailyTotal) {
        dailyTotals.push(itemDailyTotal);
      }
    }

    // 3b. Build plant-wide item daily totals (aggregated across machines via atomic operations)
    for (const [itemId, sessions] of itemSessionsMap.entries()) {
      if (sessions.length === 0) continue;
      
      const itemName = sessions[0]?.item?.name || `Item ${itemId}`;
      const itemStandard = sessions[0]?.item?.standard || 0;
      
      const itemTotal = buildItemDailyTotal({
        itemId,
        itemName,
        itemStandard,
        machineSerial,
        itemSessions: sessions,
        queryStart,
        queryEnd,
        source: 'simulator'
      });
      
      if (itemTotal) {
        dailyTotals.push(itemTotal);
      }
    }

    // 4. Build operator-item daily totals
    // For each operator, extract unique items they worked on and build operator-item records
    let operatorItemCount = 0;
    for (const [operatorId, sessions] of operatorSessionsMap.entries()) {
      if (sessions.length === 0) continue;
      
      const operatorName = sessions[0]?.operator?.name || `Operator ${operatorId}`;
      
      // Collect all unique items this operator worked on
      const uniqueItems = new Map(); // itemId -> itemName
      
      for (const session of sessions) {
        if (!session.items || session.items.length === 0) continue;
        
        for (const item of session.items) {
          if (!uniqueItems.has(item.id)) {
            uniqueItems.set(item.id, item.name || `Item ${item.id}`);
          }
        }
      }
      
      // Build operator-item record for each unique item
      for (const [itemId, itemName] of uniqueItems.entries()) {
        const operatorItemTotal = buildOperatorItemDailyTotal({
          operatorId,
          operatorName,
          itemId,
          itemName,
          machineSerial,
          machineName,
          operatorSessions: sessions,
          queryStart,
          queryEnd,
          source: 'simulator'
        });
        
        if (operatorItemTotal) {
          dailyTotals.push(operatorItemTotal);
          operatorItemCount++;
        }
      }
    }
    
    logInfo(`[${new Date().toISOString()}] 📊 Built ${operatorItemCount} operator-item totals`);

    // 5. Upsert all daily totals to cache in one batch
    const result = await upsertDailyTotalsToCache(db, dailyTotals);
    
    return {
      success: true,
      recordsUpdated: result.upsertedCount + result.modifiedCount,
      machineTotals: 1,
      operatorTotals: operatorSessionsMap.size,
      machineItemTotals: itemSessionsMap.size,
      itemTotals: itemSessionsMap.size, // Plant-wide item totals
      operatorItemTotals: operatorItemCount
    };
  } catch (error) {
    logError('Error recalculating and updating cache', { error: error.message, stack: error.stack });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Upserts hourly totals to cache collection
 */
async function upsertHourlyTotalsToCache(db, hourlyTotals, collectionName = 'hourly-totals') {
  try {
    if (!hourlyTotals || hourlyTotals.length === 0) {
      logWarn(`[${new Date().toISOString()}] ⚠️ No hourly totals to upsert`);
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const cacheCollection = db.collection(collectionName);
    logInfo(`[${new Date().toISOString()}] 🔄 Upserting ${hourlyTotals.length} records to ${collectionName}...`);

    const ops = hourlyTotals.map(total => ({
      updateOne: {
        filter: { _id: total._id },
        update: { $set: total },
        upsert: true
      }
    }));

    const result = await cacheCollection.bulkWrite(ops, { ordered: false });
    logInfo(`[${new Date().toISOString()}] ✅ Upserted ${result.upsertedCount} new, modified ${result.modifiedCount} existing hourly records`);

    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    logError(`[${new Date().toISOString()}] ❌ Error upserting hourly totals to cache`, { error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Recalculates and updates all hourly cache totals for a machine using in-memory session data
 * ✅ FIX: Now builds totals for ALL hours from todayStart to now (not just current hour)
 * This ensures all hourly totals are calculated, not just the current hour
 */
async function recalculateAndUpdateHourlyCache({
  db,
  machineSerial,
  machineName,
  machineSessions,
  faultSessions,
  operatorSessionsMap,
  itemSessionsMap,
  todayStart,
  queryEnd
}) {
  try {
    logInfo(`[${new Date().toISOString()}] 🔧 Recalculating hourly cache for machine ${machineSerial} from ${todayStart.toISOString()} to ${queryEnd.toISOString()}`);

    const hourlyTotals = [];

    // ✅ FIX: Loop through ALL hours from todayStart to now
    // This ensures we build hourly totals for every hour that has occurred today
    let hourStart = DateTime.fromJSDate(todayStart, { zone: SYSTEM_TIMEZONE }).startOf('hour');
    const endTime = DateTime.fromJSDate(queryEnd, { zone: SYSTEM_TIMEZONE });

    // Safety check: prevent infinite loops (max 24 hours per day)
    const maxHours = 24;
    let hourCount = 0;

    // Build totals for each hour from todayStart to now
    while (hourStart <= endTime && hourCount < maxHours) {
      const hourStartDate = hourStart.toJSDate();
      // For each hour, queryEnd is either the end of that hour or the current time (if it's the current hour)
      const hourEndDate = hourStart.plus({ hours: 1 }).toJSDate();
      const hourQueryEnd = hourEndDate > queryEnd ? queryEnd : hourEndDate;

      // 1. Build machine hourly total for this hour
      const machineHourlyTotal = buildMachineHourlyTotal({
        machineSerial,
        machineName,
        machineSessions,
        faultSessions,
        queryStart: hourStartDate,
        queryEnd: hourQueryEnd
      });

      if (machineHourlyTotal) {
        hourlyTotals.push(machineHourlyTotal);
      }

      // 2. Build operator-machine hourly totals for this hour
      for (const [operatorId, sessions] of operatorSessionsMap.entries()) {
        if (sessions.length === 0) continue;

        const operatorName = sessions[0]?.operator?.name || `Operator ${operatorId}`;

        const operatorHourlyTotal = buildOperatorMachineHourlyTotal({
          operatorId,
          operatorName,
          machineSerial,
          machineName,
          operatorSessions: sessions,
          queryStart: hourStartDate,
          queryEnd: hourQueryEnd
        });

        if (operatorHourlyTotal) {
          hourlyTotals.push(operatorHourlyTotal);
        }
      }

      // 3. Build item-machine hourly totals for this hour
      for (const [itemId, sessions] of itemSessionsMap.entries()) {
        if (sessions.length === 0) continue;

        const itemName = sessions[0]?.item?.name || `Item ${itemId}`;

        const itemHourlyTotal = buildItemMachineHourlyTotal({
          itemId,
          itemName,
          machineSerial,
          machineName,
          itemSessions: sessions,
          queryStart: hourStartDate,
          queryEnd: hourQueryEnd
        });

        if (itemHourlyTotal) {
          hourlyTotals.push(itemHourlyTotal);
        }
      }

      // 4. Build plant-wide item hourly totals for this hour
      for (const [itemId, sessions] of itemSessionsMap.entries()) {
        if (sessions.length === 0) continue;

        const itemName = sessions[0]?.item?.name || `Item ${itemId}`;
        const itemStandard = sessions[0]?.item?.standard || 0;

        const itemTotal = buildItemHourlyTotal({
          itemId,
          itemName,
          itemStandard,
          machineSerial,
          itemSessions: sessions,
          queryStart: hourStartDate,
          queryEnd: hourQueryEnd,
          source: 'simulator'
        });

        if (itemTotal) {
          hourlyTotals.push(itemTotal);
        }
      }

      // 5. Build operator-item hourly totals for this hour
      for (const [operatorId, sessions] of operatorSessionsMap.entries()) {
        if (sessions.length === 0) continue;

        const operatorName = sessions[0]?.operator?.name || `Operator ${operatorId}`;

        const uniqueItems = new Map();
        for (const session of sessions) {
          if (!session.items || session.items.length === 0) continue;
          for (const item of session.items) {
            if (!uniqueItems.has(item.id)) {
              uniqueItems.set(item.id, item.name || `Item ${item.id}`);
            }
          }
        }

        for (const [itemId, itemName] of uniqueItems.entries()) {
          const operatorItemTotal = buildOperatorItemHourlyTotal({
            operatorId,
            operatorName,
            itemId,
            itemName,
            machineSerial,
            machineName,
            operatorSessions: sessions,
            queryStart: hourStartDate,
            queryEnd: hourQueryEnd,
            source: 'simulator'
          });

          if (operatorItemTotal) {
            hourlyTotals.push(operatorItemTotal);
          }
        }
      }

      // Move to next hour
      hourStart = hourStart.plus({ hours: 1 });
      hourCount++;
    }

    if (hourCount >= maxHours) {
      logWarn(`[${new Date().toISOString()}] ⚠️ Hourly cache loop hit max hours limit (${maxHours}), may have incomplete totals`);
    }

    logInfo(`[${new Date().toISOString()}] 📊 Built ${hourlyTotals.length} hourly total records across ${Math.ceil((queryEnd - todayStart) / (1000 * 60 * 60))} hours`);

    // 6. Upsert all hourly totals to cache in one batch
    const result = await upsertHourlyTotalsToCache(db, hourlyTotals);

    return {
      success: true,
      recordsUpdated: result.upsertedCount + result.modifiedCount,
      hoursProcessed: Math.ceil((queryEnd - todayStart) / (1000 * 60 * 60)),
      totalRecords: hourlyTotals.length
    };
  } catch (error) {
    logError('Error recalculating and updating hourly cache', { error: error.message, stack: error.stack });
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  buildMachineDailyTotal,
  buildOperatorMachineDailyTotal,
  buildItemMachineDailyTotal,
  buildItemDailyTotal,
  buildOperatorItemDailyTotal,
  upsertDailyTotalsToCache,
  recalculateAndUpdateCache,
  buildMachineHourlyTotal,
  buildOperatorMachineHourlyTotal,
  buildItemMachineHourlyTotal,
  buildItemHourlyTotal,
  buildOperatorItemHourlyTotal,
  upsertHourlyTotalsToCache,
  recalculateAndUpdateHourlyCache,
  formatDuration,
  overlap,
  safe
};

