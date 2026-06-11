const express = require('express');
const router = express.Router();
const { deviceCameraLinks, getClientSockets } = require('../socketState');

// ─── Helper: Emit updates to FE ──────────────────────────────────────────────
function _emitLinksUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-device-camera-links', [...deviceCameraLinks]);
  }
}

// ─── GET /api/v1/device-camera-links — List all links ────────────────────────
router.get('/api/v1/device-camera-links', (req, res) => {
  res.json({ success: true, links: [...deviceCameraLinks] });
});

// ─── PATCH /api/v1/mqtt-device-camera-link — Create or update a link ─────────
router.patch('/api/v1/mqtt-device-camera-link', (req, res) => {
  const { mqttDeviceId, groupId, devEui, mqttServerId, cameraId } = req.body;

  if (!mqttDeviceId && (!devEui || !mqttServerId)) {
    return res.status(400).json({ success: false, error: 'mqttDeviceId or devEui + mqttServerId are required' });
  }

  const existingIdx = deviceCameraLinks.findIndex(
    l => mqttDeviceId ? l.mqttDeviceId === mqttDeviceId : (l.devEui === devEui && l.mqttServerId === mqttServerId)
  );

  if (existingIdx !== -1) {
    // Update existing link
    deviceCameraLinks[existingIdx].cameraId = cameraId || null;
    console.log(`[Device-Camera-Link] Updated: ${devEui} → ${cameraId || 'DEFAULT'}`);
  } else if (cameraId) {
    // Create new link only if cameraId is provided
    const linkEntry = { mqttDeviceId, groupId, devEui, mqttServerId, cameraId, features: {} };
    deviceCameraLinks.push(linkEntry);
    console.log(`[Device-Camera-Link] Created: ${devEui} → ${cameraId}`);
  }

  _emitLinksUpdate();
  res.json({ success: true, links: [...deviceCameraLinks] });
});

// ─── DELETE /api/v1/mqtt-device-camera-link — Remove a link ──────────────────
router.delete('/api/v1/mqtt-device-camera-link', (req, res) => {
  const { mqttDeviceId, devEui, mqttServerId } = req.body;

  if (!mqttDeviceId && (!devEui || !mqttServerId)) {
    return res.status(400).json({ success: false, error: 'mqttDeviceId or devEui + mqttServerId are required' });
  }

  const idx = deviceCameraLinks.findIndex(
    l => mqttDeviceId ? l.mqttDeviceId === mqttDeviceId : (l.devEui === devEui && l.mqttServerId === mqttServerId)
  );

  if (idx !== -1) {
    deviceCameraLinks.splice(idx, 1);
    console.log(`[Device-Camera-Link] Deleted: ${devEui} (server: ${mqttServerId})`);
  }

  _emitLinksUpdate();
  res.json({ success: true, links: [...deviceCameraLinks] });
});

module.exports = router;
