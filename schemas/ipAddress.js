const Ajv = require('ajv');
const ajv = new Ajv({ strictSchema: false });

// IPv4 Address Schema Definition
const schema = {
  type: 'object',
  required: [
    'firstOctet',
    'secondOctet',
    'thirdOctet',
    'fourthOctet'
  ],
  properties: {
    firstOctet: {
      type: 'integer',
      minimum: 0,
      maximum: 255,
      description: 'Number between 0 and 255, represents the first octet of an IP address'
    },
    secondOctet: {
      type: 'integer',
      minimum: 0,
      maximum: 255,
      description: 'Number between 0 and 255, represents the second octet of an IP address'
    },
    thirdOctet: {
      type: 'integer',
      minimum: 0,
      maximum: 255,
      description: 'Number between 0 and 255, represents the third octet of an IP address'
    },
    fourthOctet: {
      type: 'integer',
      minimum: 0,
      maximum: 255,
      description: 'Number between 0 and 255, represents the fourth octet of an IP address'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// IPv4 Address Utility Functions
const utils = {
  /**
   * Initialize an IP address object
   * @param {number} firstOctet - Required number between 0 and 255 inclusive
   * @param {number} secondOctet - Required number between 0 and 255 inclusive
   * @param {number} thirdOctet - Required number between 0 and 255 inclusive
   * @param {number} fourthOctet - Required number between 0 and 255 inclusive
   * @returns {object} IP address object with all four octets
   */
  initIPAddress: (firstOctet, secondOctet, thirdOctet, fourthOctet) => {
    // Validate all octets
    const octets = [
      { name: 'firstOctet', value: firstOctet },
      { name: 'secondOctet', value: secondOctet },
      { name: 'thirdOctet', value: thirdOctet },
      { name: 'fourthOctet', value: fourthOctet }
    ];

    for (const octet of octets) {
      if (typeof octet.value !== 'number' || octet.value < 0 || octet.value > 255 || !Number.isInteger(octet.value)) {
        throw new Error(`Invalid ${octet.name}: ${octet.value}. Must be an integer between 0 and 255 inclusive.`);
      }
    }

    const ipAddressObject = {
      firstOctet,
      secondOctet,
      thirdOctet,
      fourthOctet
    };

    // Validate against schema before returning
    const valid = validate(ipAddressObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return ipAddressObject;
  },

  /**
   * Set a specific octet in an IP address object
   * @param {object} ipAddressObject - Required IP address object to edit
   * @param {string} octetToSet - Required string of 'first', 'second', 'third', or 'fourth'
   * @param {number} newOctet - Required number between 0-255 to set for the chosen octet
   * @returns {object} The updated IP address object
   */
  setOctet: (ipAddressObject, octetToSet, newOctet) => {
    // Validate the octet value
    if (typeof newOctet !== 'number' || newOctet < 0 || newOctet > 255 || !Number.isInteger(newOctet)) {
      throw new Error(`Invalid octet value: ${newOctet}. Must be an integer between 0 and 255 inclusive.`);
    }

    // Validate octetToSet parameter
    const validOctets = ['first', 'second', 'third', 'fourth'];
    if (!validOctets.includes(octetToSet)) {
      throw new Error(`Invalid octetToSet: ${octetToSet}. Must be one of: ${validOctets.join(', ')}.`);
    }

    // Create a copy of the IP address object
    const updatedIPAddress = { ...ipAddressObject };

    // Set the specified octet
    const octetProperty = `${octetToSet}Octet`;
    updatedIPAddress[octetProperty] = newOctet;

    // Validate against schema before returning
    const valid = validate(updatedIPAddress);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedIPAddress;
  },

  /**
   * Get the IP address as a formatted string
   * @param {object} ipAddressObject - Required IP address object to be string formatted
   * @returns {string} Formatted IP address string (e.g., "192.168.1.1")
   */
  getIPAddressString: (ipAddressObject) => {
    const { firstOctet, secondOctet, thirdOctet, fourthOctet } = ipAddressObject;

    // Validate all octets exist
    if (firstOctet === undefined || secondOctet === undefined || 
        thirdOctet === undefined || fourthOctet === undefined) {
      throw new Error('IP address object is missing required octets.');
    }

    return [firstOctet, secondOctet, thirdOctet, fourthOctet].join('.');
  },

  /**
   * Set a property on an IP address object
   * @param {object} object - Required schema valid IP address object
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Schema validated IP address object with updated property
   */
  setProperty: (object, propertyToSet, valueToSet) => {
    const updatedIPAddress = {
      ...object,
      [propertyToSet]: valueToSet
    };

    // Validate against schema before returning
    const valid = validate(updatedIPAddress);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedIPAddress;
  }
};

module.exports = {
  schema,
  utils
};

