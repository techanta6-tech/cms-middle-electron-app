const express = require('express');
const i3AiService = require('../services/i3ai.service');

const router = express.Router();

router.post('/api/v1/alerts/external', (req, res) => {
  try {
    const result = i3AiService.ingestExternalAlert(req);
    res.status(200).json({
      success: true,
      source: 'i3ai',
      server: result.server,
      log_id: result.log.id,
    });
  } catch (err) {
    console.error('[i3AI] Failed to ingest external alert:', err);
    res.status(400).json({ success: false, error: err.message || String(err) });
  }
});

router.get('/api/v1/i3ai-servers', (req, res) => {
  res.json({ success: true, servers: i3AiService.listI3AiServers() });
});

router.patch('/api/v1/i3ai-servers/:id', (req, res) => {
  const server = i3AiService.updateI3AiServer(req.params.id, {
    alias: req.body?.alias,
  });
  if (!server) {
    return res.status(404).json({ success: false, error: 'i3AI server not found' });
  }
  return res.json({ success: true, server });
});

router.delete('/api/v1/i3ai-servers/:id', (req, res) => {
  const removed = i3AiService.removeI3AiServer(req.params.id);
  if (!removed) {
    return res.status(404).json({ success: false, error: 'i3AI server not found' });
  }
  return res.json({ success: true });
});

module.exports = router;
