// fillmore-machines.js - Configuration for all Fillmore machines from MongoDB
const { MongoClient } = require('mongodb');
const simulatedMachineSchema = require('./schemas/simulatedMachineSchema');
const config = require('./config');
const schemaValidator = require('./schema-validator');
const schemaAdapters = require('./schema-adapters');

// Helper for conditional logging (only in development mode)
const isDev = process.env.NODE_ENV === 'development';
const devLog = (...args) => {
  if (isDev) console.log(...args);
};

// MongoDB connection settings (from centralized config)
const mongoUri = config.mongoUri;
const dbName = config.dbName;
const machineCollectionName = config.machineCollectionName;

// Cache for machine data
let machineCache = null;
let lastCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to determine active stations based on lanes
function getStationsFromLanes(lanes) {
  switch (lanes) {
    case 1:
      return [1]; // Single lane
    case 2:
      return [1, 2]; // Two lanes
    case 3:
      return [1, 2, 3]; // Three lanes
    case 4:
      return [1, 2, 3, 4]; // Four lanes
    default:
      return [1]; // Default to single lane
  }
}

// Helper function to determine machine type based on name
function getMachineTypeFromName(name) {
  if (name.startsWith('SPF')) return 'SPF';
  if (name.startsWith('LPL')) return 'LPL';
  if (name.startsWith('Blanket')) return 'Blanket';
  if (name.startsWith('SPL')) return 'SPL';
  return 'Unknown';
}

// Fetch machines from MongoDB
async function fetchMachinesFromMongoDB() {
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    devLog('🔗 Connected to MongoDB to fetch machine data');
    
    const db = client.db(dbName);
    const collection = db.collection(machineCollectionName);
    
    // Fetch all machines
    const machines = await collection.find({active:true}).toArray();

    // Transform MongoDB data to match our expected format
    const transformedMachines = machines.map(machine => ({
      serial: machine.serial,
      name: machine.name,
      active: machine.active,
      ipAddress: machine.ipAddress,
      lanes: machine.lanes,
      stations: getStationsFromLanes(machine.lanes),
      type: getMachineTypeFromName(machine.name),
      groups: machine.groups || []
    }));

    // ⭐ Adapt machines to schema format
    const adaptedMachines = transformedMachines.map(machine => {
      const adapted = schemaAdapters.adaptMachine(machine);
      // Store original serial as non-enumerable property for backward compatibility
      Object.defineProperty(adapted, '_originalSerial', {
        value: machine.serial,
        enumerable: false,
        writable: false
      });
      return adapted;
    });

    devLog(`📋 Fetched ${adaptedMachines.length} machines from MongoDB`);
    return adaptedMachines;
    
  } catch (error) {
    console.error('❌ Error fetching machines from MongoDB:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

// Get machines with caching
async function getMachines() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (machineCache && lastCacheTime && (now - lastCacheTime) < CACHE_DURATION) {
    return machineCache;
  }
  
  // Fetch fresh data from MongoDB
  machineCache = await fetchMachinesFromMongoDB();
  lastCacheTime = now;
  
  return machineCache;
}

// Helper function to validate machine configuration against schema
function validateMachineConfig(machine) {
  // Basic validation for adapted machines (serial is now id)
  const required = ['id', 'name', 'active', 'ipAddress', 'lanes', 'type'];
  for (const field of required) {
    if (!(field in machine)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const validTypes = ['SPF', 'LPL', 'Blanket', 'SPL', 'Unknown'];
  if (!validTypes.includes(machine.type)) {
    throw new Error(`Invalid machine type: ${machine.type}`);
  }

  return true;
}

// Validate all machines
async function validateAllMachines() {
  devLog('🔍 Validating Fillmore machine configurations...');

  const machines = await getMachines();
  let validMachineCount = 0;

  machines.forEach((machine, index) => {
    try {
      validateMachineConfig(machine);

      // ⭐ PHASE 1: Validate adapted machine object against schema (non-breaking)
      if (schemaValidator.validate('machine', machine, {
        machineSerial: machine.id || machine._originalSerial,
        machineName: machine.name
      })) {
        validMachineCount++;
      }

      devLog(`✅ Machine ${index + 1}: ${machine.name} (${machine.type}) - ${machine.lanes} lanes - Valid`);
    } catch (error) {
      console.error(`❌ Machine ${index + 1}: ${machine.name} - ${error.message}`);
      throw error;
    }
  });

  devLog(`✅ All ${machines.length} machines validated successfully!`);
  devLog(`✅ ${validMachineCount}/${machines.length} machines passed schema validation`);
}

// Get active machines only
async function getActiveMachines() {
  const machines = await getMachines();
  return machines.filter(machine => machine.active);
}

// Get machines by type
async function getMachinesByType(type) {
  const machines = await getMachines();
  return machines.filter(machine => machine.type === type);
}

// Get machine by serial
async function getMachineBySerial(serial) {
  const machines = await getMachines();
  return machines.find(machine => machine.serial === serial);
}

// Clear cache (useful for testing or manual refresh)
function clearCache() {
  machineCache = null;
  lastCacheTime = null;
  devLog('🗑️ Machine cache cleared');
}

module.exports = {
  getMachines,
  validateMachineConfig,
  validateAllMachines,
  getActiveMachines,
  getMachinesByType,
  getMachineBySerial,
  clearCache,
  getStationsFromLanes,
  getMachineTypeFromName
}; 