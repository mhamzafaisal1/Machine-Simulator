// fillmore-machines.js - Configuration for all Fillmore machines from MongoDB
const { MongoClient } = require('mongodb');
const simulatedMachineSchema = require('./schemas/simulatedMachineSchema');
const config = require('./config');
const schemaValidator = require('./schema-validator');

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
    console.log('🔗 Connected to MongoDB to fetch machine data');
    
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
    
    console.log(`📋 Fetched ${transformedMachines.length} machines from MongoDB`);
    return transformedMachines;
    
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
  // Basic validation - in production you'd use a proper JSON schema validator
  const required = simulatedMachineSchema.required;
  for (const field of required) {
    if (!(field in machine)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  if (!simulatedMachineSchema.properties.type.enum.includes(machine.type)) {
    throw new Error(`Invalid machine type: ${machine.type}`);
  }
  
  return true;
}

// Validate all machines
async function validateAllMachines() {
  console.log('🔍 Validating Fillmore machine configurations...');

  const machines = await getMachines();

  machines.forEach((machine, index) => {
    try {
      validateMachineConfig(machine);

      // ⭐ PHASE 1: Validate machine object against schema (non-breaking)
      schemaValidator.validate('machine', machine, {
        machineSerial: machine.serial,
        machineName: machine.name
      });

      console.log(`✅ Machine ${index + 1}: ${machine.name} (${machine.type}) - ${machine.lanes} lanes - Valid`);
    } catch (error) {
      console.error(`❌ Machine ${index + 1}: ${machine.name} - ${error.message}`);
      throw error;
    }
  });

  console.log(`✅ All ${machines.length} machines validated successfully!`);
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
  console.log('🗑️ Machine cache cleared');
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