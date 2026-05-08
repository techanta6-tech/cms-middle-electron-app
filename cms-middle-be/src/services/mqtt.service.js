const mqtt = require('mqtt');
const path = require('path');
const { mqttServers, servers, deviceCameraLinks, getClientSockets } = require('../socketState');
let cameraModule;
try {
  cameraModule = require('./cameraModule');
} catch (err) {
  try {
    cameraModule = require('../../cameraModule');
  } catch (err2) {
    cameraModule = { init: () => { } };
  }
}

const { getSnapshotForCamera } = require('./cameras.service');

/** Map of active MQTT client instances, keyed by server config id */
const mqttClients = new Map();

const MAX_LOGS_PER_SERVER = 100;

// ─── MQTT Connection ────────────────────────────────────────────────────────────

/**
 * Connect to a single MQTT server config and start listening.
 * @param {object} serverConfig - { id, brokerHost, brokerPort, protocol, topic, defaultTopic, cameraId }
 */
const connectMqttServer = (serverConfig) => {
  const { id, brokerHost, brokerPort, protocol, topic, cameraId } = serverConfig;
  const brokerUrl = `${protocol || 'mqtt'}://${brokerHost}:${brokerPort}`;

  console.log(`[MQTT] Connecting to server '${id}' at ${brokerUrl}...`);

  // Update status in mqttServers array
  const entry = mqttServers.find(s => s.id === id);

  if (!topic || !topic.trim()) {
    console.error(`[MQTT] Server '${id}' has no topic specified.`);
    if (entry) entry.status = 'error';

    // Register as a disconnected server entry for unified display on FE
    servers.set(`mqtt-${id}`, {
      id: `mqtt-${id}`,
      serial: '',
      server_ip: brokerHost,
      server_name: serverConfig.name || `MQTT: ${brokerHost}:${brokerPort}`,
      version: '',
      location: '',
      day: 0, month: 0, year: 0,
      svms_ipv4_ip: brokerHost,
      type: 'mqtt',
      connectionStatus: 'disconnected',
      lastSeen: new Date().toISOString(),
      mqttTopic: '',
    });

    _pushSystemLog(id, `Connection ERROR: No topic specified for subscription`);
    _emitMqttServersUpdate();
    _emitServerInfoUpdate();
    return;
  }

  if (entry) entry.status = 'connecting';

  // Register as a server entry for unified display on FE
  servers.set(`mqtt-${id}`, {
    id: `mqtt-${id}`,
    serial: '',
    server_ip: brokerHost,
    server_name: serverConfig.name || `MQTT: ${brokerHost}:${brokerPort}`,
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

        // ── DEBUG: In cấu trúc payload để chuẩn đoán ──
        console.log(`[MQTT][${id}] Payload keys:`, Object.keys(parsedBody));
        if (parsedBody.object) {
          console.log(`[MQTT][${id}] object keys:`, Object.keys(parsedBody.object));
          console.log(`[MQTT][${id}] object.events:`, JSON.stringify(parsedBody.object.events)?.substring(0, 300));
        } else {
          console.log(`[MQTT][${id}] ⚠️  parsedBody.object is MISSING`);
        }
        // ── END DEBUG ──

        // ── Device-level snapshot: tìm camera theo devEui của device gửi log ──
        const devEui = (dataTarget?.deviceInfo?.devEui) || (parsedBody?.deviceInfo?.devEui) || '';
        const deviceLink = devEui
          ? deviceCameraLinks.find(l => l.devEui === devEui && l.mqttServerId === id)
          : null;
        // Fallback: dùng server-level cameraId nếu không tìm thấy device-level link
        const resolvedCameraId = deviceLink?.cameraId || (entry && entry.cameraId) || null;

        if (dataTarget && dataTarget.object && dataTarget.object.events) {
          const events = dataTarget.object.events;
          // Lấy snapshot 1 lần duy nhất cho tất cả events
          let snapshot = null;
          if (resolvedCameraId && resolvedCameraId !== 'none') {
            snapshot = await getSnapshotForCamera(resolvedCameraId);
          }

          // Tạo 1 log entry riêng cho mỗi event trong mảng
          for (const event of events) {
            // Lọc bỏ các sự kiện có trạng thái deactivated hoặc ignored
            const status = (event.alarm_status || '').toLowerCase();
            if (status.includes('deactivated') || status.includes('ignored')) {
              console.log(`[MQTT][${id}] Skipped event with status: ${event.alarm_status}`);
              continue;
            }

            // Event Filtering for MQTT Radar (individual toggles)
            const alarmType = (event.alarm_type || '').toLowerCase();
            const linkFeatures = deviceLink?.features || {};

            // Check individual toggle state. Default to true if not defined.
            const isAllowed = linkFeatures[alarmType] ?? true;

            if (!isAllowed) {
              console.log(`[MQTT][${id}] Skipped filtered event: ${alarmType} for devEui: ${devEui}`);
              continue;
            }
            // Tách riêng payload để mỗi log mới chỉ lưu một event
            const isolatedPayload = {
              ...parsedBody,
              object: {
                ...parsedBody.object,
                events: [event]
              }
            };

            const logEntry = {
              time: new Date().toISOString(),
              type: 'data',
              topic: msgTopic,
              payload: isolatedPayload,
              event,              // alarm event riêng lẻ: { alarm_type, alarm_id, alarm_status }
              snapshot: snapshot || null,
              mqttServerId: id,
            };
            _pushDataLog(id, logEntry);
            _emitMqttLog(id, logEntry);
          }
        } else {
          // Valid JSON nhưng không có object.events — vẫn tạo log + yêu cầu snapshot
          console.log(`[MQTT][${id}] Forward raw payload (no object.events)`);
          let snapshot = null;
          // if (resolvedCameraId) {
          //   snapshot = await getSnapshotForCamera(resolvedCameraId);
          //   console.log(`[MQTT][${id}] Snapshot result:`, snapshot ? `OK (${snapshot.length} chars)` : 'null');
          // }
          const logEntry = {
            time: new Date().toISOString(),
            type: 'raw',
            topic: msgTopic,
            payload: parsedBody,
            event: { alarm_type: 'debug_raw', alarm_status: 'raw_payload', alarm_id: 0 },
            snapshot: snapshot || null,
            mqttServerId: id,
          };
          _pushDataLog(id, logEntry);
          _emitMqttLog(id, logEntry);
        }
      } catch (e) {
        // Binary/Protobuf — skip
        console.log(`[MQTT][${id}] Skipped: non-JSON payload (binary/protobuf)`, e.message);
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
    name: s.name || '',
    brokerHost: s.brokerHost,
    brokerPort: s.brokerPort,
    protocol: s.protocol,
    topic: s.topic,
    defaultTopic: s.defaultTopic,
    cameraId: s.cameraId || null,
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

// ─── Downlink / Command Publishing ──────────────────────────────────────────────

/**
 * Publish a downlink command to a device via ChirpStack MQTT.
 *
 * ChirpStack v4 topic:
 *   application/{applicationId}/device/{devEui}/command/down
 *
 * @param {string} mqttServerId  - ID của MQTT server đã được cấu hình (phải đang `connected`)
 * @param {object} options
 * @param {string} options.applicationId - Application ID trên ChirpStack
 * @param {string} options.devEui        - Device EUI của thiết bị đích
 * @param {number} options.fPort         - Application port (VS373 dùng 85)
 * @param {string} options.dataBase64    - Payload dưới dạng Base64
 * @param {boolean} [options.confirmed]  - Có yêu cầu ACK từ thiết bị không (mặc định false)
 * @returns {{ success: boolean, topic?: string, error?: string }}
 */
const publishDownlink = (mqttServerId, { applicationId, devEui, fPort, dataBase64, confirmed = false }) => {
  const client = mqttClients.get(mqttServerId);
  if (!client) {
    const msg = `[MQTT][Downlink] No active client for server '${mqttServerId}'`;
    console.error(msg);
    return { success: false, error: msg };
  }

  const entry = mqttServers.find(s => s.id === mqttServerId);
  if (!entry || entry.status !== 'connected') {
    const msg = `[MQTT][Downlink] Server '${mqttServerId}' is not connected (status: ${entry?.status})`;
    console.error(msg);
    return { success: false, error: msg };
  }

  const topic = `application/${applicationId}/device/${devEui}/command/down`;
  const payload = JSON.stringify({
    devEui,
    confirmed,
    fPort,
    data: dataBase64,
  });

  client.publish(topic, payload, { qos: 0 }, (err) => {
    if (err) {
      console.error(`[MQTT][Downlink] Publish error on topic '${topic}':`, err);
      _pushSystemLog(mqttServerId, `Downlink FAILED for devEui=${devEui} fPort=${fPort}: ${String(err)}`);
    } else {
      console.log(`[MQTT][Downlink] Published to '${topic}': ${payload}`);
      _pushSystemLog(mqttServerId, `Downlink OK → devEui=${devEui} fPort=${fPort} data=${dataBase64}`);
      _emitMqttServersUpdate();
    }
  });

  return { success: true, topic };
};

/**
 * Bật hoặc tắt còi báo động (Buzzer) trên thiết bị VS373.
 *
 * Lệnh theo tài liệu VS373:
 *   - Bật Buzzer  : Hex ff3e01 → Base64 /z4B
 *   - Tắt Buzzer  : Hex ff3e00 → Base64 /z4A
 *
 * @param {string} mqttServerId  - ID của MQTT server
 * @param {object} options
 * @param {string} options.applicationId - Application ID trên ChirpStack
 * @param {string} options.devEui        - Device EUI của thiết bị VS373
 * @param {boolean} options.enable       - true = bật còi, false = tắt còi
 * @param {number}  [options.fPort]      - Application port (mặc định 85 theo spec VS373)
 * @returns {{ success: boolean, topic?: string, error?: string }}
 */
const controlBuzzer = (mqttServerId, { applicationId, devEui, enable, fPort = 85 }) => {
  // Hex ff3e01 (enable) / ff3e00 (disable) → Buffer → Base64
  const hexBytes = enable ? [0xff, 0x3e, 0x01] : [0xff, 0x3e, 0x00];
  const dataBase64 = Buffer.from(hexBytes).toString('base64');

  console.log(`[MQTT][Buzzer] ${enable ? 'ON' : 'OFF'} → devEui=${devEui} data=${dataBase64}`);

  // return publishDownlink(mqttServerId, {
  //   applicationId,
  //   devEui,
  //   fPort,
  //   dataBase64,
  //   confirmed: false,
  // });
  return publishDownlink(mqttServerId, {
    applicationId,
    devEui: '24e124806e515126',
    fPort,
    dataBase64,
    confirmed: false,
  });
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
  publishDownlink,
  controlBuzzer,
};

