const express = require('express');
const router = express.Router();
const { gridLayout, getClientSockets } = require('../socketState');

// ─── Helper: Emit grid layout to FE ─────────────────────────────────────────
function _emitGridLayoutUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-grid-layout', {
      grids: gridLayout.grids,
      gridCols: gridLayout.gridCols,
    });
  }
}

// ─── GET /api/v1/grid-layout — Get saved grid layout ────────────────────────
router.get('/api/v1/grid-layout', (req, res) => {
  res.json({
    success: true,
    grids: gridLayout.grids,
    gridCols: gridLayout.gridCols,
  });
});

// ─── PUT /api/v1/grid-layout — Save grid layout ─────────────────────────────
router.put('/api/v1/grid-layout', (req, res) => {
  const { grids, gridCols } = req.body;

  if (grids !== undefined) {
    gridLayout.grids = grids;
  }
  if (gridCols !== undefined) {
    gridLayout.gridCols = gridCols;
  }

  console.log(`[Grid-Layout] Saved: ${gridLayout.grids.filter(Boolean).length} devices in ${gridLayout.gridCols}x${gridLayout.gridCols} grid`);

  _emitGridLayoutUpdate();
  res.json({
    success: true,
    grids: gridLayout.grids,
    gridCols: gridLayout.gridCols,
  });
});

module.exports = router;
