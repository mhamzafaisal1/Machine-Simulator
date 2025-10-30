const Ajv = require('ajv');
const ajv = new Ajv({ strictSchema: false });

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const machineSchema = require('./machine');
const itemSchema = require('./item');
const programSchema = require('./program');
const operatorSchema = require('./operator');
const shiftSchema = require('./shift');

// Sensor Count Schema Definition
const schema = {
  type: 'object',
  required: [
    'timestamps',
    'machine',
    'timers',
    'program',
    'shift'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this sensor count record'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this sensor count'
    },
    machine: {
      ...machineSchema.schema,
      description: 'Schema valid machineObject for the machine for this sensor count'
    },
    timers: {
      type: 'object',
      required: ['on', 'run', 'ready', 'broke', 'empty'],
      properties: {
        on: {
          type: 'number',
          description: 'Number value representing on timer'
        },
        run: {
          type: 'number',
          description: 'Number value representing run timer'
        },
        ready: {
          type: 'number',
          description: 'Number value representing ready timer'
        },
        broke: {
          type: 'number',
          description: 'Number value representing broke timer'
        },
        empty: {
          type: 'number',
          description: 'Number value representing empty timer'
        }
      },
      additionalProperties: false,
      description: 'Object with five required child properties, all Numbers: on, run, ready, broke, empty'
    },
    program: {
      ...programSchema.schema,
      description: 'Schema valid program definition of the program running on the machine for this sensor count'
    },
    shift: {
      ...shiftSchema.schema,
      description: 'Schema valid shift definition of the shift this sensor count was credited to'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid itemObject of the item(s) this sensor count was credited to'
    },
    largePieceFolder: {
      type: 'object',
      required: ['lane', 'input'],
      properties: {
        lane: {
          type: 'number',
          description: 'Number value representing the lane'
        },
        input: {
          type: 'number',
          description: 'Number value representing the input'
        }
      },
      additionalProperties: false,
      description: 'Object containing lane and input properties for large piece folder'
    },
    smallPieceFolder: {
      type: 'object',
      required: ['operator', 'station', 'input'],
      properties: {
        operator: {
          type: 'number',
          description: 'Number value representing the operator'
        },
        station: {
          type: 'number',
          description: 'Number value representing the station'
        },
        input: {
          type: 'number',
          description: 'Number value representing the input'
        }
      },
      additionalProperties: false,
      description: 'Object containing operator, station, and input properties for small piece folder'
    },
    feeder: {
      type: 'object',
      required: ['station', 'input'],
      properties: {
        station: {
          type: 'number',
          description: 'Number value representing the station'
        },
        input: {
          type: 'number',
          description: 'Number value representing the input'
        }
      },
      additionalProperties: false,
      description: 'Object containing station and input properties for feeder'
    },
    lane: {
      type: 'number',
      description: 'Number value representing the lane this count was credited to'
    },
    station: {
      type: 'number',
      description: 'Number value representing the station this sensorCount was credited to'
    },
    operator: {
      ...operatorSchema.schema,
      description: 'Schema valid operatorObject of the operator who was working on the machine when this stack was output'
    },
    operators: {
      type: 'array',
      items: {
        ...operatorSchema.schema
      },
      description: 'Array of schema valid operatorObjects of the operators who were working on the machine when this stack was output'
    }
  },
  additionalProperties: false,
  // Custom validation to ensure either 'operator' OR 'operators' is provided, but not both
  allOf: [
    {
      anyOf: [
        { required: ['operator'], not: { required: ['operators'] } },
        { required: ['operators'], not: { required: ['operator'] } }
      ]
    }
  ]
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Sensor Count Utility Functions
const utils = {
  /**
   * Initialize a sensor count object
   * @param {object} timestamps - Required schema valid timestamps object of when the sensor count happened
   * @param {object} machine - Required schema valid machineObject of machine this count was credited to
   * @param {object} timers - Required timers object with five required Number properties (on, run, ready, broke, empty)
   * @param {object} program - Required schema valid programObject of program the machine was running when this stack was output
   * @param {object} shift - Required schema valid shiftObject of the shift this sensor count was credited to
   * @param {object} [folderType] - Optional object with one property indicating folder type ('feeder', 'smallPieceFolder', or 'largePieceFolder')
   * @param {object} [item] - Optional schema valid itemObject of item this sensor count was credited to
   * @param {object|object[]} [operatorOrOperators] - Optional schema valid operatorObject or array of operatorObjects this sensor count was credited to
   * @param {number} [lane] - Optional number value of lane this count was credited to
   * @param {number} [station] - Optional number value of station this count was credited to
   * @returns {object} Validated sensor count object
   */
  initSensorCount: (timestamps, machine, timers, program, shift, folderType = null, item = null, operatorOrOperators = null, lane = null, station = null) => {
    // Build the sensor count object with required properties
    const sensorCountObject = {
      timestamps,
      machine,
      timers,
      program,
      shift
    };

    // Add folder type if provided
    if (folderType !== null) {
      if (folderType.feeder) {
        sensorCountObject.feeder = folderType.feeder;
      } else if (folderType.smallPieceFolder) {
        sensorCountObject.smallPieceFolder = folderType.smallPieceFolder;
      } else if (folderType.largePieceFolder) {
        sensorCountObject.largePieceFolder = folderType.largePieceFolder;
      }
    }

    // Add item if provided
    if (item !== null) {
      sensorCountObject.item = item;
    }

    // Handle operators - determine if it's a single operator or array
    if (operatorOrOperators !== null) {
      if (Array.isArray(operatorOrOperators)) {
        sensorCountObject.operators = operatorOrOperators;
      } else {
        sensorCountObject.operator = operatorOrOperators;
      }
    }

    // Add lane if provided
    if (lane !== null) {
      sensorCountObject.lane = lane;
    }

    // Add station if provided
    if (station !== null) {
      sensorCountObject.station = station;
    }

    // Validate against schema before returning
    const valid = validate(sensorCountObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return sensorCountObject;
  },

  /**
   * Set a property on a sensor count object
   * @param {object} sensorCountObject - Required Sensor Count schema valid sensorCountObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Sensor Count schema validated object with updated property
   */
  setProperty: (sensorCountObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedSensorCount = {
      ...sensorCountObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(sensorCountObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedSensorCount);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedSensorCount;
  },

  /**
   * Get sensor count summary information
   * @param {object} sensorCountObject - Required Sensor Count schema valid sensorCountObject
   * @returns {object} Summary object with key sensor count information
   */
  getSensorCountSummary: (sensorCountObject) => {
    const operatorNames = sensorCountObject.operator ? 
      [operatorSchema.utils.getFullName(sensorCountObject.operator)] : 
      sensorCountObject.operators ? sensorCountObject.operators.map(op => operatorSchema.utils.getFullName(op)) : [];

    const folderType = sensorCountObject.feeder ? 'feeder' : 
                      sensorCountObject.smallPieceFolder ? 'smallPieceFolder' : 
                      sensorCountObject.largePieceFolder ? 'largePieceFolder' : 'none';

    return {
      timestamp: sensorCountObject.timestamps.create,
      machine: machineSchema.utils.getIPAddress(sensorCountObject.machine),
      machineName: sensorCountObject.machine.name,
      programMode: sensorCountObject.program.mode,
      shiftName: sensorCountObject.shift.name || 'Unnamed Shift',
      itemName: sensorCountObject.item ? sensorCountObject.item.name : 'No Item',
      operatorNames,
      folderType,
      lane: sensorCountObject.lane || 'Not specified',
      station: sensorCountObject.station || 'Not specified',
      timers: sensorCountObject.timers
    };
  }
};

module.exports = {
  schema,
  utils
};
