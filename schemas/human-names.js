const Ajv = require('ajv');
const ajv = new Ajv({ strictSchema: false });

// Names Schema Definition
const schema = {
  type: 'object',
  required: [
    'first',
    'surname'
  ],
  properties: {
    first: {
      type: 'string',
      description: "String of the person's first name"
    },
    surname: {
      type: 'string',
      description: "String of the person's surname/last name"
    },
    prefix: {
      type: 'string',
      description: "String of the person's name prefix, such as Dr., Mr., Ms., Mrs., etc."
    },
    suffix: {
      type: 'string',
      description: "String of the person's name suffix, such as Sr./Jr., II, III, etc."
    },
    middle: {
      type: 'string',
      description: "String of the person's middle name"
    },
    middleInitial: {
      type: 'string',
      description: "String of the person's middle initial"
    },
    additionalSurnames: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: "Array of strings, sorted in the order they should be displayed, of additional last names for a person. This is often applicable for Spanish names which often include mother's maiden name in a person's last name."
    },
    lastFirst: {
      type: 'boolean',
      description: "Boolean value for if a person's last/surname should be displayed prior to their first/given name. If true, the fullname util function should put the surname before the given name."
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Names Utility Functions
const utils = {
  /**
   * Set or update name properties on a name object
   * @param {object} nameObjectToEdit - If initing a name, provide an empty object. Otherwise, provide the existing name object.
   * @param {object} nameObject - Object containing the properties to set/overwrite. If a null is provided for a property, that property will be removed.
   * @returns {object} The updated name object
   */
  setName: (nameObjectToEdit, nameObject) => {
    const updatedName = { ...nameObjectToEdit };

    // Iterate through all properties in nameObject
    for (const [key, value] of Object.entries(nameObject)) {
      if (value === null) {
        // If null is provided, remove the property
        delete updatedName[key];
      } else {
        // Otherwise, set/overwrite the property
        updatedName[key] = value;
      }
    }

    // Validate against schema before returning
    const valid = validate(updatedName);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedName;
  },

  /**
   * Get the full name of a person based on the specified format
   * @param {string} nameFormat - String for indicating the name format to use. Currently only 'standard' is supported.
   * @param {object} nameObject - The name object containing the person's name properties
   * @returns {string} Concatenated string of the person's full name
   */
  getFullName: (nameFormat, nameObject) => {
    if (nameFormat !== 'standard') {
      throw new Error(`Unsupported name format: ${nameFormat}. Only 'standard' is currently supported.`);
    }

    const parts = [];
    
    // Add prefix if exists
    if (nameObject.prefix) {
      parts.push(nameObject.prefix);
    }

    // Determine if we're using lastFirst format
    if (nameObject.lastFirst) {
      // Format: prefix surname middle/middleInitial additionalSurnames first suffix
      
      // Add surname
      if (nameObject.surname) {
        parts.push(nameObject.surname);
      }

      // Add middle or middleInitial
      if (nameObject.middle) {
        parts.push(nameObject.middle);
      } else if (nameObject.middleInitial) {
        parts.push(nameObject.middleInitial);
      }

      // Add additionalSurnames
      if (nameObject.additionalSurnames && nameObject.additionalSurnames.length > 0) {
        parts.push(...nameObject.additionalSurnames);
      }

      // Add first name
      if (nameObject.first) {
        parts.push(nameObject.first);
      }
    } else {
      // Format: prefix first middle/middleInitial additionalSurnames surname suffix
      
      // Add first name
      if (nameObject.first) {
        parts.push(nameObject.first);
      }

      // Add middle or middleInitial
      if (nameObject.middle) {
        parts.push(nameObject.middle);
      } else if (nameObject.middleInitial) {
        parts.push(nameObject.middleInitial);
      }

      // Add additionalSurnames
      if (nameObject.additionalSurnames && nameObject.additionalSurnames.length > 0) {
        parts.push(...nameObject.additionalSurnames);
      }

      // Add surname
      if (nameObject.surname) {
        parts.push(nameObject.surname);
      }
    }

    // Add suffix if exists
    if (nameObject.suffix) {
      parts.push(nameObject.suffix);
    }

    // Trim and normalize spacing to avoid double spaces if some values are empty
    return parts.join(' ').trim().replace(/\s+/g, ' ');
  },

  /**
   * Set a property on a name object
   * @param {object} object - Required schema valid name object
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Schema validated name object with updated property
   */
  setProperty: (object, propertyToSet, valueToSet) => {
    const updatedName = {
      ...object,
      [propertyToSet]: valueToSet
    };

    // Validate against schema before returning
    const valid = validate(updatedName);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedName;
  }
};

module.exports = {
  schema,
  utils
};

