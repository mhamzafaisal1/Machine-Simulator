# Cache Coherence Analysis Report
## Simulator Cache Builder - Data Integrity Issues

**Date:** 2025-01-24
**Analyzed Files:**
- `simulator-cache-builder.js` (cache totals calculation)
- `simulation-worker.js` (session management)
- `fillmore-simulator.js` (orchestration)

---

## Executive Summary

After analyzing the cache builder logic, I've identified **7 critical coherence issues** that cause inconsistencies between entity types in the `totals-daily` collection. These issues lead to:

1. ❌ **Runtime mismatches** between machines and operators
2. ❌ **Incorrect operator-item time distribution**
3. ❌ **Missing workTime/activeStations for items**
4. ❌ **Inconsistent fault time handling**
5. ❌ **SPF machines showing 1 activeStations instead of 1**
6. ❌ **Operator sessions showing runtime instead of workTime**
7. ❌ **Item counts not properly distributed across operators**

---

## Issue #1: Machine activeStations Resolution is Wrong for SPF

**Location:** `simulator-cache-builder.js:44-57` (resolveActiveStations)

**Problem:**
```javascript
function resolveActiveStations(s) {
  if (Number.isFinite(s.activeStations) && s.activeStations > 0) return s.activeStations;
  // Counts real operators (filters out -1)
  if (Array.isArray(s.operators)) {
    const n = s.operators.filter(op => op && op.id !== -1).length;
    if (n > 0) return n;
  }
  // Falls back to program.stations (which is set to machine.lanes)
  if (Number.isFinite(s.program?.stations) && s.program.stations > 0) return s.program.stations;
  ...
}
```

**Why This Is Wrong:**
- SPF machines have 4 lanes but run as **single-station machines** (1 operator controls all 4 lanes)
- The fallback to `program.stations` (which = `machine.lanes` = 4) is incorrect
- This causes SPF machines to show `activeStations: 4` instead of `activeStations: 1`
- **Result:** SPF workTime is inflated by 4x (runtime × 4 instead of runtime × 1)

**Evidence from simulation-worker.js:**
```javascript
// Line 1902: Program stations is set to machine.lanes
program: {
  stations: targetConfig.lanes,  // ← For SPF, this is 4!
}
```

**Impact:**
- Machine totals show 4x inflated workTime for SPF machines
- Operator totals show correct workTime (single operator)
- **Cache shows machine worked 4 hours but operator only worked 1 hour** → INCOHERENT

**Fix Required:**
```javascript
function resolveActiveStations(s) {
  // Primary: Use computed activeStations if available
  if (Number.isFinite(s.activeStations) && s.activeStations > 0) return s.activeStations;

  // Secondary: Count real operators (this is the CORRECT method)
  if (Array.isArray(s.operators)) {
    const n = s.operators.filter(op => op && op.id !== -1).length;
    if (n > 0) return n;
  }

  // ⚠️ DO NOT fall back to program.stations for SPF machines!
  // SPF machines have 4 lanes but 1 active station

  // Tertiary: Use machine type metadata if available
  const machineType = s.machine?.type || '';
  if (machineType.toUpperCase() === 'SPF') return 1;

  // Last resort: fall back to program.stations (for non-SPF multi-lane machines)
  if (Number.isFinite(s.program?.stations) && s.program.stations > 0) return s.program.stations;

  return 1;
}
```

---

## Issue #2: Operator-Machine Totals Use Wrong Time Metric

**Location:** `simulator-cache-builder.js:256-283` (buildOperatorMachineDailyTotal)

**Problem:**
```javascript
// Line 279: Uses workedTimeSec for BOTH runtime and workTime
const runtimeMs = Math.round(workedTimeSec * 1000);  // ← WRONG
const workedTimeMs = Math.round(workedTimeSec * 1000);
```

**Why This Is Wrong:**
- Operators should have `workTime = runtime` (single operator, not multiplied)
- But code uses `workedTimeSec` (which is already multiplied in line 271) for both fields
- **Result:** `runtimeMs` shows worked time instead of actual session runtime

**Evidence from simulator-cache-builder.js:**
```javascript
// Line 266-271: workTime is correctly calculated
const workTime = getWorkedSeconds(s);  // Already multiplied by stations in session
workedTimeSec += safe(workTime) * factor;

// Line 279: Then incorrectly used for runtime
const runtimeMs = Math.round(workedTimeSec * 1000);  // ← Should be runtimeSec!
```

**Impact:**
- Operator totals show inflated runtime
- When comparing machine runtime (correct) vs sum of operator runtimes (inflated), they don't match
- **Machine runs 2 hours, but operators show 6 hours of runtime** → INCOHERENT

**Fix Required:**
```javascript
function buildOperatorMachineDailyTotal({ operatorId, operatorName, machineSerial, machineName, operatorSessions, queryStart, queryEnd }) {
  try {
    // Calculate totals using overlap logic
    let runtimeSec = 0;      // ← ADD THIS
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;

    for (const s of operatorSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const runtime = getRuntimeSeconds(s);     // ← ADD THIS
      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      runtimeSec += safe(runtime) * factor;     // ← ADD THIS
      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;
    }

    // For operators, workTime = runtime (single operator)
    const runtimeMs = Math.round(runtimeSec * 1000);     // ← FIX THIS
    const workedTimeMs = Math.round(workedTimeSec * 1000);
    const timeCreditMs = Math.round(timeCreditSec * 1000);
    // ... rest of code
```

---

## Issue #3: Item-Machine Totals Missing activeStations Calculation

**Location:** `simulator-cache-builder.js:336-374` (buildItemMachineDailyTotal)

**Problem:**
- Item-machine totals don't calculate or store `activeStations`
- Makes it impossible to validate if item workTime aligns with machine workTime
- Item sessions should track how many operators worked on that item

**Why This Matters:**
- For SPF machines: 1 operator runs 4 different items → each item should show activeStations: 1
- For multi-lane machines: 3 operators run 1 item → item should show activeStations: 3
- Without this field, we can't validate coherence

**Fix Required:**
```javascript
function buildItemMachineDailyTotal({ itemId, itemName, machineSerial, machineName, itemSessions, queryStart, queryEnd }) {
  try {
    let workedTimeSec = 0, timeCreditSec = 0;
    let totalCounts = 0, totalMisfeeds = 0;
    let itemStandard = 0;
    let activeStations = 0;  // ← ADD THIS

    for (const s of itemSessions) {
      const { factor } = overlap(s.timestamps?.start, s.timestamps?.end, queryStart, queryEnd);

      const workTime = getWorkedSeconds(s);
      const totalTimeCredit = getTimeCreditSeconds(s);
      const totalCount = getCountsValid(s);
      const misfeedCount = getCountsMisfeed(s);

      // ← ADD THIS: Track max active stations for this item
      const sessionStations = resolveActiveStations(s);
      if (sessionStations > activeStations) activeStations = sessionStations;

      workedTimeSec += safe(workTime) * factor;
      timeCreditSec += safe(totalTimeCredit) * factor;
      totalCounts += safe(totalCount) * factor;
      totalMisfeeds += safe(misfeedCount) * factor;

      if (!itemStandard && s.item?.standard) {
        itemStandard = s.item.standard;
      }
    }

    // ... later in return object:
    return {
      // ... existing fields
      activeStations: activeStations,  // ← ADD THIS
      // ... rest of fields
    };
```

---

## Issue #4: Plant-Wide Item Totals Missing Aggregation Logic

**Location:** `simulator-cache-builder.js:425-491` (buildItemDailyTotal)

**Problem:**
- Plant-wide item totals use atomic `$inc` operations (lines 631-637)
- But they don't track which machines contributed or how to detect duplicates
- If cache update runs twice in the same interval, counts get double-counted

**Evidence:**
```javascript
// Line 626-656: Atomic increment for item totals
if (total.entityType === 'item') {
  return {
    updateOne: {
      filter: { _id: total._id },
      update: {
        $inc: {  // ← DANGEROUS: Can double-count if called twice
          totalCounts: total.totalCounts || 0,
          // ...
        },
        $addToSet: {
          contributingMachines: total.contributingMachine  // ← Only tracks machine IDs
        }
      }
    }
  };
}
```

**Why This Is Wrong:**
- Cache updates run every 30 seconds (config.cacheUpdateIntervalSeconds)
- If a session is still open, it gets counted in EVERY update
- **Result:** Counts accumulate incorrectly over time
- Example: 1 count at 10:00:30 becomes 120 counts by 10:30:30 (60 × 2 updates)

**Fix Required:**
Use `$set` instead of `$inc` for item totals, with machine contribution tracking:

```javascript
if (total.entityType === 'item') {
  return {
    updateOne: {
      filter: { _id: total._id },
      update: {
        $set: {  // ← CHANGE from $inc to $set
          runtimeMs: total.runtimeMs || 0,
          workedTimeMs: total.workedTimeMs || 0,
          totalTimeCreditMs: total.totalTimeCreditMs || 0,
          totalCounts: total.totalCounts || 0,
          totalMisfeeds: total.totalMisfeeds || 0,
          entityType: total.entityType,
          itemId: total.itemId,
          itemName: total.itemName,
          date: total.date,
          dateObj: total.dateObj,
          itemStandard: total.itemStandard,
          source: total.source,
          lastUpdated: total.lastUpdated,
          timeRange: total.timeRange,
          version: total.version
        },
        $addToSet: {
          contributingMachines: total.contributingMachine
        }
      },
      upsert: true
    }
  };
}
```

**Alternative (Better) Fix:**
Don't build plant-wide item totals in simulator at all. Build them in a separate aggregation service that runs once per day and sums up machine-item totals.

---

## Issue #5: Operator-Item Time Distribution is Incorrect

**Location:** `simulator-cache-builder.js:509-601` (buildOperatorItemDailyTotal)

**Problem:**
```javascript
// Line 543-550: Proportional time distribution
const totalCountInSession = getCountsValid(s);
if (totalCountInSession > 0) {
  const itemProportion = countForItem / totalCountInSession;
  const workTime = getWorkedSeconds(s);
  workedTimeSec += safe(workTime) * factor * itemProportion;
}
```

**Why This Is Problematic:**
- For SPF machines: 1 operator runs 4 items simultaneously
- Distributing time by count proportion assumes sequential work, not parallel
- **Reality:** Operator worked on all 4 items for the FULL runtime, not split 25% each
- **Result:** Operator-item totals show 25% time per item, but operator worked 100% time

**Two Valid Approaches:**

**Approach A: Time-Credit Only (Recommended)**
Don't track `workedTimeMs` for operator-item totals. Only track `totalTimeCreditMs`:
```javascript
return {
  _id: `operator-item-${operatorId}-${itemId}-${machineSerial}-${dateStr}`,
  entityType: 'operator-item',
  // ... identity fields

  // Remove workedTimeMs entirely (it's ambiguous for SPF)
  totalTimeCreditMs: timeCreditMs,  // ← This is unambiguous
  totalCounts: Math.round(totalCounts),
  totalMisfeeds: Math.round(totalMisfeeds),
  // ...
};
```

**Approach B: Full Time Attribution**
Give full credit to each item (don't proportion):
```javascript
// Don't proportion time - give full credit
const workTime = getWorkedSeconds(s);
workedTimeSec += safe(workTime) * factor;  // ← Remove itemProportion
```

**Recommendation:** Use Approach A. `workedTimeMs` is ambiguous for operator-item combos. Use `totalTimeCreditMs` as the canonical metric.

---

## Issue #6: Fault Time Handling is Inconsistent

**Location:**
- `simulator-cache-builder.js:175-194` (machine totals)
- `simulator-cache-builder.js:277-283` (operator totals)

**Problem:**
- Machine totals calculate fault time from fault sessions (correct)
- Operator totals set `faultTimeMs: 0` (line 282)
- But operators ARE PRESENT during faults (they're in the fault session document)

**Evidence from simulation-worker.js:**
```javascript
// Line 2060-2067: Fault sessions include operators
const doc = {
  timestamps: { start: startState.timestamp },
  items,
  operators: ops,  // ← Operators are recorded in fault session
  states: [startState],
  startState,
  machine: startState.machine,
  program: startState.program,
  activeStations: ops.length
};
```

**Why This Matters:**
- If a machine has 2 hours of fault time with 3 operators, did those operators "experience" fault time?
- Current logic says: Machine lost 2 hours, operators lost 0 hours
- **This is incoherent:** Operators were there but their time isn't reflected

**Fix Required:**
Either:
1. **Track fault time in operator totals** (allocate fault time proportionally)
2. **Remove pausedTime from operator totals** (since faults are machine-level, not operator-level)

**Recommended Fix:**
```javascript
// In buildOperatorMachineDailyTotal, add fault time tracking:
let faultTimeSec = 0;

// Query fault sessions for this operator on this machine
for (const fs of faultSessions) {  // ← Need to pass faultSessions parameter
  // Check if this operator was present during the fault
  const operatorInFault = fs.operators?.some(op => op.id === operatorId);
  if (!operatorInFault) continue;

  const { ovSec } = overlap(fs.timestamps?.start, fs.timestamps?.end, queryStart, queryEnd);
  faultTimeSec += ovSec;
}

const faultTimeMs = Math.round(faultTimeSec * 1000);
const pausedTimeMs = Math.max(0, runtimeMs - workedTimeMs - faultTimeMs);
```

---

## Issue #7: Paused Time Calculation is Wrong

**Location:** `simulator-cache-builder.js:204-206` (machine), `283` (operator), `369` (item)

**Problem:**
```javascript
// Machine totals (line 204-206):
const nonRunMs = Math.max(0, windowMs - runtimeMs);
const faultClampedMs = Math.min(faultTimeMs, nonRunMs);
const pausedTimeMs = Math.max(0, nonRunMs - faultClampedMs);

// Operator totals (line 283):
const pausedTimeMs = Math.max(0, windowMs - runtimeMs);  // ← Uses windowMs!
```

**Why This Is Wrong:**
- `pausedTimeMs` for operators uses `windowMs` (24 hours) as the base
- But operators don't work 24/7 - they work during machine sessions
- **Result:** If machine ran 2 hours and operator worked 2 hours, operator shows 22 hours paused
- **Reality:** Operator was only "on shift" for 2 hours, so pausedTime should be 0

**Correct Logic:**
```javascript
// For operators and items:
// pausedTime = (time on machine) - (time actively working)
const sessionTimeMs = runtimeMs;  // Time associated with this operator
const pausedTimeMs = Math.max(0, sessionTimeMs - workedTimeMs);
```

---

## Coherence Validation Rules

After fixes are applied, the following equations MUST hold true:

### Rule 1: Machine Time Balance
```
windowMs = runtimeMs + faultTimeMs + pausedTimeMs
```

### Rule 2: Machine WorkTime Equals Sum of Operator WorkTimes
For a machine with operators [A, B, C]:
```
machine.workedTimeMs = operatorA.workedTimeMs + operatorB.workedTimeMs + operatorC.workedTimeMs
```

### Rule 3: Machine Counts Equal Sum of Operator Counts
```
machine.totalCounts = sum(operator.totalCounts for all operators)
```

### Rule 4: Machine Counts Equal Sum of Item Counts
```
machine.totalCounts = sum(machineItem.totalCounts for all items)
```

### Rule 5: SPF Machine Active Stations
```
IF machine.type === 'SPF':
  machine.activeStations === 1
  machine.workedTimeMs === machine.runtimeMs × 1  (not × 4)
```

### Rule 6: Operator-Item Time Credit Sums Correctly
For an operator who worked on items [X, Y, Z]:
```
operator.totalTimeCreditMs >= sum(operatorItem[X,Y,Z].totalTimeCreditMs)
(Greater than or equal because operator may have idle time)
```

### Rule 7: Plant-Wide Item Totals Equal Sum of Machine-Item Totals
```
item[X].totalCounts = sum(machineItem[X].totalCounts across all machines)
```

---

## Recommended Implementation Order

1. **Fix #1 (SPF activeStations)** - CRITICAL - Affects all downstream calculations
2. **Fix #7 (pausedTime logic)** - Affects coherence validation
3. **Fix #2 (operator runtime)** - Required for Rule 2 validation
4. **Fix #3 (item activeStations)** - Needed for validation
5. **Fix #6 (fault time in operator totals)** - Needed for Rule 2 validation
6. **Fix #5 (operator-item time)** - Policy decision (Approach A vs B)
7. **Fix #4 (plant-wide items)** - Consider architectural change (separate aggregation service)

---

## Testing Strategy

After implementing fixes, run these queries to validate coherence:

```javascript
// Test 1: SPF Machine Coherence
db['totals-daily'].aggregate([
  { $match: { entityType: 'machine', date: '2025-01-24' } },
  { $project: {
      machineName: 1,
      activeStations: 1,
      runtimeMs: 1,
      workedTimeMs: 1,
      ratio: { $divide: ['$workedTimeMs', '$runtimeMs'] }
  }},
  { $match: { machineName: { $regex: /^SPF/ } } }
]);
// Expected: activeStations = 1, ratio ≈ 1.0

// Test 2: Machine vs Operator WorkTime Balance
db['totals-daily'].aggregate([
  { $match: { date: '2025-01-24', machineSerial: 67798 } },
  { $group: {
      _id: '$entityType',
      totalWorkedMs: { $sum: '$workedTimeMs' }
  }}
]);
// Expected: machine.workedTimeMs = sum(operator.workedTimeMs)

// Test 3: Machine vs Operator Counts Balance
db['totals-daily'].aggregate([
  { $match: { date: '2025-01-24', machineSerial: 67798 } },
  { $group: {
      _id: '$entityType',
      totalCounts: { $sum: '$totalCounts' }
  }}
]);
// Expected: machine.totalCounts = sum(operator.totalCounts)
```

---

## Summary

The current cache builder has **systematic coherence issues** caused by:
1. Incorrect activeStations resolution for SPF machines (4x inflation)
2. Wrong time metrics for operator totals (runtime vs workTime confusion)
3. Missing validation fields (activeStations for items)
4. Incorrect time attribution (pausedTime using wrong base)
5. Policy ambiguity (how to handle operator-item time for parallel work)
6. Double-counting risk (atomic $inc for plant-wide items)
7. Inconsistent fault time handling (machine vs operator)

**Impact:** Cache data appears correct in isolation but fails cross-entity validation.

**Priority:** Fix #1 (SPF activeStations) is CRITICAL and affects all other calculations.
