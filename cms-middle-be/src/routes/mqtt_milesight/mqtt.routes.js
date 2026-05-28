const express = require('express');
const crypto = require('crypto');
const { mqttGroups, mqttDeviceList } = require('../../socketState');
const {
  connectMqttDevice,
  disconnectMqttDevice,
  removeMqttDevice,
  getMqttGroupsList,
  getMqttDevicesList,
  getMqttServersList,
  getMqttServerLogs,
  publishDownlink,
  controlBuzzer,
  parseDeviceInfoFromTopic,
} = require('../../services/mqtt.service');
const authMiddleware = require('../../middleware/auth.middleware');
const persistedDevices = require('../../services/persisted-devices.service');

const router = express.Router();
router.use((req, res, next) => {
  const protectedPrefixes = [
    '/api/v1/mqtt-groups',
    '/api/v1/mqtt-devices',
    '/api/v1/mqtt-servers',
  ];
  if (!protectedPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next('router');
  }
  return authMiddleware(req, res, next);
});

function emitMqttState() {
  const { getClientSockets } = require('../../socketState');
  const clientSockets = getClientSockets();
  if (!clientSockets) return;
  clientSockets.emit('update-mqtt-groups', getMqttGroupsList());
  clientSockets.emit('update-mqtt-devices', getMqttDevicesList());
  clientSockets.emit('update-mqtt-servers', getMqttServersList());
  clientSockets.emit('update-mqtt-milesight-servers', getMqttServersList());
  clientSockets.emit('update-mqtt-milesight-devices', getMqttDevicesList());
}

router.get('/api/v1/mqtt-groups', (req, res) => {
  res.json({ success: true, groups: getMqttGroupsList() });
});

router.post('/api/v1/mqtt-groups', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Missing group name' });

  const group = {
    id: crypto.randomUUID().slice(0, 8),
    name,
    cameraId: req.body.cameraId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mqttGroups.push(group);
  persistedDevices.persistMqttGroup(group);
  emitMqttState();
  res.status(201).json({ success: true, group });
});

router.put('/api/v1/mqtt-groups/:id', (req, res) => {
  const group = mqttGroups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ success: false, message: 'MQTT group not found' });
  if (req.body.name !== undefined) group.name = String(req.body.name || group.name).trim();
  if (req.body.cameraId !== undefined) group.cameraId = req.body.cameraId || null;
  group.updatedAt = new Date().toISOString();
  persistedDevices.persistMqttGroup(group);
  emitMqttState();
  res.json({ success: true, group });
});

router.delete('/api/v1/mqtt-groups/:id', (req, res) => {
  const idx = mqttGroups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'MQTT group not found' });
  const devices = mqttDeviceList.filter(d => d.groupId === req.params.id);
  devices.forEach(device => removeMqttDevice(device.id));
  mqttGroups.splice(idx, 1);
  persistedDevices.removeMqttGroup(req.params.id);
  emitMqttState();
  res.json({ success: true });
});

router.get('/api/v1/mqtt-devices', (req, res) => {
  res.json({ success: true, devices: getMqttDevicesList() });
});

router.post('/api/v1/mqtt-groups/:groupId/devices', (req, res) => {
  const group = mqttGroups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ success: false, message: 'MQTT group not found' });

  const { brokerHost, brokerPort, protocol, topic, deviceInfo, cameraId } = req.body;
  if (!brokerHost || !brokerPort || !topic) {
    return res.status(400).json({ success: false, message: 'Missing brokerHost, brokerPort or topic' });
  }

  const exists = mqttDeviceList.find(d => d.groupId === group.id && d.topic === String(topic).trim());
  if (exists) {
    return res.status(409).json({ success: false, message: 'MQTT device with same group/topic already exists', existingId: exists.id });
  }

  const device = {
    id: crypto.randomUUID().slice(0, 8),
    groupId: group.id,
    brokerHost: String(brokerHost).trim(),
    brokerPort: String(brokerPort).trim(),
    protocol: protocol || 'mqtt',
    topic: String(topic).trim(),
    deviceInfo: deviceInfo || parseDeviceInfoFromTopic(topic),
    cameraId: cameraId || null,
    status: 'connecting',
    features: {},
  };

  connectMqttDevice(device);
  res.status(201).json({ success: true, device });
});

router.put('/api/v1/mqtt-devices/:id', (req, res) => {
  const idx = mqttDeviceList.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'MQTT device not found' });
  const current = mqttDeviceList[idx];
  disconnectMqttDevice(current.id);
  const updated = {
    ...current,
    ...req.body,
    id: current.id,
    groupId: req.body.groupId || current.groupId,
    brokerHost: req.body.brokerHost ? String(req.body.brokerHost).trim() : current.brokerHost,
    brokerPort: req.body.brokerPort ? String(req.body.brokerPort).trim() : current.brokerPort,
    topic: req.body.topic ? String(req.body.topic).trim() : current.topic,
    protocol: req.body.protocol || current.protocol,
    status: 'connecting',
  };
  mqttDeviceList[idx] = updated;
  connectMqttDevice(updated);
  res.json({ success: true, device: updated });
});

router.patch('/api/v1/mqtt-devices/:id', (req, res) => {
  const device = mqttDeviceList.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ success: false, message: 'MQTT device not found' });
  if (req.body.cameraId !== undefined) device.cameraId = req.body.cameraId || null;
  if (req.body.features) device.features = { ...(device.features || {}), ...req.body.features };
  persistedDevices.persistMqttDevice(device);
  emitMqttState();
  res.json({ success: true, device });
});

router.delete('/api/v1/mqtt-devices/:id', (req, res) => {
  const device = mqttDeviceList.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ success: false, message: 'MQTT device not found' });
  removeMqttDevice(req.params.id);
  res.json({ success: true });
});

router.get('/api/v1/mqtt-devices/:id/logs', (req, res) => {
  const logs = getMqttServerLogs(req.params.id);
  res.json({ success: true, count: logs.length, logs });
});

// Compatibility endpoints: old "server" now represents one MQTT device.
router.get('/api/v1/mqtt-servers', (req, res) => {
  res.json({ success: true, servers: getMqttServersList() });
});

router.get('/api/v1/mqtt-servers/:id/logs', (req, res) => {
  const logs = getMqttServerLogs(req.params.id);
  res.json({ success: true, count: logs.length, logs });
});

router.post('/api/v1/mqtt-servers', (req, res) => {
  let group = mqttGroups[0];
  if (!group) {
    group = {
      id: crypto.randomUUID().slice(0, 8),
      name: 'Default Group',
      cameraId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mqttGroups.push(group);
    persistedDevices.persistMqttGroup(group);
  }
  const { brokerHost, brokerPort, protocol, topic, deviceInfo, cameraId } = req.body;
  if (!brokerHost || !brokerPort || !topic) {
    return res.status(400).json({ success: false, message: 'Missing brokerHost, brokerPort or topic' });
  }
  const device = {
    id: crypto.randomUUID().slice(0, 8),
    groupId: group.id,
    brokerHost: String(brokerHost).trim(),
    brokerPort: String(brokerPort).trim(),
    protocol: protocol || 'mqtt',
    topic: String(topic).trim(),
    deviceInfo: deviceInfo || parseDeviceInfoFromTopic(topic),
    cameraId: cameraId || null,
    status: 'connecting',
    features: {},
  };
  connectMqttDevice(device);
  return res.status(201).json({ success: true, message: `MQTT device '${device.id}' created and connecting`, server: device, device });
});

router.put('/api/v1/mqtt-servers/:id', (req, res) => {
  const idx = mqttDeviceList.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'MQTT device not found' });
  const current = mqttDeviceList[idx];
  disconnectMqttDevice(current.id);
  const updated = { ...current, ...req.body, id: current.id, status: 'connecting' };
  mqttDeviceList[idx] = updated;
  connectMqttDevice(updated);
  res.json({ success: true, server: updated, device: updated });
});

router.patch('/api/v1/mqtt-servers/:id', (req, res) => {
  const device = mqttDeviceList.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ success: false, message: 'MQTT device not found' });
  if (req.body.cameraId !== undefined) device.cameraId = req.body.cameraId || null;
  if (req.body.features) device.features = { ...(device.features || {}), ...req.body.features };
  persistedDevices.persistMqttDevice(device);
  emitMqttState();
  res.json({ success: true, server: device, device });
});

router.delete('/api/v1/mqtt-servers/:id', (req, res) => {
  const device = mqttDeviceList.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ success: false, message: 'MQTT device not found' });
  removeMqttDevice(req.params.id);
  res.json({ success: true });
});

router.post('/api/v1/mqtt-devices/:id/downlink', (req, res) => {
  const { applicationId, devEui, fPort, dataBase64, confirmed } = req.body;
  if (!applicationId || !devEui || !fPort || !dataBase64) {
    return res.status(400).json({ success: false, message: 'Missing required fields: applicationId, devEui, fPort, dataBase64' });
  }
  const result = publishDownlink(req.params.id, { applicationId, devEui, fPort: Number(fPort), dataBase64, confirmed });
  if (!result.success) return res.status(503).json({ success: false, message: result.error });
  res.json({ success: true, message: 'Downlink published', topic: result.topic });
});

router.post('/api/v1/mqtt-devices/:id/buzzer', (req, res) => {
  const { applicationId, devEui, enable, fPort } = req.body;
  if (!applicationId || !devEui || enable === undefined) {
    return res.status(400).json({ success: false, message: 'Missing required fields: applicationId, devEui, enable' });
  }
  const result = controlBuzzer(req.params.id, { applicationId, devEui, enable: Boolean(enable), fPort: fPort ? Number(fPort) : 85 });
  if (!result.success) return res.status(503).json({ success: false, message: result.error });
  res.json({ success: true, message: `Buzzer ${Boolean(enable) ? 'ON' : 'OFF'} command sent`, topic: result.topic });
});

router.post('/api/v1/mqtt-servers/:id/downlink', (req, res) => {
  const { applicationId, devEui, fPort, dataBase64, confirmed } = req.body;
  const result = publishDownlink(req.params.id, { applicationId, devEui, fPort: Number(fPort), dataBase64, confirmed });
  if (!result.success) return res.status(503).json({ success: false, message: result.error });
  res.json({ success: true, message: 'Downlink published', topic: result.topic });
});

router.post('/api/v1/mqtt-servers/:id/buzzer', (req, res) => {
  const { applicationId, devEui, enable, fPort } = req.body;
  const result = controlBuzzer(req.params.id, { applicationId, devEui, enable: Boolean(enable), fPort: fPort ? Number(fPort) : 85 });
  if (!result.success) return res.status(503).json({ success: false, message: result.error });
  res.json({ success: true, message: `Buzzer ${Boolean(enable) ? 'ON' : 'OFF'} command sent`, topic: result.topic });
});

module.exports = router;
