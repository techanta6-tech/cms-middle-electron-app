const mqtt = require('mqtt');
const path = require('path');
const { mqttServers, mqttDevices, servers, getClientSockets } = require('../socketState');
let cameraModule;
try {
  cameraModule = require('./cameraModule');
} catch (err) {
  console.warn('[MQTT-Service] cameraModule load failed — snapshot disabled:', err.message);
  cameraModule = {
    init: () => {},
    connectCamera: async () => ({ online: false, error: 'cameraModule not available' }),
    captureSnapshotBase64: async () => null,
  };
}

/** Map of active MQTT client instances, keyed by server config id */
const mqttClients = new Map();

const MAX_LOGS_PER_SERVER = 100;

// ─── Device CRUD ────────────────────────────────────────────────────────────────

/**
 * Thêm camera device liên kết với 1 MQTT server.
 * Nếu type=sunell → gọi cameraModule để kết nối SDK.
 * @param {object} deviceConfig - { mqttServerId, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl }
 * @returns {Promise<object>} result { success, device, sdkResult? }
 */
async function addMqttDevice(deviceConfig) {
  const { mqttServerId, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl } = deviceConfig;

  const id = `cam-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const snapshotDir = path.join(__dirname, '..', '..', 'snapshots');
  const sdkPath = path.join(__dirname, '..', 'module', 'sunell');

  const device = {
    id,
    mqttServerId,
    type: type || 'sunell',
    cameraIp,
    cameraPort: cameraPort || 30001,
    cameraUser: cameraUser || 'admin',
    cameraPass: cameraPass || 'admin1234',
    rtspUrl,
    snapshotDir,
    sdkPath,
    status: 'connecting',
    handle: null,
  };

  mqttDevices.push(device);
  console.log(`[MQTT-Device] Added device '${id}' (${type}) for MQTT server '${mqttServerId}'`);

  let sdkResult = null;

  if (type === 'sunell') {
    try {
      // Init + connect camera via SDK
      cameraModule.init({
        rtspUrl,
        snapshotDir,
        sdkPath,
        cameraIp,
        cameraPort: cameraPort || 30001,
        cameraUser: cameraUser || 'admin',
        cameraPass: cameraPass || 'admin1234',
      });

      sdkResult = await cameraModule.connectCamera();
      device.status = sdkResult.online ? 'connected' : 'error';
      device.handle = sdkResult.handle || null;
      console.log(`[MQTT-Device] SDK connect result for '${id}':`, sdkResult);
    } catch (err) {
      device.status = 'error';
      sdkResult = { online: false, error: err.message || String(err) };
      console.error(`[MQTT-Device] SDK connect error for '${id}':`, err);
    }
  }

  // Emit update to FE
  _emitMqttDevicesUpdate();

  return { success: true, device: _sanitizeDevice(device), sdkResult };
}

/**
 * Xoá device theo ID.
 * @param {string} deviceId
 * @returns {object}
 */
function removeMqttDevice(deviceId) {
  const idx = mqttDevices.findIndex(d => d.id === deviceId);
  if (idx === -1) return { success: false, error: 'Device not found' };

  mqttDevices.splice(idx, 1);
  console.log(`[MQTT-Device] Removed device '${deviceId}'`);
  _emitMqttDevicesUpdate();
  return { success: true };
}

/**
 * Cập nhật thông tin device (VD: rtspUrl).
 * @param {string} deviceId
 * @param {object} updates - Các trường cần cập nhật { rtspUrl?, cameraIp?, cameraPort?, cameraUser?, cameraPass? }
 * @returns {object}
 */
function updateMqttDevice(deviceId, updates) {
  const device = mqttDevices.find(d => d.id === deviceId);
  if (!device) return { success: false, error: 'Device not found' };

  if (updates.rtspUrl !== undefined) device.rtspUrl = updates.rtspUrl;
  if (updates.cameraIp !== undefined) device.cameraIp = updates.cameraIp;
  if (updates.cameraPort !== undefined) device.cameraPort = updates.cameraPort;
  if (updates.cameraUser !== undefined) device.cameraUser = updates.cameraUser;
  if (updates.cameraPass !== undefined) device.cameraPass = updates.cameraPass;

  console.log(`[MQTT-Device] Updated device '${deviceId}':`, JSON.stringify(updates));
  _emitMqttDevicesUpdate();
  return { success: true, device: _sanitizeDevice(device) };
}

/**
 * Lấy danh sách devices (sanitized).
 * @param {string} [mqttServerId] - Lọc theo MQTT server ID (optional)
 * @returns {Array}
 */
function getMqttDevicesList(mqttServerId) {
  const list = mqttServerId
    ? mqttDevices.filter(d => d.mqttServerId === mqttServerId)
    : mqttDevices;
  return list.map(_sanitizeDevice);
}

function _sanitizeDevice(d) {
  return {
    id: d.id,
    mqttServerId: d.mqttServerId,
    type: d.type,
    cameraIp: d.cameraIp,
    cameraPort: d.cameraPort,
    cameraUser: d.cameraUser,
    rtspUrl: d.rtspUrl || null,
    status: d.status,
    handle: d.handle,
  };
}

function _emitMqttDevicesUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-devices', getMqttDevicesList());
  }
}

// ─── Snapshot Function ──────────────────────────────────────────────────────────

/**
 * Lấy snapshot từ camera đầu tiên liên kết với MQTT server của log.
 * Chờ camera trả về -> trả base64 hoặc null nếu không có device/lỗi.
 * @param {string} mqttServerId
 * @returns {Promise<string|null>}
 */
async function getSnapshotForServer(mqttServerId) {
  const device = mqttDevices.find(d => d.mqttServerId === mqttServerId && d.status === 'connected');
  if (!device) {
    console.log(`[MQTT-Snapshot] No connected camera for MQTT server '${mqttServerId}'`);
    return null;
  }

  console.log(`[MQTT-Snapshot] Capturing from device '${device.id}' (${device.cameraIp}) ...`);
  try {
    const base64 = await cameraModule.captureSnapshotBase64(device.rtspUrl);
    return base64;
  } catch (err) {
    console.error(`[MQTT-Snapshot] Capture failed for device '${device.id}':`, err.message);
    return null;
  }
}

// ─── MQTT Connection ────────────────────────────────────────────────────────────

/**
 * Connect to a single MQTT server config and start listening.
 * @param {object} serverConfig - { id, brokerHost, brokerPort, protocol, topic, defaultTopic }
 */
const connectMqttServer = (serverConfig) => {
  const { id, brokerHost, brokerPort, protocol, topic } = serverConfig;
  const brokerUrl = `${protocol || 'mqtt'}://${brokerHost}:${brokerPort}`;

  console.log(`[MQTT] Connecting to server '${id}' at ${brokerUrl}...`);

  // Update status in mqttServers array
  const entry = mqttServers.find(s => s.id === id);
  if (entry) entry.status = 'connecting';

  // Register as a server entry for unified display on FE
  servers.set(`mqtt-${id}`, {
    id: `mqtt-${id}`,
    serial: '',
    server_ip: brokerHost,
    server_name: `MQTT: ${brokerHost}:${brokerPort}`,
    version: '',
    location: '',
    day: 0, month: 0, year: 0,
    svms_ipv4_ip: brokerHost,
    type: 'mqtt',
    connectionStatus: 'connecting',
    lastSeen: new Date().toISOString(),
    mqttTopic: topic,
  });

  // Emit server list update to FE
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('receive-server-information', {
      allServers: Object.fromEntries(servers)
    });
  }

  try {
    const client = mqtt.connect(brokerUrl);
    mqttClients.set(id, client);

    client.on('connect', () => {
      console.log(`[MQTT] Server '${id}' connected to ${brokerUrl}`);
      if (entry) entry.status = 'connected';

      // Update server entry status
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) {
        srvEntry.connectionStatus = 'connected';
        srvEntry.lastSeen = new Date().toISOString();
      }

      _pushSystemLog(id, `Connected to broker at ${brokerUrl}`);
      _emitMqttServersUpdate();
      _emitServerInfoUpdate();

      // Subscribe to topic
      if (topic) {
        client.subscribe(topic, (err) => {
          if (err) {
            console.error(`[MQTT] Server '${id}' subscription error for topic ${topic}:`, err);
            _pushSystemLog(id, `Subscription ERROR for topic ${topic}: ${String(err)}`);
          } else {
            console.log(`[MQTT] Server '${id}' subscribed to topic: ${topic}`);
            _pushSystemLog(id, `Subscribed to topic: ${topic}`);
          }
        });
      }
    });

    client.on('message', async (msgTopic, message) => {
      console.log(`[MQTT][${id}] Data received on topic: ${msgTopic}`);
      try {
        const parsedBody = JSON.parse(message.toString());
        const dataTarget = parsedBody.payload || parsedBody;

        if (dataTarget && dataTarget.object && dataTarget.object.events) {
          const events = dataTarget.object.events;
          // Lấy snapshot 1 lần duy nhất cho tất cả events
          const snapshot = await getSnapshotForServer(id);

          // Tạo 1 log entry riêng cho mỗi event trong mảng
          for (const event of events) {
            const logEntry = {
              time: new Date().toISOString(),
              type: 'data',
              topic: msgTopic,
              payload: parsedBody,
              event,              // alarm event riêng lẻ: { alarm_type, alarm_id, alarm_status }
              snapshot: snapshot || null,
              mqttServerId: id,
            };
            _pushDataLog(id, logEntry);
            _emitMqttLog(id, logEntry);
          }
        } else {
          // Valid JSON but missing object.events — skip
          console.log(`[MQTT][${id}] Skipped: message has no object.events structure`);
        }
      } catch (e) {
        // Binary/Protobuf — skip
        console.log(`[MQTT][${id}] Skipped: non-JSON payload (binary/protobuf)`);
      }
    });

    client.on('error', (err) => {
      console.error(`[MQTT] Server '${id}' connection error:`, err);
      if (entry) entry.status = 'error';
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) srvEntry.connectionStatus = 'disconnected';
      _pushSystemLog(id, `Connection Error: ${String(err)}`);
      _emitMqttServersUpdate();
      _emitServerInfoUpdate();
    });

    client.on('close', () => {
      console.log(`[MQTT] Server '${id}' connection closed`);
      if (entry) entry.status = 'disconnected';
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) srvEntry.connectionStatus = 'disconnected';
      _pushSystemLog(id, `Connection closed`);
      _emitMqttServersUpdate();
      _emitServerInfoUpdate();
    });

    client.on('reconnect', () => {
      console.log(`[MQTT] Server '${id}' reconnecting...`);
      if (entry) entry.status = 'connecting';
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) srvEntry.connectionStatus = 'connecting';
      _pushSystemLog(id, `Reconnecting to broker...`);
      _emitMqttServersUpdate();
    });

  } catch (error) {
    console.error(`[MQTT] Server '${id}' initialization error:`, error);
    if (entry) entry.status = 'error';
    _pushSystemLog(id, `Initialization exception: ${String(error)}`);
    _emitMqttServersUpdate();
  }
};

/**
 * Disconnect a single MQTT server by id.
 * @param {string} id
 */
const disconnectMqttServer = (id) => {
  const client = mqttClients.get(id);
  if (client) {
    client.end(true);
    mqttClients.delete(id);
    console.log(`[MQTT] Server '${id}' disconnected and cleaned up`);
  }
  // Remove from servers Map
  servers.delete(`mqtt-${id}`);
  _emitServerInfoUpdate();
};

/**
 * Get sanitised list of MQTT server configs (without client instances).
 */
const getMqttServersList = () => {
  return mqttServers.map(s => ({
    id: s.id,
    brokerHost: s.brokerHost,
    brokerPort: s.brokerPort,
    protocol: s.protocol,
    topic: s.topic,
    defaultTopic: s.defaultTopic,
    status: s.status || 'disconnected',
    logCount: (s.logs || []).length,
  }));
};

/**
 * Get logs for a specific MQTT server.
 * @param {string} id
 * @returns {Array}
 */
const getMqttServerLogs = (id) => {
  const entry = mqttServers.find(s => s.id === id);
  return entry ? (entry.logs || []) : [];
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _pushSystemLog(serverId, message) {
  const entry = mqttServers.find(s => s.id === serverId);
  if (!entry) return;
  if (!entry.logs) entry.logs = [];
  entry.logs.push({ time: new Date().toISOString(), type: 'system', message, mqttServerId: serverId });
  if (entry.logs.length > MAX_LOGS_PER_SERVER) entry.logs.shift();
}

function _pushDataLog(serverId, logEntry) {
  const entry = mqttServers.find(s => s.id === serverId);
  if (!entry) return;
  if (!entry.logs) entry.logs = [];
  entry.logs.push(logEntry);
  if (entry.logs.length > MAX_LOGS_PER_SERVER) entry.logs.shift();
}

function _emitMqttLog(serverId, logEntry) {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    const serverConfig = mqttServers.find(s => s.id === serverId);
    clientSockets.emit('receive-mqtt-log', {
      ...logEntry,
      mqttServerId: serverId,
      brokerHost: serverConfig?.brokerHost || '',
      brokerPort: serverConfig?.brokerPort || '',
    });
  }
}

function _emitMqttServersUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-servers', getMqttServersList());
  }
}

function _emitServerInfoUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('receive-server-information', {
      allServers: Object.fromEntries(servers)
    });
  }
}

module.exports = {
  connectMqttServer,
  disconnectMqttServer,
  getMqttServersList,
  getMqttServerLogs,
  addMqttDevice,
  removeMqttDevice,
  updateMqttDevice,
  getMqttDevicesList,
};
