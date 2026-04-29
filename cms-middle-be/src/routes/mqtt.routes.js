const express = require('express');
const crypto = require('crypto');
const { mqttServers } = require('../socketState');
const { connectMqttServer, disconnectMqttServer, getMqttServersList, getMqttServerLogs } = require('../services/mqtt.service');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware);

// ─── GET /api/v1/mqtt-servers — List all MQTT server configs ─────────────────
router.get('/api/v1/mqtt-servers', (req, res) => {
  res.json({ success: true, servers: getMqttServersList() });
});

// ─── GET /api/v1/mqtt-servers/:id/logs — Get logs for one MQTT server ────────
router.get('/api/v1/mqtt-servers/:id/logs', (req, res) => {
  const logs = getMqttServerLogs(req.params.id);
  res.json({ success: true, count: logs.length, logs });
});

// ─── POST /api/v1/mqtt-servers — Add new MQTT server & connect ───────────────
router.post('/api/v1/mqtt-servers', (req, res) => {
  const { brokerHost, brokerPort, protocol, topic, defaultTopic, cameraId } = req.body;

  if (!brokerHost || !brokerPort) {
    return res.status(400).json({ success: false, message: 'Missing brokerHost or brokerPort' });
  }

  // Check duplicate
  const exists = mqttServers.find(s =>
    s.brokerHost === brokerHost && s.brokerPort === String(brokerPort) && s.topic === topic
  );
  if (exists) {
    return res.status(409).json({ success: false, message: 'MQTT server with same host:port and topic already exists', existingId: exists.id });
  }

  const id = crypto.randomUUID().slice(0, 8);
  const serverConfig = {
    id,
    brokerHost: brokerHost.trim(),
    brokerPort: String(brokerPort).trim(),
    protocol: protocol || 'mqtt',
    topic: topic ? topic.trim() : '',
    defaultTopic: defaultTopic || 'application/{appId}/device/{deviceEui}/event/up',
    status: 'connecting',
    cameraId: cameraId || null,
    logs: [],
  };

  mqttServers.push(serverConfig);
  connectMqttServer(serverConfig);

  res.status(201).json({ success: true, message: `MQTT server '${id}' created and connecting`, server: { ...serverConfig, logs: undefined } });
});

// ─── PUT /api/v1/mqtt-servers/:id — Update MQTT server config (disconnect + reconnect) ─
router.put('/api/v1/mqtt-servers/:id', (req, res) => {
  const { id } = req.params;
  const idx = mqttServers.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'MQTT server not found' });
  }

  const { brokerHost, brokerPort, protocol, topic, defaultTopic, cameraId } = req.body;

  // Disconnect old
  disconnectMqttServer(id);

  // Update config
  const updated = {
    ...mqttServers[idx],
    brokerHost: brokerHost ? brokerHost.trim() : mqttServers[idx].brokerHost,
    brokerPort: brokerPort ? String(brokerPort).trim() : mqttServers[idx].brokerPort,
    protocol: protocol || mqttServers[idx].protocol,
    topic: topic !== undefined ? topic.trim() : mqttServers[idx].topic,
    defaultTopic: defaultTopic || mqttServers[idx].defaultTopic,
    cameraId: cameraId !== undefined ? cameraId : mqttServers[idx].cameraId,
    status: 'connecting',
    logs: mqttServers[idx].logs || [], // preserve logs
  };
  mqttServers[idx] = updated;

  // Reconnect with new config
  connectMqttServer(updated);

  res.json({ success: true, message: `MQTT server '${id}' updated and reconnecting`, server: { ...updated, logs: undefined } });
});

// ─── PATCH /api/v1/mqtt-servers/:id — Partially update MQTT server config ─────
router.patch('/api/v1/mqtt-servers/:id', (req, res) => {
  const { id } = req.params;
  const idx = mqttServers.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'MQTT server not found' });
  }

  const { cameraId } = req.body;

  if (cameraId !== undefined) {
    mqttServers[idx].cameraId = cameraId;
  }

  // Emit updated list to FE
  const { getClientSockets } = require('../socketState');
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-servers', getMqttServersList());
  }

  res.json({ success: true, message: `MQTT server '${id}' partially updated`, server: { ...mqttServers[idx], logs: undefined } });
});

// ─── DELETE /api/v1/mqtt-servers/:id — Remove MQTT server ────────────────────
router.delete('/api/v1/mqtt-servers/:id', (req, res) => {
  const { id } = req.params;
  const idx = mqttServers.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'MQTT server not found' });
  }

  disconnectMqttServer(id);
  mqttServers.splice(idx, 1);

  // Emit updated list to FE
  const { getClientSockets } = require('../socketState');
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-servers', getMqttServersList());
  }

  res.json({ success: true, message: `MQTT server '${id}' removed` });
});

module.exports = router;
