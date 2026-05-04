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

    socket.on('disconnect', () => {
      syncClientsToFrontend();
    });
  });
};

module.exports = setupSocketEvents;
