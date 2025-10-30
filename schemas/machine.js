const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const ipAddressSchema = require('./ipAddress');

// Machine Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'name',
    'timestamps',
    'ipAddress',
    'lanes',
    'type',
    'polled'
  ],
  properties: {
    id: {
      type: 'integer',
      description: 'Number which uniquely identifies a Chicago machine. Currently this is serialNumber, this will take the place of Serial Number and where we display "serial number" we will be using this value going forward.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the machine is active in the system. Default is true.'
    },
    name: {
      type: 'string',
      description: 'String of the human readable name for the machine to be used for labeling this machine in various places'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this machine definition.'
    },
    ipAddress: {
      ...ipAddressSchema.schema,
      description: "IP Address schema validated ip address object for this machine's ip address."
    },
    lanes: {
      type: 'integer',
      minimum: 1,
      description: 'Number of lanes on machine. If a feeder, this is equal to stations'
    },
    type: {
      type: 'string',
      description: "String representing the type of machine. Ex: 'feeder', 'ironer', 'largePieceFolder', 'smallPieceFolder'. Type is not limited to these four possible options however."
    },
    polled: {
      type: 'boolean',
      description: 'Boolean setting for if machine should be polled by the DataFeed. If true, this is a polled DataFeed machine, like CT machines are. If false, this is a self-reporting machine, like an AC 360.'
    },
    model: {
      type: 'object',
      description: 'Freeform object right now which will be utilized to house model/family information for machines in the future'
    },
    stations: {
      type: 'integer',
      minimum: 1,
      description: 'Number of feeder input stations installed on the machine, only used if machine is a feeder'
    },
    location: {
      type: 'string',
      description: 'String location of machine in laundry'
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
      description: 'Object containing three optional string child properties: area, category, department'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Machine Utility Functions
const utils = {
  /**
   * Initialize a machine object
   * @param {number} id - Required number of the serial number for the machine
   * @param {string} name - Required string of the human readable name for the machine
   * @param {object} ipAddress - Required IP Address schema validated object for this machine's ipAddress
   * @param {number} lanes - Required number of lanes on machine
   * @param {string} type - Required string representing the type of machine
   * @param {boolean} polled - Required boolean for whether a machine is polled by the DataFeed
   * @param {string} [location] - Optional string location of machine in laundry
   * @param {object} [groups] - Optional parent object to the potential children Strings of 'area', 'category', or 'department'
   * @param {number} [stations] - Optional number of stations on machine if a feeder/directly fed machine
   * @returns {object} Validated machine object
   */
  initMachine: (id, name, ipAddress, lanes, type, polled, location = null, groups = null, stations = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Build the machine object with required properties
    const machineObject = {
      id,
      active: true,
      name,
      timestamps,
      ipAddress,
      lanes,
      type,
      polled
    };

    // Add optional properties if provided
    if (location !== null) {
      machineObject.location = location;
    }

    if (groups !== null) {
      machineObject.groups = groups;
    }

    if (stations !== null) {
      machineObject.stations = stations;
    }

    // Validate against schema before returning
    const valid = validate(machineObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return machineObject;
  },

  /**
   * Get the IP address string from a machine object
   * @param {object} machineObject - Required machine schema validated machineObject
   * @returns {string} String of machine's IP Address
   */
  getIPAddress: (machineObject) => {
    if (!machineObject.ipAddress) {
      throw new Error('Machine object does not have an IP address.');
    }

    return ipAddressSchema.utils.getIPAddressString(machineObject.ipAddress);
  },

  /**
   * Set/update the IP address on a machine object
   * @param {object} machineObject - Required machine schema validated machineObject
   * @param {object} newIPAddress - Required IP Address schema validated object
   * @returns {object} Machine schema validated machineObject with updated IP address
   */
  setIPAddress: (machineObject, newIPAddress) => {
    const now = new Date().toISOString();
    
    const updatedMachine = {
      ...machineObject,
      ipAddress: newIPAddress,
      timestamps: timestampsSchema.utils.stampUpdate(machineObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedMachine);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMachine;
  },

  /**
   * Set a machine to inactive
   * @param {object} machineObject - Required machine schema validated machineObject
   * @returns {object} Machine schema validated machineObject after inactivation
   */
  setInactive: (machineObject) => {
    const now = new Date().toISOString();
    
    const updatedMachine = {
      ...machineObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(machineObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedMachine);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMachine;
  },

  /**
   * Set a machine to active
   * @param {object} machineObject - Required machine schema validated machineObject
   * @returns {object} Machine schema validated machineObject after activation
   */
  setActive: (machineObject) => {
    const now = new Date().toISOString();
    
    const updatedMachine = {
      ...machineObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(machineObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedMachine);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMachine;
  },

  /**
   * Set a property on a machine object
   * @param {object} object - Required schema valid machine object
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Schema validated machine object with updated property
   */
  setProperty: (object, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedMachine = {
      ...object,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(object.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedMachine);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMachine;
  }
};

module.exports = {
  schema,
  utils
};

