// ─── SHARED SOCKET STATE ──────────────────────────────────────────────────────
 const { Server } = require('socket.io');

/**
 * Global array to store metadata for registered external connections.
 * Structure: { url, ip, port, mode, status, server_id, receivedCount, sentCount }
 */
const connections = [];

/**
 * In-memory store for SVMS server info, keyed by server id.
 * Structure: Map<string, { id, serial, server_ip, server_name, version, location,
 *   day, month, year, lastSeen,
 *   type: 'direct' | 'forwarded',
 *   connectionStatus: 'connected' | 'disconnected',
 *   lastLogReceived: ISO string }>
 */
const servers = new Map();

/**
 * In-memory store for devices per server, keyed by server_id.
 * Structure: Map<string, { server: { serial, server_id }, devices: [{
 *   name, ip, type, index,
 *   device_ip: string, device_port: number,
 *   connectionStatus: 'connected' | 'disconnected',
 *   lastLogReceived: ISO string }],
 *   sender_ip, lastSeen }>
 */
const devices = new Map();

/**
 * In-memory store for dynamic MQTT server configs.
 * Structure: [{ id, brokerHost, brokerPort, protocol, topic, defaultTopic, status, logs[] }]
 */
const mqttServers = [];

/**
 * In-memory store for manually added camera devices (independent of MQTT).
 * Structure: [{ id, name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl, snapshotDir, sdkPath, status, handle }]
 */
const cameraDevices = [];

/**
 * In-memory store for device↔camera links (MQTT device level).
 * Each entry maps a specific MQTT sensor device to a manually added camera.
 * Structure: [{ devEui: string, mqttServerId: string, cameraId: string }]
 */
const deviceCameraLinks = [];

/**
 * In-memory store for AlertWall grid layout.
 * Structure: { grids: [{ gridID, device: { server_serial, server_id, device_ip, device_name, device_type } } | null], gridCols: number }
 */
const gridLayout = { grids: [], gridCols: 3 };

/**
 * In-memory store for per-device event feature config for SVMS devices.
 * Structure: [{ serverId: string, deviceIndex: string, features: Record<string, boolean> }]
 * features key = log_type (e.g. 'crosswire', 'motion'), value = boolean enabled
 */
const svmsDeviceFeatures = [];

/**
 * Global variable to hold the Socket.IO server instance.
 */
let clientSockets = null;

/**
 * Initializes the Socket.IO server on the given HTTP server.
 * @param {object} httpServer - The Node.js HTTP server instance.
 */
const init = (httpServer) => {
  clientSockets = new Server(httpServer, {
    cors: { origin: '*' },
  });
};

/**
 * Getter for the client socket server instance.
 * @returns {object} The Socket.IO server instance.
 */
const getClientSockets = () => clientSockets;

module.exports = { init, getClientSockets, connections, servers, devices, mqttServers, cameraDevices, deviceCameraLinks, gridLayout, svmsDeviceFeatures };
