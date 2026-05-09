const express = require('express');
const { addCameraDevice, removeCameraDevice, updateCameraDevice, getCamerasList } = require('../services/cameras.service');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware);

// GET /api/v1/cameras — List all cameras
router.get('/api/v1/cameras', (req, res) => {
  const list = getCamerasList();
  res.json({ success: true, cameras: list });
});

// POST /api/v1/cameras — Add new camera
router.post('/api/v1/cameras', async (req, res) => {
  const { name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl } = req.body;

  try {
    const result = await addCameraDevice({ name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// PATCH /api/v1/cameras/:id — Update camera
router.patch('/api/v1/cameras/:id', async (req, res) => {
  try {
    const result = await updateCameraDevice(req.params.id, req.body);
    if (!result.success) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// DELETE /api/v1/cameras/:id — Remove camera
router.delete('/api/v1/cameras/:id', async (req, res) => {
  try {
    const result = await removeCameraDevice(req.params.id);
    if (!result.success) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

module.exports = router;
