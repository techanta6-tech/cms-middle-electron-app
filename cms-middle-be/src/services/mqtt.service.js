const mqtt = require('mqtt');
const path = require('path');
const { mqttServers, servers, deviceCameraLinks, getClientSockets, mqttDeviceList } = require('../socketState');
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
const { normalizeFeature } = require('../helpers/featureNormalizer');
const milesightEventRegistry = require('./milesightEventRegistry.service');
const { appendLog } = require('./system-state.service');
const persistedDevices = require('./persisted-devices.service');

/** Map of active MQTT client instances, keyed by server config id */
const mqttClients = new Map();

// â”€â”€â”€ MQTT Connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Connect to a single MQTT server config and start listening.
 * @param {object} serverConfig - { id, brokerHost, brokerPort, protocol, topic, defaultTopic, cameraId }
 */
const connectMqttServer = (serverConfig, options = {}) => {
  const { persistOnConnect = true } = options;
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

    console.error(`[MQTT] Connection ERROR for '${id}': No topic specified for subscription`);
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

      if (persistOnConnect && entry) {
        persistedDevices.persistMqttServer(entry);
      }

      _emitMqttServersUpdate();
      _emitServerInfoUpdate();

      // Subscribe to topic
      if (topic) {
        client.subscribe(topic, (err) => {
          if (err) {
            console.error(`[MQTT] Server '${id}' subscription error for topic ${topic}:`, err);
            console.error(`[MQTT] Subscription ERROR for '${id}' topic ${topic}: ${String(err)}`);
          } else {
            console.log(`[MQTT] Server '${id}' subscribed to topic: ${topic}`);
          }
        });
      }
    });

    client.on('message', async (msgTopic, message) => {
      console.log(`[MQTT][${id}] Data received on topic: ${msgTopic}`);
      try {
        const parsedBody = JSON.parse(message.toString());
        const dataTarget = parsedBody.payload || parsedBody;


        if (dataTarget && dataTarget.object && Array.isArray(dataTarget.object.events) && dataTarget.object.events.length > 0) {
          // â”€â”€ Device-level snapshot: tÃ¬m camera theo devEui cá»§a device gá»­i log â”€â”€
          const devEui = (dataTarget?.deviceInfo?.devEui) || (parsedBody?.deviceInfo?.devEui) || '';
          const deviceLink = devEui
            ? deviceCameraLinks.find(l => l.devEui === devEui && l.mqttServerId === id)
            : null;
          // Fallback: dÃ¹ng server-level cameraId náº¿u khÃ´ng tÃ¬m tháº¥y device-level link
          const resolvedCameraId = deviceLink?.cameraId || (entry && entry.cameraId) || null;

          // Snapshot cache per-message: trÃ¡nh chá»¥p trÃ¹ng cÃ¹ng 1 camera trong cÃ¹ng 1 message
          const snapshotCache = new Map();
          const getSnapshotCached = async (camId) => {
            if (!camId || camId === 'none') return null;
            if (snapshotCache.has(camId)) return snapshotCache.get(camId);
            const snap = await getSnapshotForCamera(camId);
            snapshotCache.set(camId, snap);
            return snap;
          };

          // Táº¡o 1 log entry riÃªng cho má»—i event trong máº£ng
          for (const event of dataTarget.object.events) {
            // Lá»c bá» cÃ¡c sá»± kiá»‡n cÃ³ tráº¡ng thÃ¡i deactivated hoáº·c ignored
            const status = (event.alarm_status || '').toLowerCase();
            if (status.includes('deactivated') || status.includes('ignored')) {
              console.log(`[MQTT][${id}] Skipped event with status: ${event.alarm_status}`);
              continue;
            }

            // Auto-discover if new event
            const alarmType = (event.alarm_type || '').toLowerCase();
            const isNewEvent = milesightEventRegistry.discoverEvent(alarmType);
            if (isNewEvent) {
              const { getClientSockets } = require('../socketState');
              const clientSockets = getClientSockets();
              if (clientSockets) {
                clientSockets.emit('update-milesight-known-events', milesightEventRegistry.getEvents());
              }
            }

            // Event Filtering + Per-event Camera Resolution
            const linkFeatures = deviceLink?.features || {};

            // Check if it's a known event from registry
            const knownTypesSet = milesightEventRegistry.getKnownTypesSet();
            const isKnownEvent = knownTypesSet.has(alarmType);

            let feat = { enabled: true, cameraId: linkFeatures[alarmType]?.cameraId || null };
            if (isKnownEvent) {
              const defaultEnabled = milesightEventRegistry.getDefaultEnabled(alarmType);
              feat = normalizeFeature(linkFeatures[alarmType], alarmType);
              if (linkFeatures[alarmType] === undefined) {
                feat.enabled = defaultEnabled; // Apply registry default if user hasn't overridden
              }
            } else {
              // Event láº¡: dÃ¹ng feature __other_events__ Ä‘á»ƒ quyáº¿t Ä‘á»‹nh, máº·c Ä‘á»‹nh táº¯t
              const otherFeat = normalizeFeature(linkFeatures['__other_events__'], '__other_events__');
              if (!otherFeat.enabled) {
                console.log(`[MQTT][${id}] Skipped unknown event (other_events disabled): ${alarmType} for devEui: ${devEui}`);
                continue;
              }
              feat = { enabled: true, cameraId: otherFeat.cameraId };
            }

            if (!feat.enabled) {
              console.log(`[MQTT][${id}] Skipped disabled event: ${alarmType} for devEui: ${devEui}`);
              continue;
            }

            // Resolve camera cho event nÃ y: event-specific â†’ device default â†’ server default
            const eventCameraId = feat.cameraId || resolvedCameraId;
            let snapshot = await getSnapshotCached(eventCameraId);

            // Fallback: camera riÃªng fail â†’ thá»­ camera máº·c Ä‘á»‹nh
            if (!snapshot && feat.cameraId && resolvedCameraId && feat.cameraId !== resolvedCameraId) {
              console.log(`[MQTT][${id}] Event camera ${feat.cameraId} failed, fallback to default ${resolvedCameraId}`);
              snapshot = await getSnapshotCached(resolvedCameraId);
            }

            // TÃ¡ch riÃªng payload Ä‘á»ƒ má»—i log má»›i chá»‰ lÆ°u má»™t event
            const isolatedPayload = {
              ...parsedBody,
              object: {
                ...parsedBody.object,
                events: [event]
              }
            };

            // export interface LogData {
            //   id?: string;
            //   receive_time: number;
            //   log_type: string;
            //   log_description: string;
            //   snapshot?: string;
            //   log_source: 'svms' | 'milesight-radar' | 'sunell-camera';
            //   // device_info: {
            //   //   name: string;
            //   //   ip: string;
            //   //   index: number;
            //   // }
            //   // server_info: {

            //   // }
            //   device_info: {
            //     name: string;
            //     ip: string;
            //   }
            //   server_unique_id: string;
            //   raw: any;
            // }


            // â”€â”€â”€ Ghi vÃ o allLogs tá»•ng (LogData shape) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

            const newLogData = {
              id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
              receive_time: dataTarget.time ? new Date(dataTarget.time).getTime() : Date.now(),
              log_type: event.alarm_type || 'mqtt_event',
              log_description: event.alarm_status || event.alarm_type || 'MQTT event',
              snapshot: snapshot || null,
              log_source: 'milesight-radar',
              device_info: {
                name: dataTarget?.deviceInfo?.deviceName || 'Milesight Device',
                id: devEui || dataTarget?.deviceInfo?.deviceName || 'unknown',
              },
              server_unique_id: `mqtt-${id}`,
              raw: isolatedPayload,
            };
            appendLog(newLogData);

            upsertMqttDevice(id, devEui, dataTarget?.deviceInfo || {});
          }
        } else {
          const deviceInfo = dataTarget?.deviceInfo || parsedBody?.deviceInfo || {};
          const devEui = deviceInfo.devEui || '';
          const didUpsert = upsertMqttDevice(id, devEui, deviceInfo);
          console.log(`[MQTT][${id}] Received payload without object.events; ${didUpsert ? 'updated MQTT device only' : 'no deviceInfo.devEui to update'}`);
        }
      } catch (e) {
        // Binary/Protobuf â€” skip
        console.log(`[MQTT][${id}] Skipped: non-JSON payload (binary/protobuf)`, e.message);
      }
    });

    client.on('error', (err) => {
      console.error(`[MQTT] Server '${id}' connection error:`, err);
      if (entry) entry.status = 'error';
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) srvEntry.connectionStatus = 'disconnected';
      _emitMqttServersUpdate();
      _emitServerInfoUpdate();
    });

    client.on('close', () => {
      console.log(`[MQTT] Server '${id}' connection closed`);
      if (entry) entry.status = 'disconnected';
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) srvEntry.connectionStatus = 'disconnected';
      _emitMqttServersUpdate();
      _emitServerInfoUpdate();
    });

    client.on('reconnect', () => {
      console.log(`[MQTT] Server '${id}' reconnecting...`);
      if (entry) entry.status = 'connecting';
      const srvEntry = servers.get(`mqtt-${id}`);
      if (srvEntry) srvEntry.connectionStatus = 'connecting';
      _emitMqttServersUpdate();
    });

  } catch (error) {
    console.error(`[MQTT] Server '${id}' initialization error:`, error);
    if (entry) entry.status = 'error';
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

function upsertMqttDevice(mqttServerId, devEui, deviceInfo = {}) {
  if (!devEui) return false;

  const deviceEntry = {
    devEui,
    mqttServerId,
    deviceName: deviceInfo.deviceName || '',
    deviceProfileName: deviceInfo.deviceProfileName || '',
    applicationId: deviceInfo.applicationId || '',
    applicationName: deviceInfo.applicationName || '',
    lastSeen: new Date().toISOString(),
    raw: deviceInfo,
  };

  const existing = mqttDeviceList.findIndex(
    d => d.devEui === devEui && d.mqttServerId === mqttServerId
  );

  if (existing !== -1) {
    mqttDeviceList[existing] = deviceEntry;
  } else {
    mqttDeviceList.push(deviceEntry);
  }

  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-milesight-devices', mqttDeviceList);
  }

  return true;
}

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
    logCount: _getMqttAllLogs(s.id).length,
  }));
};

/**
 * Get logs for a specific MQTT server.
 * @param {string} id
 * @returns {Array}
 */
const getMqttServerLogs = (id) => {
  return _getMqttAllLogs(id);
};

// â”€â”€â”€ Downlink / Command Publishing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Publish a downlink command to a device via ChirpStack MQTT.
 *
 * ChirpStack v4 topic:
 *   application/{applicationId}/device/{devEui}/command/down
 *
 * @param {string} mqttServerId  - ID cá»§a MQTT server Ä‘Ã£ Ä‘Æ°á»£c cáº¥u hÃ¬nh (pháº£i Ä‘ang `connected`)
 * @param {object} options
 * @param {string} options.applicationId - Application ID trÃªn ChirpStack
 * @param {string} options.devEui        - Device EUI cá»§a thiáº¿t bá»‹ Ä‘Ã­ch
 * @param {number} options.fPort         - Application port (VS373 dÃ¹ng 85)
 * @param {string} options.dataBase64    - Payload dÆ°á»›i dáº¡ng Base64
 * @param {boolean} [options.confirmed]  - CÃ³ yÃªu cáº§u ACK tá»« thiáº¿t bá»‹ khÃ´ng (máº·c Ä‘á»‹nh false)
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
    } else {
      console.log(`[MQTT][Downlink] Published to '${topic}': ${payload}`);
      _emitMqttServersUpdate();
    }
  });

  return { success: true, topic };
};

/**
 * Báº­t hoáº·c táº¯t cÃ²i bÃ¡o Ä‘á»™ng (Buzzer) trÃªn thiáº¿t bá»‹ VS373.
 *
 * Lá»‡nh theo tÃ i liá»‡u VS373:
 *   - Báº­t Buzzer  : Hex ff3e01 â†’ Base64 /z4B
 *   - Táº¯t Buzzer  : Hex ff3e00 â†’ Base64 /z4A
 *
 * @param {string} mqttServerId  - ID cá»§a MQTT server
 * @param {object} options
 * @param {string} options.applicationId - Application ID trÃªn ChirpStack
 * @param {string} options.devEui        - Device EUI cá»§a thiáº¿t bá»‹ VS373
 * @param {boolean} options.enable       - true = báº­t cÃ²i, false = táº¯t cÃ²i
 * @param {number}  [options.fPort]      - Application port (máº·c Ä‘á»‹nh 85 theo spec VS373)
 * @returns {{ success: boolean, topic?: string, error?: string }}
 */
const controlBuzzer = (mqttServerId, { applicationId, devEui, enable, fPort = 85 }) => {
  // Hex ff3e01 (enable) / ff3e00 (disable) â†’ Buffer â†’ Base64
  const hexBytes = enable ? [0xff, 0x3e, 0x01] : [0xff, 0x3e, 0x00];
  const dataBase64 = Buffer.from(hexBytes).toString('base64');

  console.log(`[MQTT][Buzzer] ${enable ? 'ON' : 'OFF'} â†’ devEui=${devEui} data=${dataBase64}`);

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

// â”€â”€â”€ Internal Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _getMqttAllLogs(serverId) {
  const { allLogs } = require('../socketState');
  return allLogs.filter(log =>
    log.log_source === 'milesight-radar' &&
    log.server_unique_id === `mqtt-${serverId}`
  );
}

function _emitMqttServersUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    const list = getMqttServersList();
    clientSockets.emit('update-mqtt-servers', list);
    clientSockets.emit('update-mqtt-milesight-servers', list);
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

