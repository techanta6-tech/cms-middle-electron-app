// ─── SOCKET SERVER EVENTS (BE↔FE only) ─────────────────────────────────────────────
const { getClientSockets, servers, devices, svmsDeviceFeatures } = require('./socketState');
const { syncClientsToFrontend, syncConnectionsToFrontend } = require('./helpers/notify');
const { emitSystemSnapshot } = require('./services/system-state.service');
const svmsEventRegistry = require('./services/svmsEventRegistry.service');
const milesightEventRegistry = require('./services/milesightEventRegistry.service');
const sunellEventRegistry = require('./services/sunellEventRegistry.service');
const trafficService = require('./services/traffic.service');

/**
 * Sets up Socket.IO event listeners for the client server.
 * Handles 'connection', 'message', and 'disconnect' events.
 */
const setupSocketEvents = () => {
  const clientSockets = getClientSockets();

  clientSockets.on('connection', (socket) => {
    console.log('connect to fe success');

    socket.on('request-sync', () => {
      console.log(`[REQUEST-SYNC] Socket ${socket.id} requested data sync upon login.`);
      emitSystemSnapshot(socket);
      socket.emit('receive-server-information', { allServers: Object.fromEntries(servers) });
      socket.emit('receive-devices-information', { allDevices: Object.fromEntries(devices) });
      socket.emit('update-svms-device-features', svmsDeviceFeatures);
      socket.emit('update-svms-known-events', svmsEventRegistry.getEvents());
      socket.emit('update-milesight-known-events', milesightEventRegistry.getEvents());
      socket.emit('update-sunell-known-events', sunellEventRegistry.getEvents());
      // ─── Traffic records sync ───
      socket.emit('traffic-sync', trafficService.getTrafficRecordsForSync());
    });

    // Khởi tạo sentCount cho socket này
    socket.data = { sentCount: 0 };

    // Sync client list to all connected frontends
    syncClientsToFrontend();
    syncConnectionsToFrontend();

    // ─── Sync New System Data với FE client vừa connect ──────────────────────────────────
    emitSystemSnapshot(socket);

    socket.on('message', (data) => {
      console.log(`[MESSAGE] Received message from client ${socket.id} — broadcasting`);
      clientSockets.emit('message', data);
    });

    socket.on('update-camera-features', ({ id, features }) => {
      const { updateCameraFeatures } = require('./services/cameras.service');
      console.log(`[SOCKET] Received request to update camera features for ${id}`);
      updateCameraFeatures(id, features);
    });

    socket.on('update-device-features', ({ mqttDeviceId, groupId, devEui, mqttServerId, features }) => {
      const { deviceCameraLinks } = require('./socketState');
      let link = deviceCameraLinks.find(l => mqttDeviceId ? l.mqttDeviceId === mqttDeviceId : (l.devEui === devEui && l.mqttServerId === mqttServerId));
      if (!link) {
        link = { mqttDeviceId, groupId, devEui, mqttServerId, cameraId: null, features: {} };
        deviceCameraLinks.push(link);
      }
      if (!link.features) {
        link.features = {};
      }

      // Per-key merge: hỗ trợ cả boolean cũ và object { enabled, cameraId } mới
      for (const [code, value] of Object.entries(features)) {
        const existing = link.features[code];
        // Migrate format cũ boolean → object
        if (typeof existing === 'boolean') {
          link.features[code] = { enabled: existing, cameraId: null };
        }

        if (typeof value === 'boolean') {
          // FE gửi boolean (toggle enabled) → chỉ cập nhật enabled, giữ cameraId
          link.features[code] = {
            ...(link.features[code] || { enabled: true, cameraId: null }),
            enabled: value,
          };
        } else if (typeof value === 'object' && value !== null) {
          // FE gửi object → merge (enabled, cameraId)
          link.features[code] = {
            ...(link.features[code] || { enabled: true, cameraId: null }),
            ...value,
          };
        }
      }

      console.log(`[SOCKET] Updated features for device ${devEui}:`, link.features);
      clientSockets.emit('update-device-camera-links', [...deviceCameraLinks]);
    });

    socket.on('update-svms-device-features', ({ serverId, deviceIndex, features }) => {
      if (!serverId || deviceIndex == null) return;
      const key = `${serverId}::${deviceIndex}`;
      let entry = svmsDeviceFeatures.find(e => e.serverId === serverId && String(e.deviceIndex) === String(deviceIndex));
      if (!entry) {
        entry = { serverId, deviceIndex: String(deviceIndex), features: {} };
        svmsDeviceFeatures.push(entry);
      }
      if (!entry.features) entry.features = {};
      // Merge: value là boolean
      for (const [code, value] of Object.entries(features)) {
        entry.features[code] = !!value;
      }
      console.log(`[SOCKET] Updated SVMS device features for ${key}:`, entry.features);
      clientSockets.emit('update-svms-device-features', [...svmsDeviceFeatures]);
    });

    socket.on('disconnect', () => {
      syncClientsToFrontend();
    });
  });
};

module.exports = setupSocketEvents;
