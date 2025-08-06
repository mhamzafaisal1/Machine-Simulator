# Worker Allocation Changes

## Overview
This document outlines the changes made to ensure proper worker allocation in the machine simulator, where:
1. **Number of workers** allocated to a machine depends on the number of lanes it has
2. **Operator filtering** rejects operators with IDs starting with '9' from the operators collection

## Key Changes Made

### 1. Machine Lanes Integration (`simulation-worker.js`)
- **File**: `simulation-worker.js`
- **Function**: `assignOperatorsForRunningState()`
- **Changes**:
  - Now directly uses `machineConfig.lanes` from the machine collection
  - Allocates exactly 1 worker per lane (1 worker per lane = number of workers)
  - Enhanced logging to show machine lanes and worker allocation
  - Improved logic for inactive stations beyond the number of lanes

### 2. Operator Filtering Enhancement (`simulation-worker.js`)
- **File**: `simulation-worker.js`
- **Function**: `assignOperatorsForRunningState()`
- **Changes**:
  - Enhanced filtering logic to reject operators with IDs starting with '9'
  - Added detailed logging showing total operators vs. filtered operators
  - Clear indication of how many operators were excluded

### 3. Utils Functions Updates (`utils.js`)
- **File**: `utils.js`
- **Functions Updated**:
  - `getActiveStations()`: Enhanced to properly use lanes from machine collection
  - `getStationOperators()`: Improved operator filtering and allocation logic
  - `getRandomOperators()`: Enhanced filtering with better logging
  - `buildStateRecord()`: Added logging for machine lanes and active stations

### 4. Machine Configuration (`fillmore-machines.js`)
- **File**: `fillmore-machines.js`
- **Function**: `getStationsFromLanes()`
- **Purpose**: Maps machine lanes to active stations (1 lane = 1 station)

## How It Works

### Worker Allocation Logic
1. **Machine Data Retrieval**: Machine information is loaded from MongoDB `machine` collection
2. **Lanes Processing**: The `lanes` field determines how many workers are allocated
3. **Station Mapping**: Each lane corresponds to a station (Lane 1 = Station 1, Lane 2 = Station 2, etc.)
4. **Worker Assignment**: One worker (operator) is assigned per active lane/station

### Operator Filtering Logic
1. **Operator Retrieval**: All operators are fetched from MongoDB `operator` collection
2. **Filtering**: Operators with IDs starting with '9' are rejected and excluded
3. **Validation**: Only valid operators (not starting with '9') are used for assignment
4. **Logging**: Detailed logs show filtering results

## Example Output

### Machine Configuration
```
🏭 Machine LPL1 (67798) - Lanes: 3, Active Stations: [1, 2, 3]
📊 Filtered operators: 93 total, 32 available (excluded 61 starting with 9)
👤 Assigned operator 135798 to lane 1 (station 1)
👤 Assigned operator 135811 to lane 2 (station 2)
👤 Assigned operator 135790 to lane 3 (station 3)
```

### Different Machine Types
- **SPF Machines**: 1 lane = 1 worker
- **LPL Machines**: 3 lanes = 3 workers
- **Blanket Machines**: 2 lanes = 2 workers
- **SPL Machines**: 4 lanes = 4 workers

## Verification

The implementation was tested with a comprehensive test script that verified:
1. ✅ Machine lanes are correctly retrieved from the machine collection
2. ✅ Worker allocation matches the number of lanes
3. ✅ Operators with IDs starting with '9' are properly filtered out
4. ✅ Active stations correspond to the number of lanes
5. ✅ Inactive stations are properly handled

## Files Modified
- `simulation-worker.js` - Main worker allocation logic
- `utils.js` - Utility functions for operator handling
- `fillmore-machines.js` - Machine configuration handling

## Database Collections Used
- `machine` - Contains machine information including `lanes` field
- `operator` - Contains operator information (filtered to exclude IDs starting with '9')
- `simulated-operators-ticker` - Tracks operator assignments

## Benefits
1. **Accurate Worker Allocation**: Number of workers now correctly matches machine lanes
2. **Data Integrity**: Only valid operators are used (no IDs starting with '9')
3. **Clear Logging**: Enhanced visibility into allocation decisions
4. **Scalable**: Works for machines with 1-4 lanes
5. **Consistent**: Same logic applied across all machine types 