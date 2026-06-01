const fs = require('fs');
const path = require('path');

const FILE_NAME = 'persisted-devices.json';

function getDataDir() {
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'device_registry');
  }
  return path.join(__dirname, '..', '..', 'data');
}

function getFilePath() {
  return path.join(getDataDir(), FILE_NAME);
}

function createEmptyState() {
  return {
    version: 1,
    svmsServers: [],
    svmsDevices: [],
    mqttServers: [],
    mqttGroups: [],
    mqttDevices: [],
    cameras: [],
    i3AiServers: [],
    updatedAt: null,
  };
}

function readState() {
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) return createEmptyState();

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      ...createEmptyState(),
      ...parsed,
      svmsServers: Array.isArray(parsed.svmsServers) ? parsed.svmsServers : [],
      svmsDevices: Array.isArray(parsed.svmsDevices) ? parsed.svmsDevices : [],
      mqttServers: Array.isArray(parsed.mqttServers) ? parsed.mqttServers : [],
      mqttGroups: Array.isArray(parsed.mqttGroups) ? parsed.mqttGroups : [],
      mqttDevices: Array.isArray(parsed.mqttDevices) ? parsed.mqttDevices : [],
      cameras: Array.isArray(parsed.cameras) ? parsed.cameras : [],
      i3AiServers: Array.isArray(parsed.i3AiServers) ? parsed.i3AiServers : [],
    };
  } catch (err) {
    console.error(`[PERSISTED_DEVICES] Failed to read ${filePath}: ${err.message}`);
    return createEmptyState();
  }
}

function writeState(state) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const nextState = {
    ...createEmptyState(),
    ...state,
    updatedAt: new Date().toISOString(),
  };
  const filePath = getFilePath();
  fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2), 'utf8');
}

function upsertBy(list, predicate, entry) {
  const idx = list.findIndex(predicate);
  if (idx === -1) {
    list.push(entry);
  } else {
    list[idx] = entry;
  }
}

function getSvmsServerId(serverData, fallbackIp = '') {
  return String(serverData?.id || serverData?.server_id || serverData?.serial || fallbackIp || '').trim();
}

function persistSvmsServer(serverData, senderIp = '') {
  if (!serverData) return;

  const state = readState();
  const serverId = getSvmsServerId(serverData, senderIp);
  if (!serverId) return;

  const entry = {
    serverId,
    data: {
      ...serverData,
      sender_ip: serverData.sender_ip || senderIp || serverData.svms_ipv4_ip || serverData.server_ip || '',
      svms_ipv4_ip: serverData.svms_ipv4_ip || senderIp || serverData.server_ip || '',
    },
    recordedAt: new Date().toISOString(),
  };

  upsertBy(state.svmsServers, item => item.serverId === serverId, entry);
  writeState(state);
}

function persistSvmsDevices(devicePackage, senderIp = '') {
  if (!devicePackage) return;

  const state = readState();
  const serverId = String(
    devicePackage.server?.server_id ||
    devicePackage.server?.serial ||
    devicePackage.server_id ||
    senderIp ||
    ''
  ).trim();
  if (!serverId) return;

  const entry = {
    serverId,
    data: {
      ...devicePackage,
      sender_ip: devicePackage.sender_ip || senderIp || '',
    },
    recordedAt: new Date().toISOString(),
  };

  upsertBy(state.svmsDevices, item => item.serverId === serverId, entry);
  writeState(state);
}

function persistMqttServer(serverConfig) {
  if (!serverConfig?.id) return;

  const state = readState();
  const entry = {
    id: serverConfig.id,
    name: serverConfig.name || '',
    brokerHost: serverConfig.brokerHost,
    brokerPort: String(serverConfig.brokerPort),
    protocol: serverConfig.protocol || 'mqtt',
    topic: serverConfig.topic || '',
    defaultTopic: serverConfig.defaultTopic || '',
    cameraId: serverConfig.cameraId || null,
    recordedAt: new Date().toISOString(),
  };

  upsertBy(state.mqttServers, item => item.id === entry.id, entry);
  writeState(state);
}

function removeMqttServer(id) {
  const state = readState();
  state.mqttServers = state.mqttServers.filter(item => item.id !== id);
  writeState(state);
}

function persistMqttGroup(group) {
  if (!group?.id) return;
  const state = readState();
  const entry = {
    id: group.id,
    name: group.name || '',
    cameraId: group.cameraId || null,
    createdAt: group.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertBy(state.mqttGroups, item => item.id === entry.id, entry);
  writeState(state);
}

function removeMqttGroup(id) {
  const state = readState();
  state.mqttGroups = state.mqttGroups.filter(item => item.id !== id);
  state.mqttDevices = state.mqttDevices.filter(item => item.groupId !== id);
  writeState(state);
}

function persistMqttDevice(deviceConfig) {
  if (!deviceConfig?.id) return;

  const state = readState();
  const entry = {
    id: deviceConfig.id,
    groupId: deviceConfig.groupId,
    topic: deviceConfig.topic || '',
    deviceInfo: deviceConfig.deviceInfo || {},
    brokerHost: deviceConfig.brokerHost || '',
    brokerPort: String(deviceConfig.brokerPort || ''),
    protocol: deviceConfig.protocol || 'mqtt',
    cameraId: deviceConfig.cameraId || null,
    features: deviceConfig.features || {},
    deviceNickname: deviceConfig.deviceNickname || deviceConfig.deviceInfo?.deviceNickname || undefined,
    recordedAt: new Date().toISOString(),
  };

  if (entry.deviceNickname && entry.deviceInfo) {
    entry.deviceInfo.deviceNickname = entry.deviceNickname;
  }

  upsertBy(state.mqttDevices, item => item.id === entry.id, entry);
  writeState(state);
}

function removeMqttDevice(id) {
  const state = readState();
  state.mqttDevices = state.mqttDevices.filter(item => item.id !== id);
  writeState(state);
}

function persistCamera(cameraConfig) {
  if (!cameraConfig?.id) return;

  const state = readState();
  const entry = {
    id: cameraConfig.id,
    name: cameraConfig.name || '',
    type: cameraConfig.type || 'sunell',
    cameraIp: cameraConfig.cameraIp || '',
    cameraPort: cameraConfig.cameraPort || 30001,
    cameraUser: cameraConfig.cameraUser || 'admin',
    cameraPass: cameraConfig.cameraPass || 'admin1234',
    rtspUrl: cameraConfig.rtspUrl || null,
    snapshotUrl: cameraConfig.snapshotUrl || null,
    features: cameraConfig.features || {},
    recordedAt: new Date().toISOString(),
  };

  upsertBy(state.cameras, item => item.id === entry.id, entry);
  writeState(state);
}

function removeCamera(id) {
  const state = readState();
  state.cameras = state.cameras.filter(item => item.id !== id);
  writeState(state);
}

function persistI3AiServer(serverData) {
  if (!serverData?.id) return;

  const state = readState();
  const entry = {
    serverId: serverData.id,
    data: {
      id: serverData.id,
      server_id: serverData.server_id,
      serial: serverData.serial,
      server_name: serverData.server_name,
      custom_server_name: serverData.custom_server_name || '',
      server_ip: serverData.server_ip,
      sender_ip: serverData.sender_ip,
      type: 'i3ai',
      lastSeen: serverData.lastSeen,
      lastLogReceived: serverData.lastLogReceived,
    },
    recordedAt: new Date().toISOString(),
  };

  upsertBy(state.i3AiServers, item => item.serverId === entry.serverId, entry);
  writeState(state);
}

function removeI3AiServer(serverId) {
  const state = readState();
  state.i3AiServers = state.i3AiServers.filter(item => item.serverId !== serverId);
  writeState(state);
}

async function bootstrapPersistedDevices() {
  const state = readState();
  const {
    servers,
    devices,
    svmsServers,
    svmsDevices,
    mqttServers,
    mqttGroups,
    cameraDevices,
    getClientSockets,
  } = require('../socketState');
  const { connectMqttDevice, parseDeviceInfoFromTopic } = require('./mqtt.service');
  const { addCameraDevice, removeCameraDevice } = require('./cameras.service');
  const i3AiService = require('./i3ai.service');
  let restoredSvms = 0;
  let restoredMqtt = 0;
  let restoredCameras = 0;
  let restoredI3Ai = 0;

  restoredI3Ai = i3AiService.restoreI3AiServers(state.i3AiServers);

  for (const item of state.svmsServers) {
    const serverData = item.data || {};
    const serverId = item.serverId || getSvmsServerId(serverData);
    if (!serverId) continue;

    const entry = {
      ...serverData,
      lastSeen: new Date().toISOString(),
      connectionStatus: 'disconnected',
      type: serverData.type || 'direct',
    };
    servers.set(serverId, entry);
    upsertBy(svmsServers, s => String(s.id || s.server_id || s.serial) === String(serverId), {
      ...serverData,
      _receivedAt: new Date().toISOString(),
    });
    restoredSvms += 1;
  }

  for (const item of state.svmsDevices) {
    const devicePackage = item.data || {};
    const serverId = item.serverId || devicePackage.server?.server_id || devicePackage.server?.serial;
    if (!serverId || !servers.has(serverId)) continue;

    const parsedDevices = (devicePackage.devices || []).map((device) => {
      const [deviceIp, devicePortStr] = (device.ip || '').split(':');
      return {
        ...device,
        device_ip: device.device_ip || deviceIp || '',
        device_port: device.device_port || (devicePortStr ? parseInt(devicePortStr, 10) : null),
        connectionStatus: 'disconnected',
        lastLogReceived: device.lastLogReceived || new Date().toISOString(),
      };
    });

    devices.set(serverId, {
      server: devicePackage.server,
      devices: parsedDevices,
      sender_ip: devicePackage.sender_ip || '',
      lastSeen: new Date().toISOString(),
    });
    upsertBy(svmsDevices, d => String(d.server?.server_id || d.server?.serial) === String(serverId), {
      ...devicePackage,
      _receivedAt: new Date().toISOString(),
    });
  }

  const defaultGroupId = state.mqttGroups[0]?.id || 'default';
  if (state.mqttServers.length > 0 && state.mqttGroups.length === 0) {
    const group = {
      id: defaultGroupId,
      name: 'Default Group',
      cameraId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mqttGroups.push(group);
    persistMqttGroup(group);
  }

  for (const group of state.mqttGroups) {
    if (!group.id || mqttGroups.some(item => item.id === group.id)) continue;
    mqttGroups.push({
      id: group.id,
      name: group.name || 'MQTT Group',
      cameraId: group.cameraId || null,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    });
  }

  const persistedDevices = [
    ...state.mqttDevices,
    ...state.mqttServers.map(server => ({
      id: server.id,
      groupId: defaultGroupId,
      brokerHost: server.brokerHost,
      brokerPort: server.brokerPort,
      protocol: server.protocol,
      topic: server.topic,
      deviceInfo: parseDeviceInfoFromTopic(server.topic),
      cameraId: server.cameraId,
    })),
  ];

  for (const persisted of persistedDevices) {
    if (!persisted.id || mqttServers.some(server => server.id === persisted.id)) continue;

    const serverConfig = {
      id: persisted.id,
      groupId: persisted.groupId || defaultGroupId,
      brokerHost: persisted.brokerHost,
      brokerPort: String(persisted.brokerPort),
      protocol: persisted.protocol || 'mqtt',
      topic: persisted.topic || '',
      deviceInfo: persisted.deviceInfo || parseDeviceInfoFromTopic(persisted.topic),
      cameraId: persisted.cameraId || null,
      features: persisted.features || {},
      deviceNickname: persisted.deviceNickname || persisted.deviceInfo?.deviceNickname || undefined,
      status: 'connecting',
    };
    if (serverConfig.deviceNickname && serverConfig.deviceInfo) {
      serverConfig.deviceInfo.deviceNickname = serverConfig.deviceNickname;
    }
    if (!serverConfig.brokerHost || !serverConfig.brokerPort) continue;

    mqttServers.push(serverConfig);
    connectMqttDevice(serverConfig, { persistOnConnect: false });
    restoredMqtt += 1;
  }

  for (const persisted of state.cameras) {
    if (!persisted.id || cameraDevices.some(camera => camera.id === persisted.id)) continue;

    try {
      const result = await addCameraDevice(persisted, { persist: false, id: persisted.id });
      if (result?.device?.status === 'connected') {
        restoredCameras += 1;
      } else {
        await removeCameraDevice(persisted.id, { persist: false });
        console.warn(`[PERSISTED_DEVICES] Skip camera '${persisted.id}' because it did not connect`);
      }
    } catch (err) {
      console.warn(`[PERSISTED_DEVICES] Skip camera '${persisted.id}': ${err.message}`);
    }
  }

  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('receive-server-information', { allServers: Object.fromEntries(servers) });
    clientSockets.emit('receive-devices-information', { allDevices: Object.fromEntries(devices) });
  }

  console.log(`[PERSISTED_DEVICES] Bootstrap complete: SVMS=${restoredSvms}, MQTT=${restoredMqtt}, cameras=${restoredCameras}, i3AI=${restoredI3Ai}`);
}

module.exports = {
  getFilePath,
  readState,
  persistSvmsServer,
  persistSvmsDevices,
  persistMqttServer,
  removeMqttServer,
  persistMqttGroup,
  removeMqttGroup,
  persistMqttDevice,
  removeMqttDevice,
  persistCamera,
  removeCamera,
  persistI3AiServer,
  removeI3AiServer,
  bootstrapPersistedDevices,
};
