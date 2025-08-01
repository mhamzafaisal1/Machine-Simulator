#!/usr/bin/env node

// fillmore-simulator.js - Main orchestrator for all Fillmore machines
const SimulationManager = require('./process-manager');
const { validateAllMachines, getActiveMachines } = require('./fillmore-machines');

class FillmoreSimulator {
  constructor() {
    this.manager = new SimulationManager();
  }

  async start() {
    console.log('🏭 Fillmore Manufacturing Facility Simulator');
    console.log('==============================================');
    
    try {
      // Validate configurations
      console.log('\n🔍 Validating machine configurations...');
      await validateAllMachines();
      
      // Show machine summary
      const activeMachines = await getActiveMachines();
      console.log('\n📋 Machine Summary:');
      console.log(`   Total Machines: ${activeMachines.length}`);
      
      const machineTypes = {};
      activeMachines.forEach(machine => {
        machineTypes[machine.type] = (machineTypes[machine.type] || 0) + 1;
      });
      
      Object.entries(machineTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} machine(s)`);
      });
      
      // Show lanes information
      console.log('\n🏭 Machine Lanes Configuration:');
      activeMachines.forEach(machine => {
        console.log(`   ${machine.name}: ${machine.lanes} lane(s) - Stations: [${machine.stations.join(', ')}]`);
      });
      
      console.log('\n🚀 Starting all machines...');
      
      // Start all machines
      await this.manager.startAllMachines();
      
      console.log('\n✅ Fillmore simulator is now running!');
      console.log('   Press Ctrl+C to stop all machines');
      
      // Keep the process alive
      this.keepAlive();
      
    } catch (error) {
      console.error('❌ Failed to start Fillmore simulator:', error.message);
      process.exit(1);
    }
  }

  async stop() {
    console.log('\n🛑 Stopping Fillmore simulator...');
    await this.manager.stopAllMachines();
    console.log('✅ Fillmore simulator stopped');
  }

  getStatus() {
    return this.manager.getStatus();
  }

  keepAlive() {
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down Fillmore simulator...');
      await this.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down Fillmore simulator...');
      await this.stop();
      process.exit(0);
    });
    
    // Log status periodically
    setInterval(() => {
      this.manager.logStatus();
    }, 60000); // Every minute
  }
}

// Show help
function showHelp() {
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
  simulator.start().catch(console.error);
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = FillmoreSimulator; 