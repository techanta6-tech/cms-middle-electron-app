const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { eMapLayout, getClientSockets } = require('../socketState');
const eMapLayoutService = require('../services/emap-layout.service');

// Auto-initialize background image from 10051_page-0001-1024x724.jpg if emap-bg.jpg is missing
const dataDir = process.env.USER_DATA_PATH
  ? path.join(process.env.USER_DATA_PATH, 'layout')
  : path.join(__dirname, '..', '..', 'data');

const bgPath = path.join(dataDir, 'emap-bg.jpg');
const userProvidedPath = path.join(dataDir, '10051_page-0001-1024x724.jpg');

if (!fs.existsSync(bgPath) && fs.existsSync(userProvidedPath)) {
  try {
    fs.copyFileSync(userProvidedPath, bgPath);
    console.log('[EMap-Layout] Initialized emap-bg.jpg from 10051_page-0001-1024x724.jpg');
  } catch (err) {
    console.error('[EMap-Layout] Failed to initialize default background:', err);
  }
}

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

// POST endpoint for updating background map image via Base64
router.post('/api/v1/emap-layout/background', (req, res) => {
  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ success: false, error: 'Không tìm thấy dữ liệu ảnh' });
    }

    // Extract base64 data
    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ success: false, error: 'Định dạng ảnh Base64 không hợp lệ' });
    }

    const imageBuffer = Buffer.from(matches[2], 'base64');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const outputFilePath = path.join(dataDir, 'emap-bg.jpg');
    fs.writeFileSync(outputFilePath, imageBuffer);

    console.log(`[EMap-Layout] Background image updated successfully: ${outputFilePath}`);

    // Emit event to update all frontend clients
    const clientSockets = getClientSockets();
    if (clientSockets) {
      clientSockets.emit('update-emap-bg', {
        bgUrl: '/api/v1/emap-bg-static/emap-bg.jpg?t=' + Date.now()
      });
    }

    res.json({
      success: true,
      bgUrl: '/api/v1/emap-bg-static/emap-bg.jpg?t=' + Date.now()
    });
  } catch (error) {
    console.error('[EMap-Layout] Error updating background image:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
