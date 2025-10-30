const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');

// Item Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'name',
    'standard'
  ],
  properties: {
    id: {
      type: 'integer',
      description: 'Number which uniquely identifies an item, this will be used to identify items in the system. Currently this is number, this id will take the place of number and where we display item number/id, we will be using this value going forward. We will be standardizing all definitions around ids instead of a mix of serialNumber/code/number/id/etc depending on object type, which currently causes confusion.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the item is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this item definition.'
    },
    name: {
      type: 'string',
      description: 'String value of the name of the item'
    },
    standard: {
      type: 'number',
      description: 'Number value representing the pace standard, in Pieces Per Hour, for this item'
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
    },
    weight: {
      type: 'object',
      required: ['value', 'unit', 'per'],
      properties: {
        value: {
          type: 'number',
          description: 'Number value weight for the item'
        },
        unit: {
          type: 'string',
          enum: ['ounce', 'pound', 'gram'],
          default: 'gram',
          description: 'String value of the unit of measure for the weight. Options are ounce, pound, or gram. Default is grams.'
        },
        per: {
          type: 'number',
          default: 1,
          description: 'Number value representing how many items equal the value. This allows the option of setting a more average value across a number of items instead of a weight per individual piece. Can also help for defining weights for small pieces. Default is 1.'
        }
      },
      additionalProperties: false,
      description: 'Object containing three child properties (if weight is specified, all three child properties are required): value, unit, and per'
    },
    machineTypes: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: 'Array of strings to hold specific machineTypes an item is available on. If undefined/empty, item is available on all machineTypes'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Item Utility Functions
const utils = {
  /**
   * Initialize an item object
   * @param {number} id - Required number value of the item number
   * @param {string} name - Required string of the item name
   * @param {number} standard - Required number value representing the pace standard, in Pieces Per Hour, for this item
   * @param {string[]} [machineTypes] - Optional array of strings representing the machine types this item is available on
   * @param {object} [groups] - Optional parent object to the potential children Strings of 'area', 'category', or 'department'
   * @param {object} [weight] - Optional parent object, if provided must contain 'value', 'unit', and 'per'
   * @returns {object} Validated item object
   */
  initItem: (id, name, standard, machineTypes = null, groups = null, weight = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Build the item object with required properties
    const itemObject = {
      id,
      active: true,
      timestamps,
      name,
      standard
    };

    // Add optional properties if provided
    if (machineTypes !== null) {
      itemObject.machineTypes = machineTypes;
    }

    if (groups !== null) {
      itemObject.groups = groups;
    }

    if (weight !== null) {
      itemObject.weight = weight;
    }

    // Validate against schema before returning
    const valid = validate(itemObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return itemObject;
  },

  /**
   * Set a property on an item object
   * @param {object} itemObject - Required Item schema valid itemObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Item schema validated object with updated property
   */
  setProperty: (itemObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedItem = {
      ...itemObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(itemObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedItem);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedItem;
  },

  /**
   * Set an item to inactive
   * @param {object} itemObject - Required Item schema valid itemObject
   * @returns {object} Item schema validated itemObject after inactivation
   */
  setInactive: (itemObject) => {
    const now = new Date().toISOString();
    
    const updatedItem = {
      ...itemObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(itemObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedItem);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedItem;
  },

  /**
   * Set an item to active
   * @param {object} itemObject - Required Item schema valid itemObject
   * @returns {object} Item schema validated itemObject after activation
   */
  setActive: (itemObject) => {
    const now = new Date().toISOString();
    
    const updatedItem = {
      ...itemObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(itemObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedItem);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedItem;
  }
};

module.exports = {
  schema,
  utils
};
