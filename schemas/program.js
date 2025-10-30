const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const itemSchema = require('./item');

// Program Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'speed',
    'mode',
    'account',
    'batch'
  ],
  properties: {
    id: {
      type: 'integer',
      description: 'Number which identifies a program. Currently this is "programNumber", we will be replacing programNumber with this id.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the program is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this program definition.'
    },
    speed: {
      type: 'number',
      description: 'Number value of the speed of the machine for this program'
    },
    mode: {
      type: 'string',
      description: 'String value of the mode the machine is running in, typically either "largePiece" or "smallPiece" though not limited to these two'
    },
    account: {
      type: 'number',
      default: 0,
      description: 'Number value representing the account (customer) associated with this program. Not fully utilized at the moment, defaults to 0'
    },
    batch: {
      type: 'number',
      default: 0,
      description: 'Number value representing the batch number associated with this program. Similar to account, not fully utilized yet and defaults to 0'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid itemObject which represents the item definition associated with this program'
    },
    items: {
      type: 'array',
      items: {
        ...itemSchema.schema
      },
      description: 'Array of schema valid itemObjects which represent the item definitions associated with this program'
    },
    name: {
      type: 'string',
      description: 'String value of the name of the program'
    },
    stations: {
      type: 'number',
      description: 'Number value representing the number of active stations for this program, if this machine is/has a feeder'
    },
    pace: {
      type: 'number',
      description: 'Number value representing the intended pace standard, this only applies to some machines and will be phased out later'
    },
    configuration: {
      type: 'number',
      description: 'Number value representing the current configuration of the machine, this only applies to self-polling machines currently, like the AC 360s'
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

// Program Utility Functions
const utils = {
  /**
   * Initialize a program object
   * @param {number} id - Required number value of the program number
   * @param {string} mode - Required string value of the mode for this program
   * @param {number} speed - Required number value of the speed for this program
   * @param {object|object[]} itemOrItems - Required schema valid itemObject, or an array of schema valid itemObjects
   * @param {number} account - Required number value identifying the account associated with this program
   * @param {number} batch - Required number value identifying the batch associated with this program
   * @param {string} [name] - Optional string of the program name
   * @param {number} [stations] - Optional number of active stations for this program
   * @param {number} [pace] - Optional number value representing the intended pace standard
   * @param {number} [configuration] - Optional number value representing the current configuration
   * @returns {object} Validated program object
   */
  initProgram: (id, mode, speed, itemOrItems, account, batch, name = null, stations = null, pace = null, configuration = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Build the program object with required properties
    const programObject = {
      id,
      active: true,
      timestamps,
      speed,
      mode,
      account,
      batch
    };

    // Handle item/items - determine if it's a single item or array
    if (Array.isArray(itemOrItems)) {
      programObject.items = itemOrItems;
    } else {
      programObject.item = itemOrItems;
    }

    // Add optional properties if provided
    if (name !== null) {
      programObject.name = name;
    }

    if (stations !== null) {
      programObject.stations = stations;
    }

    if (pace !== null) {
      programObject.pace = pace;
    }

    if (configuration !== null) {
      programObject.configuration = configuration;
    }

    // Validate against schema before returning
    const valid = validate(programObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return programObject;
  },

  /**
   * Set a property on a program object
   * @param {object} programObject - Required Program schema valid programObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Program schema validated object with updated property
   */
  setProperty: (programObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedProgram = {
      ...programObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(programObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedProgram);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedProgram;
  },

  /**
   * Set a program to inactive
   * @param {object} programObject - Required Program schema valid programObject
   * @returns {object} Program schema validated programObject after inactivation
   */
  setInactive: (programObject) => {
    const now = new Date().toISOString();
    
    const updatedProgram = {
      ...programObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(programObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedProgram);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedProgram;
  },

  /**
   * Set a program to active
   * @param {object} programObject - Required Program schema valid programObject
   * @returns {object} Program schema validated programObject after activation
   */
  setActive: (programObject) => {
    const now = new Date().toISOString();
    
    const updatedProgram = {
      ...programObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(programObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedProgram);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedProgram;
  }
};

module.exports = {
  schema,
  utils
};
