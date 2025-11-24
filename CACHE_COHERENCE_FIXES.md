# Cache Coherence Fixes - Implementation Guide

This document provides the exact code changes needed to fix all 7 coherence issues identified in `CACHE_COHERENCE_ANALYSIS.md`.

---

## Fix #1: SPF Machine Active Stations Resolution

**File:** `simulator-cache-builder.js`
**Lines:** 44-57
**Priority:** 🔴 CRITICAL - Affects all calculations

### Current Code (WRONG):
```javascript
function resolveActiveStations(s) {
  if (Number.isFinite(s.activeStations) && s.activeStations > 0) return s.activeStations;
  // primary: count real operators if present
  if (Array.isArray(s.operators)) {
    const n = s.operators.filter(op => op && op.id !== -1).length;
    if (n > 0) return n;
  }
  // fallback: program.stations set by simulator (SPF should be 1; multi-lane machines >1)
  if (Number.isFinite(s.program?.stations) && s.program.stations > 0) return s.program.stations;
  // fallback: machine.lanes from machine config
  if (Number.isFinite(s.machine?.lanes) && s.machine.lanes > 0) return s.machine.lanes;
  // last resort
  return 1;
}
```

### Fixed Code:
```javascript
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
```

### Why This Fix Is Critical:
- SPF machines have `machine.lanes = 4` (4 physical lanes)
- But only **1 operator** controls all 4 lanes → `activeStations = 1`
- Old code fell back to `program.stations = 4`, causing **4x inflation** of workTime
- New code trusts the operator count (most reliable source)

---

## Fix #2: Operator-Machine Runtime Calculation

**File:** `simulator-cache-builder.js`
**Lines:** 256-283
**Priority:** 🟡 HIGH - Required for validation

### Current Code (WRONG):
```javascript
function buildOperatorMachineDailyTotal({ operatorId, operatorName, machineSerial, machineName, operatorSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of operatorSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      // ✅ Use normalizers to handle both computed metrics and raw schema-adapted format
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    // For operators, we don't track separate fault sessions
    const windowMs = queryEnd - queryStart;
    const runtimeMs = Math.round(workedTimeSec * 1000);  // ← WRONG: Using workedTime as runtime
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0; // Operators don't have separate fault tracking
    const pausedTimeMs = Math.max(0, windowMs - runtimeMs);  // ← WRONG: Using 24-hour window
```

### Fixed Code:
```javascript
function buildOperatorMachineDailyTotal({ operatorId, operatorName, machineSerial, machineName, operatorSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
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
```

### What Changed:
1. Added `runtimeSec` tracking (actual session duration)
2. Changed `runtimeMs` to use `runtimeSec` instead of `workedTimeSec`
3. Changed `pausedTimeMs` to use `runtimeMs` as base instead of `windowMs`

### Impact:
- Operator runtime now matches actual session duration
- Paused time now represents idle time within sessions (not 24-hour gaps)
- Enables validation: `machine.workedTimeMs = sum(operator.workedTimeMs)`

---

## Fix #3: Item-Machine Active Stations Tracking

**File:** `simulator-cache-builder.js`
**Lines:** 336-410
**Priority:** 🟡 MEDIUM - Needed for validation

### Current Code (MISSING FIELD):
```javascript
function buildItemMachineDailyTotal({ itemId, itemName, machineSerial, machineName, itemSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;
    // ← MISSING: No activeStations tracking

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const workTime = getWorkedSeconds(s);
      // ... rest of loop
    }

    // ... later in return:
    return {
      _id: `machine-item-${machineSerial}-${itemId}-${dateStr}`,
      entityType: 'machine-item',
      // ... other fields
      // ← MISSING: No activeStations field
```

### Fixed Code:
```javascript
function buildItemMachineDailyTotal({ itemId, itemName, machineSerial, machineName, itemSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;
    let maxActiveStations = 0;  // ← ADD: Track max active stations

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      // ← ADD: Track maximum active stations for this item
      const sessionStations = resolveActiveStations(s);
      if (sessionStations > maxActiveStations) {
        maxActiveStations = sessionStations;
      }

      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;

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

    // Create date string and ensure timezone consistency
    const dateStr = queryStart.toISOString().split('T')[0];
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
```

### Why This Matters:
- For SPF: 1 operator runs 4 items → each item shows `activeStations: 1`
- For multi-lane: 3 operators run 1 item → item shows `activeStations: 3`
- Enables validation of workTime consistency across entity types

---

## Fix #4: Plant-Wide Item Totals (Atomic Operations)

**File:** `simulator-cache-builder.js`
**Lines:** 612-683
**Priority:** 🔴 CRITICAL - Prevents double-counting

### Current Code (DANGEROUS):
```javascript
async function upsertDailyTotalsToCache(db, dailyTotals, collectionName = 'totals-daily') {
  try {
    // ... setup code

    // Prepare bulk operations for upsert
    const ops = dailyTotals.map(total => {
      // For 'item' entityType, use atomic $inc operations to aggregate across machines
      if (total.entityType === 'item') {
        return {
          updateOne: {
            filter: { _id: total._id },
            update: {
              $inc: {  // ← DANGEROUS: Accumulates on every cache update
                runtimeMs: total.runtimeMs || 0,
                workedTimeMs: total.workedTimeMs || 0,
                totalTimeCreditMs: total.totalTimeCreditMs || 0,
                totalCounts: total.totalCounts || 0,
                totalMisfeeds: total.totalMisfeeds || 0
              },
              $set: {
                // ... metadata fields
              },
              $addToSet: {
                contributingMachines: total.contributingMachine
              }
            },
            upsert: true
          }
        };
      } else {
        // For other entity types, use regular $set
        return { /* ... */ };
      }
    });
```

### Fixed Code (Option A - Recommended):
```javascript
async function upsertDailyTotalsToCache(db, dailyTotals, collectionName = 'totals-daily') {
  try {
    if (!dailyTotals || dailyTotals.length === 0) {
      console.warn(`[${new Date().toISOString()}] ⚠️ No daily totals to upsert`);
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const cacheCollection = db.collection(collectionName);

    console.log(`[${new Date().toISOString()}] 🔄 Upserting ${dailyTotals.length} records to ${collectionName}...`);

    // Prepare bulk operations for upsert
    const ops = dailyTotals.map(total => {
      // ✅ FIX: Use $set for ALL entity types (no more $inc)
      // Reason: Cache updates run every 30 seconds, so $inc would accumulate incorrectly
      // Instead, we recalculate totals from scratch each time
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

    console.log(`[${new Date().toISOString()}] ✅ Upserted ${result.upsertedCount} new, modified ${result.modifiedCount} existing records`);

    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error upserting daily totals to cache:`, error);
    throw error;
  }
}
```

### Alternative Fix (Option B - Architectural Change):
**Remove plant-wide item totals from simulator entirely.** Instead, create a separate daily aggregation service:

```javascript
// NEW FILE: daily-aggregator.js
// Runs once per day at 11:59pm to build plant-wide totals

async function aggregatePlantWideItemTotals(db, date) {
  const dateStr = date.toISOString().split('T')[0];

  // Aggregate machine-item totals to build plant-wide totals
  const pipeline = [
    { $match: { entityType: 'machine-item', date: dateStr } },
    { $group: {
        _id: '$itemId',
        itemName: { $first: '$itemName' },
        itemStandard: { $first: '$itemStandard' },
        runtimeMs: { $sum: '$runtimeMs' },
        workedTimeMs: { $sum: '$workedTimeMs' },
        totalTimeCreditMs: { $sum: '$totalTimeCreditMs' },
        totalCounts: { $sum: '$totalCounts' },
        totalMisfeeds: { $sum: '$totalMisfeeds' },
        contributingMachines: { $addToSet: '$machineSerial' }
    }},
    { $project: {
        _id: { $concat: ['item-', { $toString: '$_id' }, '-', dateStr] },
        entityType: { $literal: 'item' },
        itemId: '$_id',
        itemName: 1,
        itemStandard: 1,
        date: { $literal: dateStr },
        dateObj: { $literal: new Date(dateStr) },
        runtimeMs: 1,
        workedTimeMs: 1,
        totalTimeCreditMs: 1,
        totalCounts: 1,
        totalMisfeeds: 1,
        contributingMachines: 1,
        source: { $literal: 'aggregator' },
        lastUpdated: { $literal: new Date() },
        version: { $literal: '1.0.0' }
    }}
  ];

  const results = await db.collection('totals-daily').aggregate(pipeline).toArray();

  // Upsert aggregated totals
  const ops = results.map(total => ({
    updateOne: {
      filter: { _id: total._id },
      update: { $set: total },
      upsert: true
    }
  }));

  await db.collection('totals-daily').bulkWrite(ops);
  console.log(`✅ Aggregated ${results.length} plant-wide item totals for ${dateStr}`);
}
```

### Recommendation:
- **Short-term:** Use Option A ($set instead of $inc)
- **Long-term:** Use Option B (separate aggregation service)

---

## Fix #5: Operator-Item Time Distribution

**File:** `simulator-cache-builder.js`
**Lines:** 509-601
**Priority:** 🟡 MEDIUM - Policy decision

### Current Code (AMBIGUOUS):
```javascript
function buildOperatorItemDailyTotal({ operatorId, operatorName, itemId, itemName, machineSerial, machineName, operatorSessions, queryStart, queryEnd, source = 'simulator' }) {
  try {
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;

    for (const s of operatorSessions) {
      // ... item matching logic

      // ← PROBLEM: Proportional time distribution
      const totalCountInSession = getCountsValid(s);
      if (totalCountInSession > 0) {
        const itemProportion = countForItem / totalCountInSession;
        const workTime = getWorkedSeconds(s);
        workedTimeSec += safe(workTime) * factor * itemProportion;  // ← Assumes sequential work
      }

      // ... rest of loop
    }

    // Convert to milliseconds
    const workedTimeMs = Math.round(workedTimeSec * 1000);
```

### Fixed Code (Approach A - Time-Credit Only, Recommended):
```javascript
function buildOperatorItemDailyTotal({ operatorId, operatorName, itemId, itemName, machineSerial, machineName, operatorSessions, queryStart, queryEnd, source = 'simulator' }) {
  try {
    // ✅ FIX: Don't track workedTime for operator-item combos (ambiguous for SPF)
    // Only track time-credit (unambiguous metric)
    let timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;

    for (const s of operatorSessions) {
      const itemIndex = s.items?.findIndex(it => it.id === itemId);
      if (itemIndex === -1 || itemIndex === undefined) continue;

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

      // Data provenance
      source: source,

      // Metadata
      lastUpdated: DateTime.now().setZone(SYSTEM_TIMEZONE).toJSDate(),
      timeRange: { start: queryStart, end: queryEnd },
      version: '1.0.0'
    };
  } catch (error) {
    console.error(`Error building operator-item daily total for operator ${operatorId} and item ${itemId}:`, error);
    return null;
  }
}
```

### Alternative Fix (Approach B - Full Time Attribution):
```javascript
// Give full credit to each item (don't proportion time)
// This is more accurate for SPF where operator works on all items simultaneously

for (const s of operatorSessions) {
  // ... item matching logic

  // ✅ FIX: Don't proportion time - give full session time to this item
  const workTime = getWorkedSeconds(s);
  workedTimeSec += safe(workTime) * factor;  // ← Remove itemProportion

  // ... rest of loop
}
```

### Recommendation:
Use **Approach A** (Time-Credit Only). Here's why:
- `workedTimeMs` is ambiguous for operator-item combos
- For SPF: Does 1 hour on machine = 1 hour on each item, or 0.25 hours per item?
- `totalTimeCreditMs` is unambiguous: It's based on count × standard (clear definition)
- Simpler to validate: `sum(operatorItem.timeCredit) <= operator.timeCredit` (always true)

---

## Fix #6: Fault Time in Operator Totals

**File:** `simulator-cache-builder.js`
**Lines:** 256-316
**Priority:** 🟢 LOW - Nice to have

### Current Code (INCONSISTENT):
```javascript
function buildOperatorMachineDailyTotal({ operatorId, operatorName, machineSerial, machineName, operatorSessions, queryStart, queryEnd }) {
  try {
    // ... calculation logic

    const faultTimeMs = 0; // ← HARDCODED: Operators don't have separate fault tracking
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);
```

### Fixed Code (Option A - Add Fault Tracking):
```javascript
function buildOperatorMachineDailyTotal({
  operatorId,
  operatorName,
  machineSerial,
  machineName,
  operatorSessions,
  faultSessions,  // ← ADD: Pass fault sessions
  queryStart,
  queryEnd
}) {
  try {
    let runtimeSec = 0;
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let faultTimeSec = 0;  // ← ADD: Track fault time

    for (const s of operatorSessions) {
      // ... existing calculation logic
    }

    // ← ADD: Calculate fault time for this operator
    for (const fs of faultSessions) {
      // Check if this operator was present during the fault
      const operatorInFault = fs.operators?.some(op => op.id === operatorId);
      if (!operatorInFault) continue;

      // Calculate overlap between fault session and query window
      const { ovSec } = overlap(fs.timestamps?.start, fs.timestamps?.end, queryStart, queryEnd);
      faultTimeSec += ovSec;
    }

    const runtimeMs = Math.round(runtimeSec * 1000);
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = Math.round(faultTimeSec * 1000);  // ← FIX: Use calculated value
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs - faultTimeMs);  // ← FIX: Subtract fault time
```

### Update recalculateAndUpdateCache to pass faultSessions:
```javascript
// In recalculateAndUpdateCache function (line 731-750):

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
    faultSessions: faultSessions,  // ← ADD: Pass fault sessions
    queryStart,
    queryEnd
  });

  if (operatorDailyTotal) {
    dailyTotals.push(operatorDailyTotal);
  }
}
```

### Alternative (Option B - Remove Paused Time):
If fault time is machine-level only (not operator-level), then remove `pausedTimeMs` from operator totals entirely.

### Recommendation:
Use **Option A** (Add Fault Tracking). This makes operator totals complete:
- `runtimeMs` = total session time
- `workedTimeMs` = productive time
- `faultTimeMs` = time machine was faulted (operator present but not working)
- `pausedTimeMs` = idle time (operator present, machine not faulted, but not producing)

---

## Fix #7: Paused Time Calculation Logic

**File:** `simulator-cache-builder.js`
**Lines:** Multiple locations
**Priority:** 🟡 MEDIUM - Affects validation

### Current Code (WRONG):
```javascript
// Operator totals (line 283):
const windowMs = queryEnd - queryStart;  // ← 24 hours
const runtimeMs = Math.round(runtimeSec * 1000);
const pausedTimeMs = Math.max(0, windowMs - runtimeMs);  // ← Uses 24-hour window!

// Item totals (line 369):
const windowMs = queryEnd - queryStart;  // ← 24 hours
const runtimeMs = Math.round(workedTimeSec * 1000);
const pausedTimeMs = Math.max(0, windowMs - runtimeMs);  // ← Uses 24-hour window!
```

### Fixed Code:
```javascript
// For OPERATORS (already fixed in Fix #2):
const runtimeMs = Math.round(runtimeSec * 1000);
const workedTimeMs = Math.round(workedTimeSec * 1000);
const faultTimeMs = Math.round(faultTimeSec * 1000);
const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs - faultTimeMs);  // ← Base on runtime, not window

// For ITEMS:
const runtimeMs = Math.round(totalRuntimeSec * 1000);  // ← Need to track actual runtime
const workedTimeMs = Math.round(workedTimeSec * 1000);
const timeCreditMs = Math.round(timeCreditSec * 1000);
const faultTimeMs = 0; // Items don't track separate faults
const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);  // ← Base on runtime, not window
```

### Update buildItemMachineDailyTotal:
```javascript
function buildItemMachineDailyTotal({ itemId, itemName, machineSerial, machineName, itemSessions, queryStart, queryEnd }) {
  try {
    let totalRuntimeSec = 0;  // ← ADD: Track actual session runtime
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;
    let maxActiveStations = 0;

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const runtime = getRuntimeSeconds(s);    // ← ADD: Get session duration
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      const sessionStations = resolveActiveStations(s);
      if (sessionStations > maxActiveStations) {
        maxActiveStations = sessionStations;
      }

      totalRuntimeSec += safe(runtime) * factor;  // ← ADD: Accumulate runtime
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;

      if (!itemStandard && s.item?.standard) {
        itemStandard = s.item.standard;
      }
    }

    // Calculate times correctly
    const runtimeMs = Math.round(totalRuntimeSec * 1000);  // ← FIX: Use actual runtime
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    const faultTimeMs = 0; // Items don't track separate faults
    const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs);  // ← FIX: Use runtime as base
```

### What Changed:
1. Added `totalRuntimeSec` tracking for items
2. Changed `pausedTimeMs` base from `windowMs` to `runtimeMs`
3. For operators: `pausedTimeMs = runtimeMs - workedTimeMs - faultTimeMs`
4. For items: `pausedTimeMs = runtimeMs - workedTimeMs`

### Impact:
- Paused time now represents idle time within sessions (not 24-hour gaps)
- Operator/item records no longer show 20+ hours of "paused time" when they only worked 2 hours
- Time balance equation now holds: `runtimeMs = workedTimeMs + faultTimeMs + pausedTimeMs`

---

## Implementation Checklist

### Phase 1: Critical Fixes (Do First)
- [ ] Fix #1: SPF activeStations resolution
- [ ] Fix #4: Plant-wide item totals (change $inc to $set)
- [ ] Test SPF machines show `activeStations: 1`

### Phase 2: High-Priority Fixes
- [ ] Fix #2: Operator runtime calculation
- [ ] Fix #7: Paused time logic
- [ ] Test: `machine.workedTimeMs = sum(operator.workedTimeMs)`

### Phase 3: Validation Improvements
- [ ] Fix #3: Item activeStations tracking
- [ ] Fix #6: Fault time in operator totals
- [ ] Test: All time balance equations

### Phase 4: Policy Decision
- [ ] Fix #5: Operator-item time distribution (choose Approach A or B)
- [ ] Document the chosen approach
- [ ] Update validation queries

---

## Testing Commands

After implementing all fixes, run these validation queries:

```javascript
// Test 1: SPF Active Stations
db['totals-daily'].find({
  entityType: 'machine',
  date: '2025-01-24',
  machineName: { $regex: /^SPF/ }
}, {
  machineName: 1,
  activeStations: 1,
  runtimeMs: 1,
  workedTimeMs: 1
});
// Expected: activeStations = 1, workedTimeMs ≈ runtimeMs

// Test 2: Machine-Operator WorkTime Balance
const machineSerial = 67798;
const date = '2025-01-24';

const machineTotal = db['totals-daily'].findOne({
  entityType: 'machine',
  machineSerial: machineSerial,
  date: date
});

const operatorTotals = db['totals-daily'].find({
  entityType: 'operator-machine',
  machineSerial: machineSerial,
  date: date
}).toArray();

const sumOperatorWorkedTime = operatorTotals.reduce((sum, op) => sum + op.workedTimeMs, 0);

console.log(`Machine workedTimeMs: ${machineTotal.workedTimeMs}`);
console.log(`Sum of operator workedTimeMs: ${sumOperatorWorkedTime}`);
console.log(`Difference: ${Math.abs(machineTotal.workedTimeMs - sumOperatorWorkedTime)}ms`);
// Expected: Difference < 1000ms (less than 1 second due to rounding)

// Test 3: Machine-Operator Counts Balance
const machineTotal = db['totals-daily'].findOne({
  entityType: 'machine',
  machineSerial: machineSerial,
  date: date
});

const operatorTotals = db['totals-daily'].find({
  entityType: 'operator-machine',
  machineSerial: machineSerial,
  date: date
}).toArray();

const sumOperatorCounts = operatorTotals.reduce((sum, op) => sum + op.totalCounts, 0);

console.log(`Machine totalCounts: ${machineTotal.totalCounts}`);
console.log(`Sum of operator totalCounts: ${sumOperatorCounts}`);
console.log(`Difference: ${machineTotal.totalCounts - sumOperatorCounts}`);
// Expected: Difference = 0

// Test 4: Time Balance Equation
db['totals-daily'].aggregate([
  { $match: { entityType: 'machine', date: '2025-01-24' } },
  { $project: {
      machineName: 1,
      runtimeMs: 1,
      workedTimeMs: 1,
      faultTimeMs: 1,
      pausedTimeMs: 1,
      // Check if: runtimeMs + faultTimeMs + pausedTimeMs adds up correctly
      calculatedTotal: { $add: ['$workedTimeMs', '$faultTimeMs', '$pausedTimeMs'] },
      difference: {
        $abs: {
          $subtract: [
            '$runtimeMs',
            { $add: ['$workedTimeMs', '$faultTimeMs', '$pausedTimeMs'] }
          ]
        }
      }
  }},
  { $match: { difference: { $gt: 1000 } } }  // Show machines with >1 second difference
]);
// Expected: No results (all machines balance correctly)
```

---

## Summary

**Total Fixes:** 7
- **Critical (Must Do):** 2 (Fix #1, #4)
- **High Priority:** 2 (Fix #2, #7)
- **Medium Priority:** 2 (Fix #3, #5)
- **Low Priority:** 1 (Fix #6)

**Estimated Impact:**
- Fix #1 alone will resolve 50% of coherence issues (SPF inflation)
- Fixes #1-4 will resolve 90% of coherence issues
- Fixes #5-7 improve validation and completeness

**Implementation Time:**
- Phase 1: 2 hours (critical fixes + testing)
- Phase 2: 2 hours (high-priority fixes + validation)
- Phase 3: 3 hours (validation improvements + comprehensive testing)
- Phase 4: 1 hour (policy decision + documentation)
- **Total: 8 hours**
