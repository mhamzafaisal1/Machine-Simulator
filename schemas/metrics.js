const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

// Import related schemas
const itemSchema = require('./item');

// Metrics Schema Definition
const schema = {
  type: 'object',
  required: [
    'totals',
    'byItem',
    'timers'
  ],
  properties: {
    totals: {
      type: 'object',
      required: ['counts', 'timeCredit'],
      properties: {
        counts: {
          type: 'object',
          required: ['valid', 'misfeed'],
          properties: {
            valid: {
              type: 'number',
              description: 'Number representing the total valid counts for the object this metrics object is associated with'
            },
            misfeed: {
              type: 'number',
              description: 'Number representing the total misfed counts for the object this metrics object is associated with'
            }
          },
          additionalProperties: false,
          description: 'Object with two required child properties: valid and misfeed, both Numbers, representing the total valid and misfed counts for the object this metrics object is associated with'
        },
        timeCredit: {
          type: 'number',
          description: 'Number value of the total timeCredit, across all item types, earned in this metrics object'
        }
      },
      additionalProperties: false,
      description: 'Object with the following required children: counts and timeCredit'
    },
    byItem: {
      type: 'object',
      required: ['items', 'timeCredit', 'counts'],
      properties: {
        items: {
          type: 'array',
          items: {
            ...itemSchema.schema
          },
          description: 'Array of schema valid itemObjects which had earned time/counts during this metrics object'
        },
        timeCredit: {
          type: 'array',
          items: {
            type: 'number'
          },
          description: 'Array of Numbers with each number being the timeCredit (in ms) earned in this metrics object for a given item, sorted in the same order as items[] such that the timeCredit[n] value lines up with the itemObject in items[n]'
        },
        counts: {
          type: 'object',
          required: ['valid', 'misfeed'],
          properties: {
            valid: {
              type: 'array',
              items: {
                type: 'number'
              },
              description: 'Array of Numbers representing the total valid counts for a given item, sorted in the same order as items[] such that the valid[n] value lines up with the itemObject in items[n]'
            },
            misfeed: {
              type: 'array',
              items: {
                type: 'number'
              },
              description: 'Array of Numbers representing the total misfed counts for a given item, sorted in the same order as items[] such that the misfeed[n] value lines up with the itemObject in items[n]'
            }
          },
          additionalProperties: false,
          description: 'Object with two child properties: valid and misfeed, both Arrays of Numbers representing the total valid and misfed counts for a given item, sorted in the same order as items[]'
        }
      },
      additionalProperties: false,
      description: 'Object with three required child properties: items[], timeCredit[] and counts{}'
    },
    timers: {
      type: 'object',
      required: ['elapsed', 'pause', 'run', 'worked', 'fault', 'offline', 'maintenance'],
      properties: {
        elapsed: {
          type: 'number',
          description: 'Number value of the amount of time (in ms) that elapsed during the object this metricsObject is associated with. This will typically be equal to the metricObject\'s parent\'s timestamp.end - timestamp.start.'
        },
        pause: {
          type: 'number',
          description: 'Number value of the amount of time (in ms) that was accrued in a pause/timeout state during the object this metricsObject is associated with.'
        },
        run: {
          type: 'number',
          description: 'Number value of the amount of time (in ms) that was accrued in a run state during the object this metricsObject is associated with.'
        },
        worked: {
          type: 'number',
          description: 'Number value of the worked time during the object this metricsObject is associated with. This will typically be timers.run multiplied by the number of active stations for the object this metricsObject is associated with'
        },
        fault: {
          type: 'number',
          description: 'Number value of the fault time (in ms) that was accrued in a fault state during the object this metricsObject is associated with'
        },
        offline: {
          type: 'number',
          description: 'Number value of the offline time (in ms) that was accrued in an offline state during the object this metricsObject is associated with'
        },
        maintenance: {
          type: 'number',
          description: 'Number value of the maintenance time (in ms) that was accrued in a maintenance state during the object this metricsObject is associated with. We currently do not track this, but need to in the near future'
        }
      },
      additionalProperties: false,
      description: 'Object containing various timer values for the metrics object'
    },
    stations: {
      type: 'number',
      description: 'Number value of the number of active stations for the object this metricsObject is associated with'
    },
    lanes: {
      type: 'number',
      description: 'Number value of the number of active lanes for the object this metricsObject is associated with'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Metrics Utility Functions
const utils = {
  /**
   * Initialize a metrics object
   * @param {object} totals - Required object as outlined above of the calculated metrics based on the object this metricsObject is associated with
   * @param {object} byItem - Required object as outlined above of the calculated metrics based on the object this metricsObject is associated with
   * @param {object} timers - Required object as outlined above of the calculated metrics based on the object this metricsObject is associated with
   * @param {number} [stations] - Optional number value of the number of active stations
   * @param {number} [lanes] - Optional number value of the number of active lanes
   * @returns {object} Validated metrics object
   */
  initMetrics: (totals, byItem, timers, stations = null, lanes = null) => {
    // Build the metrics object with required properties
    const metricsObject = {
      totals,
      byItem,
      timers
    };

    // Add optional properties if provided
    if (stations !== null) {
      metricsObject.stations = stations;
    }

    if (lanes !== null) {
      metricsObject.lanes = lanes;
    }

    // Validate against schema before returning
    const valid = validate(metricsObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return metricsObject;
  },

  /**
   * Set a property on a metrics object
   * @param {object} metricsObject - Required Metrics schema valid metricsObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Metrics schema validated object with updated property
   */
  setProperty: (metricsObject, propertyToSet, valueToSet) => {
    const updatedMetrics = {
      ...metricsObject,
      [propertyToSet]: valueToSet
    };

    // Validate against schema before returning
    const valid = validate(updatedMetrics);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedMetrics;
  },

  /**
   * Get metrics summary information
   * @param {object} metricsObject - Required Metrics schema valid metricsObject
   * @returns {object} Summary object with key metrics information
   */
  getMetricsSummary: (metricsObject) => {
    const totalValid = metricsObject.totals.counts.valid;
    const totalMisfeed = metricsObject.totals.counts.misfeed;
    const totalTimeCredit = metricsObject.totals.timeCredit;
    
    const itemCount = metricsObject.byItem.items.length;
    const totalElapsed = metricsObject.timers.elapsed;
    const totalRun = metricsObject.timers.run;
    const totalWorked = metricsObject.timers.worked;
    
    return {
      totalValid,
      totalMisfeed,
      totalTimeCredit,
      itemCount,
      totalElapsed,
      totalRun,
      totalWorked,
      stations: metricsObject.stations || 'Not Specified',
      lanes: metricsObject.lanes || 'Not Specified',
      efficiency: totalElapsed > 0 ? (totalRun / totalElapsed * 100).toFixed(2) + '%' : '0%'
    };
  },

  /**
   * Calculate efficiency metrics
   * @param {object} metricsObject - Required Metrics schema valid metricsObject
   * @returns {object} Efficiency metrics object
   */
  calculateEfficiency: (metricsObject) => {
    const { timers } = metricsObject;
    const totalTime = timers.elapsed;
    
    if (totalTime === 0) {
      return {
        runEfficiency: 0,
        workedEfficiency: 0,
        faultRate: 0,
        offlineRate: 0
      };
    }

    return {
      runEfficiency: (timers.run / totalTime * 100).toFixed(2) + '%',
      workedEfficiency: (timers.worked / totalTime * 100).toFixed(2) + '%',
      faultRate: (timers.fault / totalTime * 100).toFixed(2) + '%',
      offlineRate: (timers.offline / totalTime * 100).toFixed(2) + '%'
    };
  },

  /**
   * Get item-specific metrics
   * @param {object} metricsObject - Required Metrics schema valid metricsObject
   * @param {number} itemIndex - Required index of the item to get metrics for
   * @returns {object} Item-specific metrics object
   */
  getItemMetrics: (metricsObject, itemIndex) => {
    if (itemIndex < 0 || itemIndex >= metricsObject.byItem.items.length) {
      throw new Error('Item index is out of range.');
    }

    const item = metricsObject.byItem.items[itemIndex];
    const timeCredit = metricsObject.byItem.timeCredit[itemIndex];
    const validCount = metricsObject.byItem.counts.valid[itemIndex];
    const misfeedCount = metricsObject.byItem.counts.misfeed[itemIndex];

    return {
      itemName: item.name,
      timeCredit,
      validCount,
      misfeedCount,
      totalCount: validCount + misfeedCount,
      misfeedRate: validCount + misfeedCount > 0 ? (misfeedCount / (validCount + misfeedCount) * 100).toFixed(2) + '%' : '0%'
    };
  }
};

module.exports = {
  schema,
  utils
};
