const path = require('path');
const isPkg = Boolean(process.pkg);
const runtimeDir = isPkg ? path.dirname(process.execPath) : __dirname;
const sharedEnvDir = isPkg ? runtimeDir : path.join(__dirname, '..');

if (isPkg && !process.env.USER_DATA_PATH) {
  process.env.USER_DATA_PATH = runtimeDir;
}

require('dotenv').config({ path: path.join(runtimeDir, '.env') });
require('dotenv').config({ path: path.join(sharedEnvDir, '.env.generated') });
if (process.env.USER_DATA_PATH) {
  require('dotenv').config({ path: path.join(process.env.USER_DATA_PATH, '.env.generated') });
}

process.on('uncaughtException', (err) => {
  console.error('[Backend] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Backend] Unhandled Rejection at:', promise, 'reason:', reason);
});

const { createServer } = require('http');
const { port, SVMS_PORT_LIST, CONNECTIVITY_TIMEOUT_MS } = require('./src/config');
const app = require('./src/app');
const socketState = require('./src/socketState');
const setupSocketEvents = require('./src/socketEvents');
const { startMonitoring } = require('./src/services/check-server.service');
const connectivityMonitor = require('./src/services/connectivity-monitor.service');
const svmsEventRegistry = require('./src/services/svmsEventRegistry.service');
const milesightEventRegistry = require('./src/services/milesightEventRegistry.service');
const sunellEventRegistry = require('./src/services/sunellEventRegistry.service');

svmsEventRegistry.loadRegistry();
milesightEventRegistry.loadRegistry();
sunellEventRegistry.loadRegistry();

const httpServer = createServer(app);

socketState.init(httpServer);
setupSocketEvents();

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`\nMIDDLE SERVER RUNNING AT: http://0.0.0.0:${port}`);
  console.log(`CLIENT SOCKET SERVER READY (PORT ${port})`);

  startMonitoring();

  console.log('\nCONNECTIVITY MONITOR INITIALIZED');
  console.log(`   Timeout: ${CONNECTIVITY_TIMEOUT_MS}ms`);
  console.log(`   SVMS Ports: ${SVMS_PORT_LIST.join(', ')}`);
  console.log(`   Timers: ${JSON.stringify(connectivityMonitor.getTimerStats())}\n`);
});
