const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');

// Break Schema Definition
const schema = {
  type: 'object',
  required: [
    'active',
    'timestamps',
    'breakTime'
  ],
  properties: {
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the break is active in the shift. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this break definition.'
    },
    breakTime: {
      type: 'number',
      description: 'Number value equal to timestamps.end - timestamps.start, in milliseconds.'
    },
    name: {
      type: 'string',
      description: 'String value representing the name of the break'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Break Utility Functions
const utils = {
  /**
   * Initialize a break object
   * @param {object} timestamps - Required schema valid timestamps object, must contain timestamps.start and timestamps.end
   * @param {string} [name] - Optional string value of a label to use for this break
   * @returns {object} Validated break object
   */
  initBreak: (timestamps, name = null) => {
    // Validate that timestamps has both start and end
    if (!timestamps.start || !timestamps.end) {
      throw new Error('Timestamps object must contain both start and end properties to define break time.');
    }

    // Calculate breakTime as timestamps.end - timestamps.start in milliseconds
    const startTime = new Date(timestamps.start).getTime();
    const endTime = new Date(timestamps.end).getTime();
    const breakTime = endTime - startTime;

    // Validate that breakTime is positive
    if (breakTime <= 0) {
      throw new Error('Break end time must be after start time.');
    }

    // Build the break object with required properties
    const breakObject = {
      active: true,
      timestamps,
      breakTime
    };

    // Add optional properties if provided
    if (name !== null) {
      breakObject.name = name;
    }

    // Validate against schema before returning
    const valid = validate(breakObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return breakObject;
  },

  /**
   * Set a property on a break object
   * @param {object} breakObject - Required Break schema valid breakObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Break schema validated object with updated property
   */
  setProperty: (breakObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedBreak = {
      ...breakObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(breakObject.timestamps, now)
    };

    // If we're updating timestamps.start or timestamps.end, recalculate breakTime
    if (propertyToSet === 'timestamps' && valueToSet.start && valueToSet.end) {
      const startTime = new Date(valueToSet.start).getTime();
      const endTime = new Date(valueToSet.end).getTime();
      updatedBreak.breakTime = endTime - startTime;
    }

    // Validate against schema before returning
    const valid = validate(updatedBreak);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedBreak;
  },

  /**
   * Set a break to inactive
   * @param {object} breakObject - Required Break schema valid breakObject
   * @returns {object} Break schema validated breakObject after inactivation
   */
  setInactive: (breakObject) => {
    const now = new Date().toISOString();
    
    const updatedBreak = {
      ...breakObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(breakObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedBreak);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedBreak;
  },

  /**
   * Set a break to active
   * @param {object} breakObject - Required Break schema valid breakObject
   * @returns {object} Break schema validated breakObject after activation
   */
  setActive: (breakObject) => {
    const now = new Date().toISOString();
    
    const updatedBreak = {
      ...breakObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(breakObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedBreak);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedBreak;
  },

  /**
   * Update break timestamps and recalculate breakTime
   * @param {object} breakObject - Required Break schema valid breakObject
   * @param {object} newTimestamps - Required new timestamps object with start and end
   * @returns {object} Break schema validated breakObject with updated timestamps and breakTime
   */
  updateTimestamps: (breakObject, newTimestamps) => {
    const now = new Date().toISOString();
    
    // Validate that new timestamps has both start and end
    if (!newTimestamps.start || !newTimestamps.end) {
      throw new Error('New timestamps object must contain both start and end properties.');
    }

    // Calculate new breakTime
    const startTime = new Date(newTimestamps.start).getTime();
    const endTime = new Date(newTimestamps.end).getTime();
    const breakTime = endTime - startTime;

    if (breakTime <= 0) {
      throw new Error('Break end time must be after start time.');
    }

    const updatedBreak = {
      ...breakObject,
      timestamps: timestampsSchema.utils.stampUpdate(newTimestamps, now),
      breakTime
    };

    // Validate against schema before returning
    const valid = validate(updatedBreak);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedBreak;
  }
};

module.exports = {
  schema,
  utils
};
