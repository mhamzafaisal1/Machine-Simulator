const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const humanNamesSchema = require('./human-names');

// Operator Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'name'
  ],
  properties: {
    id: {
      type: 'integer',
      description: 'Number which uniquely identifies an operator, this will be used to log the operator in on machines. Currently this is code, this will take the place of code and where we display operator code/id we will be using this value going forward. We will be standardizing all definitions around ids instead of a mix of serialNumber/code/number/id/etc depending on object type, which currently causes confusion.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the operator is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this operator definition.'
    },
    name: {
      ...humanNamesSchema.schema,
      description: 'Name schema validated human-name object for this operator\'s name.'
    },
    groups: {
      type: 'object',
      properties: {
        area: {
          type: 'string'
        },
        category: {
          type: 'string'
        },
        department: {
          type: 'string'
        }
      },
      additionalProperties: false,
      description: 'Object containing any combination of three optional string child properties: area, category, department'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Operator Utility Functions
const utils = {
  /**
   * Initialize an operator object
   * @param {number} id - Required number of the id for the operator
   * @param {object} name - Required Name schema valid object for this operator's name
   * @param {object} [groups] - Optional parent object to the potential children Strings of 'area', 'category', or 'department'
   * @returns {object} Validated operator object
   */
  initOperator: (id, name, groups = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Build the operator object with required properties
    const operatorObject = {
      id,
      active: true,
      timestamps,
      name
    };

    // Add optional properties if provided
    if (groups !== null) {
      operatorObject.groups = groups;
    }

    // Validate against schema before returning
    const valid = validate(operatorObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return operatorObject;
  },

  /**
   * Get the full name of an operator
   * @param {object} operatorObject - Required Operator schema valid operatorObject
   * @returns {string} String of operator's full name
   */
  getFullName: (operatorObject) => {
    if (!operatorObject.name) {
      throw new Error('Operator object does not have a name.');
    }

    return humanNamesSchema.utils.getFullName('standard', operatorObject.name);
  },

  /**
   * Set the name of an operator
   * @param {object} operatorObject - Required Operator schema valid operatorObject
   * @param {object} name - Required Name schema valid object for this operator's name
   * @returns {object} Operator schema validated operatorObject
   */
  setName: (operatorObject, name) => {
    const now = new Date().toISOString();
    
    const updatedOperator = {
      ...operatorObject,
      name,
      timestamps: timestampsSchema.utils.stampUpdate(operatorObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedOperator);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedOperator;
  },

  /**
   * Set an operator to inactive
   * @param {object} operatorObject - Required Operator schema valid operatorObject
   * @returns {object} Operator schema validated operatorObject after inactivation
   */
  setInactive: (operatorObject) => {
    const now = new Date().toISOString();
    
    const updatedOperator = {
      ...operatorObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(operatorObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedOperator);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedOperator;
  },

  /**
   * Set an operator to active
   * @param {object} operatorObject - Required Operator schema valid operatorObject
   * @returns {object} Operator schema validated operatorObject after activation
   */
  setActive: (operatorObject) => {
    const now = new Date().toISOString();
    
    const updatedOperator = {
      ...operatorObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(operatorObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedOperator);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedOperator;
  },

  /**
   * Set a property on an operator object
   * @param {object} object - Required schema valid operator object
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Schema validated operator object with updated property
   */
  setProperty: (object, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedOperator = {
      ...object,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(object.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedOperator);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedOperator;
  }
};

module.exports = {
  schema,
  utils
};
