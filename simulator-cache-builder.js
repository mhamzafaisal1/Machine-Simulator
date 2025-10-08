// simulator-cache-builder.js - Real-time cache building logic for simulator
// This module builds and updates cache totals using in-memory session data
// Eliminates need for database polling by calculating on-demand

const { DateTime } = require('luxon');

const SYSTEM_TIMEZONE = 'America/Chicago';

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
      runtimeSec += safe(s.runtime) * factor;
      workedTimeSec += safe(s.workTime) * factor;
      timeCreditSec += safe(s.totalTimeCredit) * factor;
      totalCounts += safe(s.totalCount) * factor;
      totalMisfeeds += safe(s.misfeedCount) * factor;
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
    
    // Create date string for today
    const dateStr = queryStart.toISOString().split('T')[0];

    return {
      _id: `machine-${machineSerial}-${dateStr}`,
      entityType: 'machine',
      machineSerial: machineSerial,
      machineName: machineName,
      date: dateStr,
      dateObj: new Date(dateStr + 'T00:00:00.000Z'),
      
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
    console.error(`Error building machine daily total for machine ${machineSerial}:`, error);
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
    // Calculate totals using overlap logic
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of operatorSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);
      workedTimeSec += safe(s.workTime) * factor;
      timeCreditSec += safe(s.totalTimeCredit) * factor;
      totalCounts += safe(s.totalCount) * factor;
      totalMisfeeds += safe(s.misfeedCount) * factor;
    }

    // For operators, we don't track separate fault sessions
    const windowMs = queryEnd - queryStart;
    const runtimeMs = Math.round(workedTimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0; // Operators don't have separate fault tracking
    const pausedTimeMs = Math.max(0, windowMs - runtimeMs);
    
    // Create date string
    const dateStr = queryStart.toISOString().split('T')[0];

    return {
      _id: `operator-machine-${operatorId}-${machineSerial}-${dateStr}`,
      entityType: 'operator-machine',
      operatorId: operatorId,
      operatorName: operatorName,
      machineSerial: machineSerial,
      machineName: machineName,
      date: dateStr,
      dateObj: new Date(dateStr + 'T00:00:00.000Z'),
      
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
    console.error(`Error building operator daily total for operator ${operatorId} on machine ${machineSerial}:`, error);
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
    // Calculate totals using overlap logic
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);
      workedTimeSec += safe(s.workTime) * factor;
      timeCreditSec += safe(s.totalTimeCredit) * factor;
      totalCounts += safe(s.totalCount) * factor;
      totalMisfeeds += safe(s.misfeedCount) * factor;
      
      // Get item standard from first session
      if (!itemStandard && s.item?.standard) {
        itemStandard = s.item.standard;
      }
    }

    // Calculate window and paused time
    const windowMs = queryEnd - queryStart;
    const runtimeMs = Math.round(workedTimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0; // Items don't track separate faults
    const pausedTimeMs = Math.max(0, windowMs - runtimeMs);
    
    // Create date string
    const dateStr = queryStart.toISOString().split('T')[0];

    return {
      _id: `machine-item-${machineSerial}-${itemId}-${dateStr}`,
      entityType: 'machine-item',
      itemId: itemId,
      itemName: itemName || `Item ${itemId}`,
      machineSerial: machineSerial,
      machineName: machineName || `Serial ${machineSerial}`,
      date: dateStr,
      dateObj: new Date(dateStr + 'T00:00:00.000Z'),
      
      // Time metrics (in milliseconds)
      runtimeMs: runtimeMs,
      faultTimeMs: faultTimeMs,
      workedTimeMs: workedTimeMs,
      pausedTimeMs: pausedTimeMs,
      
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
    console.error(`Error building item-machine daily total for item ${itemId} on machine ${machineSerial}:`, error);
    return null;
  }
}

/**
 * Upserts daily totals to cache collection
 * @param {Object} db - MongoDB database instance
 * @param {Array} dailyTotals - Array of daily total records to upsert
 * @param {String} collectionName - Collection name (default: 'totals-daily')
 */
async function upsertDailyTotalsToCache(db, dailyTotals, collectionName = 'totals-daily') {
  try {
    if (!dailyTotals || dailyTotals.length === 0) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const cacheCollection = db.collection(collectionName);
    
    // Prepare bulk operations for upsert
    const ops = dailyTotals.map(total => ({
      updateOne: {
        filter: { _id: total._id },
        update: { 
          $set: total
        },
        upsert: true
      }
    }));

    // Execute bulk write
    const result = await cacheCollection.bulkWrite(ops, { ordered: false });
    
    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    console.error('Error upserting daily totals to cache:', error);
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

    // 4. Upsert all daily totals to cache in one batch
    const result = await upsertDailyTotalsToCache(db, dailyTotals);
    
    return {
      success: true,
      recordsUpdated: result.upsertedCount + result.modifiedCount,
      machineTotals: 1,
      operatorTotals: operatorSessionsMap.size,
      itemTotals: itemSessionsMap.size
    };
  } catch (error) {
    console.error('Error recalculating and updating cache:', error);
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
  upsertDailyTotalsToCache,
  recalculateAndUpdateCache,
  formatDuration,
  overlap,
  safe
};

