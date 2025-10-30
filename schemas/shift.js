const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const breakSchema = require('./break');

// Shift Schema Definition
const schema = {
  type: 'object',
  required: [
    'active',
    'timestamps',
    'shiftTime',
    'breaks'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this shift record'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the shift is active in the shift plan. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this shift definition.'
    },
    shiftTime: {
      type: 'number',
      description: 'Number value equal to timestamps.end - timestamps.start, in milliseconds.'
    },
    breaks: {
      type: 'array',
      items: {
        ...breakSchema.schema
      },
      description: 'Array of schema valid breakObjects. None are required, if none are present, property should be an empty array, not null or undefined.'
    },
    name: {
      type: 'string',
      description: 'String value representing the name of the shift'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Shift Utility Functions
const utils = {
  /**
   * Initialize a shift object
   * @param {object} timestamps - Required schema valid timestamps object, must contain timestamps.start and timestamps.end
   * @param {object[]} [breaks] - Optional array of schema valid breakObjects
   * @param {string} [name] - Optional string value of a label to use for this shift
   * @returns {object} Validated shift object
   */
  initShift: (timestamps, breaks = null, name = null) => {
    // Validate that timestamps has both start and end
    if (!timestamps.start || !timestamps.end) {
      throw new Error('Timestamps object must contain both start and end properties to define shift time.');
    }

    // Calculate shiftTime as timestamps.end - timestamps.start in milliseconds
    const startTime = new Date(timestamps.start).getTime();
    const endTime = new Date(timestamps.end).getTime();
    const shiftTime = endTime - startTime;

    // Validate that shiftTime is positive
    if (shiftTime <= 0) {
      throw new Error('Shift end time must be after start time.');
    }

    // Build the shift object with required properties
    const shiftObject = {
      active: true,
      timestamps,
      shiftTime,
      breaks: breaks || [] // If breaks is null, use empty array
    };

    // Add optional properties if provided
    if (name !== null) {
      shiftObject.name = name;
    }

    // Validate against schema before returning
    const valid = validate(shiftObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return shiftObject;
  },

  /**
   * Set a property on a shift object
   * @param {object} shiftObject - Required Shift schema valid shiftObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Shift schema validated object with updated property
   */
  setProperty: (shiftObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedShift = {
      ...shiftObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now)
    };

    // If we're updating timestamps.start or timestamps.end, recalculate shiftTime
    if (propertyToSet === 'timestamps' && valueToSet.start && valueToSet.end) {
      const startTime = new Date(valueToSet.start).getTime();
      const endTime = new Date(valueToSet.end).getTime();
      updatedShift.shiftTime = endTime - startTime;
    }

    // If we're updating breaks and it's null, convert to empty array
    if (propertyToSet === 'breaks' && valueToSet === null) {
      updatedShift.breaks = [];
    }

    // Validate against schema before returning
    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  /**
   * Set a shift to inactive
   * @param {object} shiftObject - Required Shift schema valid shiftObject
   * @returns {object} Shift schema validated shiftObject after inactivation
   */
  setInactive: (shiftObject) => {
    const now = new Date().toISOString();
    
    const updatedShift = {
      ...shiftObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  /**
   * Set a shift to active
   * @param {object} shiftObject - Required Shift schema valid shiftObject
   * @returns {object} Shift schema validated shiftObject after activation
   */
  setActive: (shiftObject) => {
    const now = new Date().toISOString();
    
    const updatedShift = {
      ...shiftObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  /**
   * Add a break to a shift
   * @param {object} shiftObject - Required Shift schema valid shiftObject
   * @param {object} breakObject - Required Break schema valid breakObject
   * @returns {object} Shift schema validated shiftObject with added break
   */
  addBreak: (shiftObject, breakObject) => {
    const now = new Date().toISOString();
    
    const updatedShift = {
      ...shiftObject,
      breaks: [...shiftObject.breaks, breakObject],
      timestamps: timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  /**
   * Remove a break from a shift by index
   * @param {object} shiftObject - Required Shift schema valid shiftObject
   * @param {number} breakIndex - Required index of break to remove
   * @returns {object} Shift schema validated shiftObject with removed break
   */
  removeBreak: (shiftObject, breakIndex) => {
    const now = new Date().toISOString();
    
    if (breakIndex < 0 || breakIndex >= shiftObject.breaks.length) {
      throw new Error('Break index is out of range.');
    }

    const updatedBreaks = [...shiftObject.breaks];
    updatedBreaks.splice(breakIndex, 1);
    
    const updatedShift = {
      ...shiftObject,
      breaks: updatedBreaks,
      timestamps: timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  /**
   * Update shift timestamps and recalculate shiftTime
   * @param {object} shiftObject - Required Shift schema valid shiftObject
   * @param {object} newTimestamps - Required new timestamps object with start and end
   * @returns {object} Shift schema validated shiftObject with updated timestamps and shiftTime
   */
  updateTimestamps: (shiftObject, newTimestamps) => {
    const now = new Date().toISOString();
    
    // Validate that new timestamps has both start and end
    if (!newTimestamps.start || !newTimestamps.end) {
      throw new Error('New timestamps object must contain both start and end properties.');
    }

    // Calculate new shiftTime
    const startTime = new Date(newTimestamps.start).getTime();
    const endTime = new Date(newTimestamps.end).getTime();
    const shiftTime = endTime - startTime;

    if (shiftTime <= 0) {
      throw new Error('Shift end time must be after start time.');
    }

    const updatedShift = {
      ...shiftObject,
      timestamps: timestampsSchema.utils.stampUpdate(newTimestamps, now),
      shiftTime
    };

    // Validate against schema before returning
    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  }
};

module.exports = {
  schema,
  utils
};
