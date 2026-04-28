const mqtt = require('mqtt');
const { mqttServers, servers, getClientSockets } = require('../socketState');

/** Map of active MQTT client instances, keyed by server config id */
const mqttClients = new Map();

const MAX_LOGS_PER_SERVER = 100;

/**
 * Placeholder: Lấy snapshot base64 từ camera/device khi có alarm event.
 * TODO: Thay bằng hàm thực tế gọi API camera (VD: VS373 getSnapshot, Sunell SDK, ...)
 * @param {object} parsedBody - Raw MQTT payload (chứa deviceInfo, object.events, ...)
 * @returns {Promise<string|null>} base64 image string hoặc null
 */
async function getSnapshot(parsedBody) {
  // Placeholder — trả về null cho đến khi có hàm gọi thực tế
  return null;
}

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
          // TODO: Thay bằng hàm thực tế gọi API lấy snapshot từ camera/device
          const snapshot = await getSnapshot(parsedBody);

          const logEntry = {
            time: new Date().toISOString(),
            type: 'data',
            topic: msgTopic,
            payload: parsedBody,
            snapshot: snapshot || null,
            mqttServerId: id,
          };
          _pushDataLog(id, logEntry);
          _emitMqttLog(id, logEntry);
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
};
