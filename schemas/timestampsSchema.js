const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Timestamps Schema Definition
const schema = {
  type: 'object',
  required: [
    'create',
    'active',
    'update'
  ],
  properties: {
    create: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp of when the object/document was created. Should never be changed, only initialized when an object/document is initially written.'
    },
    active: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp of when the object/document was activated. Initially this is the same as create, only changes if the object is made inactive and then reactivated.'
    },
    update: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp of when the object/document was last updated. Initially this is the same as create, only changes if the object is updated/edited.'
    },
    start: {
      type: 'string',
      format: 'date-time',
      description: 'Optional timestamp of when a session, or other period of time, started. Should never be changed once stamped.'
    },
    end: {
      type: 'string',
      format: 'date-time',
      description: 'Optional timestamp of when a session, or other period of time, ended. Should never be changed once stamped.'
    },
    inactive: {
      type: 'string',
      format: 'date-time',
      description: 'Optional timestamp of when an object/document was made inactive. Should only exist if and when an object/document is made inactive.'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Timestamps Utility Functions
const utils = {
  /**
   * Initialize a timestamps object with create, active, and update timestamps
   * @param {string} create - Required timestamp which will be used for create, active, and update
   * @param {string} [start] - Optional timestamp for start
   * @param {string} [end] - Optional timestamp for end
   * @param {string} [inactive] - Optional timestamp for inactive
   * @returns {object} Timestamps object with the specified properties
   */
  stampInit: (create, start = null, end = null, inactive = null) => {
    const timestamps = {
      create,
      active: create,
      update: create
    };

    if (start !== null) {
      timestamps.start = start;
    }

    if (end !== null) {
      timestamps.end = end;
    }

    if (inactive !== null) {
      timestamps.inactive = inactive;
    }

    // Validate against schema before returning
    const valid = validate(timestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return timestamps;
  },

  /**
   * Stamp the update timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {string} updateTimestamp - Required timestamp to be applied to .update
   * @returns {object} New timestamps object with update timestamp
   */
  stampUpdate: (timestampsObjectToStamp, updateTimestamp) => {
    const updatedTimestamps = {
      ...timestampsObjectToStamp,
      update: updateTimestamp
    };

    // Validate against schema before returning
    const valid = validate(updatedTimestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedTimestamps;
  },

  /**
   * Stamp the start timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {string} startTimestamp - Required timestamp to be applied to .start
   * @returns {object} New timestamps object with start timestamp
   */
  stampStart: (timestampsObjectToStamp, startTimestamp) => {
    const updatedTimestamps = {
      ...timestampsObjectToStamp,
      start: startTimestamp
    };

    // Validate against schema before returning
    const valid = validate(updatedTimestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedTimestamps;
  },

  /**
   * Stamp the end timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {string} endTimestamp - Required timestamp to be applied to .end
   * @returns {object} New timestamps object with end timestamp
   */
  stampEnd: (timestampsObjectToStamp, endTimestamp) => {
    const updatedTimestamps = {
      ...timestampsObjectToStamp,
      end: endTimestamp
    };

    // Validate against schema before returning
    const valid = validate(updatedTimestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedTimestamps;
  },

  /**
   * Stamp the active timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {string} activeTimestamp - Required timestamp to be applied to .active
   * @returns {object} New timestamps object with active timestamp
   */
  stampActive: (timestampsObjectToStamp, activeTimestamp) => {
    const updatedTimestamps = {
      ...timestampsObjectToStamp,
      active: activeTimestamp
    };

    // Validate against schema before returning
    const valid = validate(updatedTimestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedTimestamps;
  },

  /**
   * Stamp the inactive timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {string} inactiveTimestamp - Required timestamp to be applied to .inactive
   * @returns {object} New timestamps object with inactive timestamp
   */
  stampInactive: (timestampsObjectToStamp, inactiveTimestamp) => {
    const updatedTimestamps = {
      ...timestampsObjectToStamp,
      inactive: inactiveTimestamp
    };

    // Validate against schema before returning
    const valid = validate(updatedTimestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedTimestamps;
  }
};

module.exports = {
  schema,
  utils
};

