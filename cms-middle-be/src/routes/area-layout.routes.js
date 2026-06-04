const express = require('express');
const router = express.Router();
const { areaLayout, getClientSockets } = require('../socketState');
const areaLayoutService = require('../services/area-layout.service');

function emitAreaLayoutUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-area-layout', {
      nodes: areaLayout.nodes || [],
      updatedAt: areaLayout.updatedAt || null,
    });
  }
}

router.get('/api/v1/area-layout', (req, res) => {
  res.json({
    success: true,
    nodes: areaLayout.nodes || [],
    updatedAt: areaLayout.updatedAt || null,
  });
});

router.put('/api/v1/area-layout', (req, res) => {
  const { nodes } = req.body || {};

  if (nodes !== undefined) {
    areaLayout.nodes = Array.isArray(nodes) ? nodes : [];
  }
  areaLayout.updatedAt = new Date().toISOString();
  areaLayoutService.markDirty();

  emitAreaLayoutUpdate();
  res.json({
    success: true,
    nodes: areaLayout.nodes,
    updatedAt: areaLayout.updatedAt,
  });
});

module.exports = router;
