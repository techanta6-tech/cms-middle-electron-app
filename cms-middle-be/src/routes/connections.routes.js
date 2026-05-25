const express = require('express');
const { connections } = require('../socketState');
const {
  notifyStatusToClients,
  getActiveClients,
  removeConnection,
  disconnectClientSocket,
  syncConnectionsToFrontend,
} = require('../helpers/notify');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/api/v1/disconnect-client', async (req, res) => {
  const { socketId } = req.body;
  if (!socketId) return res.status(400).send({ success: false, message: 'Missing socketId' });

  const result = await disconnectClientSocket(socketId);
  return res.status(result.success ? 200 : 404).send(result);
});

// Register a data source for display/monitoring only. This app no longer creates
// send targets, logs in to peer middle servers, syncs data to peers, or forwards.
router.post('/api/v1/create-connection', (req, res) => {
  const { ip, port } = req.body;
  if (!ip || !port) return res.status(400).send({ success: false, message: 'Missing IP or Port' });

  const url = `http://${ip}:${port}`;
  const existing = connections.find(c => c.url === url);
  if (existing) {
    existing.mode = 'receive';
    existing.status = 'connected';
    syncConnectionsToFrontend();
    return res.status(200).send({ success: true, message: 'Already configured', status: existing.status });
  }

  const connEntry = {
    url,
    ip,
    port,
    mode: 'receive',
    status: 'connected',
    server_id: 'PENDING',
    receivedCount: 0,
    sentCount: 0,
  };
  connections.push(connEntry);
  notifyStatusToClients(url, 'receive', 'connected');
  syncConnectionsToFrontend();

  return res.status(200).send({ success: true, message: `Registered data source ${url}`, ip, port, status: 'connected' });
});

router.post('/api/v1/reconnect-connection', (req, res) => {
  const { ip, port } = req.body;
  if (!ip || !port) return res.status(400).send({ success: false, message: 'Missing IP or Port' });

  const url = `http://${ip}:${port}`;
  const existing = connections.find(c => c.url === url);

  if (!existing) {
    return res.status(404).send({ success: false, message: 'Connection not found' });
  }

  existing.mode = 'receive';
  existing.status = 'connected';
  notifyStatusToClients(url, 'receive', 'connected');
  syncConnectionsToFrontend();

  return res.status(200).send({ success: true, message: 'Data source marked connected' });
});

router.post('/api/v1/remove-connection', (req, res) => {
  const { ip, port } = req.body;
  if (!ip || !port) return res.status(400).send({ success: false, message: 'Missing IP or Port' });

  const url = `http://${ip}:${port}`;
  const result = removeConnection(url);

  return res.status(result.success ? 200 : 404).send(result);
});

router.get('/api/v1/connections', async (req, res) => {
  const connectedClients = await getActiveClients();
  res.json({ sendList: [], receiveList: connections, activeMonitoringClients: connectedClients });
});

module.exports = router;
