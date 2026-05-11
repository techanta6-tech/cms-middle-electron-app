const path = require('path');
require('dotenv').config(); // Load biến môi trường của BE (cms-middle-be/.env)
require('dotenv').config({ path: path.join(__dirname, '../.env.generated') }); // Đè các thông số IP/Port chung từ root
if (process.env.USER_DATA_PATH) {
  require('dotenv').config({ path: path.join(process.env.USER_DATA_PATH, '.env.generated') }); 
}

// Global error handlers to prevent abrupt crashes
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

// Load SVMS event registry từ file vào memory
svmsEventRegistry.loadRegistry();


const httpServer = createServer(app);

// Khởi tạo Socket.IO Server trên httpServer
socketState.init(httpServer);

// Đăng ký các socket event handlers
setupSocketEvents();

// ─── SERVER STARTUP ──────────────────────────────────────────────────────────
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`\n🚀 MIDDLE SERVER RUNNING AT: http://0.0.0.0:${port}`);
  console.log(`📡 CLIENT SOCKET SERVER READY (PORT ${port})`);

  // Start server monitoring cron job
  startMonitoring();

  // MQTT is now managed via UI — no auto-init from .env

  // Log connectivity monitor config
  console.log(`\n🔌 CONNECTIVITY MONITOR INITIALIZED`);
  console.log(`   ├─ Timeout: ${CONNECTIVITY_TIMEOUT_MS}ms`);
  console.log(`   ├─ SVMS Ports: ${SVMS_PORT_LIST.join(', ')}`);
  console.log(`   └─ Timers: ${JSON.stringify(connectivityMonitor.getTimerStats())}\n`);
});