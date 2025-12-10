#!/usr/bin/env node

// fillmore-simulator.js - Main orchestrator for all Fillmore machines-Starting point for the simulation of fillmore machines
const SimulationManager = require('./process-manager');
const { validateAllMachines, getActiveMachines } = require('./fillmore-machines');
const schemaValidator = require('./schema-validator');
const config = require('./config');

// Helper for conditional logging (only in development mode)
const isDev = process.env.NODE_ENV === 'development';
const devLog = (...args) => {
  if (isDev) console.log(...args);
};

class FillmoreSimulator {
  constructor() {
    this.manager = new SimulationManager();
  }

  async start() {
    devLog('🏭 Fillmore Manufacturing Facility Simulator');
    devLog('==============================================');
    
    // Print MongoDB connection info
    const mongoUri = config.mongoUri || 'Not configured';
    // Mask credentials if present in URI
    const maskedUri = mongoUri.includes('@') 
      ? mongoUri.replace(/:\/\/[^:]+:[^@]+@/, '://****:****@') 
      : mongoUri;
    devLog(`\n📊 MongoDB Connection:`);
    devLog(`   URI: ${maskedUri}`);
    devLog(`   Database: ${config.dbName}`);
    
    try {
      // Validate configurations
      devLog('\n🔍 Validating machine configurations...');
      await validateAllMachines();
      
      // Show machine summary
      const activeMachines = await getActiveMachines();
      devLog('\n📋 Machine Summary:');
      devLog(`   Total Machines: ${activeMachines.length}`);
      
      const machineTypes = {};
      activeMachines.forEach(machine => {
        machineTypes[machine.type] = (machineTypes[machine.type] || 0) + 1;
      });
      
      Object.entries(machineTypes).forEach(([type, count]) => {
        devLog(`   ${type}: ${count} machine(s)`);
      });
      
      // Show lanes information
      devLog('\n🏭 Machine Lanes Configuration:');
      activeMachines.forEach(machine => {
        // Use _stationsArray if available, otherwise generate from lanes
        const stationsArray = machine._stationsArray || Array.from({length: machine.lanes}, (_, i) => i + 1);
        devLog(`   ${machine.name}: ${machine.lanes} lane(s) - Stations: [${stationsArray.join(', ')}]`);
      });
      
      devLog('\n🚀 Starting all machines...');
      
      // Start all machines
      await this.manager.startAllMachines();
      
      devLog('\n✅ Fillmore simulator is now running!');
      devLog('   Press Ctrl+C to stop all machines');
      
      // Keep the process alive
      this.keepAlive();
      
    } catch (error) {
      // Initialize logger for error logging
      const createLogger = require('./logger');
      const config = require('./config');
      function buildLoggingConnectionString() {
          if (!config.mongoLog || !config.mongoLog.url) return null;
          const logUsername = config.mongoLog.username;
          const logPassword = config.mongoLog.password;
          const logAuthSource = config.mongoLog.authSource || 'admin';
          if (!logUsername || !logPassword) return null;
          const encodedLogUsername = encodeURIComponent(logUsername);
          const encodedLogPassword = encodeURIComponent(logPassword);
          let loggerConnectionString;
          if (config.mongoLog.url.startsWith('mongodb://')) {
              const urlWithoutScheme = config.mongoLog.url.substring(10);
              const slashIndex = urlWithoutScheme.indexOf('/');
              if (slashIndex === -1) {
                  loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}/${config.mongoLog.db || 'chitrac-logging'}?authSource=${logAuthSource}`;
              } else {
                  loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}?authSource=${logAuthSource}`;
              }
          } else {
              loggerConnectionString = config.mongoLog.url.replace('mongodb://', `mongodb://${encodedLogUsername}:${encodedLogPassword}@`);
              if (!loggerConnectionString.includes('?')) {
                  loggerConnectionString += `?authSource=${logAuthSource}`;
              } else {
                  loggerConnectionString += `&authSource=${logAuthSource}`;
              }
          }
          return loggerConnectionString;
      }
      const logMongoUri = buildLoggingConnectionString();
      const logger = createLogger(logMongoUri);
      logger.error('❌ Failed to start Fillmore simulator', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  }

  async stop() {
    devLog('\n🛑 Stopping Fillmore simulator...');

    // ⭐ PHASE 1: Print final validation statistics
    devLog('\n📊 Final Schema Validation Report:');
    schemaValidator.printStats();

    await this.manager.stopAllMachines();
    devLog('✅ Fillmore simulator stopped');
  }

  getStatus() {
    return this.manager.getStatus();
  }

  keepAlive() {
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      devLog('\n🛑 Received SIGINT, shutting down Fillmore simulator...');
      await this.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      devLog('\n🛑 Received SIGTERM, shutting down Fillmore simulator...');
      await this.stop();
      process.exit(0);
    });
    
    // Log status periodically
    setInterval(() => {
      this.manager.logStatus();
    }, 60000); // Every minute

    // ⭐ PHASE 1: Print validation statistics periodically (every 5 minutes)
    setInterval(() => {
      schemaValidator.printStats();
    }, 300000); // Every 5 minutes
  }
}

// Show help
function showHelp() {
  // Help should always be shown
  console.log(`
🏭 Fillmore Manufacturing Facility Simulator

Usage: node fillmore-simulator.js [options]

Options:
  --help               Show this help message
  --status             Show current status (if running)

Description:
  This simulator starts all machines from the MongoDB 'machine' collection:
  - Machines are dynamically loaded from the database
  - Each machine can have 1-4 lanes based on the 'lanes' field
  - Each lane gets its own operator assignment
  - Machines are filtered by the 'active' field

  Each machine runs in its own process and generates realistic
  manufacturing data including state changes and production counts.

Examples:
  node fillmore-simulator.js              # Start all active machines
  node fillmore-simulator.js --help       # Show help

Data Generated:
  - State records: Machine state changes (Timeout → Running → Fault)
  - Count records: Production counts for each active station
  - Database: chitrac.state-simulated, chitrac.count-simulated

Stopping:
  Press Ctrl+C to gracefully stop all machines
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
  
  // Start the simulator
  const simulator = new FillmoreSimulator();
  // Initialize logger for error logging
  const createLogger = require('./logger');
  const config = require('./config');
  function buildLoggingConnectionString() {
      if (!config.mongoLog || !config.mongoLog.url) return null;
      const logUsername = config.mongoLog.username;
      const logPassword = config.mongoLog.password;
      const logAuthSource = config.mongoLog.authSource || 'admin';
      if (!logUsername || !logPassword) return null;
      const encodedLogUsername = encodeURIComponent(logUsername);
      const encodedLogPassword = encodeURIComponent(logPassword);
      let loggerConnectionString;
      if (config.mongoLog.url.startsWith('mongodb://')) {
          const urlWithoutScheme = config.mongoLog.url.substring(10);
          const slashIndex = urlWithoutScheme.indexOf('/');
          if (slashIndex === -1) {
              loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}/${config.mongoLog.db || 'chitrac-logging'}?authSource=${logAuthSource}`;
          } else {
              loggerConnectionString = `mongodb://${encodedLogUsername}:${encodedLogPassword}@${urlWithoutScheme}?authSource=${logAuthSource}`;
          }
      } else {
          loggerConnectionString = config.mongoLog.url.replace('mongodb://', `mongodb://${encodedLogUsername}:${encodedLogPassword}@`);
          if (!loggerConnectionString.includes('?')) {
              loggerConnectionString += `?authSource=${logAuthSource}`;
          } else {
              loggerConnectionString += `&authSource=${logAuthSource}`;
          }
      }
      return loggerConnectionString;
  }
  const logMongoUri = buildLoggingConnectionString();
  const logger = createLogger(logMongoUri);
  simulator.start().catch((error) => {
    logger.error('Failed to start Fillmore simulator', { error: error.message, stack: error.stack });
  });
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = FillmoreSimulator; 