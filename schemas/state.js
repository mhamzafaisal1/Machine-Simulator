const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const machineSchema = require('./machine');
const itemSchema = require('./item');
const programSchema = require('./program');
const operatorSchema = require('./operator');
const shiftSchema = require('./shift');

// State Schema Definition
const schema = {
  type: 'object',
  required: [
    'timestamps',
    'machine',
    'lanes',
    'program',
    'operators',
    'shift'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this state record'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this state'
    },
    machine: {
      ...machineSchema.schema,
      description: 'Schema valid machineObject for the machine for this state'
    },
    lanes: {
      type: 'number',
      description: 'Number value representing the number of lanes active for this state'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid itemObject of the item active for this state'
    },
    items: {
      type: 'array',
      items: {
        ...itemSchema.schema
      },
      description: 'Array of schema valid itemObjects of the items active for this state'
    },
    program: {
      ...programSchema.schema,
      description: 'Schema valid programObject of the program running on the machine for this state'
    },
    operators: {
      type: 'array',
      items: {
        ...operatorSchema.schema
      },
      description: 'Array of schema valid operatorObject of the operator who fed this state'
    },
    shift: {
      ...shiftSchema.schema,
      description: 'Schema valid shiftObject of the shift this state was credited to'
    },
    stations: {
      type: 'array',
      items: {
        type: 'number'
      },
      description: 'Array of Number values representing the active stations for this state. Each active station number will be a value in this array, so for example: if stations 1 and 3 are active on a machine, this array would be [1, 3].'
    },
    session_id: {
      type: 'string',
      description: 'String of BSON ID of the session this count was credited to'
    }
  },
  additionalProperties: false,
  // Custom validation to ensure either 'item' OR 'items' is provided, but not both
  anyOf: [
    {
      required: ['item'],
      not: { required: ['items'] }
    },
    {
      required: ['items'],
      not: { required: ['item'] }
    }
  ]
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// State Utility Functions
const utils = {
  /**
   * Initialize a state object
   * @param {object} timestamps - Required schema valid timestamps object of when the state happened
   * @param {object} machine - Required schema valid machineObject of machine this state was credited to
   * @param {object|object[]} operatorOrOperators - Required schema valid operatorObject or array of operatorObjects
   * @param {object|object[]} itemOrItems - Required schema valid itemObject or array of itemObjects active for this state
   * @param {object} program - Required schema valid programObject of program the machine was running for this state
   * @param {number} lanes - Required number value of number of active lanes for this state
   * @param {object} shift - Required schema valid shiftObject of the shift this state was credited to
   * @param {number[]} [stations] - Optional array of number values representing the active stations for this state
   * @param {string} [session_id] - Optional string of BSON ID of the session this state was credited to
   * @returns {object} Validated state object
   */
  initState: (timestamps, machine, operatorOrOperators, itemOrItems, program, lanes, shift, stations = null, session_id = null) => {
    // Handle operators - ensure it's always an array
    const operators = Array.isArray(operatorOrOperators) ? operatorOrOperators : [operatorOrOperators];

    // Handle items - determine if it's a single item or array
    let item, items;
    if (Array.isArray(itemOrItems)) {
      items = itemOrItems;
    } else {
      item = itemOrItems;
    }

    // Build the state object with required properties
    const stateObject = {
      timestamps,
      machine,
      lanes,
      program,
      operators,
      shift
    };

    // Add item or items based on what was provided
    if (item) {
      stateObject.item = item;
    } else if (items) {
      stateObject.items = items;
    }

    // Add optional properties if provided
    if (stations !== null) {
      stateObject.stations = stations;
    }

    if (session_id !== null) {
      stateObject.session_id = session_id;
    }

    // Validate against schema before returning
    const valid = validate(stateObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return stateObject;
  },

  /**
   * Set a property on a state object
   * @param {object} stateObject - Required State schema valid stateObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} State schema validated object with updated property
   */
  setProperty: (stateObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedState = {
      ...stateObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(stateObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedState);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedState;
  },

  /**
   * Set a state to inactive
   * @param {object} stateObject - Required State schema valid stateObject
   * @returns {object} State schema validated stateObject after inactivation
   */
  setInactive: (stateObject) => {
    const now = new Date().toISOString();
    
    const updatedState = {
      ...stateObject,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(stateObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedState);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedState;
  },

  /**
   * Set a state to active
   * @param {object} stateObject - Required State schema valid stateObject
   * @returns {object} State schema validated stateObject after activation
   */
  setActive: (stateObject) => {
    const now = new Date().toISOString();
    
    const updatedState = {
      ...stateObject,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(stateObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedState);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedState;
  },

  /**
   * Add an operator to the state
   * @param {object} stateObject - Required State schema valid stateObject
   * @param {object} operatorObject - Required Operator schema valid operatorObject
   * @returns {object} State schema validated stateObject with added operator
   */
  addOperator: (stateObject, operatorObject) => {
    const now = new Date().toISOString();
    
    const updatedState = {
      ...stateObject,
      operators: [...stateObject.operators, operatorObject],
      timestamps: timestampsSchema.utils.stampUpdate(stateObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedState);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedState;
  },

  /**
   * Remove an operator from the state by index
   * @param {object} stateObject - Required State schema valid stateObject
   * @param {number} operatorIndex - Required index of operator to remove
   * @returns {object} State schema validated stateObject with removed operator
   */
  removeOperator: (stateObject, operatorIndex) => {
    const now = new Date().toISOString();
    
    if (operatorIndex < 0 || operatorIndex >= stateObject.operators.length) {
      throw new Error('Operator index is out of range.');
    }

    const updatedOperators = [...stateObject.operators];
    updatedOperators.splice(operatorIndex, 1);
    
    const updatedState = {
      ...stateObject,
      operators: updatedOperators,
      timestamps: timestampsSchema.utils.stampUpdate(stateObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedState);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedState;
  },

  /**
   * Update state timestamps
   * @param {object} stateObject - Required State schema valid stateObject
   * @param {object} newTimestamps - Required new timestamps object
   * @returns {object} State schema validated stateObject with updated timestamps
   */
  updateTimestamps: (stateObject, newTimestamps) => {
    const now = new Date().toISOString();
    
    const updatedState = {
      ...stateObject,
      timestamps: timestampsSchema.utils.stampUpdate(newTimestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedState);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedState;
  },

  /**
   * Get state summary information
   * @param {object} stateObject - Required State schema valid stateObject
   * @returns {object} Summary object with key state information
   */
  getStateSummary: (stateObject) => {
    const operatorNames = stateObject.operators.map(op => operatorSchema.utils.getFullName(op));
    const itemNames = stateObject.item ? [stateObject.item.name] : stateObject.items.map(item => item.name);
    
    return {
      timestamp: stateObject.timestamps.create,
      machine: machineSchema.utils.getIPAddress(stateObject.machine),
      machineName: stateObject.machine.name,
      lanes: stateObject.lanes,
      stations: stateObject.stations || 'No Active Stations',
      itemNames: itemNames,
      operatorNames: operatorNames,
      programMode: stateObject.program.mode,
      shiftName: stateObject.shift.name || 'Unnamed Shift',
      sessionId: stateObject.session_id || 'No Session'
    };
  }
};

module.exports = {
  schema,
  utils
};
