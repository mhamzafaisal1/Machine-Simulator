// fillmore-machines.js - Configuration for all Fillmore machines
const simulatedMachineSchema = require('./schemas/simulatedMachineSchema');

// All Fillmore machines configuration
const fillmoreMachines = [
  // SPF Machines (5 total) - Single station each
  {
    serial: 68012,
    name: 'SPF2',
    active: true,
    ipAddress: '192.168.0.2',
    lanes: 1,
    stations: [1],
    type: 'SPF',
    groups: []
  },
  {
    serial: 68013,
    name: 'SPF3',
    active: true,
    ipAddress: '192.168.0.3',
    lanes: 1,
    stations: [1],
    type: 'SPF',
    groups: []
  },
  {
    serial: 68014,
    name: 'SPF4',
    active: true,
    ipAddress: '192.168.0.4',
    lanes: 1,
    stations: [1],
    type: 'SPF',
    groups: []
  },
  {
    serial: 68015,
    name: 'SPF5',
    active: true,
    ipAddress: '192.168.0.5',
    lanes: 1,
    stations: [1],
    type: 'SPF',
    groups: []
  },
  {
    serial: 68016,
    name: 'SPF6',
    active: true,
    ipAddress: '192.168.0.6',
    lanes: 1,
    stations: [1],
    type: 'SPF',
    groups: []
  },

  // LPL Machines (2 total) - Three stations each
  {
    serial: 67798,
    name: 'LPL1',
    active: true,
    ipAddress: '192.168.0.7',
    lanes: 3,
    stations: [1, 2, 3],
    type: 'LPL',
    groups: []
  },
  {
    serial: 67799,
    name: 'LPL2',
    active: true,
    ipAddress: '192.168.0.8',
    lanes: 3,
    stations: [1, 2, 3],
    type: 'LPL',
    groups: []
  },

  // Blanket Machines (2 total) - Two stations each (1 and 3)
  {
    serial: 67801,
    name: 'Blanket1',
    active: true,
    ipAddress: '192.168.0.9',
    lanes: 2,
    stations: [1, 3],
    type: 'Blanket',
    groups: []
  },
  {
    serial: 67802,
    name: 'Blanket2',
    active: true,
    ipAddress: '192.168.0.10',
    lanes: 2,
    stations: [1, 3],
    type: 'Blanket',
    groups: []
  },

  // SPL Machines (1 total) - Four stations
  {
    serial: 67800,
    name: 'SPL1',
    active: true,
    ipAddress: '192.168.0.11',
    lanes: 4,
    stations: [1, 2, 3, 4],
    type: 'SPL',
    groups: []
  }
];

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
function validateAllMachines() {
  console.log('🔍 Validating Fillmore machine configurations...');
  
  fillmoreMachines.forEach((machine, index) => {
    try {
      validateMachineConfig(machine);
      console.log(`✅ Machine ${index + 1}: ${machine.name} (${machine.type}) - Valid`);
    } catch (error) {
      console.error(`❌ Machine ${index + 1}: ${machine.name} - ${error.message}`);
      throw error;
    }
  });
  
  console.log(`✅ All ${fillmoreMachines.length} machines validated successfully!`);
}

// Get active machines only
function getActiveMachines() {
  return fillmoreMachines.filter(machine => machine.active);
}

// Get machines by type
function getMachinesByType(type) {
  return fillmoreMachines.filter(machine => machine.type === type);
}

// Get machine by serial
function getMachineBySerial(serial) {
  return fillmoreMachines.find(machine => machine.serial === serial);
}

module.exports = {
  fillmoreMachines,
  validateMachineConfig,
  validateAllMachines,
  getActiveMachines,
  getMachinesByType,
  getMachineBySerial
}; 