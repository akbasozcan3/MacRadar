const path = require('node:path');
require('./load-backend-env');

const resolvedPort = String(
  process.env.PORT || process.env.NODE_PORT || process.env.GO_PORT || '8090',
);

process.env.PORT = resolvedPort;
process.env.NODE_PORT = resolvedPort;
process.env.MACRADAR_IMPLEMENTATION = process.env.MACRADAR_IMPLEMENTATION || 'node';
process.env.MACRADAR_SERVICE_NAME = process.env.MACRADAR_SERVICE_NAME || 'node';

require(path.join(__dirname, '..', 'node', 'server.js'));
