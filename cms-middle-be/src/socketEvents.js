// ─── SOCKET SERVER EVENTS (BE↔FE only) ───────────────────────────────────────
const { getClientSockets, servers, devices } = require('./socketState');
const { syncClientsToFrontend, syncConnectionsToFrontend } = require('./helpers/notify');

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
      socket.emit('receive-server-information', {
        allServers: Object.fromEntries(servers)
      });
      socket.emit('receive-devices-information', {
        allDevices: Object.fromEntries(devices)
      });
    });

    // Khởi tạo sentCount cho socket này
    socket.data = { sentCount: 0 };

    // Sync client list to all connected frontends
    syncClientsToFrontend();
    syncConnectionsToFrontend();

    socket.on('message', (data) => {
      console.log(`[MESSAGE] Received message from client ${socket.id} — broadcasting`);
      clientSockets.emit('message', data);
    });

    socket.on('update-camera-features', ({ id, features }) => {
      const { updateCameraFeatures } = require('./services/cameras.service');
      console.log(`[SOCKET] Received request to update camera features for ${id}`);
      updateCameraFeatures(id, features);
    });

    socket.on('update-device-features', ({ devEui, mqttServerId, features }) => {
      const { deviceCameraLinks } = require('./socketState');
      let link = deviceCameraLinks.find(l => l.devEui === devEui && l.mqttServerId === mqttServerId);
      if (!link) {
        link = { devEui, mqttServerId, cameraId: 'none', features: {} };
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

    socket.on('disconnect', () => {
      syncClientsToFrontend();
    });
  });
};

module.exports = setupSocketEvents;
