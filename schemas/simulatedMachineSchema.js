module.exports = {
    type: 'object',
    required: [
      'serial',
      'name',
      'active',
      'lanes',
      'stations',
      'type'
    ],
    properties: {
      _id: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$' // optional but must be valid ObjectId if present
      },
      serial: {
        type: 'integer',
        description: 'Machine serial number'
      },
      name: {
        type: 'string',
        description: 'Machine name'
      },
      active: {
        type: 'boolean',
        description: 'Whether this machine should be simulated'
      },
      ipAddress: {
        type: 'string',
        format: 'ipv4',
        description: 'Machine IP address'
      },
      lanes: {
        type: 'integer',
        minimum: 1,
        description: 'Number of lanes/stations the machine has'
      },
      stations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'integer'
        },
        description: 'Required sorted array of active station numbers like [1, 3] for Blanket machines'
      },
      type: {
        type: 'string',
        enum: ['SPF', 'LPL', 'Blanket', 'SPL'],
        description: 'Machine type identifier'
      },
      groups: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string'
            },
            costCenter: {
              type: 'string'
            },
            departmentId: {
              type: 'string'
            }
          },
          additionalProperties: false
        },
        default: []
      }
    },
    additionalProperties: false
  }; 