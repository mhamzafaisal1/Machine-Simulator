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

  const adapted = {
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

  // Schema expects 'stations' as integer (count), but simulator uses array
  // Store both: stations (integer count for schema) and _stationsArray (array for simulator)
  if (machineConfig.stations && Array.isArray(machineConfig.stations)) {
    adapted.stations = machineConfig.stations.length; // Store count as integer for schema
    Object.defineProperty(adapted, '_stationsArray', {
      value: machineConfig.stations,
      enumerable: false,
      writable: false
    });
  }

  return adapted;
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

  // For counts, operator might have station field - preserve it temporarily
  const adaptedOperator = adaptOperatorSimple(count.operator);
  // Note: station is tracked separately in count.station, not on operator

  return {
    timestamps: timestamps,
    machine: adaptMachineSimple(count.machine),
    program: adaptProgram(count.program),
    operator: adaptedOperator,
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
    id: machine.id || machine.serial, // Prefer id (adapted machines) over serial (legacy)
    name: machine.name,
    active: machine.active !== undefined ? machine.active : true,
    ipAddress: ipAddress,
    lanes: machine.lanes || 1,
    type: machine.type || 'Unknown',
    polled: machine.polled !== undefined ? machine.polled : true,
    timestamps: machine.timestamps || createTimestamps(new Date())
  };
}

/**
 * Simple operator adapter (for nested objects)
 * @param {Object} operator - Operator object
 * @param {Object} options - Optional settings
 * @returns {Object} Adapted operator
 */
function adaptOperatorSimple(operator, options = {}) {
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

  const adapted = {
    id: operator.id || operator.code,
    name: nameObj,
    active: true,
    timestamps: createTimestamps(new Date())
  };

  // For state operators, preserve station field (needed for simulation to continue)
  if (options.preserveStation && operator.station !== undefined) {
    adapted.station = operator.station;
  }

  return adapted;
}

/**
 * Adapt operator from database to schema format
 * Handles DB operators with fields like code, rate, groups
 * @param {Object} operator - Operator object from database
 * @returns {Object} Schema-adapted operator object
 */
function adaptOperatorFromDB(operator) {
  // Parse operator name into first/surname
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

  const adapted = {
    id: operator.id || operator.code,
    active: operator.active !== undefined ? operator.active : true,
    timestamps: createTimestamps(new Date()),
    name: nameObj
  };

  // Handle optional groups object (area, category, department)
  if (operator.area || operator.category || operator.department) {
    adapted.groups = {};
    if (operator.area) adapted.groups.area = String(operator.area);
    if (operator.category) adapted.groups.category = String(operator.category);
    if (operator.department) adapted.groups.department = String(operator.department);
  }

  // Store original values as non-enumerable properties (won't be validated but accessible)
  Object.defineProperty(adapted, '_originalCode', {
    value: operator.code,
    enumerable: false,
    writable: false
  });

  Object.defineProperty(adapted, '_originalName', {
    value: operator.name,
    enumerable: false,
    writable: false
  });

  if (operator.rate !== undefined) {
    Object.defineProperty(adapted, '_rate', {
      value: operator.rate,
      enumerable: false,
      writable: false
    });
  }

  return adapted;
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

/**
 * Adapt item from database to schema format
 * Handles DB items with fields like number, area, department, weight
 * @param {Object} item - Item object from database
 * @returns {Object} Schema-adapted item object
 */
function adaptItemFromDB(item) {
  const adapted = {
    id: item.id || item.number,
    active: item.active !== undefined ? item.active : true,
    timestamps: createTimestamps(new Date()),
    name: item.name,
    standard: item.standard
  };

  // Handle optional groups object (area, category, department)
  if (item.area || item.category || item.department) {
    adapted.groups = {};
    if (item.area) adapted.groups.area = String(item.area);
    if (item.category) adapted.groups.category = String(item.category);
    if (item.department) adapted.groups.department = String(item.department);
  }

  // Handle optional weight object
  if (item.weight && typeof item.weight === 'object' && item.weight.value !== undefined) {
    adapted.weight = {
      value: item.weight.value,
      unit: item.weight.unit || 'gram',
      per: item.weight.per || 1
    };
  }

  // Handle optional machineTypes array
  if (item.machineTypes && Array.isArray(item.machineTypes)) {
    adapted.machineTypes = item.machineTypes;
  }

  // Store original 'number' as non-enumerable property (won't be validated but accessible)
  Object.defineProperty(adapted, '_originalNumber', {
    value: item.number,
    enumerable: false,
    writable: false
  });

  return adapted;
}

/**
 * Adapt fault from database to schema format
 * @param {Object} fault - Fault object from database (e.g., { code, name, jam })
 * @returns {Object} Schema-adapted fault object
 */
function adaptFaultFromDB(fault) {
  const id = Number(fault?.code ?? fault?.id ?? 0);
  const name = fault?.name || fault?.description || 'Fault';
  const jam = Number(fault?.jam ?? 0);

  return {
    id,
    active: fault?.active !== undefined ? !!fault.active : true,
    timestamps: createTimestamps(new Date()),
    name,
    jam,
    ...(fault?.softrolColor ? { softrolColor: String(fault.softrolColor) } : {})
  };
}

/**
 * Adapt state object to schema format
 * @param {Object} state - Current state object
 * @param {Object} options - Additional options
 * @returns {Object} Schema-adapted state object
 */
function adaptState(state, options = {}) {
  const timestamps = createTimestamps(state.timestamp || new Date());

  // Adapt operators array (station is preserved in original record, not in adapted version)
  const adaptedOperators = state.operators ? state.operators.map(op => {
    return adaptOperatorSimple(op);
  }) : [];

  // Determine if SPF (multiple items) or single item
  let itemsForState = [];
  let itemForState = null;

  if (state.program && state.program.items && Array.isArray(state.program.items) && state.program.items.length > 1) {
    // SPF machine - use items array
    itemsForState = state.program.items
      .filter(item => item.id || item.number) // Filter out count-only entries
      .map(item => adaptItemSimple(item));
  } else if (state.program && state.program.items && state.program.items.length === 1) {
    // Single item machine
    const item = state.program.items[0];
    if (item.name && item.standard) {
      itemForState = adaptItemSimple(item);
    }
  }

  // Build state object based on item structure
  const stateObj = {
    timestamps: timestamps,
    machine: adaptMachineSimple(state.machine),
    lanes: state.program?.stations || 1,
    program: adaptProgram(state.program || {}),
    operators: adaptedOperators,
    shift: options.shift || createDefaultShift(),
    stations: state.operators ? state.operators.map(op => op.station).filter(s => s) : []
  };

  // Only include status for stateTicker (non-schema-validated contexts)
  if (options.includeStatus) {
    stateObj.status = adaptStatus(state.status);
  }

  // Only add session_id if it exists (optional field)
  if (state.session_id) {
    stateObj.session_id = String(state.session_id);
  }

  // Add either item or items based on structure
  if (itemsForState.length > 0) {
    stateObj.items = itemsForState;
  } else if (itemForState) {
    stateObj.item = itemForState;
  } else {
    // Fallback - create minimal item
    stateObj.item = {
      id: 1,
      name: 'Unknown',
      standard: 0,
      active: true,
      timestamps: createTimestamps(new Date())
    };
  }

  // Preserve _tickerDoc if present (critical for atomic updates)
  if (state._tickerDoc) {
    stateObj._tickerDoc = state._tickerDoc;
  }

  return stateObj;
}

/**
 * Adapt status object (for states)
 * @param {Object} status - Status object with code, name, softrolColor
 * @returns {Object} Adapted status object
 */
function adaptStatus(status) {
  if (!status) {
    return {
      code: 0,
      name: 'Unknown',
      softrolColor: 'None'
    };
  }

  return {
    code: status.code,
    name: status.name,
    softrolColor: status.softrolColor || status.color || 'None'
  };
}

/**
 * Adapt session object (machine/operator/item/fault sessions)
 */
function adaptSession(session, options = {}) {
  const sessionType = options.sessionType || 'machine';

  // Create timestamps with start/end
  const timestamps = session.timestamps?.start
    ? (session.timestamps?.end
      ? createSessionTimestampsWithEnd(session.timestamps.start, session.timestamps.end)
      : createSessionTimestamps(session.timestamps.start))
    : createSessionTimestamps(new Date());

  // Adapt states structure: {start, array, end} instead of array
  const statesObj = {
    start: session.startState ? adaptState(session.startState) : adaptState(session.states?.[0] || {}),
    array: []
  };

  // Add middle states to array
  if (Array.isArray(session.states) && session.states.length > 1) {
    statesObj.array = session.states.slice(1, session.endState ? -1 : session.states.length)
      .map(s => adaptState(s));
  }

  // Add end state if exists
  if (session.endState) {
    statesObj.end = adaptState(session.endState);
  }

  // Adapt counts structure: {valid, misfeed} instead of separate arrays
  const countsObj = {
    valid: (session.counts || []).map(c => adaptCount(c, options)),
    misfeed: (session.misfeeds || []).map(m => adaptMisfeed(m, options))
  };

  // Adapt machine (with full details)
  const ipAddress = typeof session.machine?.ipAddress === 'string'
    ? parseIPAddress(session.machine.ipAddress)
    : (session.machine?.ipAddress || parseIPAddress('192.168.0.1'));

  const machineObj = {
    id: session.machine?.serial || session.machine?.id,
    name: session.machine?.name || 'Unknown',
    active: session.machine?.active !== undefined ? session.machine.active : true,
    ipAddress: ipAddress,
    lanes: session.machine?.lanes || 1,
    type: session.machine?.type || 'Unknown',
    polled: session.machine?.polled !== undefined ? session.machine.polled : true,
    timestamps: session.machine?.timestamps || createTimestamps(new Date())
  };

  // Build adapted session (only schema-required fields)
  // Build metrics with proper nested structure
  const metricsObj = {
    totals: {
      counts: {
        valid: session.totalCount || 0,
        misfeed: session.misfeedCount || 0
      },
      timeCredit: session.totalTimeCredit || 0
    },
    byItem: {
      items: [],
      timeCredit: [],
      counts: {
        valid: [],
        misfeed: []
      }
    },
    timers: {
      elapsed: session.elapsed || 0,
      pause: session.pause || 0,
      run: session.runtime || session.run || 0,
      worked: session.workTime || session.worked || 0,
      fault: session.fault || 0,
      offline: session.offline || 0,
      maintenance: session.maintenance || 0
    }
  };

  // Populate byItem arrays if session has item-level data
  if (session.items && Array.isArray(session.items)) {
    metricsObj.byItem.items = session.items.map(i => adaptItemSimple(i));
    // Initialize arrays with zeros for each item
    metricsObj.byItem.timeCredit = session.items.map(() => 0);
    metricsObj.byItem.counts.valid = session.items.map(() => 0);
    metricsObj.byItem.counts.misfeed = session.items.map(() => 0);
  } else if (session.item) {
    metricsObj.byItem.items = [adaptItemSimple(session.item)];
    metricsObj.byItem.timeCredit = [0];
    metricsObj.byItem.counts.valid = [session.totalCount || 0];
    metricsObj.byItem.counts.misfeed = [session.misfeedCount || 0];
  }

  const adapted = {
    timestamps,
    machine: machineObj,
    metrics: metricsObj,
    program: adaptProgram(session.program || {}),
    states: statesObj,
    counts: countsObj,
    shift: options.shift || createDefaultShift()
  };

  // Handle item/items
  if (session.items && Array.isArray(session.items) && session.items.length > 1) {
    adapted.items = session.items.map(i => adaptItemSimple(i));
  } else if (session.item) {
    adapted.item = adaptItemSimple(session.item);
  } else if (session.items && session.items.length === 1) {
    adapted.item = adaptItemSimple(session.items[0]);
  }

  // Handle operator/operators
  if (session.operators && Array.isArray(session.operators) && session.operators.length > 1) {
    adapted.operators = session.operators.map(o => adaptOperatorSimple(o));
  } else if (session.operator) {
    adapted.operator = adaptOperatorSimple(session.operator);
  } else if (session.operators && session.operators.length === 1) {
    adapted.operator = adaptOperatorSimple(session.operators[0]);
  }

  return adapted;
}

module.exports = {
  createTimestamps,
  createSessionTimestamps,
  createSessionTimestampsWithEnd,
  adaptMachine,
  adaptMachineSimple,
  adaptOperator,
  adaptOperatorSimple,
  adaptOperatorFromDB,
  adaptItem,
  adaptItemSimple,
  adaptItemFromDB,
  adaptProgram,
  adaptCount,
  adaptMisfeed,
  adaptState,
  adaptStatus,
  adaptSession,
  createDefaultShift,
  parseIPAddress,
  adaptFaultFromDB
};
