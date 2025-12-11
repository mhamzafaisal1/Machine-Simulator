/**
 * Schema Validation Infrastructure
 * Non-breaking validation that logs errors without disrupting simulation
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Helper for conditional logging (only in development mode)
const isDev = process.env.NODE_ENV === 'development';
const devLog = (...args) => {
  if (isDev) console.log(...args);
};
const devWarn = (...args) => {
  if (isDev) console.warn(...args);
};

// Suppress "unknown format" warnings from schema imports
const originalWarn = console.warn;
console.warn = (...args) => {
  const msg = args.join(' ');
  if (!msg.includes('unknown format') && !msg.includes('ignored in schema')) {
    originalWarn.apply(console, args);
  }
};

// Initialize AJV with formats support BEFORE importing schemas
const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false, // Allow additional properties for backward compatibility
  validateFormats: false, // Disable format validation errors
  strictSchema: false // Don't throw on unknown formats, just warn
});
addFormats(ajv);

// Import all schemas AFTER AJV is configured
const timestampsSchema = require('./schemas/timestampsSchema');
const breakSchema = require('./schemas/break');
const countSchema = require('./schemas/count');
const faultSchema = require('./schemas/fault');
const humanNamesSchema = require('./schemas/human-names');
const ipAddressSchema = require('./schemas/ipAddress');
const itemSchema = require('./schemas/item');
const machineSchema = require('./schemas/machine');
const metricsSchema = require('./schemas/metrics');
const misfeedSchema = require('./schemas/misfeed');
const operatorSchema = require('./schemas/operator');
const programSchema = require('./schemas/program');
const sensorCountSchema = require('./schemas/sensorCount');
const sessionSchema = require('./schemas/session');
const shiftSchema = require('./schemas/shift');
const stateSchema = require('./schemas/state');
const statusSchema = require('./schemas/status');
// const userSchema = require('./schemas/user'); // Skip - requires bcrypt, not needed for simulator

// Compile all validators once for performance
const validators = {
  timestamps: ajv.compile(timestampsSchema.schema),
  break: ajv.compile(breakSchema.schema),
  count: ajv.compile(countSchema.schema),
  fault: ajv.compile(faultSchema.schema),
  humanNames: ajv.compile(humanNamesSchema.schema),
  ipAddress: ajv.compile(ipAddressSchema.schema),
  item: ajv.compile(itemSchema.schema),
  machine: ajv.compile(machineSchema.schema),
  metrics: ajv.compile(metricsSchema.schema),
  misfeed: ajv.compile(misfeedSchema.schema),
  operator: ajv.compile(operatorSchema.schema),
  program: ajv.compile(programSchema.schema),
  sensorCount: ajv.compile(sensorCountSchema.schema),
  session: ajv.compile(sessionSchema.schema),
  shift: ajv.compile(shiftSchema.schema),
  state: ajv.compile(stateSchema.schema),
  status: ajv.compile(statusSchema.schema)
  // user: ajv.compile(userSchema.schema) // Skip - not needed for simulator
};

// Restore original console.warn after schemas are loaded
console.warn = originalWarn;

// Validation statistics tracking
const validationStats = {
  timestamps: { total: 0, valid: 0, invalid: 0 },
  count: { total: 0, valid: 0, invalid: 0 },
  misfeed: { total: 0, valid: 0, invalid: 0 },
  state: { total: 0, valid: 0, invalid: 0 },
  session: { total: 0, valid: 0, invalid: 0 },
  machine: { total: 0, valid: 0, invalid: 0 },
  operator: { total: 0, valid: 0, invalid: 0 },
  item: { total: 0, valid: 0, invalid: 0 },
  fault: { total: 0, valid: 0, invalid: 0 },
  program: { total: 0, valid: 0, invalid: 0 },
  shift: { total: 0, valid: 0, invalid: 0 },
  metrics: { total: 0, valid: 0, invalid: 0 }
};

// Track unique error patterns to avoid log spam
const errorPatterns = new Map();
const MAX_SAME_ERROR_LOGS = 3; // Only log each unique error pattern 3 times

/**
 * Get a simplified error signature for deduplication
 */
function getErrorSignature(errors, schemaType) {
  if (!errors || errors.length === 0) return null;

  // Create signature from error paths and messages
  const signature = errors
    .map(err => `${err.instancePath}:${err.message}`)
    .sort()
    .join('|');

  return `${schemaType}::${signature}`;
}

/**
 * Check if we should log this error based on deduplication
 */
function shouldLogError(signature) {
  if (!signature) return true;

  const count = errorPatterns.get(signature) || 0;
  if (count < MAX_SAME_ERROR_LOGS) {
    errorPatterns.set(signature, count + 1);
    return true;
  }
  return false;
}

/**
 * Format validation errors for readable logging
 */
function formatErrors(errors) {
  if (!errors || errors.length === 0) return 'Unknown validation error';

  return errors.map(err => {
    const path = err.instancePath || 'root';
    const message = err.message || 'validation failed';
    const params = err.params ? JSON.stringify(err.params) : '';
    return `  - ${path}: ${message} ${params}`;
  }).join('\n');
}

/**
 * Validate an object against a schema
 * @param {string} schemaType - Type of schema (e.g., 'count', 'state', 'machine')
 * @param {object} data - Data to validate
 * @param {object} context - Additional context for logging (e.g., { machineSerial: 'M123' })
 * @returns {boolean} - True if valid, false if invalid
 */
function validate(schemaType, data, context = {}) {
  if (!validators[schemaType]) {
    console.error(`[SCHEMA-VALIDATOR] Unknown schema type: ${schemaType}`);
    return false;
  }

  // Update stats
  if (validationStats[schemaType]) {
    validationStats[schemaType].total++;
  }

  const validator = validators[schemaType];
  const isValid = validator(data);

  if (isValid) {
    if (validationStats[schemaType]) {
      validationStats[schemaType].valid++;
    }
    return true;
  }

  // Handle validation failure
  if (validationStats[schemaType]) {
    validationStats[schemaType].invalid++;
  }

  const signature = getErrorSignature(validator.errors, schemaType);

  if (shouldLogError(signature)) {
    const contextStr = Object.keys(context).length > 0
      ? ` [${Object.entries(context).map(([k, v]) => `${k}=${v}`).join(', ')}]`
      : '';

    devWarn(`[SCHEMA-VALIDATOR] ${schemaType} validation failed${contextStr}:`);
    devWarn(formatErrors(validator.errors));

    // Log a sample of the invalid data (first 500 chars)
    const dataSample = JSON.stringify(data, null, 2).substring(0, 500);
    devWarn(`Sample data:\n${dataSample}${dataSample.length >= 500 ? '...' : ''}`);
  }

  return false;
}

/**
 * Validate nested timestamps object
 */
function validateTimestamps(timestamps, context = {}) {
  return validate('timestamps', timestamps, context);
}

/**
 * Get validation statistics summary
 */
function getStats() {
  return { ...validationStats };
}

/**
 * Reset validation statistics
 */
function resetStats() {
  Object.keys(validationStats).forEach(key => {
    validationStats[key] = { total: 0, valid: 0, invalid: 0 };
  });
  errorPatterns.clear();
}

/**
 * Print validation statistics summary
 */
function printStats() {
  devLog('\n========== SCHEMA VALIDATION STATISTICS ==========');

  let totalChecks = 0;
  let totalValid = 0;
  let totalInvalid = 0;

  Object.entries(validationStats).forEach(([type, stats]) => {
    if (stats.total > 0) {
      const validPercent = ((stats.valid / stats.total) * 100).toFixed(1);
      const status = stats.invalid === 0 ? '✓' : '✗';

      devLog(`${status} ${type.padEnd(15)} - Total: ${stats.total}, Valid: ${stats.valid}, Invalid: ${stats.invalid} (${validPercent}% valid)`);

      totalChecks += stats.total;
      totalValid += stats.valid;
      totalInvalid += stats.invalid;
    }
  });

  devLog('--------------------------------------------------');
  const overallPercent = totalChecks > 0 ? ((totalValid / totalChecks) * 100).toFixed(1) : 0;
  devLog(`OVERALL: ${totalChecks} checks, ${totalValid} valid, ${totalInvalid} invalid (${overallPercent}% valid)`);
  devLog(`Unique error patterns logged: ${errorPatterns.size}`);
  devLog('==================================================\n');
}

module.exports = {
  validate,
  validateTimestamps,
  validators,
  getStats,
  resetStats,
  printStats
};
