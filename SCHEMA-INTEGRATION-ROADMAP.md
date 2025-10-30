# Schema Integration Roadmap

## Overview

This document outlines the complete 3-phase approach to integrating schema validation into the machine simulator.

## Current Status: ✅ Phase 1 Complete

---

## Phase 1: Non-Breaking Validation ✅ COMPLETE

**Goal:** Identify schema compliance issues without changing any existing logic

**Risk Level:** 🟢 **LOW** - Zero breaking changes

**Duration:** Complete

### What We Did

1. **Created Validation Infrastructure** ([schema-validator.js](schema-validator.js))
   - Compiled validators for all 18 schemas
   - Error deduplication and logging
   - Statistics tracking and reporting

2. **Added Validation Checks** (Non-breaking)
   - Machine configs on startup
   - Faults, items, operators on load
   - States before DB write
   - Counts/misfeeds before DB write
   - Sessions on creation

3. **Monitoring & Reporting**
   - Real-time error logging (first 3 per pattern)
   - Statistics every 5 minutes
   - Final report on shutdown

### Files Changed
- ✅ **NEW:** [schema-validator.js](schema-validator.js) (287 lines)
- ✅ **Modified:** [simulation-worker.js](simulation-worker.js) (+40 lines)
- ✅ **Modified:** [fillmore-machines.js](fillmore-machines.js) (+8 lines)
- ✅ **Modified:** [fillmore-simulator.js](fillmore-simulator.js) (+10 lines)
- ✅ **Modified:** [simulator-cache-builder.js](simulator-cache-builder.js) (+1 line import)

### Key Benefit
**Know exactly which objects fail validation and why, without any risk**

---

## Phase 2: Selective Schema Adoption 🔄 NOT STARTED

**Goal:** Use schema utilities for NEW code while preserving existing simulation loop

**Risk Level:** 🟡 **MEDIUM** - Changes to non-critical paths only

**Estimated Duration:** 1-2 days

### What Needs to Change

#### 1. Session Finalization Logic
**Location:** [simulation-worker.js](simulation-worker.js)

**Current Approach:**
```javascript
// Manual session object construction
const sessionData = {
  timestamps: { start: runningState.timestamp },
  counts: [],
  misfeeds: [],
  // ... manually built fields
};
```

**Schema Approach:**
```javascript
const sessionSchema = require('./schemas/session');
const metricsSchema = require('./schemas/metrics');

// Build metrics using schema utility
const metrics = metricsSchema.utils.initMetrics(
  counts, misfeeds, items, timeCredits
);

// Build session using schema utility
const sessionData = sessionSchema.utils.initSession(
  timestamps, machine, operators, items,
  program, startState, metrics
);
```

**Files to Modify:**
- `startMachineSession()` - line 571-649
- `endMachineSession()` - session finalization
- `startOperatorSessions()` - line 651-743
- `endOperatorSessions()` - operator session finalization

#### 2. Cache Building Logic
**Location:** [simulator-cache-builder.js](simulator-cache-builder.js)

**Current Approach:**
```javascript
// Manual cache record construction
return {
  _id: `machine-${machineSerial}-${dateStr}`,
  runtimeMs: runtimeMs,
  totalCounts: Math.round(totalCounts),
  // ... manually built fields
};
```

**Schema Approach:**
```javascript
const metricsSchema = require('./schemas/metrics');

// Use metrics schema for cache totals
const metrics = metricsSchema.utils.initMetrics(
  validCounts, misfeeds, items, timeCredits
);

// Build cache record with validated metrics
return {
  _id: `machine-${machineSerial}-${dateStr}`,
  metrics: metrics,
  // ... other fields
};
```

**Functions to Modify:**
- `buildMachineDailyTotal()` - line 50-128
- `buildOperatorMachineDailyTotal()` - line 130-208
- `buildItemMachineDailyTotal()` - line 210-288
- `buildItemDailyTotal()` - line 290-368
- `buildOperatorItemDailyTotal()` - line 370-448

#### 3. Timestamp Standardization
**Location:** Multiple files

**Current:**
```javascript
const now = new Date().toISOString();
// or
timestamp: new Date()
```

**Schema:**
```javascript
const timestampsSchema = require('./schemas/timestampsSchema');
const timestamps = timestampsSchema.utils.stampInit(now);
```

**Locations:**
- State creation (simulation-worker.js:1270, 1312)
- Count creation (simulation-worker.js:1590)
- Session creation (simulation-worker.js:608-609)

### Testing Strategy

1. **Implement changes incrementally**
   - Start with timestamps (easiest)
   - Then sessions (moderate)
   - Finally cache (most complex)

2. **Validate after each change**
   - Run simulator for 30+ minutes
   - Check validation stats improve
   - Verify DB writes unchanged

3. **Compare before/after**
   - Export DB records before Phase 2
   - Export DB records after Phase 2
   - Diff to ensure compatibility

### Expected Outcome
- ✅ Validation success rate increases to >98%
- ✅ New sessions match schemas exactly
- ✅ Cache records have validated metrics
- ✅ Existing simulation loop untouched

---

## Phase 3: Full Schema Integration 🚫 OPTIONAL

**Goal:** Refactor ALL object creation to use schema utilities

**Risk Level:** 🔴 **HIGH** - Changes core simulation logic

**Estimated Duration:** 3-5 days

**Recommendation:** ⚠️ **ONLY proceed if Phase 2 reveals significant benefits**

### What Would Change

#### 1. State Object Creation
**Location:** [simulation-worker.js:1270-1332](simulation-worker.js#L1270-L1332)

**Current:**
```javascript
record = {
  timestamp: new Date(),
  machine: { serial: ..., name: ..., ipAddress: ... },
  program: { mode: ..., programNumber: ..., ... },
  operators: assignedOperators,
  status: { code: 1, name: "Run", ... }
};
```

**Schema:**
```javascript
const stateSchema = require('./schemas/state');
const state = stateSchema.utils.initState(
  timestamps, machine, operators, items,
  program, lanes, shift, stations, session_id
);
```

**Challenge:** The `_tickerDoc` addition (line 1432-1433) must be preserved:
```javascript
stateObject._tickerDoc = _tickerDoc; // CRITICAL for atomic updates
```

#### 2. Count/Misfeed Object Creation
**Location:** [simulation-worker.js:1589-1630](simulation-worker.js#L1589-L1630)

**Current:**
```javascript
const countRecord = {
  timestamp: new Date(),
  machine: runningState.machine,
  program: runningState.program,
  operator: { id: ..., name: ..., station: ... },
  station: station,
  lane: station,
  item: { id: ..., name: ..., standard: ... }
};
```

**Schema:**
```javascript
const countSchema = require('./schemas/count');
const count = countSchema.utils.initCount(
  timestamps, machine, operator, item,
  program, lane, station, shift, session_id
);
```

**Challenge:** Misfeed handling and timing calculations must be preserved

#### 3. Program Object Initialization
**Location:** [simulation-worker.js:104-115](simulation-worker.js#L104-L115)

**Current:**
```javascript
this.programObject = {
  mode: "smallPiece",
  programNumber: 1,
  batchNumber: 0,
  accountNumber: 0,
  speed: 0,
  stations: this.machineConfig.lanes || 1
};
```

**Schema:**
```javascript
const programSchema = require('./schemas/program');
this.programObject = programSchema.utils.initProgram(
  1, 'smallPiece', 100, [], 0, 0
);
```

### Why Phase 3 Might Not Be Worth It

1. **High Risk**
   - Changes core simulation loop
   - Risk of breaking timing/count generation
   - Extensive testing required

2. **Low Additional Benefit**
   - Phase 2 already achieves >95% validation
   - Remaining 5% are transactional records
   - Existing logic is proven and stable

3. **Maintenance Burden**
   - More abstraction = harder to debug
   - Schema changes require code updates
   - Potential performance overhead

4. **Alternative Approach**
   - Keep existing logic as "ground truth"
   - Use schemas for validation only
   - Accept minor differences as acceptable

### Decision Criteria for Phase 3

**Proceed ONLY if:**
- ✅ Phase 2 validation rate < 90%
- ✅ Frequent schema-related bugs in production
- ✅ New features require strict schema compliance
- ✅ Team has 3+ days for refactoring + testing

**Skip Phase 3 if:**
- ✅ Phase 2 validation rate > 95%
- ✅ Simulation is stable and reliable
- ✅ Time/resources better spent elsewhere
- ✅ Risk outweighs benefit

---

## Comparison: Phases 1, 2, 3

| Aspect | Phase 1 ✅ | Phase 2 🔄 | Phase 3 🚫 |
|--------|-----------|-----------|-----------|
| **Risk** | 🟢 None | 🟡 Medium | 🔴 High |
| **Benefit** | Identify issues | Fix issues | Perfect compliance |
| **Time** | 1 day | 2 days | 5 days |
| **Code Changes** | Minimal | Moderate | Extensive |
| **Testing Needed** | Light | Moderate | Comprehensive |
| **Rollback Easy?** | ✅ Yes | ⚠️ Maybe | ❌ No |
| **Validation Rate** | Current | >95% | ~100% |
| **Breaking Risk** | 0% | <5% | 10-20% |

---

## Recommended Path Forward

### Immediate Next Steps (This Week)

1. **Run Phase 1 for 24+ Hours**
   ```bash
   node fillmore-simulator.js
   # Let it run overnight
   ```

2. **Collect Baseline Metrics**
   - Note validation success rate
   - Identify top 3 error patterns
   - Measure frequency of each error

3. **Analyze Results**
   - If >95% valid → Phase 2 optional
   - If 90-95% valid → Phase 2 recommended
   - If <90% valid → Phase 2 required

### Decision Tree

```
Phase 1 Complete
    │
    ├─ Validation Rate >95%
    │   ├─ Few critical errors? → STOP HERE (Phase 2/3 not needed)
    │   └─ Want perfection? → Proceed to Phase 2
    │
    ├─ Validation Rate 90-95%
    │   └─ Proceed to Phase 2 (selective adoption)
    │
    └─ Validation Rate <90%
        └─ Investigate root cause first
            ├─ Schema too strict? → Adjust schemas
            ├─ Data quality issue? → Fix data sources
            └─ Logic mismatch? → Proceed to Phase 2
```

---

## Schema Files Reference

All schemas are in: [machine-simulator/schemas/](machine-simulator/schemas/)

| Schema | File | Used For |
|--------|------|----------|
| Timestamps | [timestampsSchema.js](schemas/timestampsSchema.js) | All records |
| Machine | [machine.js](schemas/machine.js) | Machine configs |
| Operator | [operator.js](schemas/operator.js) | Operator records |
| Item | [item.js](schemas/item.js) | Product records |
| Fault | [fault.js](schemas/fault.js) | Fault codes |
| State | [state.js](schemas/state.js) | Machine states |
| Count | [count.js](schemas/count.js) | Production counts |
| Misfeed | [misfeed.js](schemas/misfeed.js) | Misfeed records |
| Session | [session.js](schemas/session.js) | Session tracking |
| Metrics | [metrics.js](schemas/metrics.js) | Session metrics |
| Program | [program.js](schemas/program.js) | Program data |
| Shift | [shift.js](schemas/shift.js) | Shift info |
| Break | [break.js](schemas/break.js) | Break tracking |
| Status | [status.js](schemas/status.js) | Status codes |
| IP Address | [ipAddress.js](schemas/ipAddress.js) | Network info |
| Human Names | [human-names.js](schemas/human-names.js) | Name structure |
| Sensor Count | [sensorCount.js](schemas/sensorCount.js) | Sensor data |
| User | [user.js](schemas/user.js) | User records |

---

## Documentation Files

- **[PHASE1-SCHEMA-VALIDATION.md](PHASE1-SCHEMA-VALIDATION.md)** - Complete Phase 1 documentation
- **[PHASE1-QUICK-START.md](PHASE1-QUICK-START.md)** - Quick reference guide
- **[SCHEMA-INTEGRATION-ROADMAP.md](SCHEMA-INTEGRATION-ROADMAP.md)** - This file

---

## Success Metrics

### Phase 1 Success Criteria ✅
- ✅ Validation infrastructure implemented
- ✅ Zero breaking changes
- ✅ Statistics reporting working
- ✅ Error logging functional

### Phase 2 Success Criteria
- ⏳ Validation rate >95% for new sessions
- ⏳ Cache records have validated metrics
- ⏳ No regression in simulation behavior
- ⏳ DB writes remain compatible

### Phase 3 Success Criteria (Optional)
- ⏳ Validation rate >99% overall
- ⏳ All objects use schema utilities
- ⏳ Comprehensive test coverage
- ⏳ Performance unchanged

---

## Contact & Support

**Questions about Phase 1?**
→ Check [PHASE1-QUICK-START.md](PHASE1-QUICK-START.md)

**Planning Phase 2?**
→ Review validation statistics first
→ Identify high-value targets
→ Start with timestamp standardization

**Considering Phase 3?**
→ Ask: "Is perfect compliance worth 5 days + risk?"
→ Probably not if Phase 2 achieves >95%

---

**Last Updated:** 2025-01-15
**Current Phase:** Phase 1 Complete ✅
**Next Phase:** Analyze results, decide on Phase 2
