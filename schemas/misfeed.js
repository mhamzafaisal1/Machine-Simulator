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

// Misfeed Schema Definition
const schema = {
  type: 'object',
  required: [
    'timestamps',
    'machine',
    'station',
    'program',
    'operator',
    'shift'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this misfeed record'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this misfeed'
    },
    machine: {
      ...machineSchema.schema,
      description: 'Schema valid machineObject for the machine for this misfeed'
    },
    station: {
      type: 'number',
      description: 'Number value representing the station this count was fed on'
    },
    program: {
      ...programSchema.schema,
      description: 'Schema valid program definition of the program running on the machine for this misfeed'
    },
    operator: {
      ...operatorSchema.schema,
      description: 'Schema valid operator definition of the operator who fed this misfeed'
    },
    shift: {
      ...shiftSchema.schema,
      description: 'Schema valid shift definition of the shift this misfeed was credited to'
    },
    session_id: {
      type: 'string',
      description: 'BSON ID of the session this misfeed was credited to'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid item definition of the item ran, if known'
    },
    lane: {
      type: 'number',
      description: 'Number value of lane this misfeed was credited to'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Misfeed Utility Functions
const utils = {
  /**
   * Initialize a misfeed object
   * @param {object} timestamps - Required schema valid timestamps object of when the misfeed happened
   * @param {object} machine - Required schema valid machineObject of machine this misfeed was credited to
   * @param {object} operator - Required schema valid operatorObject of operator this misfeed was credited to
   * @param {object} item - Required schema valid itemObject of item this misfeed was credited to
   * @param {object} program - Required schema valid programObject of program the machine was running for this misfeed
   * @param {number} station - Required number value of station this misfeed was credited to
   * @param {object} shift - Required schema valid shiftObject of the shift this count was credited to
   * @param {string} [session_id] - Optional BSON ID of the session this misfeed was credited to
   * @param {number} [lane] - Optional number value of lane this misfeed was credited to
   * @returns {object} Validated misfeed object
   */
  initMisfeed: (timestamps, machine, operator, item, program, station, shift, session_id = null, lane = null) => {
    // Build the misfeed object with required properties
    const misfeedObject = {
      timestamps,
      machine,
      station,
      program,
      operator,
      shift,
      item
    };

    // Add optional properties if provided
    if (session_id !== null) {
      misfeedObject.session_id = session_id;
    }

    if (lane !== null) {
      misfeedObject.lane = lane;
    }

    // Validate against schema before returning
    const valid = validate(misfeedObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return misfeedObject;
  },

  /**
   * Set a property on a misfeed object
   * @param {object} misfeedObject - Required Misfeed schema valid misfeedObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Misfeed schema validated object with updated property
   */
  setProperty: (misfeedObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedMisfeed = {
      ...misfeedObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(misfeedObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedMisfeed);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMisfeed;
  },

  /**
   * Set a misfeed to inactive
   * @param {object} misfeedObject - Required Misfeed schema valid misfeedObject
   * @returns {object} Misfeed schema validated misfeedObject after inactivation
   */
  setInactive: (misfeedObject) => {
    const now = new Date().toISOString();
    
    const updatedMisfeed = {
      ...misfeedObject,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(misfeedObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedMisfeed);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMisfeed;
  },

  /**
   * Set a misfeed to active
   * @param {object} misfeedObject - Required Misfeed schema valid misfeedObject
   * @returns {object} Misfeed schema validated misfeedObject after activation
   */
  setActive: (misfeedObject) => {
    const now = new Date().toISOString();
    
    const updatedMisfeed = {
      ...misfeedObject,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(misfeedObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedMisfeed);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMisfeed;
  },

  /**
   * Update misfeed timestamps
   * @param {object} misfeedObject - Required Misfeed schema valid misfeedObject
   * @param {object} newTimestamps - Required new timestamps object
   * @returns {object} Misfeed schema validated misfeedObject with updated timestamps
   */
  updateTimestamps: (misfeedObject, newTimestamps) => {
    const now = new Date().toISOString();
    
    const updatedMisfeed = {
      ...misfeedObject,
      timestamps: timestampsSchema.utils.stampUpdate(newTimestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedMisfeed);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMisfeed;
  },

  /**
   * Get misfeed summary information
   * @param {object} misfeedObject - Required Misfeed schema valid misfeedObject
   * @returns {object} Summary object with key misfeed information
   */
  getMisfeedSummary: (misfeedObject) => {
    return {
      timestamp: misfeedObject.timestamps.create,
      machine: machineSchema.utils.getIPAddress(misfeedObject.machine),
      machineName: misfeedObject.machine.name,
      station: misfeedObject.station,
      lane: misfeedObject.lane || 'Unknown',
      itemName: misfeedObject.item ? misfeedObject.item.name : 'Unknown Item',
      operatorName: operatorSchema.utils.getFullName(misfeedObject.operator),
      programMode: misfeedObject.program.mode,
      shiftName: misfeedObject.shift.name || 'Unnamed Shift',
      sessionId: misfeedObject.session_id || 'No Session'
    };
  }
};

module.exports = {
  schema,
  utils
};
