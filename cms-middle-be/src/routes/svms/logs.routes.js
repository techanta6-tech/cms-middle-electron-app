const express = require('express');
const { getClientSockets, connections, servers, devices, svmsDeviceFeatures } = require('../../socketState');
const connectivityMonitor = require('../../services/connectivity-monitor.service');
const svmsEventRegistry = require('../../services/svmsEventRegistry.service');
const { appendLog } = require('../../services/system-state.service');

const OTHER_EVENTS_DEFAULT_ON = true;

const router = express.Router();

router.post('/api/v1/logs', async (req, res) => {
  const clientSockets = getClientSockets();

  if (req.body && !req.body.sender_ip) {
    req.body.sender_ip = (req.socket?.remoteAddress || req.ip || '').replace('::ffff:', '');
  }

  const logBodyForFrontend = req.body || {};
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    originalUrl: req.originalUrl,
    statusCode: res.statusCode,
    ip: req.ip,
    body: logBodyForFrontend,
  };

  const newLogData = {
    id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    receive_time: logBodyForFrontend.time ? new Date(logBodyForFrontend.time).getTime() : Date.now(),
    log_type: logBodyForFrontend.log_type,
    log_description: logBodyForFrontend.description,
    snapshot: logBodyForFrontend.snapshot,
    log_source: 'svms',
    device_info: {
      name: logBodyForFrontend.device_name,
      id: logBodyForFrontend.device_index,
    },
    server_unique_id: `${logBodyForFrontend.server?.serial || ''}-${logBodyForFrontend.server?.server_id || ''}`,
    raw: logBodyForFrontend,
  };

  const logBody = logBodyForFrontend;
  const serverId = logBody.server_id || logBody.server?.server_id;
  const deviceIndex = logBody.device_index;

  if (serverId) {
    const now = new Date().toISOString();
    const serverEntry = servers.get(serverId);

    if (serverEntry && serverEntry.connectionStatus === 'disconnected') {
      console.log(`[CONNECTIVITY] Server ${serverId} auto-reconnected (log received)`);
      serverEntry.connectionStatus = 'connected';
      serverEntry.lastLogReceived = now;
    } else if (serverEntry) {
      serverEntry.lastLogReceived = now;
    }

    if (deviceIndex != null) {
      const deviceEntry = devices.get(serverId);
      const device = deviceEntry?.devices?.find(d => String(d.index) === String(deviceIndex));
      if (device) {
        if (device.connectionStatus === 'disconnected') {
          console.log(`[CONNECTIVITY] Device ${serverId}::${deviceIndex} auto-reconnected (log received)`);
          device.connectionStatus = 'connected';
        }
        device.lastLogReceived = now;
      }
    }

    connectivityMonitor.onLogReceived(serverId, deviceIndex);
  }

  if (serverId && deviceIndex != null) {
    const logType = (logBodyForFrontend.log_type || '').toLowerCase();
    if (logType) {
      const isNewEvent = svmsEventRegistry.discoverEvent(logType);
      if (isNewEvent) {
        clientSockets.emit('update-svms-known-events', svmsEventRegistry.getEvents());
      }

      const deviceEntry = svmsDeviceFeatures.find(
        e => e.serverId === serverId && String(e.deviceIndex) === String(deviceIndex)
      );
      const feats = deviceEntry ? (deviceEntry.features || {}) : {};
      const knownTypesSet = svmsEventRegistry.getKnownTypesSet();
      const isKnown = knownTypesSet.has(logType);

      if (isKnown) {
        const enabled = feats[logType] !== undefined
          ? !!feats[logType]
          : svmsEventRegistry.getDefaultEnabled(logType);
        if (!enabled) {
          console.log(`[SVMS] Prefiltered event '${logType}' for device ${serverId}::${deviceIndex}`);
          return res.status(200).send({ success: true });
        }
      } else {
        const otherEnabled = feats.__other_events__ !== undefined
          ? !!feats.__other_events__
          : OTHER_EVENTS_DEFAULT_ON;
        if (!otherEnabled) {
          console.log(`[SVMS] Prefiltered unknown event '${logType}' (__other_events__ disabled) for ${serverId}::${deviceIndex}`);
          return res.status(200).send({ success: true });
        }
      }
    }
  }

  appendLog(newLogData);
  clientSockets.emit('receive-log', logData);

  const senderIp = (req.ip || '').replace('::ffff:', '');
  connections.forEach(entry => {
    if (entry.ip === senderIp) {
      entry.receivedCount = (entry.receivedCount || 0) + 1;
      if ((!entry.server_id || entry.server_id === 'PENDING') && req.body?.server?.server_id) {
        entry.server_id = `${req.body.server.server_id}-${req.body.server.serial || ''}`;
      }
    }
  });

  return res.status(200).send({ success: true });
});

module.exports = router;
