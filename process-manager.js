// process-manager.js - Manages multiple machine simulation processes
const { spawn } = require('child_process');
const path = require('path');
const { getActiveMachines, validateAllMachines } = require('./fillmore-machines');

class SimulationManager {
  constructor() {
    this.workers = new Map(); // machineSerial -> child process
    this.isRunning = false;
  }

  async startAllMachines() {
    if (this.isRunning) {
      console.log('⚠️  Simulation manager is already running');
      return;
    }

    console.log('🚀 Starting Fillmore Simulation Manager...');
    
    try {
      // Validate all machine configurations
      await validateAllMachines();
      
      // Get active machines
      const activeMachines = await getActiveMachines();
      console.log(`📋 Found ${activeMachines.length} active machines to simulate`);
      
      // Spawn worker for each active machine
      for (const machine of activeMachines) {
        await this.spawnMachine(machine);
        // Small delay between spawning to avoid overwhelming the system
        await this.delay(750 + Math.floor(Math.random() * 1000)); // 0.75–1.75s
      }
      
      this.isRunning = true;
      console.log(`✅ All ${activeMachines.length} machines started successfully!`);
      
      // Log status
      this.logStatus();
      
    } catch (error) {
      console.error('❌ Failed to start simulation manager:', error.message);
      throw error;
    }
  }

  async spawnMachine(machineConfig) {
    // Machines are now adapted: 'serial' is now 'id', with '_originalSerial' as backup
    const machineSerial = machineConfig.id || machineConfig._originalSerial || machineConfig.serial;

    if (this.workers.has(machineSerial)) {
      console.log(`⚠️  Machine ${machineConfig.name} (${machineSerial}) is already running`);
      return;
    }

    console.log(`🔄 Spawning worker for ${machineConfig.name} (${machineSerial})...`);
    
    try {
      // Create a temporary config file for this machine
      const tempConfigPath = await this.createTempConfig(machineConfig);
      
      // Spawn child process
      const workerPath = path.join(__dirname, 'simulation-worker.js');
      const worker = spawn('node', [workerPath], {
        stdio: 'inherit',
        cwd: __dirname,
        env: {
          ...process.env,
          MACHINE_CONFIG: JSON.stringify(machineConfig)
        }
      });
      
      // Store worker reference
      this.workers.set(machineSerial, {
        process: worker,
        config: machineConfig,
        startTime: new Date()
      });
      
      // Handle worker events
      worker.on('error', (error) => {
        console.error(`❌ Worker error for ${machineConfig.name} (${machineSerial}):`, error.message);
        this.workers.delete(machineSerial);
      });
      
      worker.on('exit', (code, signal) => {
        console.log(`🛑 Worker for ${machineConfig.name} (${machineSerial}) exited with code ${code} (signal: ${signal})`);
        this.workers.delete(machineSerial);
        
        // If this was an unexpected exit and manager is still running, restart
        if (this.isRunning && code !== 0) {
          console.log(`🔄 Restarting ${machineConfig.name} (${machineSerial})...`);
          setTimeout(() => this.spawnMachine(machineConfig), 5000);
        }
      });
      
      console.log(`✅ Worker spawned for ${machineConfig.name} (${machineSerial})`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn worker for ${machineConfig.name} (${machineSerial}):`, error.message);
      throw error;
    }
  }

  async stopMachine(machineSerial) {
    const worker = this.workers.get(machineSerial);
    
    if (!worker) {
      console.log(`⚠️  Machine ${machineSerial} is not running`);
      return;
    }

    console.log(`🛑 Stopping machine ${worker.config.name} (${machineSerial})...`);
    
    try {
      worker.process.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log(`⚠️  Force killing machine ${worker.config.name} (${machineSerial})...`);
          worker.process.kill('SIGKILL');
          resolve();
        }, 5000);
        
        worker.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      this.workers.delete(machineSerial);
      console.log(`✅ Machine ${worker.config.name} (${machineSerial}) stopped`);
      
    } catch (error) {
      console.error(`❌ Error stopping machine ${machineSerial}:`, error.message);
    }
  }

  async stopAllMachines() {
    if (!this.isRunning) {
      console.log('⚠️  Simulation manager is not running');
      return;
    }

    console.log('🛑 Stopping all machines...');
    
    const stopPromises = Array.from(this.workers.keys()).map(serial => this.stopMachine(serial));
    await Promise.all(stopPromises);
    
    this.isRunning = false;
    console.log('✅ All machines stopped');
  }

  getStatus() {
    const status = {
      isRunning: this.isRunning,
      totalWorkers: this.workers.size,
      workers: []
    };
    
    this.workers.forEach((worker, serial) => {
      status.workers.push({
        serial: serial,
        name: worker.config.name,
        type: worker.config.type,
        startTime: worker.startTime,
        uptime: Date.now() - worker.startTime.getTime(),
        pid: worker.process.pid
      });
    });
    
    return status;
  }

  logStatus() {
    const status = this.getStatus();
    console.log('\n📊 Simulation Manager Status:');
    console.log(`   Running: ${status.isRunning ? '✅ Yes' : '❌ No'}`);
    console.log(`   Active Workers: ${status.totalWorkers}`);
    
    if (status.workers.length > 0) {
      console.log('\n🏭 Active Machines:');
      status.workers.forEach(worker => {
        const uptimeMinutes = Math.floor(worker.uptime / 60000);
        console.log(`   ${worker.name} (${worker.type}) - Serial: ${worker.serial} - Uptime: ${uptimeMinutes}m`);
      });
    }
  }

  async createTempConfig(machineConfig) {
    // For now, we'll use environment variables to pass config
    // In a more robust implementation, you might create temporary config files
    return null;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use as module
module.exports = SimulationManager;

// If this file is run directly, start the simulation manager
if (require.main === module) {
  const manager = new SimulationManager();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, stopping all machines...');
    await manager.stopAllMachines();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, stopping all machines...');
    await manager.stopAllMachines();
    process.exit(0);
  });
  
  // Start all machines
  manager.startAllMachines().catch(console.error);
  
  // Log status every 30 seconds
  setInterval(() => {
    manager.logStatus();
  }, 30000);
} 