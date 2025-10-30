const Ajv = require('ajv');
const ajv = new Ajv({ strictSchema: false });
const bcrypt = require('bcrypt');

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const humanNamesSchema = require('./human-names');

// User Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'name',
    'local'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this user record'
    },
    id: {
      type: 'integer',
      default: 999999,
      description: 'Number which uniquely identifies a user. For now this is essentially a placeholder, will need to implement, debating possibly making this number usable to log in on machines, for now just needs to be an integer defaulting to 999999'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the user is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this user definition.'
    },
    name: {
      ...humanNamesSchema.schema,
      description: 'Schema valid human name object'
    },
    local: {
      type: 'object',
      required: ['username', 'password'],
      properties: {
        username: {
          type: 'string',
          description: 'String of the username for this user, used to log in'
        },
        password: {
          type: 'string',
          description: 'String of the encrypted password for user'
        }
      },
      additionalProperties: false,
      description: 'Parent object with two required children: username and password'
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

// User Utility Functions
const utils = {
  /**
   * Initialize a user object
   * @param {number} id - Required number value of the user id
   * @param {object} name - Required schema valid human name object
   * @param {string} username - Required string value of user's desired username
   * @param {string} password - Required string value of the password (will be encrypted)
   * @param {object} [groups] - Optional parent object to the potential children Strings of 'area', 'category', or 'department'
   * @returns {object} Validated user object
   */
  initUser: (id, name, username, password, groups = null) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    // Encrypt the password using bcrypt (same method as current passport registration)
    const salt = bcrypt.genSaltSync(10);
    const encryptedPassword = bcrypt.hashSync(password, salt);

    // Build the user object with required properties
    const userObject = {
      id,
      active: true,
      timestamps,
      name,
      local: {
        username,
        password: encryptedPassword
      }
    };

    // Add optional properties if provided
    if (groups !== null) {
      userObject.groups = groups;
    }

    // Validate against schema before returning
    const valid = validate(userObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return userObject;
  },

  /**
   * Set a property on a user object
   * @param {object} userObject - Required User schema valid userObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} User schema validated object with updated property
   */
  setProperty: (userObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedUser = {
      ...userObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(userObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  },

  /**
   * Set a user to inactive
   * @param {object} userObject - Required User schema valid userObject
   * @returns {object} User schema validated userObject after inactivation
   */
  setInactive: (userObject) => {
    const now = new Date().toISOString();
    
    const updatedUser = {
      ...userObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(userObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  },

  /**
   * Set a user to active
   * @param {object} userObject - Required User schema valid userObject
   * @returns {object} User schema validated userObject after activation
   */
  setActive: (userObject) => {
    const now = new Date().toISOString();
    
    const updatedUser = {
      ...userObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(userObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  },

  /**
   * Verify a password against a user object
   * @param {object} userObject - Required User schema valid userObject
   * @param {string} password - Required plain text password to verify
   * @returns {boolean} True if password matches, false otherwise
   */
  verifyPassword: (userObject, password) => {
    if (!userObject.local || !userObject.local.password) {
      throw new Error('User object does not have a password.');
    }

    return bcrypt.compareSync(password, userObject.local.password);
  },

  /**
   * Update a user's password
   * @param {object} userObject - Required User schema valid userObject
   * @param {string} newPassword - Required new plain text password
   * @returns {object} User schema validated userObject with updated password
   */
  updatePassword: (userObject, newPassword) => {
    const now = new Date().toISOString();
    
    // Encrypt the new password
    const salt = bcrypt.genSaltSync(10);
    const encryptedPassword = bcrypt.hashSync(newPassword, salt);
    
    const updatedUser = {
      ...userObject,
      local: {
        ...userObject.local,
        password: encryptedPassword
      },
      timestamps: timestampsSchema.utils.stampUpdate(userObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  }
};

module.exports = {
  schema,
  utils
};
