const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');

// Status Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'name',
    'jam'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this status record'
    },
    id: {
      type: 'integer',
      description: 'Number which uniquely identifies a status, this will be used to identify statuses in the system. Currently this is code, this id will take the place of code and where we display status code, we will be using this value going forward. We will be standardizing all definitions around ids instead of a mix of serialNumber/code/number/id/etc depending on object type, which currently causes confusion.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the status is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this status definition.'
    },
    name: {
      type: 'string',
      description: 'String value of the name of the status'
    },
    jam: {
      type: 'number',
      description: 'Number value of jam for this status (unsure what this truly means, need to clarify with Marty)'
    },
    softrolColor: {
      type: 'string',
      description: 'String value of the color we want Softrol to display for this status. Needs rework, but needs to exist as an option for now.'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Status Utility Functions
const utils = {
  /**
   * Initialize a status object
   * @param {number} id - Required number value of the status id
   * @param {string} name - Required string of the status name
   * @param {number} jam - Required number value of jam for this status
   * @param {string} [softrolColor] - Optional string value of the color for Softrol
   * @returns {object} Validated status object
   */
  initStatus: (id, name, jam, softrolColor = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Build the status object with required properties
    const statusObject = {
      id,
      active: true,
      timestamps,
      name,
      jam
    };

    // Add optional properties if provided
    if (softrolColor !== null) {
      statusObject.softrolColor = softrolColor;
    }

    // Validate against schema before returning
    const valid = validate(statusObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return statusObject;
  },

  /**
   * Set a property on a status object
   * @param {object} statusObject - Required Status schema valid statusObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Status schema validated object with updated property
   */
  setProperty: (statusObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedStatus = {
      ...statusObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(statusObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedStatus);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedStatus;
  },

  /**
   * Set a status to inactive
   * @param {object} statusObject - Required Status schema valid statusObject
   * @returns {object} Status schema validated statusObject after inactivation
   */
  setInactive: (statusObject) => {
    const now = new Date().toISOString();
    
    const updatedStatus = {
      ...statusObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(statusObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedStatus);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedStatus;
  },

  /**
   * Set a status to active
   * @param {object} statusObject - Required Status schema valid statusObject
   * @returns {object} Status schema validated statusObject after activation
   */
  setActive: (statusObject) => {
    const now = new Date().toISOString();
    
    const updatedStatus = {
      ...statusObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(statusObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedStatus);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedStatus;
  }
};

module.exports = {
  schema,
  utils
};
