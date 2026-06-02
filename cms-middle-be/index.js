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
const { bootstrapPersistedDevices, getFilePath: getPersistedDevicesPath } = require('./src/services/persisted-devices.service');
const trafficService = require('./src/services/traffic.service');
const eventGroupService = require('./src/services/eventGroup.service');
const milesightHeartbeat = require('./src/services/milesight-heartbeat.service');

const fs = require('fs');

/**
 * Load Milesight-specific settings from data/milesightSettings.json.
 * Falls back to defaults if the file is missing or malformed.
 */
function loadMilesightSettings() {
  const defaults = {
    heartbeat: {
      offlineThresholdMinutes: 1,
      checkIntervalSeconds: 15,
    },
  };
  try {
    const settingsPath = path.join(runtimeDir, 'data', 'milesightSettings.json');
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return {
        ...defaults,
        ...parsed,
        heartbeat: { ...defaults.heartbeat, ...(parsed.heartbeat || {}) },
      };
    }
  } catch (err) {
    console.warn('[MILESIGHT_SETTINGS] Cannot load milesightSettings.json:', err.message);
  }
  return defaults;
}

svmsEventRegistry.loadRegistry();
milesightEventRegistry.loadRegistry();
sunellEventRegistry.loadRegistry();
trafficService.loadTrafficRecords();
eventGroupService.loadEventGroups();

const httpServer = createServer(app);

socketState.init(httpServer);
setupSocketEvents();

// ─── allLogs persistence: lưu ra file mỗi 1 phút ─────────────────────────
const _writableBase = process.env.USER_DATA_PATH || process.cwd();
const _allLogsDir = path.join(_writableBase, 'data');
const _allLogsFilePath = path.join(_allLogsDir, 'allLogs.json');

if (!fs.existsSync(_allLogsDir)) {
  fs.mkdirSync(_allLogsDir, { recursive: true });
}

// Khôi phục allLogs từ file khi khởi động (nếu có)
try {
  if (fs.existsSync(_allLogsFilePath)) {
    const raw = fs.readFileSync(_allLogsFilePath, 'utf8');
    const restored = JSON.parse(raw);
    if (Array.isArray(restored) && restored.length > 0) {
      const { allLogs, ALL_LOGS_MAX } = socketState;
      // Nạp lại dữ liệu cũ, giới hạn theo ALL_LOGS_MAX
      const toRestore = restored.slice(-ALL_LOGS_MAX).map(log => eventGroupService.normalizeLog(log));
      allLogs.push(...toRestore);
      console.log(`[allLogs] Khoi phuc ${toRestore.length} logs tu ${_allLogsFilePath}`);
    }
  }
} catch (err) {
  console.error('[allLogs] Loi khi khoi phuc allLogs:', err.message);
}

// Lưu allLogs ra file mỗi 1 phút
let _lastSavedLogCount = 0;
setInterval(() => {
  try {
    const { allLogs } = socketState;
    // Chỉ ghi file khi có thay đổi (tránh ghi liên tục không cần thiết)
    if (allLogs.length === _lastSavedLogCount) return;

    fs.writeFileSync(_allLogsFilePath, JSON.stringify(allLogs), 'utf8');
    _lastSavedLogCount = allLogs.length;
    console.log(`[allLogs] Da luu ${allLogs.length} logs ra ${_allLogsFilePath}`);
  } catch (err) {
    console.error('[allLogs] Loi khi luu allLogs:', err.message);
  }

  // Lưu traffic records
  trafficService.saveTrafficRecords();
}, 60 * 1000); // 1 phút

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`\nMIDDLE SERVER RUNNING AT: http://0.0.0.0:${port}`);
  console.log(`CLIENT SOCKET SERVER READY (PORT ${port})`);
  console.log(`PERSISTED DEVICE REGISTRY: ${getPersistedDevicesPath()}`);
  console.log(`ALL LOGS PERSIST FILE: ${_allLogsFilePath}`);
  console.log(`TRAFFIC PERSIST FILE: ${trafficService.getFilePath()}`);

  startMonitoring();

  console.log('\nCONNECTIVITY MONITOR INITIALIZED');
  console.log(`   Timeout: ${CONNECTIVITY_TIMEOUT_MS}ms`);
  console.log(`   SVMS Ports: ${SVMS_PORT_LIST.join(', ')}`);
  console.log(`   Timers: ${JSON.stringify(connectivityMonitor.getTimerStats())}\n`);

  bootstrapPersistedDevices()
    .then(() => {
      const milesightSettings = loadMilesightSettings();
      milesightHeartbeat.startHeartbeatMonitor(milesightSettings.heartbeat);
    })
    .catch((err) => {
      console.error('[PERSISTED_DEVICES] Bootstrap failed:', err);
      // Still start heartbeat monitor even if bootstrap had issues
      const milesightSettings = loadMilesightSettings();
      milesightHeartbeat.startHeartbeatMonitor(milesightSettings.heartbeat);
    });
});
