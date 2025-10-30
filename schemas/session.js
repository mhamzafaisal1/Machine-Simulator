const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const machineSchema = require('./machine');
const metricsSchema = require('./metrics');
const itemSchema = require('./item');
const programSchema = require('./program');
const operatorSchema = require('./operator');
const stateSchema = require('./state');
const countSchema = require('./count');
const misfeedSchema = require('./misfeed');
const shiftSchema = require('./shift');

// Session Schema Definition
const schema = {
  type: 'object',
  required: [
    'timestamps',
    'machine',
    'metrics',
    'program',
    'states',
    'counts',
    'shift'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this session record'
    },
    timestamps: {
      ...timestampsSchema.schema,
      properties: {
        ...timestampsSchema.schema.properties,
        start: {
          type: 'string',
          format: 'date-time',
          description: 'Timestamp of when the session started'
        },
        end: {
          type: 'string',
          format: 'date-time',
          description: 'Timestamp of when the session ended'
        }
      },
      description: 'Timestamps schema validated timestamps object for this session. Must also have .start and .end'
    },
    machine: {
      ...machineSchema.schema,
      description: 'Schema valid machineObject for the machine for this session'
    },
    metrics: {
      ...metricsSchema.schema,
      description: 'Schema valid metricsObject for this session'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid itemObject of the item active for this session'
    },
    items: {
      type: 'array',
      items: {
        ...itemSchema.schema
      },
      description: 'Array of schema valid itemObjects of the items active for this session'
    },
    program: {
      ...programSchema.schema,
      description: 'Schema valid programObject of the program running on the machine for this session'
    },
    operator: {
      ...operatorSchema.schema,
      description: 'Schema valid operatorObject of the operator who was credited with work in this session'
    },
    operators: {
      type: 'array',
      items: {
        ...operatorSchema.schema
      },
      description: 'Array of schema valid operatorObjects of the operators who were credited with work in this session'
    },
    states: {
      type: 'object',
      required: ['start', 'array'],
      properties: {
        start: {
          ...stateSchema.schema,
          description: 'Schema valid stateObject record which started this session'
        },
        array: {
          type: 'array',
          items: {
            ...stateSchema.schema
          },
          description: 'Array of schema valid stateObjects representing any state records which have occurred during this session without ending it'
        },
        end: {
          ...stateSchema.schema,
          description: 'Schema valid stateObject record which ended this session, if it has ended'
        }
      },
      additionalProperties: false,
      description: 'Object with two required, one optional, child properties: start, array, and end'
    },
    counts: {
      type: 'object',
      required: ['valid', 'misfeed'],
      properties: {
        valid: {
          type: 'array',
          items: {
            ...countSchema.schema
          },
          description: 'Array of schema valid countObject records which are credited to this session. Can be empty.'
        },
        misfeed: {
          type: 'array',
          items: {
            ...misfeedSchema.schema
          },
          description: 'Array of schema valid misfeedObject records which are credited to this session. Can be empty.'
        }
      },
      additionalProperties: false,
      description: 'Object with two required child properties: valid and misfeed arrays'
    },
    shift: {
      ...shiftSchema.schema,
      description: 'Schema valid shiftObject of the shift this session was credited to'
    }
  },
  additionalProperties: false,
  // Custom validation to ensure either 'item' OR 'items' is provided, but not both
  // AND either 'operator' OR 'operators' is provided, but not both
  allOf: [
    {
      anyOf: [
        { required: ['item'], not: { required: ['items'] } },
        { required: ['items'], not: { required: ['item'] } }
      ]
    },
    {
      anyOf: [
        { required: ['operator'], not: { required: ['operators'] } },
        { required: ['operators'], not: { required: ['operator'] } }
      ]
    }
  ]
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Session Utility Functions
const utils = {
  /**
   * Initialize a session object
   * @param {object} timestamps - Required schema valid timestamps object for this session
   * @param {object} machine - Required schema valid machineObject of machine this session was credited to
   * @param {object} metrics - Required schema valid metricsObject for this session
   * @param {object|object[]} itemOrItems - Required schema valid itemObject or array of itemObjects active for this session
   * @param {object} program - Required schema valid programObject of program the machine was running for this session
   * @param {object|object[]} operatorOrOperators - Required schema valid operatorObject or array of operatorObjects this session was credited to
   * @param {object} states - Required object with start, array, and optional end properties
   * @param {object} counts - Required object with valid and misfeed arrays
   * @param {object} shift - Required schema valid shiftObject associated with this session
   * @returns {object} Validated session object
   */
  initSession: (timestamps, machine, metrics, itemOrItems, program, operatorOrOperators, states, counts, shift) => {
    // Validate that timestamps has both start and end
    if (!timestamps.start || !timestamps.end) {
      throw new Error('Timestamps object must contain both start and end properties for session.');
    }

    // Handle items - determine if it's a single item or array
    let item, items;
    if (Array.isArray(itemOrItems)) {
      items = itemOrItems;
    } else {
      item = itemOrItems;
    }

    // Handle operators - determine if it's a single operator or array
    let operator, operators;
    if (Array.isArray(operatorOrOperators)) {
      operators = operatorOrOperators;
    } else {
      operator = operatorOrOperators;
    }

    // Build the session object with required properties
    const sessionObject = {
      timestamps,
      machine,
      metrics,
      program,
      states,
      counts,
      shift
    };

    // Add item or items based on what was provided
    if (item) {
      sessionObject.item = item;
    } else if (items) {
      sessionObject.items = items;
    }

    // Add operator or operators based on what was provided
    if (operator) {
      sessionObject.operator = operator;
    } else if (operators) {
      sessionObject.operators = operators;
    }

    // Validate against schema before returning
    const valid = validate(sessionObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return sessionObject;
  },

  /**
   * Set a property on a session object
   * @param {object} sessionObject - Required Session schema valid sessionObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Session schema validated object with updated property
   */
  setProperty: (sessionObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedSession = {
      ...sessionObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(sessionObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedSession;
  },

  /**
   * Push a count into the session
   * @param {object} sessionObject - Required Session schema valid sessionObject to push the count into
   * @param {object} countToPush - Required schema valid countObject
   * @returns {object} Session schema validated sessionObject with added count
   */
  pushCount: (sessionObject, countToPush) => {
    const now = new Date().toISOString();
    
    // Update timestamps.update to the timestamps.update in the countToPush
    const updatedTimestamps = timestampsSchema.utils.stampUpdate(
      sessionObject.timestamps, 
      countToPush.timestamps.update
    );

    // Push the count into counts.valid[]
    const updatedCounts = {
      ...sessionObject.counts,
      valid: [...sessionObject.counts.valid, countToPush]
    };

    // Recalculate metrics for metricsObject and reInit metricsObject
    // TODO: Implement proper metrics recalculation based on updated counts
    // For now, using a stub that maintains the existing metrics structure
    const updatedMetrics = metricsSchema.utils.setProperty(
      sessionObject.metrics, 
      'totals', 
      {
        ...sessionObject.metrics.totals,
        counts: {
          valid: sessionObject.metrics.totals.counts.valid + 1,
          misfeed: sessionObject.metrics.totals.counts.misfeed
        }
      }
    );

    const updatedSession = {
      ...sessionObject,
      timestamps: updatedTimestamps,
      counts: updatedCounts,
      metrics: updatedMetrics
    };

    // Validate against schema before returning
    const valid = validate(updatedSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedSession;
  },

  /**
   * Push a misfeed into the session
   * @param {object} sessionObject - Required Session schema valid sessionObject to push the misfeed into
   * @param {object} misfeedToPush - Required schema valid misfeedObject
   * @returns {object} Session schema validated sessionObject with added misfeed
   */
  pushMisfeed: (sessionObject, misfeedToPush) => {
    const now = new Date().toISOString();
    
    // Update timestamps.update to the timestamps.update in the misfeedToPush
    const updatedTimestamps = timestampsSchema.utils.stampUpdate(
      sessionObject.timestamps, 
      misfeedToPush.timestamps.update
    );

    // Push the misfeed into counts.misfeed[]
    const updatedCounts = {
      ...sessionObject.counts,
      misfeed: [...sessionObject.counts.misfeed, misfeedToPush]
    };

    // Recalculate metrics for metricsObject and reInit metricsObject
    // TODO: Implement proper metrics recalculation based on updated misfeeds
    // For now, using a stub that maintains the existing metrics structure
    const updatedMetrics = metricsSchema.utils.setProperty(
      sessionObject.metrics, 
      'totals', 
      {
        ...sessionObject.metrics.totals,
        counts: {
          valid: sessionObject.metrics.totals.counts.valid,
          misfeed: sessionObject.metrics.totals.counts.misfeed + 1
        }
      }
    );

    const updatedSession = {
      ...sessionObject,
      timestamps: updatedTimestamps,
      counts: updatedCounts,
      metrics: updatedMetrics
    };

    // Validate against schema before returning
    const valid = validate(updatedSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedSession;
  },

  /**
   * Push a state into the session
   * @param {object} sessionObject - Required Session schema valid sessionObject to push the state into
   * @param {object} stateToPush - Required schema valid stateObject
   * @param {boolean} [isEndState] - Optional boolean value, only true if the state being pushed is the end state for this session
   * @returns {object} Session schema validated sessionObject with added state
   */
  pushState: (sessionObject, stateToPush, isEndState = false) => {
    const now = new Date().toISOString();
    
    // Update timestamps.update to the timestamps.update in the stateToPush
    const updatedTimestamps = timestampsSchema.utils.stampUpdate(
      sessionObject.timestamps, 
      stateToPush.timestamps.update
    );

    // Push the state into states.array[]
    const updatedStates = {
      ...sessionObject.states,
      array: [...sessionObject.states.array, stateToPush]
    };

    // If isEndState == true, assign the timestamps.update in the stateToPush to the timestamps.end for this session
    // and assign the stateToPush to states.end
    if (isEndState) {
      updatedTimestamps.end = stateToPush.timestamps.update;
      updatedStates.end = stateToPush;
    }

    // Recalculate metrics for metricsObject and reInit metricsObject
    // TODO: Implement proper metrics recalculation based on updated states
    // For now, using a stub that maintains the existing metrics structure
    const updatedMetrics = metricsSchema.utils.setProperty(
      sessionObject.metrics, 
      'timers', 
      {
        ...sessionObject.metrics.timers,
        elapsed: sessionObject.metrics.timers.elapsed + 1000 // Placeholder: add 1 second
      }
    );

    const updatedSession = {
      ...sessionObject,
      timestamps: updatedTimestamps,
      states: updatedStates,
      metrics: updatedMetrics
    };

    // Validate against schema before returning
    const valid = validate(updatedSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedSession;
  },

  /**
   * Get session summary information
   * @param {object} sessionObject - Required Session schema valid sessionObject
   * @returns {object} Summary object with key session information
   */
  getSessionSummary: (sessionObject) => {
    const validCounts = sessionObject.counts.valid.length;
    const misfeedCounts = sessionObject.counts.misfeed.length;
    const stateCount = sessionObject.states.array.length;
    const hasEndState = !!sessionObject.states.end;
    
    const operatorNames = sessionObject.operator ? 
      [operatorSchema.utils.getFullName(sessionObject.operator)] : 
      sessionObject.operators.map(op => operatorSchema.utils.getFullName(op));
    
    const itemNames = sessionObject.item ? 
      [sessionObject.item.name] : 
      sessionObject.items.map(item => item.name);

    return {
      startTime: sessionObject.timestamps.start,
      endTime: sessionObject.timestamps.end || 'Session Active',
      machine: machineSchema.utils.getIPAddress(sessionObject.machine),
      machineName: sessionObject.machine.name,
      validCounts,
      misfeedCounts,
      stateCount,
      hasEndState,
      operatorNames,
      itemNames,
      programMode: sessionObject.program.mode,
      shiftName: sessionObject.shift.name || 'Unnamed Shift'
    };
  }
};

module.exports = {
  schema,
  utils
};
