# Machine Simulator for ChiTrac System

A comprehensive multi-station machine simulator for the ChiTrac manufacturing system. Supports both individual machine simulation and full facility simulation (Fillmore) with dynamic machine configuration from MongoDB.

## Features

- **Dynamic Machine Configuration**: Pulls machine data from MongoDB 'machine' collection
- **Multi-Lane Support**: Each machine can have 1-4 lanes based on database configuration
- **Multiple Machine Types**: SPF, LPL, Blanket, and SPL machines
- **Realistic Data Generation**: State changes and production counts
- **Process Management**: Spawn multiple machines as child processes
- **Database Integration**: MongoDB storage with real-time updates
- **Configurable**: Easy machine configuration and validation
- **Operator Management**: Unique operator assignment per lane with persistence

## Machine Configuration

Machines are configured in the MongoDB 'machine' collection with the following format:

```javascript
{
  "serial": 67798,
  "name": "LPL1", 
  "active": true,
  "ipAddress": "192.168.0.7",
  "lanes": 3
}
```

### Lane Configuration

- **1 Lane**: Single station (station 1)
- **2 Lanes**: Two stations (stations 1, 2)  
- **3 Lanes**: Three stations (stations 1, 2, 3)
- **4 Lanes**: Four stations (stations 1, 2, 3, 4)

Each lane gets its own operator assignment and generates independent production counts.

## Installation

```bash
# Install dependencies
npm install

# Ensure MongoDB is running
mongod
```

## Usage

### Fillmore Facility Simulation (All Active Machines)

```bash
# Start all active machines from MongoDB
node fillmore-simulator.js

# Or use npm script
npm start
```

### Single Machine Simulation

```bash
# Run individual machine
node machine-simulator.js --serial=67800 --type=SPL

# Examples
node machine-simulator.js --serial=68012 --type=SPF
node machine-simulator.js --serial=67798 --type=LPL
node machine-simulator.js --serial=67801 --type=Blanket
```

### Testing MongoDB Integration

```bash
# Test MongoDB machine data integration
npm run test-mongo

# Validate machine configurations
npm run validate
```

### NPM Scripts

```bash
npm start              # Start all active machines from MongoDB
npm run single         # Run single machine simulator
npm run test-mongo     # Test MongoDB integration
npm run validate       # Validate machine configurations
npm run test           # Test configuration
npm run help           # Show single machine help
npm run fillmore-help  # Show Fillmore simulator help
```

## Data Generated

### State Records
- Machine state changes (Timeout → Running → Fault)
- Operator assignments per lane/station
- Program information and item details

### Count Records
- Production counts for each active lane
- Operator and item correlation
- Station and lane information

### Operator Management
- Unique operator assignment per lane
- 85/15% operator reuse probability
- Cross-machine operator uniqueness
- Persistent operator tracking in `simulated-operators-ticker` collection

### Database Collections
- `chitrac.machine`: Machine configurations
- `chitrac.state-simulated`: Machine state records
- `chitrac.count-simulated`: Production count records
- `chitrac.simulated-operators-ticker`: Operator assignments

## Architecture

### Files Structure
```
machine-simulator/
├── schemas/
│   └── simulatedMachineSchema.js    # Machine configuration schema
├── fillmore-machines.js             # MongoDB machine data integration
├── simulation-worker.js             # Individual machine simulator
├── process-manager.js               # Multi-process manager
├── fillmore-simulator.js            # Main orchestrator
├── machine-simulator.js             # Single machine CLI
├── worker.js                        # Legacy single machine worker
├── utils.js                         # Utility functions
├── config.js                        # Configuration (auto-generated)
├── test-mongo-integration.js        # MongoDB integration tests
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
  serial: 67798,           // Machine serial number
  name: "LPL1",            // Machine name
  active: true,            // Whether to simulate
  ipAddress: "192.168.0.7", // Machine IP
  lanes: 3,                // Number of lanes (1-4)
  stations: [1,2,3],       // Active stations (auto-generated from lanes)
  type: "LPL",             // Machine type (auto-detected from name)
  groups: []               // Machine groups
}
```

### Adding New Machines
1. Add machine configuration to MongoDB `machine` collection
2. Set `active: true` to enable simulation
3. Set `lanes` field to determine number of stations
4. Restart simulator: `npm start`

## Monitoring

### Real-time Status
The simulator provides real-time status updates:
- Machine uptime
- Active lanes/stations
- Count generation status
- Process health

### Logging
- Timestamped logs for each machine
- State change notifications
- Count generation events
- Error reporting
- Operator assignment tracking

## Troubleshooting

### Common Issues

**MongoDB Connection Error**
```bash
# Ensure MongoDB is running
mongod
```

**No Machines Found**
```bash
# Check if machines exist in database
npm run test-mongo
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
# Test MongoDB integration
npm run test-mongo

# Test configuration
npm run test

# Validate machines
npm run validate

# Test single worker
node simulation-worker.js
```

### Adding New Features
1. Update schema in `schemas/simulatedMachineSchema.js`
2. Modify machine configurations in MongoDB
3. Update simulation logic in `simulation-worker.js`
4. Test with validation and single machine first

## License

ISC License

## Support

For issues and questions, please refer to the ChiTrac system documentation or contact the development team. 