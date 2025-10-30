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

// Count Schema Definition
const schema = {
  type: 'object',
  required: [
    'timestamps',
    'machine',
    'lane',
    'station',
    'item',
    'program',
    'operator',
    'shift'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this count record'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this count'
    },
    machine: {
      ...machineSchema.schema,
      description: 'Schema valid machineObject for the machine for this count'
    },
    lane: {
      type: 'number',
      description: 'Number value representing the lane this count was output on after folding'
    },
    station: {
      type: 'number',
      description: 'Number value representing the station this count was fed on'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid item definition of the item ran'
    },
    program: {
      ...programSchema.schema,
      description: 'Schema valid program definition of the program running on the machine for this count'
    },
    operator: {
      ...operatorSchema.schema,
      description: 'Schema valid operator definition of the operator who fed this count'
    },
    shift: {
      ...shiftSchema.schema,
      description: 'Schema valid shift definition of the shift this count was credited to'
    },
    session_id: {
      type: 'string',
      description: 'String of BSON ID of the session this count was credited to'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Count Utility Functions
const utils = {
  /**
   * Initialize a count object
   * @param {object} timestamps - Required schema valid timestamps object of when the count happened
   * @param {object} machine - Required schema valid machineObject of machine this count was credited to
   * @param {object} operator - Required schema valid operatorObject of operator this count was credited to
   * @param {object} item - Required schema valid itemObject of item this count was credited to
   * @param {object} program - Required schema valid programObject of program the machine was running for this count
   * @param {number} lane - Required number value of lane this count was credited to
   * @param {number} station - Required number value of station this count was credited to
   * @param {object} shift - Required schema valid shiftObject of the shift this count was credited to
   * @param {string} [session_id] - Optional string of BSON ID of the session this count was credited to
   * @returns {object} Validated count object
   */
  initCount: (timestamps, machine, operator, item, program, lane, station, shift, session_id = null) => {
    // Build the count object with required properties
    const countObject = {
      timestamps,
      machine,
      lane,
      station,
      item,
      program,
      operator,
      shift
    };

    // Add optional properties if provided
    if (session_id !== null) {
      countObject.session_id = session_id;
    }

    // Validate against schema before returning
    const valid = validate(countObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return countObject;
  },

  /**
   * Set a property on a count object
   * @param {object} countObject - Required Count schema valid countObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Count schema validated object with updated property
   */
  setProperty: (countObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedCount = {
      ...countObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(countObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedCount);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedCount;
  },

  /**
   * Set a count to inactive
   * @param {object} countObject - Required Count schema valid countObject
   * @returns {object} Count schema validated countObject after inactivation
   */
  setInactive: (countObject) => {
    const now = new Date().toISOString();
    
    const updatedCount = {
      ...countObject,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(countObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedCount);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedCount;
  },

  /**
   * Set a count to active
   * @param {object} countObject - Required Count schema valid countObject
   * @returns {object} Count schema validated countObject after activation
   */
  setActive: (countObject) => {
    const now = new Date().toISOString();
    
    const updatedCount = {
      ...countObject,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(countObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedCount);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedCount;
  },

  /**
   * Update count timestamps
   * @param {object} countObject - Required Count schema valid countObject
   * @param {object} newTimestamps - Required new timestamps object
   * @returns {object} Count schema validated countObject with updated timestamps
   */
  updateTimestamps: (countObject, newTimestamps) => {
    const now = new Date().toISOString();
    
    const updatedCount = {
      ...countObject,
      timestamps: timestampsSchema.utils.stampUpdate(newTimestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedCount);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedCount;
  },

  /**
   * Get count summary information
   * @param {object} countObject - Required Count schema valid countObject
   * @returns {object} Summary object with key count information
   */
  getCountSummary: (countObject) => {
    return {
      timestamp: countObject.timestamps.create,
      machine: machineSchema.utils.getIPAddress(countObject.machine),
      machineName: countObject.machine.name,
      lane: countObject.lane,
      station: countObject.station,
      itemName: countObject.item.name,
      operatorName: operatorSchema.utils.getFullName(countObject.operator),
      programMode: countObject.program.mode,
      shiftName: countObject.shift.name || 'Unnamed Shift',
      sessionId: countObject.session_id || 'No Session'
    };
  }
};

module.exports = {
  schema,
  utils
};
