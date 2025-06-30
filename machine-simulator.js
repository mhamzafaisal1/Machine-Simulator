#!/usr/bin/env node

// machine-simulator.js - CLI interface for multi-station machine simulator
const { spawn } = require('child_process');
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    serial: 67800,
    type: 'SPL',
    lanes: 4,
    name: 'SPL1',
    ipAddress: '192.168.0.11'
  };

  args.forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      if (key && value) {
        config[key] = value;
      }
    }
  });

  return config;
}

// Machine type configurations
const machineTypes = {
  'SPF': {
    lanes: 1,
    name: 'SPF',
    ipAddress: '192.168.0.2'
  },
  'LPL': {
    lanes: 3,
    name: 'LPL',
    ipAddress: '192.168.0.7'
  },
  'Blanket': {
    lanes: 2,
    name: 'Blanket',
    ipAddress: '192.168.0.9'
  },
  'SPL': {
    lanes: 4,
    name: 'SPL',
    ipAddress: '192.168.0.11'
  }
};

// Update config file with CLI arguments
function updateConfig(cliConfig) {
  const fs = require('fs');
  const configPath = path.join(__dirname, 'config.js');
  
  // Get machine type configuration
  const machineType = machineTypes[cliConfig.type] || machineTypes.SPL;
  
  // Generate machine name if not provided
  const machineName = cliConfig.name || `${machineType.name}${cliConfig.serial}`;
  
  // Update IP address based on serial if not provided
  const ipAddress = cliConfig.ipAddress || machineType.ipAddress;
  
  const configContent = `// config.js - Auto-generated from CLI arguments
module.exports = {
    // MongoDB connection matching chitrac-api structure
    mongoUri: 'mongodb://localhost:27017/chitrac',
    dbName: 'chitrac',
    collectionName: 'state',
    countCollectionName: 'count',
  
    // Machine data from CLI arguments
    machine: {
      serial: ${cliConfig.serial},
      name: '${machineName}',
      ipAddress: '${ipAddress}',
      active: true,
      lanes: ${machineType.lanes}, // Determined by machine type
      type: '${cliConfig.type}' // Machine type from CLI
    },
  
    // Item IDs matching chitrac-api defaults (using 'number' field)
    itemIds: [26, 30, 33], // HospitalSheet, Large Thermal Blanket, Mixed Towels
  
    // Operator pool matching chitrac-api format (using 'code' field instead of 'id')
    operatorPool: [
      { code: 135790, name: "Lilliana Ashca", active: true },
      { code: 135791, name: "Jessica Barrera", active: true },
      { code: 135792, name: "Lashiyah Blakemore", active: true },
      { code: 135793, name: "Paul Carroll", active: true },
      { code: 135794, name: "Martinez Carter", active: true },
      { code: 135795, name: "Maria Changuluisa", active: true },
      { code: 135796, name: "Flor Changuluisa", active: true },
      { code: 135797, name: "Natalie Chavez", active: true },
      { code: 135798, name: "Akura Coleman", active: true },
      { code: 135799, name: "Lakeesha Davis", active: true }
    ],

    // Station-specific operator assignments (operators per station)
    operatorsPerStation: 1 // Number of operators assigned to each station
  };
`;

  fs.writeFileSync(configPath, configContent);
  console.log(`✅ Updated config.js with machine configuration:`);
  console.log(`   Serial: ${cliConfig.serial}`);
  console.log(`   Type: ${cliConfig.type}`);
  console.log(`   Name: ${machineName}`);
  console.log(`   Lanes: ${machineType.lanes}`);
  console.log(`   IP: ${ipAddress}`);
}

// Show help
function showHelp() {
  console.log(`
🤖 Multi-Station Machine Simulator CLI

Usage: node machine-simulator.js [options]

Options:
  --serial=<number>    Machine serial number (default: 67800)
  --type=<type>        Machine type: SPF, LPL, Blanket, SPL (default: SPL)
  --lanes=<number>     Number of lanes (auto-determined by type)
  --name=<name>        Machine name (auto-generated if not provided)
  --ip=<address>       IP address (auto-determined by type)
  --help               Show this help message

Examples:
  node machine-simulator.js --serial=67800 --type=SPL
  node machine-simulator.js --serial=68012 --type=SPF
  node machine-simulator.js --serial=67798 --type=LPL
  node machine-simulator.js --serial=67801 --type=Blanket

Machine Types:
  SPF     - Single station (lanes: 1, stations: [1])
  LPL     - Three stations (lanes: 3, stations: [1,2,3])
  Blanket - Two stations (lanes: 2, stations: [1,3])
  SPL     - Four stations (lanes: 4, stations: [1,2,3,4])
`);
}

// Main function
function main() {
  const args = process.argv.slice(2);
  
  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  // Parse CLI arguments
  const cliConfig = parseArgs();
  
  // Validate machine type
  if (!machineTypes[cliConfig.type]) {
    console.error(`❌ Invalid machine type: ${cliConfig.type}`);
    console.error(`   Valid types: ${Object.keys(machineTypes).join(', ')}`);
    process.exit(1);
  }
  
  // Update configuration file
  updateConfig(cliConfig);
  
  // Start the simulator
  console.log(`\n🚀 Starting simulator for ${cliConfig.type} machine (Serial: ${cliConfig.serial})...`);
  
  const workerPath = path.join(__dirname, 'worker.js');
  const worker = spawn('node', [workerPath], {
    stdio: 'inherit',
    cwd: __dirname
  });
  
  worker.on('error', (error) => {
    console.error(`❌ Failed to start worker: ${error.message}`);
    process.exit(1);
  });
  
  worker.on('exit', (code) => {
    console.log(`\n🛑 Simulator stopped with code: ${code}`);
    process.exit(code);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n🛑 Received SIGINT, stopping simulator...`);
    worker.kill('SIGINT');
  });
  
  process.on('SIGTERM', () => {
    console.log(`\n🛑 Received SIGTERM, stopping simulator...`);
    worker.kill('SIGTERM');
  });
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = { parseArgs, updateConfig, showHelp }; 