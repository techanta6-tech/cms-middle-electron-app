const express = require('express');
const router = express.Router();
const { eMapLayout, getClientSockets } = require('../socketState');
const eMapLayoutService = require('../services/emap-layout.service');

function emitEMapLayoutUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-emap-layout', {
      pins: eMapLayout.pins || [],
      tileProviderId: eMapLayout.tileProviderId || 'openstreetmap',
    });
  }
}

router.get('/api/v1/emap-layout', (req, res) => {
  res.json({
    success: true,
    pins: eMapLayout.pins || [],
    tileProviderId: eMapLayout.tileProviderId || 'openstreetmap',
  });
});

router.put('/api/v1/emap-layout', (req, res) => {
  const { pins, tileProviderId } = req.body || {};

  if (pins !== undefined) {
    eMapLayout.pins = Array.isArray(pins) ? pins : [];
  }
  if (tileProviderId !== undefined) {
    eMapLayout.tileProviderId = tileProviderId || 'openstreetmap';
  }

  const saved = eMapLayoutService.saveLayout(eMapLayout);
  eMapLayout.pins = saved.pins;
  eMapLayout.tileProviderId = saved.tileProviderId;
  eMapLayout.updatedAt = saved.updatedAt;

  console.log(`[EMap-Layout] Saved: ${eMapLayout.pins.length} pins`);

  emitEMapLayoutUpdate();
  res.json({
    success: true,
    pins: eMapLayout.pins,
    tileProviderId: eMapLayout.tileProviderId,
  });
});

module.exports = router;
