const LOG_EMIT_INTERVAL_MS = 250;

let pendingLogs = [];
let flushTimer = null;

const eventGroupService = require('./eventGroup.service');

function appendLog(logEntry) {
  if (!logEntry) return;

  eventGroupService.normalizeLog(logEntry);

  const { allLogs, ALL_LOGS_MAX } = require('../socketState');
  allLogs.push(logEntry);
  while (allLogs.length > ALL_LOGS_MAX) allLogs.shift();

  pendingLogs.push(logEntry);
  scheduleLogFlush();
}

function scheduleLogFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushPendingLogs, LOG_EMIT_INTERVAL_MS);
}

function flushPendingLogs() {
  flushTimer = null;
  if (pendingLogs.length === 0) return;

  const batch = pendingLogs.splice(0);
  const { getClientSockets } = require('../socketState');
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('logs-batch', batch);
  }
}

function getSystemSnapshot() {
  const {
    allLogs,
    connections,
    servers,
    devices,
    svmsServers,
    svmsDevices,
    mqttServers,
    mqttGroups,
    mqttDeviceList,
    cameraDevices,
    prefilter,
    svmsDeviceFeatures,
    deviceCameraLinks,
    gridLayout,
    eMapLayout,
    areaLayout,
  } = require('../socketState');
  const svmsEventRegistry = require('./svmsEventRegistry.service');
  const milesightEventRegistry = require('./milesightEventRegistry.service');
  const sunellEventRegistry = require('./sunellEventRegistry.service');

  const svmsServersWithDevices = svmsServers.map((server) => {
    const serverId = server.id || server.server_id;
    const deviceEntry = svmsDevices.find((entry) => {
      const entryServerId = entry.server?.server_id || entry.server_id;
      const entrySerial = entry.server?.serial || entry.serial;
      return String(entryServerId) === String(serverId) || String(entrySerial) === String(server.serial);
    });

    return {
      ...server,
      devices: deviceEntry?.devices || [],
    };
  });

  const mqttGroupsWithDevices = mqttGroups.map((group) => ({
    ...group,
    cameraId: group.cameraId || null,
    devices: mqttDeviceList
      .filter((device) => device.groupId === group.id)
      .map((device) => ({
        ...device,
        type: device.type || 'milesight',
        logCount: allLogs.filter(log =>
          (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button') &&
          log.mqtt_device_id === device.id
        ).length,
      })),
  }));

  const mqttServersWithDevices = mqttServers.map((server) => {
    const devices = mqttDeviceList
      .filter((device) => device.id === server.id || device.groupId === server.id)
      .map((device) => ({
        ...device,
        type: device.type || 'milesight',
      }));

    return {
      id: server.id,
      groupId: server.groupId,
      name: server.name || server.deviceInfo?.deviceName || '',
      brokerHost: server.brokerHost,
      brokerPort: server.brokerPort,
      protocol: server.protocol,
      topic: server.topic,
      defaultTopic: server.defaultTopic || server.topic,
      deviceInfo: server.deviceInfo,
      cameraId: server.cameraId || null,
      status: server.status || 'disconnected',
      logCount: allLogs.filter(log =>
        (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button') &&
        log.server_unique_id === `mqtt-${server.id}`
      ).length,
      devices,
    };
  });

  const cameras = cameraDevices.map((camera) => ({
    id: camera.id,
    name: camera.name,
    type: camera.type === 'sunell' ? 'sunell' : 'other',
    cameraIp: camera.cameraIp,
    cameraPort: camera.cameraPort,
    cameraUser: camera.cameraUser,
    rtspUrl: camera.rtspUrl || null,
    snapshotUrl: camera.snapshotUrl || null,
    status: camera.status,
    handle: camera.handle || null,
    capabilities: {
      sdk: camera.type === 'sunell',
      rtsp: true,
    },
    features: camera.features || {},
  }));

  return {
    connections: [...connections],
    sendServers: [],
    receiveServers: [...connections],
    servers: Object.fromEntries(servers),
    devices: Object.fromEntries(devices),
    svmsServers: svmsServersWithDevices,
    svmsDevices: [...svmsDevices],
    mqttGroups: mqttGroupsWithDevices,
    mqttServers: mqttServersWithDevices,
    mqttDeviceList: [...mqttDeviceList],
    cameras,
    allLogs: [...allLogs],
    prefilter: [...prefilter],
    gridLayout: {
      grids: [...(gridLayout.grids || [])],
      gridCols: gridLayout.gridCols || 3,
    },
    eMapLayout: {
      pins: [...(eMapLayout.pins || [])],
      tileProviderId: eMapLayout.tileProviderId || 'openstreetmap',
    },
    areaLayout: {
      nodes: [...(areaLayout.nodes || [])],
      updatedAt: areaLayout.updatedAt || null,
    },
    knownEvents: {
      svms: svmsEventRegistry.getEvents(),
      milesight: milesightEventRegistry.getEvents(),
      sunell: sunellEventRegistry.getEvents(),
    },
    compatibility: {
      svmsDeviceFeatures: [...svmsDeviceFeatures],
      deviceCameraLinks: [...deviceCameraLinks],
    },
    trafficRecords: require('./traffic.service').getTrafficRecordsForSync(),
  };
}

function emitSystemSnapshot(socket) {
  socket.emit('system-snapshot', getSystemSnapshot());
}

module.exports = {
  LOG_EMIT_INTERVAL_MS,
  appendLog,
  flushPendingLogs,
  getSystemSnapshot,
  emitSystemSnapshot,
};
