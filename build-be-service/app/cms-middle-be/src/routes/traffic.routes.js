// ─── TRAFFIC ROUTES ────────────────────────────────────────────────────────────
// API endpoints cho module Traffic (quản lý biển số xe LPR)

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const trafficService = require('../services/traffic.service');

const getSnapshotContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
};

/**
 * GET /api/v1/traffic/records
 * Lấy danh sách bản ghi biển số xe với phân trang và tìm kiếm.
 * Query params: page (default 1), limit (default 50), search, camera_id
 */
router.get('/api/v1/traffic/records', (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', camera_id = '' } = req.query;
    const result = trafficService.getTrafficRecords({
      page: parseInt(page, 10) || 1,
      limit: Math.min(parseInt(limit, 10) || 50, 500), // giới hạn tối đa 500/trang
      search: String(search),
      camera_id: String(camera_id || ''),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Traffic API] Error getting records:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/traffic/stats
 * Lấy thống kê tổng quan về biển số xe.
 */
router.get('/api/v1/traffic/stats', (req, res) => {
  try {
    const stats = trafficService.getTrafficStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('[Traffic API] Error getting stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/traffic/search/:plate
 * Tìm kiếm nhanh theo biển số xe.
 */
router.get('/api/v1/traffic/search/:plate', (req, res) => {
  try {
    const { plate } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const result = trafficService.getTrafficRecords({
      page: parseInt(page, 10) || 1,
      limit: Math.min(parseInt(limit, 10) || 50, 500),
      search: plate,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Traffic API] Error searching:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/traffic/snapshot
 * Proxy serving a snapshot image from the backend disk.
 */
router.get('/api/v1/traffic/snapshot', (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Path is required' });
    }
    const normalized = path.resolve(path.normalize(filePath));
    if (!fs.existsSync(normalized)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const stat = fs.statSync(normalized);
    if (!stat.isFile()) {
      return res.status(404).json({ success: false, error: 'Snapshot is not a file' });
    }

    res.setHeader('Content-Type', getSnapshotContentType(normalized));
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(normalized);
    stream.on('error', (err) => {
      console.error('[Traffic API] Error reading snapshot:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[Traffic API] Error sending snapshot:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/traffic/save
 * Bắt buộc lưu trafficRecords ra file ngay lập tức (thay vì chờ cron 1 phút).
 */
router.post('/api/v1/traffic/save', (req, res) => {
  try {
    trafficService.saveTrafficRecords();
    res.json({ success: true, message: 'Traffic records saved to disk.' });
  } catch (err) {
    console.error('[Traffic API] Error saving:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
