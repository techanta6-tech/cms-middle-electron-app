const express = require('express');
const {
  addCameraDevice,
  removeCameraDevice,
  updateCameraDevice,
  getCamerasList,
  getSdkSnapshotForCamera,
  getSnapshotUrlForCamera
} = require('../services/cameras.service');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/v1/cameras — List all cameras
router.get('/api/v1/cameras', authMiddleware, (req, res) => {
  const list = getCamerasList();
  res.json({ success: true, cameras: list });
});

// POST /api/v1/cameras — Add new camera
router.post('/api/v1/cameras', authMiddleware, async (req, res) => {
  const { name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl, snapshotUrl } = req.body;

  try {
    const result = await addCameraDevice({ name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl, snapshotUrl });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// PATCH /api/v1/cameras/:id — Update camera
router.patch('/api/v1/cameras/:id', authMiddleware, async (req, res) => {
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
router.delete('/api/v1/cameras/:id', authMiddleware, async (req, res) => {
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

router.post('/api/v1/cameras/:id/snapshot/sdk', authMiddleware, async (req, res) => {
  try {
    const result = await getSdkSnapshotForCamera(req.params.id);
    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.post('/api/v1/cameras/:id/snapshot/url', authMiddleware, async (req, res) => {
  try {
    const result = await getSnapshotUrlForCamera(req.params.id);
    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

module.exports = router;
