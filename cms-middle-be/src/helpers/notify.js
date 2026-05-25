// ─── NOTIFICATION & CLIENT HELPERS ────────────────────────────────────────────
const axios = require('axios');
const { getClientSockets, connections } = require('../socketState');
const { port } = require('../config');

/**
 * Emit connection status of an external server to all FE clients.
 * @param {string} url - The URL of the external server.
 * @param {string} mode - The connection mode ('send', etc.).
 * @param {string} status - The status ('connected', 'error', 'disconnected').
 * @param {any} data - Optional data to include in the payload.
 */
const notifyStatusToClients = (url = null, mode = 'receive', status, data = null) => {
  const clientSockets = getClientSockets();
  const payload = { url, type: mode, status };

  let eventName = status;
  if (status === 'connecting') eventName = 'external-server-connecting';
  if (status === 'connected') eventName = 'external-server-connect';
  if (status === 'error') eventName = 'external-server-err-connect';
  if (status === 'disconnected') eventName = 'external-server-disconnect';
  if (status === 'receive-log') eventName = 'receive-log';
  if (status === 'log-sent') eventName = 'log-sent';

  clientSockets.emit(eventName, { ...payload, data });
};

/**
 * Get detailed information about all currently connected socket clients.
 * @returns {Promise<Array>} List of client objects { socketId, ip, port, status, mode, sentCount }.
 */
const getActiveClients = async () => {
  const clientSockets = getClientSockets();
  const sockets = await clientSockets.fetchSockets();
  return sockets.map(s => {
    let clientPort = port;
    if (s.handshake?.headers?.host) {
      clientPort = s.handshake.headers.host.split(':')[1] || port;
    }
    return {
      socketId: s.id,
      ip: (s.handshake.address || '').replace('::ffff:', ''),
      port: clientPort,
      status: 'connected',
      mode: 'receive',
      sentCount: s.data.sentCount || 0
    };
  });
};

/**
 * Sync the current active client list to all connected frontends.
 */
const syncClientsToFrontend = async () => {
  const clientSockets = getClientSockets();
  const clients = await getActiveClients();
  clientSockets.emit('update-client', clients);
};

/**
 * Sync the current connections list to all connected frontends.
 */
const syncConnectionsToFrontend = () => {
  const clientSockets = getClientSockets();
  const sendList = [];
  const receiveList = connections;
  clientSockets.emit('update-connections', { sendList, receiveList });
};

/**
 * Remove a connection from the global connections array and notify clients.
 * @param {string} url - The URL of the connection to remove.
 * @returns {object} { success: boolean, message: string }
 */
const removeConnection = (url) => {
  const idx = connections.findIndex(c => c.url === url);
  if (idx === -1) {
    console.log(`[REMOVE] Connection not found for URL: ${url}`);
    return { success: false, message: 'Connection not found' };
  }

  const entry = connections[idx];
  const mode = entry.mode;

  connections.splice(idx, 1);

  console.log(`[REMOVE] Removed connection: ${url} (mode: ${mode})`);
  notifyStatusToClients(url, mode, 'disconnected');
  syncConnectionsToFrontend();

  return { success: true, message: `Removed ${url}` };
};

/**
 * Forcefully disconnect a client socket by its ID.
 * @param {string} socketId - The ID of the socket to disconnect.
 * @returns {Promise<object>} { success: boolean, message: string }
 */
const disconnectClientSocket = async (socketId) => {
  const clientSockets = getClientSockets();
  const sockets = await clientSockets.fetchSockets();
  const target = sockets.find(s => s.id === socketId);
  if (!target) {
    console.log(`[DISCONNECT_CLIENT] Socket not found: ${socketId}`);
    return { success: false, message: 'Client socket not found' };
  }
  target.disconnect(true);
  console.log(`[DISCONNECT_CLIENT] Kicked client: ${socketId}`);
  return { success: true, message: `Disconnected ${socketId}` };
};

/**
 * Ping a URL via healthcheck endpoint.
 * @param {string} url - The URL to ping.
 * @param {number} timeout - Timeout in ms (default 2000).
 * @returns {Promise<boolean>}
 */
async function pingUrl(url, timeout = 2000) {
  try {
    const res = await axios.get(`${url}/healthcheck`, { timeout });
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

module.exports = {
  notifyStatusToClients,
  getActiveClients,
  syncClientsToFrontend,
  syncConnectionsToFrontend,
  removeConnection,
  disconnectClientSocket,
  pingUrl
};
