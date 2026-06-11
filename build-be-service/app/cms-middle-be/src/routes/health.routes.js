// ─── HEALTH & SERVER INFO ROUTES ──────────────────────────────────────────────
const express = require('express');
const os = require('os');
const { port } = require('../config');
const { connections } = require('../socketState');

const router = express.Router();

/**
 * @route GET /healthcheck
 * @description Simple health check endpoint.
 * @returns {object} 200 - { status: 'OK' }
 */
router.get('/healthcheck', (req, res) => {
  console.log("healcheck called from ", req.originalUrl);
  const { ip, port } = req.query;

  let isLogged = false;
  if (ip && port) {
    const targetUrl = `http://${ip}:${port}`;
    const exists = connections.find(c => c.url === targetUrl);
    isLogged = !!exists;
  }

  res.status(200).send({ status: 'OK', isLogged });
});

const authMiddleware = require('../middleware/auth.middleware');

/**
 * @route GET /server-information
 * @description Provides network interface details and current registered connections.
 * @returns {object} 200 - { ip: string, port: number, all_ips: Array, connections: Array }
 */
router.get('/server-information', authMiddleware, (req, res) => {

  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  res.status(200).send({
    ip: addresses[0] || '127.0.0.1',
    port,
    all_ips: addresses,
    connections: connections.map(c => ({ url: c.url, status: c.status, mode: 'receive' }))
  });
});

module.exports = router;

