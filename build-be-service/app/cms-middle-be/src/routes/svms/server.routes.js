const express = require('express');
const { getClientSockets, servers, devices, svmsServers, svmsDevices } = require('../../socketState');
const connectivityMonitor = require('../../services/connectivity-monitor.service');
const persistedDevices = require('../../services/persisted-devices.service');

const router = express.Router();

router.post('/api/v1/server', async (req, res) => {
  const clientSockets = getClientSockets();
  const senderIp = (req.ip || '').replace('::ffff:', '');
  const dataArr = Array.isArray(req.body) ? req.body : [req.body];
  const serverType = 'direct';

  clientSockets.emit('test', { message: 'new server', data: req.body });
  clientSockets.emit('new-server', dataArr);

  for (const serverData of dataArr) {
    if (!serverData) continue;
    const serverId = serverData.id || serverData.serial || senderIp;
    const existing = servers.get(serverId);
    const wasDisconnected = existing?.connectionStatus === 'disconnected';

    servers.set(serverId, {
      ...serverData,
      svms_ipv4_ip: serverData.svms_ipv4_ip || senderIp,
      sender_ip: senderIp,
      lastSeen: new Date().toISOString(),
      type: serverData.type || existing?.type || serverType,
      connectionStatus: 'connected',
      lastLogReceived: serverData.lastLogReceived || existing?.lastLogReceived || new Date().toISOString(),
    });
    persistedDevices.persistSvmsServer(servers.get(serverId), senderIp);

    if (wasDisconnected) {
      console.log(`[CONNECTIVITY] Server ${serverId} auto-reconnected (server data received)`);
      clientSockets.emit('server-connection-status', { serverId, status: 'connected' });
    }

    connectivityMonitor.registerServer(serverId);
  }

  dataArr.forEach(item => {
    if (!item) return;
    const existing = svmsServers.findIndex(s => (s.id || s.serial) === (item.id || item.serial));
    const entry = { ...item, _receivedAt: new Date().toISOString() };
    if (existing !== -1) {
      svmsServers[existing] = entry;
    } else {
      svmsServers.push(entry);
      if (svmsServers.length > 200) svmsServers.shift();
    }
  });

  clientSockets.emit('new-svms-servers', svmsServers);
  clientSockets.emit('receive-server-information', {
    allServers: Object.fromEntries(servers),
  });

  return res.status(200).send({ success: true });
});

router.post('/api/v1/devices', async (req, res) => {
  const clientSockets = getClientSockets();
  const senderIp = (req.ip || '').replace('::ffff:', '');
  const dataArr = Array.isArray(req.body) ? req.body : [req.body];

  clientSockets.emit('test', { message: 'new device', data: req.body });

  for (const item of dataArr) {
    if (!item) continue;
    const { server, devices: deviceList } = item;
    const serverId = server?.server_id || server?.serial || senderIp;
    const existingEntry = devices.get(serverId);

    const parsedDevices = (deviceList || []).map(d => {
      if (d.device_ip) {
        return {
          ...d,
          connectionStatus: 'connected',
          lastLogReceived: d.lastLogReceived || new Date().toISOString(),
        };
      }

      const [deviceIp, devicePortStr] = (d.ip || '').split(':');
      return {
        ...d,
        device_ip: deviceIp || '',
        device_port: devicePortStr ? parseInt(devicePortStr, 10) : null,
        connectionStatus: 'connected',
        lastLogReceived: d.lastLogReceived || new Date().toISOString(),
      };
    });

    if (existingEntry) {
      for (const newD of parsedDevices) {
        const oldD = existingEntry.devices.find(od => String(od.index) === String(newD.index));
        if (oldD && oldD.connectionStatus === 'disconnected') {
          console.log(`[CONNECTIVITY] Device ${serverId}::${newD.index} auto-reconnected (device data received)`);
          clientSockets.emit('device-connection-status', { serverId, deviceIndex: newD.index, status: 'connected' });
        }
      }
    }

    const serverEntry = servers.get(serverId);
    if (serverEntry && serverEntry.connectionStatus === 'disconnected') {
      console.log(`[CONNECTIVITY] Server ${serverId} auto-reconnected (device data received)`);
      serverEntry.connectionStatus = 'connected';
      clientSockets.emit('server-connection-status', { serverId, status: 'connected' });
    }

    devices.set(serverId, {
      server,
      devices: parsedDevices,
      sender_ip: senderIp,
      lastSeen: new Date().toISOString(),
    });
    persistedDevices.persistSvmsDevices(devices.get(serverId), senderIp);
    connectivityMonitor.registerDevices(serverId, parsedDevices);
  }

  dataArr.forEach(item => {
    if (!item) return;
    const itemServerId = item.server?.server_id || item.server?.serial || senderIp;
    const existing = svmsDevices.findIndex(d => (d.server?.server_id || d.server?.serial) === itemServerId);
    const entry = { ...item, _receivedAt: new Date().toISOString() };
    if (existing !== -1) {
      svmsDevices[existing] = entry;
    } else {
      svmsDevices.push(entry);
      if (svmsDevices.length > 200) svmsDevices.shift();
    }
  });

  clientSockets.emit('new-svms-devices', svmsDevices);
  clientSockets.emit('receive-devices-information', {
    allDevices: Object.fromEntries(devices),
  });

  return res.status(200).send({ success: true });
});

module.exports = { router };
