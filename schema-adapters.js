/**
 * Schema Adapters - Phase 2
 *
 * Helper functions to adapt simulator data structures to match schemas
 * without breaking existing functionality
 */

const timestampsSchema = require('./schemas/timestampsSchema');

/**
 * Parse IP address string to octets
 * @param {string} ipString - IP address string like "192.168.0.2"
 * @returns {Object} IP address object with octets
 */
function parseIPAddress(ipString) {
  const parts = ipString.split('.');
  if (parts.length === 4) {
    return {
      firstOctet: parseInt(parts[0]),
      secondOctet: parseInt(parts[1]),
      thirdOctet: parseInt(parts[2]),
      fourthOctet: parseInt(parts[3])
    };
  }
  // Fallback for invalid IP
  return {
    firstOctet: 192,
    secondOctet: 168,
    thirdOctet: 0,
    fourthOctet: 1
  };
}

/**
 * Convert a single timestamp to schema-compliant timestamps object
 * @param {Date|string} timestamp - Single timestamp
 * @returns {Object} Schema-compliant timestamps object
 */
function createTimestamps(timestamp) {
  const ts = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
  return {
    create: ts,
    active: ts,
    update: ts
  };
}

/**
 * Create timestamps with start time (for sessions)
 * @param {Date|string} startTime - Session start time
 * @returns {Object} Schema-compliant timestamps object with start
 */
function createSessionTimestamps(startTime) {
  const ts = startTime instanceof Date ? startTime.toISOString() : startTime;
  return {
    create: ts,
    active: ts,
    update: ts,
    start: ts
  };
}

/**
 * Create timestamps with start and optional end (for completed sessions)
 * @param {Date|string} startTime - Session start time
 * @param {Date|string} [endTime] - Session end time (optional)
 * @returns {Object} Schema-compliant timestamps object
 */
function createSessionTimestampsWithEnd(startTime, endTime) {
  const start = startTime instanceof Date ? startTime.toISOString() : startTime;
  const end = endTime ? (endTime instanceof Date ? endTime.toISOString() : endTime) : null;

  const timestamps = {
    create: start,
    active: start,
    update: end || start,
    start: start
  };

  if (end) {
    timestamps.end = end;
  }

  return timestamps;
}

/**
 * Adapt machine object to schema format
 * @param {Object} machineConfig - Current machine config
 * @returns {Object} Schema-adapted machine object
 */
function adaptMachine(machineConfig) {
  const ipAddress = typeof machineConfig.ipAddress === 'string'
    ? parseIPAddress(machineConfig.ipAddress)
    : machineConfig.ipAddress;

  return {
    id: machineConfig.serial, // Map serial to id
    name: machineConfig.name,
    active: machineConfig.active !== undefined ? machineConfig.active : true,
    ipAddress: ipAddress,
    lanes: machineConfig.lanes,
    type: machineConfig.type,
    polled: true, // Default value
    timestamps: createTimestamps(new Date()),
    groups: machineConfig.groups && typeof machineConfig.groups === 'object' && !Array.isArray(machineConfig.groups)
      ? machineConfig.groups
      : {} // Schema expects object, not array
  };
}

/**
 * Adapt operator object to schema format
 * @param {Object} operator - Current operator object
 * @returns {Object} Schema-adapted operator object
 */
function adaptOperator(operator) {
  // Parse name if it's a string
  let nameObj;
  if (typeof operator.name === 'string') {
    const parts = operator.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      nameObj = {
        first: parts[0],
        surname: parts.slice(1).join(' ')
      };
    } else {
      nameObj = {
        first: parts[0] || 'Unknown',
        surname: ''
      };
    }
  } else {
    nameObj = operator.name;
  }

  return {
    id: operator.id || operator.code, // Map code to id if needed
    name: nameObj,
    active: operator.active !== undefined ? operator.active : true,
    timestamps: createTimestamps(new Date())
  };
}

/**
 * Adapt item object to schema format
 * @param {Object} item - Current item object
 * @returns {Object} Schema-adapted item object
 */
function adaptItem(item) {
  return {
    id: item.id || item.number,
    name: item.name,
    standard: item.standard,
    active: item.active !== undefined ? item.active : true,
    timestamps: createTimestamps(new Date())
  };
}

/**
 * Adapt program object to schema format
 * @param {Object} program - Current program object
 * @returns {Object} Schema-adapted program object
 */
function adaptProgram(program) {
  // Adapt items array if present
  let adaptedItems = [];
  if (program.items && Array.isArray(program.items)) {
    adaptedItems = program.items.map(item => {
      // If item has full details, adapt it
      if (item.name && item.standard) {
        return adaptItemSimple(item);
      }
      // If item only has id, create minimal object
      return {
        id: item.id || item.number,
        name: item.name || 'Unknown',
        standard: item.standard || 0,
        active: true,
        timestamps: createTimestamps(new Date())
      };
    });
  }

  return {
    id: program.programNumber || program.id || 1,
    mode: program.mode || 'smallPiece',
    speed: program.speed || 0,
    account: program.accountNumber !== undefined ? program.accountNumber : (program.account || 0),
    batch: program.batchNumber !== undefined ? program.batchNumber : (program.batch || 0),
    active: true,
    timestamps: createTimestamps(new Date()),
    stations: program.stations,
    items: adaptedItems
  };
}

/**
 * Create a minimal shift object (required by schemas)
 * @returns {Object} Minimal shift object
 */
function createDefaultShift() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(7, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(15, 0, 0, 0);

  const timestamps = createSessionTimestampsWithEnd(startOfDay, endOfDay);
  const shiftTime = endOfDay - startOfDay; // 8 hours in ms

  return {
    active: true,
    timestamps: timestamps,
    shiftTime: shiftTime,
    breaks: [], // Empty array as required
    name: 'Day Shift'
  };
}

/**
 * Adapt count object to schema format
 * @param {Object} count - Current count object
 * @param {Object} options - Additional options
 * @returns {Object} Schema-adapted count object
 */
function adaptCount(count, options = {}) {
  const timestamps = createTimestamps(count.timestamp || new Date());

  return {
    timestamps: timestamps,
    machine: adaptMachineSimple(count.machine),
    program: adaptProgram(count.program),
    operator: adaptOperatorSimple(count.operator),
    item: adaptItemSimple(count.item),
    shift: options.shift || createDefaultShift(),
    lane: count.lane,
    station: count.station,
    session_id: count.session_id
  };
}

/**
 * Adapt misfeed object to schema format
 * @param {Object} misfeed - Current misfeed object
 * @param {Object} options - Additional options
 * @returns {Object} Schema-adapted misfeed object
 */
function adaptMisfeed(misfeed, options = {}) {
  const timestamps = createTimestamps(misfeed.timestamp || new Date());

  return {
    timestamps: timestamps,
    machine: adaptMachineSimple(misfeed.machine),
    program: adaptProgram(misfeed.program),
    operator: adaptOperatorSimple(misfeed.operator),
    item: adaptItemSimple(misfeed.item),
    shift: options.shift || createDefaultShift(),
    lane: misfeed.lane,
    station: misfeed.station,
    session_id: misfeed.session_id
  };
}

/**
 * Simple machine adapter (for nested objects in counts/states)
 * @param {Object} machine - Machine object
 * @returns {Object} Adapted machine (simplified for nesting)
 */
function adaptMachineSimple(machine) {
  const ipAddress = typeof machine.ipAddress === 'string'
    ? parseIPAddress(machine.ipAddress)
    : machine.ipAddress;

  return {
    id: machine.serial || machine.id,
    name: machine.name,
    active: true,
    ipAddress: ipAddress,
    lanes: machine.lanes || 1,
    type: machine.type || 'Unknown',
    polled: true,
    timestamps: createTimestamps(new Date())
  };
}

/**
 * Simple operator adapter (for nested objects)
 * @param {Object} operator - Operator object
 * @returns {Object} Adapted operator
 */
function adaptOperatorSimple(operator) {
  let nameObj;
  if (typeof operator.name === 'string') {
    const parts = operator.name.trim().split(/\s+/);
    nameObj = {
      first: parts[0] || 'Unknown',
      surname: parts.slice(1).join(' ') || ''
    };
  } else {
    nameObj = operator.name;
  }

  return {
    id: operator.id || operator.code,
    name: nameObj,
    active: true,
    timestamps: createTimestamps(new Date())
    // Note: station removed as it's not in operator schema
  };
}

/**
 * Simple item adapter (for nested objects)
 * @param {Object} item - Item object
 * @returns {Object} Adapted item
 */
function adaptItemSimple(item) {
  return {
    id: item.id || item.number,
    name: item.name,
    standard: item.standard,
    active: true,
    timestamps: createTimestamps(new Date())
  };
}

module.exports = {
  createTimestamps,
  createSessionTimestamps,
  createSessionTimestampsWithEnd,
  adaptMachine,
  adaptMachineSimple,
  adaptOperator,
  adaptOperatorSimple,
  adaptItem,
  adaptItemSimple,
  adaptProgram,
  adaptCount,
  adaptMisfeed,
  createDefaultShift
};
