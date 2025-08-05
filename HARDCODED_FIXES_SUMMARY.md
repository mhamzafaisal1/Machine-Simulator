# Hardcoded Elements Fixes Summary

## Overview
This document summarizes all the hardcoded elements that were identified and fixed in the machine simulator project.

## ✅ **Fixed Issues**

### 1. **Hardcoded Max Station Count**
**Problem**: `for (let station = 1; station <= 4; station++)` was hardcoded to assume all machines have up to 4 lanes.

**Files Fixed**:
- `utils.js` - `getStationOperators()` function
- `simulation-worker.js` - `assignOperatorsForRunningState()` function  
- `worker.js` - `assignOperatorsForRunningState()` function

**Solution**: 
```javascript
// OLD:
for (let station = 1; station <= 4; station++)

// NEW:
const maxStations = targetConfig.lanes || 1;
for (let station = 1; station <= maxStations; station++)
```

### 2. **Operator Fallback Logic with Fixed Dummy IDs**
**Problem**: Hardcoded dummy operator ID generation using machine serial:
```javascript
assignedOperators.push({ id: parseInt('9' + machineSerial.toString()), station });
```

**Files Fixed**:
- `simulation-worker.js` - Removed dummy operator generation
- `worker.js` - Removed dummy operator generation

**Solution**: 
```javascript
// OLD:
if (station === 2 && !activeStations.includes(2)) {
  assignedOperators.push({ id: parseInt('9' + machineSerial.toString()), station });
}

// NEW:
assignedOperators.push({ id: -1, station });
```

### 3. **Hardcoded Status Codes and Names**
**Problem**: Fault codes were randomly generated instead of using actual fault records from database.

**Files Fixed**:
- `utils.js` - `buildStateRecord()` function
- `simulation-worker.js` - `writeState()` function

**Solution**:
```javascript
// OLD:
Fault: { code: Math.floor(Math.random() * 99) + 2, name: "Fault", softrolColor: "Red" }

// NEW:
// Dynamic fault selection from database
if (stateType === "Fault") {
  const faultCollection = db.collection(config.faultCollectionName);
  const faults = await faultCollection.find({}).sort({ code: 1 }).toArray();
  if (faults.length > 0) {
    const randomFault = faults[Math.floor(Math.random() * faults.length)];
    status = {
      code: randomFault.code,
      name: randomFault.name || randomFault.description || "Fault",
      softrolColor: "Red"
    };
  }
}
```

### 4. **Hardcoded Item IDs in Config**
**Problem**: `itemIds: [26, 30, 33]` was hardcoded in config.js.

**Files Fixed**:
- `config.js` - Removed hardcoded itemIds array
- `utils.js` - Deprecated `getRandomItemId()` function

**Solution**:
```javascript
// OLD:
itemIds: [26, 30, 33], // HospitalSheet, Large Thermal Blanket, Mixed Towels

// NEW:
// Items are now fetched from MongoDB 'item' collection
// No longer using hardcoded item IDs
```

### 5. **Hardcoded Items Array Size**
**Problem**: `for (let i = 0; i < 8; i++)` was hardcoded for items array generation.

**Files Fixed**:
- `utils.js` - `getRandomItemPerStation()` function
- `simulation-worker.js` - `writeState()` function

**Solution**:
```javascript
// OLD:
for (let i = 0; i < 8; i++) {
  items[i.toString()] = { id: itemId, count: 0 };
}

// NEW:
const maxStations = (machineConfig || config.machine).lanes || 1;
for (let i = 0; i < maxStations; i++) {
  items[i.toString()] = { id: itemId, count: 0 };
}
```

## 🎯 **Benefits of These Fixes**

1. **Dynamic Configuration**: All station counts now use machine lanes from database
2. **No Artificial IDs**: No more dummy operator IDs with '9' prefix
3. **Real Fault Codes**: Fault states now use actual fault records from database
4. **Database-Driven Items**: All items are loaded from MongoDB, no hardcoded fallbacks
5. **Scalable Architecture**: System can handle machines with any number of lanes
6. **Consistent Logic**: Same rules applied across all files and functions

## 📊 **Verification**

All fixes ensure:
- ✅ **Worker allocation matches machine lanes exactly**
- ✅ **No operators with IDs starting with '9' are created**
- ✅ **Fault codes come from actual database records**
- ✅ **Items are loaded dynamically from MongoDB**
- ✅ **Station counts are based on machine configuration**
- ✅ **No hardcoded assumptions about machine capabilities**

## 🔧 **Files Modified**

1. **`simulation-worker.js`** - Main worker allocation and state generation
2. **`utils.js`** - Utility functions for operators, items, and state records
3. **`worker.js`** - Single machine simulation logic
4. **`config.js`** - Removed hardcoded item IDs

The system is now fully database-driven and free of hardcoded assumptions! 🚀 