const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');

// Fault Schema Definition
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
    id: {
      type: 'integer',
      description: 'Number which uniquely identifies a fault, this will be used to identify faults in the system. Currently this is code, this id will take the place of code and where we display fault code, we will be using this value going forward. We will be standardizing all definitions around ids instead of a mix of serialNumber/code/number/id/etc depending on object type, which currently causes confusion.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the fault is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this fault definition.'
    },
    name: {
      type: 'string',
      description: 'String value of the name of the fault'
    },
    jam: {
      type: 'number',
      description: 'Number value of jam for this fault (unsure what this truly means, need to clarify with Marty)'
    },
    softrolColor: {
      type: 'string',
      description: 'String value of the color we want Softrol to display for this fault. Needs rework, but needs to exist as an option for now.'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Fault Utility Functions
const utils = {
  /**
   * Initialize a fault object
   * @param {number} id - Required number value of the fault id
   * @param {string} name - Required string of the fault name
   * @param {number} jam - Required number value of jam for this fault
   * @param {string} [softrolColor] - Optional string value of the color for Softrol
   * @returns {object} Validated fault object
   */
  initFault: (id, name, jam, softrolColor = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Build the fault object with required properties
    const faultObject = {
      id,
      active: true,
      timestamps,
      name,
      jam
    };

    // Add optional properties if provided
    if (softrolColor !== null) {
      faultObject.softrolColor = softrolColor;
    }

    // Validate against schema before returning
    const valid = validate(faultObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return faultObject;
  },

  /**
   * Set a property on a fault object
   * @param {object} faultObject - Required Fault schema valid faultObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Fault schema validated object with updated property
   */
  setProperty: (faultObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedFault = {
      ...faultObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(faultObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedFault);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedFault;
  },

  /**
   * Set a fault to inactive
   * @param {object} faultObject - Required Fault schema valid faultObject
   * @returns {object} Fault schema validated faultObject after inactivation
   */
  setInactive: (faultObject) => {
    const now = new Date().toISOString();
    
    const updatedFault = {
      ...faultObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(faultObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedFault);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedFault;
  },

  /**
   * Set a fault to active
   * @param {object} faultObject - Required Fault schema valid faultObject
   * @returns {object} Fault schema validated faultObject after activation
   */
  setActive: (faultObject) => {
    const now = new Date().toISOString();
    
    const updatedFault = {
      ...faultObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(faultObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedFault);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedFault;
  }
};

module.exports = {
  schema,
  utils
};
