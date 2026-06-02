const mqtt = require('mqtt');
const { mqttGroups, mqttServers, servers, deviceCameraLinks, getClientSockets, mqttDeviceList } = require('../socketState');
const { getSnapshotForCamera } = require('./cameras.service');
const { normalizeFeature } = require('../helpers/featureNormalizer');
const milesightEventRegistry = require('./milesightEventRegistry.service');
const { appendLog } = require('./system-state.service');
const persistedDevices = require('./persisted-devices.service');
const milesightHeartbeat = require('./milesight-heartbeat.service');
const signalQualityService = require('./signalQualityMilesight.service');

const mqttClients = new Map();

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseDeviceInfoFromTopic(topic = '') {
  const match = String(topic).match(/application\/([^/]+)\/device\/([^/]+)\/event\/up/i);
  return {
    tenantId: '',
    tenantName: '',
    applicationId: match?.[1] || '',
    applicationName: '',
    deviceProfileId: '',
    deviceProfileName: '',
    deviceName: match?.[2] ? `Milesight ${match[2]}` : 'Milesight Device',
    devEui: match?.[2] || '',
    deviceClassEnabled: '',
    tags: {},
  };
}

function normalizeDeviceInfo(deviceInfo = {}, fallbackTopic = '') {
  return {
    ...parseDeviceInfoFromTopic(fallbackTopic),
    ...deviceInfo,
    tags: deviceInfo.tags || {},
  };
}

function ensureDeviceEntry(deviceConfig) {
  const id = deviceConfig.id || makeId();
  const entry = {
    id,
    groupId: deviceConfig.groupId,
    topic: String(deviceConfig.topic || '').trim(),
    deviceInfo: normalizeDeviceInfo(deviceConfig.deviceInfo, deviceConfig.topic),
    brokerHost: String(deviceConfig.brokerHost || '').trim(),
    brokerPort: String(deviceConfig.brokerPort || '').trim(),
    protocol: deviceConfig.protocol || 'mqtt',
    status: deviceConfig.status || 'connecting',
    cameraId: deviceConfig.cameraId || null,
    features: deviceConfig.features || {},
    lastSeen: deviceConfig.lastSeen || new Date().toISOString(),
    deviceNickname: deviceConfig.deviceNickname || deviceConfig.name || undefined,
  };

  if (entry.deviceNickname && entry.deviceInfo) {
    entry.deviceInfo.deviceNickname = entry.deviceNickname;
  }

  const idx = mqttDeviceList.findIndex(d => d.id === id);
  if (idx === -1) mqttDeviceList.push(entry);
  else mqttDeviceList[idx] = { ...mqttDeviceList[idx], ...entry };
  return entry;
}

function getMqttGroupsList() {
  return mqttGroups.map(group => ({
    ...group,
    cameraId: group.cameraId || null,
    devices: getMqttDevicesList().filter(device => device.groupId === group.id),
  }));
}

function getMqttDevicesList() {
  return mqttDeviceList.map(device => ({
    ...device,
    logCount: _getMqttAllLogs(device.id).length,
  }));
}

function connectMqttDevice(deviceConfig, options = {}) {
  const { persistOnConnect = true } = options;
  const entry = ensureDeviceEntry(deviceConfig);
  const { id, groupId, brokerHost, brokerPort, protocol, topic } = entry;
  const brokerUrl = `${protocol || 'mqtt'}://${brokerHost}:${brokerPort}`;

  console.log(`[MQTT] Connecting device '${id}' at ${brokerUrl}, topic=${topic}`);

  if (!brokerHost || !brokerPort || !topic) {
    entry.status = 'error';
    _emitMqttStateUpdate();
    return entry;
  }

  entry.status = 'connecting';
  _registerGroupServer(groupId, 'connecting');
  _emitMqttStateUpdate();

  try {
    const client = mqtt.connect(brokerUrl);
    mqttClients.set(id, client);

    client.on('connect', () => {
      console.log(`[MQTT] Device '${id}' connected`);
      entry.status = 'connected';
      entry.lastSeen = new Date().toISOString();
      _registerGroupServer(groupId, 'connected');
      if (persistOnConnect) persistedDevices.persistMqttDevice(entry);
      _emitMqttStateUpdate();

      client.subscribe(topic, (err) => {
        if (err) console.error(`[MQTT] Device '${id}' subscription error for ${topic}:`, err);
        else console.log(`[MQTT] Device '${id}' subscribed: ${topic}`);
      });
    });

    client.on('message', async (msgTopic, message) => {
      console.log(`[MQTT] Message on topic '${msgTopic}'`);
      try {
        const parsedBody = JSON.parse(message.toString());
        const payload = parsedBody.payload || parsedBody;
        const deviceInfo = normalizeDeviceInfo(payload?.deviceInfo || parsedBody?.deviceInfo || entry.deviceInfo, msgTopic);
        entry.deviceInfo = { ...entry.deviceInfo, ...deviceInfo };
        entry.topic = msgTopic || entry.topic;
        entry.lastSeen = new Date().toISOString();
        // Mark device as online in heartbeat monitor on every received message
        milesightHeartbeat.markDeviceOnline(id);

        let rssi = null;
        let sf = null;
        if (parsedBody.rxInfo && parsedBody.rxInfo.length > 0) {
          rssi = parsedBody.rxInfo[0].rssi;
        }
        if (parsedBody.txInfo && parsedBody.txInfo.modulation && parsedBody.txInfo.modulation.lora) {
          sf = parsedBody.txInfo.modulation.lora.spreadingFactor;
        }
        signalQualityService.processIncomingLog(entry.deviceInfo?.devEui || deviceInfo.devEui, rssi, sf, entry);

        upsertMqttDevice(entry);

        const milesightEvents = payload?.object?.events;
        const buttonEvent = payload?.object?.button_event;

        if ((!Array.isArray(milesightEvents) || milesightEvents.length === 0) && (!buttonEvent)) {
          _emitMqttStateUpdate();
          return;
        }
        if (buttonEvent && buttonEvent.status) {
          await _appendEventLogs(entry, parsedBody, payload, [buttonEvent], 'milesight-button');
        }
        if (Array.isArray(milesightEvents) && milesightEvents.length > 0) {
          await _appendEventLogs(entry, parsedBody, payload, milesightEvents, 'milesight-radar');
        }
      } catch (err) {
        console.log(`[MQTT][${id}] Skipped non-JSON payload: ${err.message}`);
      }
    });

    client.on('error', (err) => {
      console.error(`[MQTT] Device '${id}' connection error:`, err);
      entry.status = 'error';
      _registerGroupServer(groupId, 'disconnected');
      _emitMqttStateUpdate();
    });

    client.on('close', () => {
      entry.status = 'disconnected';
      _registerGroupServer(groupId, 'disconnected');
      _emitMqttStateUpdate();
    });

    client.on('reconnect', () => {
      entry.status = 'connecting';
      _registerGroupServer(groupId, 'connecting');
      _emitMqttStateUpdate();
    });
  } catch (err) {
    entry.status = 'error';
    console.error(`[MQTT] Device '${id}' initialization error:`, err);
    _emitMqttStateUpdate();
  }

  return entry;
}

function disconnectMqttDevice(id) {
  const client = mqttClients.get(id);
  if (client) {
    client.end(true);
    mqttClients.delete(id);
  }
  const entry = mqttDeviceList.find(d => d.id === id);
  if (entry) {
    entry.status = 'disconnected';
    _registerGroupServer(entry.groupId, 'disconnected');
  }
  _emitMqttStateUpdate();
}

function removeMqttDevice(id) {
  disconnectMqttDevice(id);
  const idx = mqttDeviceList.findIndex(d => d.id === id);
  if (idx !== -1) mqttDeviceList.splice(idx, 1);
  for (let i = deviceCameraLinks.length - 1; i >= 0; i -= 1) {
    if (deviceCameraLinks[i].mqttDeviceId === id) deviceCameraLinks.splice(i, 1);
  }
  milesightHeartbeat.removeDevice(id);
  persistedDevices.removeMqttDevice(id);
  _emitMqttStateUpdate();
}

function upsertMqttDevice(deviceConfig) {
  const entry = ensureDeviceEntry(deviceConfig);
  _emitMqttStateUpdate();
  return entry;
}

async function _appendEventLogs(entry, parsedBody, payload, events, log_source = 'milesight-radar') {
  const devEui = entry.deviceInfo?.devEui || '';
  const deviceLink = deviceCameraLinks.find(l => l.mqttDeviceId === entry.id)
    || deviceCameraLinks.find(l => l.devEui === devEui && (l.groupId === entry.groupId || l.mqttServerId === entry.id));
  const group = mqttGroups.find(g => g.id === entry.groupId);
  const resolvedCameraId = deviceLink?.cameraId || group?.cameraId || entry.cameraId || null;
  const snapshotCache = new Map();

  const getSnapshotCached = async (cameraId) => {
    if (!cameraId || cameraId === 'none') return null;
    if (snapshotCache.has(cameraId)) return snapshotCache.get(cameraId);
    const snapshot = await getSnapshotForCamera(cameraId);
    snapshotCache.set(cameraId, snapshot);
    return snapshot;
  };

  for (const event of events) {
    const status = String(event.alarm_status || '').toLowerCase();
    if (status.includes('deactivated') || status.includes('ignored')) continue;

    const alarmType = log_source === 'milesight-button'
      ? 'button_pressed'
      : String(event.alarm_type || event.alarmType || '').toLowerCase();
    const eventForLog = log_source === 'milesight-button'
      ? { ...event, alarmType: 'button_pressed', alarm_type: event.alarm_type || 'button_pressed' }
      : event;
    const isNewEvent = milesightEventRegistry.discoverEvent(alarmType);
    if (isNewEvent) {
      const clientSockets = getClientSockets();
      if (clientSockets) clientSockets.emit('update-milesight-known-events', milesightEventRegistry.getEvents());
    }

    const linkFeatures = deviceLink?.features || entry.features || {};
    const knownTypesSet = milesightEventRegistry.getKnownTypesSet();
    const isKnownEvent = knownTypesSet.has(alarmType);
    let feat = { enabled: true, cameraId: linkFeatures[alarmType]?.cameraId || null };

    if (isKnownEvent && alarmType !== 'event_other') {
      const defaultEnabled = milesightEventRegistry.getDefaultEnabled(alarmType);
      feat = normalizeFeature(linkFeatures[alarmType], alarmType);
      if (linkFeatures[alarmType] === undefined) feat.enabled = defaultEnabled;
    } else {
      // Unknown event → check event_other setting from device link or registry default
      const eventOtherDefault = milesightEventRegistry.getDefaultEnabled('event_other');
      const otherFeat = normalizeFeature(linkFeatures.__other_events__, '__other_events__');
      if (linkFeatures.__other_events__ === undefined) otherFeat.enabled = eventOtherDefault;
      if (!otherFeat.enabled) continue;
      feat = { enabled: true, cameraId: otherFeat.cameraId };
    }

    if (!feat.enabled) continue;

    const eventCameraId = feat.cameraId || resolvedCameraId;
    let snapshot = await getSnapshotCached(eventCameraId);
    if (!snapshot && feat.cameraId && resolvedCameraId && feat.cameraId !== resolvedCameraId) {
      snapshot = await getSnapshotCached(resolvedCameraId);
    }

    const isolatedPayload = {
      ...parsedBody,
      topic: entry.topic,
      payload: {
        ...payload,
        deviceInfo: entry.deviceInfo,
        object: {
          ...payload.object,
          events: [eventForLog],
        },
      },
    };

    let log_type;
    let log_description;
    switch (log_source) {
      case 'milesight-radar':
        log_type = 'milesight_radar';
        log_description = event.alarm_type || event.alarm_status || 'log_description'
        break;
      case 'milesight-button':
        log_type = 'milesight_button';
        log_description = event.alarm_type || event.status || 'log_description'
        break;
      default:
        log_type = event.alarm_type || 'mqtt_event';
        log_description = event.alarm_type || event.alarm_status || 'log_description'
        break;
    }

    appendLog({
      id: makeId() + makeId(),
      receive_time: payload.time ? new Date(payload.time).getTime() : Date.now(),
      log_type,
      log_description,
      snapshot: snapshot || null,
      log_source,
      device_info: {
        name: entry.deviceInfo?.deviceName || 'Milesight Device',
        id: devEui || entry.id,
      },
      server_unique_id: entry.groupId,
      mqtt_device_id: entry.id,
      raw: isolatedPayload,
    });
  }
}

function _registerGroupServer(groupId, status) {
  if (!groupId) return;
  const group = mqttGroups.find(g => g.id === groupId);
  servers.set(groupId, {
    id: groupId,
    serial: '',
    server_ip: '',
    server_name: group?.name || `MQTT Group ${groupId}`,
    version: '',
    location: '',
    day: 0,
    month: 0,
    year: 0,
    svms_ipv4_ip: '',
    type: 'mqtt',
    connectionStatus: status,
    lastSeen: new Date().toISOString(),
  });
}

function getMqttServersList() {
  return getMqttDevicesList().map(device => ({
    id: device.id,
    groupId: device.groupId,
    name: device.deviceInfo?.deviceName || '',
    deviceNickname: device.deviceNickname || device.deviceInfo?.deviceNickname || undefined,
    brokerHost: device.brokerHost,
    brokerPort: device.brokerPort,
    protocol: device.protocol,
    topic: device.topic,
    defaultTopic: device.topic,
    cameraId: device.cameraId || null,
    status: device.status || 'disconnected',
    logCount: device.logCount || 0,
    deviceInfo: device.deviceInfo,
  }));
}

function getMqttServerLogs(id) {
  return _getMqttAllLogs(id);
}

function publishDownlink(mqttDeviceId, { applicationId, devEui, fPort, dataBase64, confirmed = false }) {
  const client = mqttClients.get(mqttDeviceId);
  if (!client) return { success: false, error: `[MQTT][Downlink] No active client for device '${mqttDeviceId}'` };

  const entry = mqttDeviceList.find(d => d.id === mqttDeviceId);
  if (!entry || entry.status !== 'connected') {
    return { success: false, error: `[MQTT][Downlink] Device '${mqttDeviceId}' is not connected` };
  }

  const topic = `application/${applicationId}/device/${devEui}/command/down`;
  client.publish(topic, JSON.stringify({ devEui, confirmed, fPort, data: dataBase64 }), { qos: 0 });
  return { success: true, topic };
}

function controlBuzzer(mqttDeviceId, { applicationId, devEui, enable, fPort = 85 }) {
  const dataBase64 = Buffer.from(enable ? [0xff, 0x3e, 0x01] : [0xff, 0x3e, 0x00]).toString('base64');
  return publishDownlink(mqttDeviceId, { applicationId, devEui, fPort, dataBase64, confirmed: false });
}

function _getMqttAllLogs(deviceOrGroupId) {
  const { allLogs } = require('../socketState');
  return allLogs.filter(log =>
    (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button') &&
    (log.mqtt_device_id === deviceOrGroupId || log.server_unique_id === deviceOrGroupId)
  );
}

function _emitMqttStateUpdate() {
  const clientSockets = getClientSockets();
  if (!clientSockets) return;
  const groups = getMqttGroupsList();
  const devices = getMqttDevicesList();
  clientSockets.emit('update-mqtt-groups', groups);
  clientSockets.emit('update-mqtt-devices', devices);
  clientSockets.emit('update-mqtt-servers', getMqttServersList());
  clientSockets.emit('update-mqtt-milesight-servers', getMqttServersList());
  clientSockets.emit('update-mqtt-milesight-devices', devices);
  clientSockets.emit('receive-server-information', { allServers: Object.fromEntries(servers) });
}

module.exports = {
  connectMqttDevice,
  disconnectMqttDevice,
  removeMqttDevice,
  upsertMqttDevice,
  getMqttGroupsList,
  getMqttDevicesList,
  getMqttServersList,
  getMqttServerLogs,
  publishDownlink,
  controlBuzzer,
  parseDeviceInfoFromTopic,
};
