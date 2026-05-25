const express = require('express');
const crypto = require('crypto');
const { mqttServers } = require('../../socketState');
const { connectMqttServer, disconnectMqttServer, getMqttServersList, getMqttServerLogs, publishDownlink, controlBuzzer } = require('../../services/mqtt.service');
const authMiddleware = require('../../middleware/auth.middleware');

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
  const { name, brokerHost, brokerPort, protocol, topic, defaultTopic, cameraId } = req.body;

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
    name: name ? name.trim() : '',
    brokerHost: brokerHost.trim(),
    brokerPort: String(brokerPort).trim(),
    protocol: protocol || 'mqtt',
    topic: topic ? topic.trim() : '',
    defaultTopic: defaultTopic || 'application/32dc910f-33ae-4526-ac0b-6344e378f00f/device/24e124806e515126/event/up',
    status: 'connecting',
    cameraId: cameraId || null,
  };

  mqttServers.push(serverConfig);
  connectMqttServer(serverConfig);

  res.status(201).json({ success: true, message: `MQTT server '${id}' created and connecting`, server: serverConfig });
});

// ─── PUT /api/v1/mqtt-servers/:id — Update MQTT server config (disconnect + reconnect) ─
router.put('/api/v1/mqtt-servers/:id', (req, res) => {
  const { id } = req.params;
  const idx = mqttServers.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'MQTT server not found' });
  }

  const { name, brokerHost, brokerPort, protocol, topic, defaultTopic, cameraId } = req.body;

  // Disconnect old
  disconnectMqttServer(id);

  // Update config
  const updated = {
    ...mqttServers[idx],
    name: name !== undefined ? (name ? name.trim() : '') : (mqttServers[idx].name || ''),
    brokerHost: brokerHost ? brokerHost.trim() : mqttServers[idx].brokerHost,
    brokerPort: brokerPort ? String(brokerPort).trim() : mqttServers[idx].brokerPort,
    protocol: protocol || mqttServers[idx].protocol,
    topic: topic !== undefined ? topic.trim() : mqttServers[idx].topic,
    defaultTopic: defaultTopic || mqttServers[idx].defaultTopic,
    cameraId: cameraId !== undefined ? cameraId : mqttServers[idx].cameraId,
    status: 'connecting',
  };
  mqttServers[idx] = updated;

  // Reconnect with new config
  connectMqttServer(updated);

  res.json({ success: true, message: `MQTT server '${id}' updated and reconnecting`, server: updated });
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
  const { getClientSockets } = require('../../socketState');
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-servers', getMqttServersList());
  }

  res.json({ success: true, message: `MQTT server '${id}' partially updated`, server: mqttServers[idx] });
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
  const { getClientSockets } = require('../../socketState');
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-mqtt-servers', getMqttServersList());
  }

  res.json({ success: true, message: `MQTT server '${id}' removed` });
});

// ─── POST /api/v1/mqtt-servers/:id/downlink — Publish generic downlink ────────
// Body: { applicationId, devEui, fPort, dataBase64, confirmed? }
router.post('/api/v1/mqtt-servers/:id/downlink', (req, res) => {
  const { id } = req.params;
  const { applicationId, devEui, fPort, dataBase64, confirmed } = req.body;

  if (!applicationId || !devEui || !fPort || !dataBase64) {
    return res.status(400).json({ success: false, message: 'Missing required fields: applicationId, devEui, fPort, dataBase64' });
  }

  const result = publishDownlink(id, { applicationId, devEui, fPort: Number(fPort), dataBase64, confirmed });

  if (!result.success) {
    return res.status(503).json({ success: false, message: result.error });
  }

  res.json({ success: true, message: 'Downlink published', topic: result.topic });
});

// ─── POST /api/v1/mqtt-servers/:id/buzzer — Control VS373 Buzzer ─────────────
// Body: { applicationId, devEui, enable: boolean, fPort? }
// enable=true  → Bật còi (ff3e01 → /z4B)
// enable=false → Tắt còi (ff3e00 → /z4A)
router.post('/api/v1/mqtt-servers/:id/buzzer', (req, res) => {
  const { id } = req.params;
  const { applicationId, devEui, enable, fPort } = req.body;

  if (!applicationId || !devEui || enable === undefined) {
    return res.status(400).json({ success: false, message: 'Missing required fields: applicationId, devEui, enable' });
  }

  const result = controlBuzzer(id, {
    applicationId,
    devEui,
    enable: Boolean(enable),
    fPort: fPort ? Number(fPort) : 85,
  });

  if (!result.success) {
    return res.status(503).json({ success: false, message: result.error });
  }

  res.json({
    success: true,
    message: `Buzzer ${Boolean(enable) ? 'ON' : 'OFF'} command sent`,
    topic: result.topic,
    devEui,
    command: Boolean(enable) ? 'ff3e01' : 'ff3e00',
  });
});

module.exports = router;
