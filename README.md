# Machine Simulator for ChiTrac System

A comprehensive multi-station machine simulator for the ChiTrac manufacturing system. Supports both individual machine simulation and full facility simulation (Fillmore).

## Features

- **Multi-Station Support**: Simulates machines with 1-4 stations
- **Multiple Machine Types**: SPF, LPL, Blanket, and SPL machines
- **Realistic Data Generation**: State changes and production counts
- **Process Management**: Spawn multiple machines as child processes
- **Database Integration**: MongoDB storage with real-time updates
- **Configurable**: Easy machine configuration and validation

## Machine Types

| Type | Lanes | Active Stations | Description |
|------|-------|-----------------|-------------|
| SPF | 1 | [1] | Single station processing |
| LPL | 3 | [1,2,3] | Three station processing |
| Blanket | 2 | [1,3] | Two station processing |
| SPL | 4 | [1,2,3,4] | Four station processing |

## Installation

```bash
# Install dependencies
npm install

# Ensure MongoDB is running
mongod
```

## Usage

### Single Machine Simulation

```bash
# Run individual machine
node machine-simulator.js --serial=67800 --type=SPL

# Examples
node machine-simulator.js --serial=68012 --type=SPF
node machine-simulator.js --serial=67798 --type=LPL
node machine-simulator.js --serial=67801 --type=Blanket
```

### Fillmore Facility Simulation (All 10 Machines)

```bash
# Start all Fillmore machines simultaneously
node fillmore-simulator.js

# Or use npm script
npm start
```

### NPM Scripts

```bash
npm start              # Start all Fillmore machines
npm run single         # Run single machine simulator
npm run validate       # Validate machine configurations
npm run test           # Test configuration
npm run help           # Show single machine help
npm run fillmore-help  # Show Fillmore simulator help
```

## Fillmore Machines

The simulator includes all 10 Fillmore manufacturing machines:

- **SPF Machines (5)**: SPF2, SPF3, SPF4, SPF5, SPF6
- **LPL Machines (2)**: LPL1, LPL2
- **Blanket Machines (2)**: Blanket1, Blanket2
- **SPL Machines (1)**: SPL1

## Data Generated

### State Records
- Machine state changes (Timeout → Running → Fault)
- Operator assignments per station
- Program information and item details

### Count Records
- Production counts for each active station
- Operator and item correlation
- Station and lane information

### Database Collections
- `chitrac.state-simulated`: Machine state records
- `chitrac.count-simulated`: Production count records

## Architecture

### Files Structure
```
machine-simulator/
├── schemas/
│   └── simulatedMachineSchema.js    # Machine configuration schema
├── fillmore-machines.js             # All 10 machine configurations
├── simulation-worker.js             # Individual machine simulator
├── process-manager.js               # Multi-process manager
├── fillmore-simulator.js            # Main orchestrator
├── machine-simulator.js             # Single machine CLI
├── worker.js                        # Legacy single machine worker
├── utils.js                         # Utility functions
├── config.js                        # Configuration (auto-generated)
└── package.json                     # Project configuration
```

### Process Management
- **Child Processes**: Each machine runs in its own Node.js process
- **Process Isolation**: Crashes in one machine don't affect others
- **Auto-Restart**: Failed machines automatically restart
- **Graceful Shutdown**: Clean shutdown on SIGINT/SIGTERM

## Configuration

### Machine Configuration Schema
```javascript
{
  serial: 67800,           // Machine serial number
  name: "SPL1",            // Machine name
  active: true,            // Whether to simulate
  ipAddress: "192.168.0.11", // Machine IP
  lanes: 4,                // Number of lanes
  stations: [1,2,3,4],     // Active stations
  type: "SPL",             // Machine type
  groups: []               // Machine groups
}
```

### Adding New Machines
1. Add machine configuration to `fillmore-machines.js`
2. Validate configuration: `npm run validate`
3. Restart simulator: `npm start`

## Monitoring

### Real-time Status
The simulator provides real-time status updates:
- Machine uptime
- Active stations
- Count generation status
- Process health

### Logging
- Timestamped logs for each machine
- State change notifications
- Count generation events
- Error reporting

## Troubleshooting

### Common Issues

**MongoDB Connection Error**
```bash
# Ensure MongoDB is running
mongod
```

**Port Already in Use**
```bash
# Check for existing processes
ps aux | grep node
# Kill existing processes
pkill -f "machine-simulator"
```

**Permission Errors**
```bash
# Ensure write access to directory
chmod 755 machine-simulator/
```

### Stopping the Simulator
```bash
# Graceful shutdown
Ctrl+C

# Force stop (if needed)
pkill -f "fillmore-simulator"
```

## Development

### Testing
```bash
# Test configuration
npm run test

# Validate machines
npm run validate

# Test single worker
node simulation-worker.js
```

### Adding New Features
1. Update schema in `schemas/simulatedMachineSchema.js`
2. Modify machine configurations in `fillmore-machines.js`
3. Update simulation logic in `simulation-worker.js`
4. Test with validation and single machine first

## License

ISC License

## Support

For issues and questions, please refer to the ChiTrac system documentation or contact the development team. 