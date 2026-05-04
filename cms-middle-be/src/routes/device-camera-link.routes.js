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
  const { devEui, mqttServerId, cameraId } = req.body;

  if (!devEui || !mqttServerId) {
    return res.status(400).json({ success: false, error: 'devEui and mqttServerId are required' });
  }

  const existingIdx = deviceCameraLinks.findIndex(
    l => l.devEui === devEui && l.mqttServerId === mqttServerId
  );

  if (cameraId) {
    // Create or update link
    const linkEntry = { devEui, mqttServerId, cameraId };
    if (existingIdx !== -1) {
      deviceCameraLinks[existingIdx] = linkEntry;
      console.log(`[Device-Camera-Link] Updated: ${devEui} → ${cameraId}`);
    } else {
      deviceCameraLinks.push(linkEntry);
      console.log(`[Device-Camera-Link] Created: ${devEui} → ${cameraId}`);
    }
  } else {
    // Remove link (cameraId is null/undefined)
    if (existingIdx !== -1) {
      deviceCameraLinks.splice(existingIdx, 1);
      console.log(`[Device-Camera-Link] Removed link for: ${devEui}`);
    }
  }

  _emitLinksUpdate();
  res.json({ success: true, links: [...deviceCameraLinks] });
});

// ─── DELETE /api/v1/mqtt-device-camera-link — Remove a link ──────────────────
router.delete('/api/v1/mqtt-device-camera-link', (req, res) => {
  const { devEui, mqttServerId } = req.body;

  if (!devEui || !mqttServerId) {
    return res.status(400).json({ success: false, error: 'devEui and mqttServerId are required' });
  }

  const idx = deviceCameraLinks.findIndex(
    l => l.devEui === devEui && l.mqttServerId === mqttServerId
  );

  if (idx !== -1) {
    deviceCameraLinks.splice(idx, 1);
    console.log(`[Device-Camera-Link] Deleted: ${devEui} (server: ${mqttServerId})`);
  }

  _emitLinksUpdate();
  res.json({ success: true, links: [...deviceCameraLinks] });
});

module.exports = router;
