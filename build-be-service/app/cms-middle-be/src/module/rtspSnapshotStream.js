const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');

let ffmpegPath = null;

const streams = new Map();
const DEFAULT_FRAME_INTERVAL_MS = 1000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 8000;
const DEFAULT_RESTART_DELAY_MS = 2000;
const DEFAULT_STALE_FRAME_MS = 15000;

function resolveFfmpegPath() {
  if (ffmpegPath) return ffmpegPath;

  if (process.env.FFMPEG_PATH) {
    ffmpegPath = process.env.FFMPEG_PATH;
    return ffmpegPath;
  }

  if (process.pkg) {
    ffmpegPath = require(path.join(
      path.dirname(process.execPath),
      'node_modules',
      '@ffmpeg-installer',
      'ffmpeg'
    )).path;
    return ffmpegPath;
  }

  try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
  } catch (err) {
    ffmpegPath = require(path.join(
      process.cwd(),
      'node_modules',
      '@ffmpeg-installer',
      'ffmpeg'
    )).path;
  }

  return ffmpegPath;
}

function maskRtspUrl(rtspUrl) {
  return String(rtspUrl || '').replace(/:\/\/([^:/@]+):([^@]+)@/, '://$1:***@');
}

function sanitizeId(id) {
  return String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getWritableBase() {
  return process.env.USER_DATA_PATH || process.cwd();
}

function getDefaultStreamDir(id) {
  return path.join(getWritableBase(), 'rtsp_streams', sanitizeId(id));
}

function statFrame(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 0) return null;
    return {
      size: stats.size,
      updatedAtMs: stats.mtimeMs,
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function createSnapshotPath(stream, ext = 'jpg') {
  const snapshotDir = stream.snapshotDir || path.join(getWritableBase(), 'snapshots');
  ensureDir(snapshotDir);
  return path.join(snapshotDir, `rtsp_${stream.id}_${Date.now()}.${ext}`);
}

function normalizeOptions(options) {
  const id = sanitizeId(options.id);
  if (!id) throw new Error('id is required');
  if (!options.rtspUrl) throw new Error('rtspUrl is required');

  const frameIntervalMs = Number(options.frameIntervalMs || DEFAULT_FRAME_INTERVAL_MS);
  const streamDir = options.streamDir || getDefaultStreamDir(id);

  return {
    id,
    rtspUrl: options.rtspUrl,
    streamDir,
    latestFramePath: options.latestFramePath || path.join(streamDir, 'latest.jpg'),
    snapshotDir: options.snapshotDir || path.join(getWritableBase(), 'snapshots'),
    frameIntervalMs: Math.max(200, frameIntervalMs),
    restartDelayMs: Number(options.restartDelayMs || DEFAULT_RESTART_DELAY_MS),
    rtspTransport: options.rtspTransport || 'tcp',
    extraInputArgs: Array.isArray(options.extraInputArgs) ? options.extraInputArgs : [],
    extraOutputArgs: Array.isArray(options.extraOutputArgs) ? options.extraOutputArgs : [],
    autoRestart: options.autoRestart !== false,
    logger: typeof options.logger === 'function' ? options.logger : null,
  };
}

function log(stream, message, meta) {
  const line = `[RTSP-Stream:${stream.id}] ${message}`;
  if (stream.logger) {
    stream.logger(line, meta);
    return;
  }
  if (meta !== undefined) {
    console.log(line, meta);
  } else {
    console.log(line);
  }
}

function buildFfmpegArgs(stream) {
  const fps = Math.max(0.1, 1000 / stream.frameIntervalMs);
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-rtsp_transport', stream.rtspTransport,
    ...stream.extraInputArgs,
    '-i', stream.rtspUrl,
    '-an',
    '-vf', `fps=${fps}`,
    '-q:v', '2',
    '-update', '1',
    ...stream.extraOutputArgs,
    stream.latestFramePath,
  ];
}

function startProcess(stream) {
  const ffmpeg = resolveFfmpegPath();
  ensureDir(stream.streamDir);
  ensureDir(stream.snapshotDir);

  const args = buildFfmpegArgs(stream);
  stream.status = 'connecting';
  stream.lastError = null;
  stream.startedAt = new Date().toISOString();
  stream.stoppedAt = null;

  log(stream, `Starting ffmpeg for ${maskRtspUrl(stream.rtspUrl)}`);
  const proc = spawn(ffmpeg, args, { windowsHide: true });
  stream.process = proc;

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (!text) return;
    stream.lastFfmpegMessage = text.slice(-2000);
    if (/error|failed|unauthorized|refused|not found/i.test(text)) {
      stream.lastError = text.slice(-2000);
    }
  });

  proc.once('spawn', () => {
    stream.status = 'running';
  });

  proc.once('error', (err) => {
    stream.status = 'error';
    stream.lastError = err.message || String(err);
  });

  proc.once('close', (code, signal) => {
    if (stream.process === proc) {
      stream.process = null;
    }
    stream.stoppedAt = new Date().toISOString();

    if (stream.stopRequested) {
      stream.status = 'stopped';
      return;
    }

    stream.status = 'error';
    stream.lastError = `ffmpeg exited with code=${code}, signal=${signal || 'none'}`;
    log(stream, stream.lastError);

    if (stream.autoRestart) {
      stream.restartTimer = setTimeout(() => {
        stream.restartTimer = null;
        if (!stream.stopRequested) startProcess(stream);
      }, stream.restartDelayMs);
    }
  });
}

function createRtspConnection(options) {
  const normalized = normalizeOptions(options);
  const existing = streams.get(normalized.id);
  if (existing) {
    throw new Error(`RTSP stream '${normalized.id}' already exists`);
  }

  const stream = {
    ...normalized,
    status: 'created',
    process: null,
    restartTimer: null,
    stopRequested: false,
    createdAt: new Date().toISOString(),
    startedAt: null,
    stoppedAt: null,
    lastError: null,
    lastFfmpegMessage: null,
  };

  streams.set(stream.id, stream);
  startProcess(stream);
  return getRtspConnection(stream.id);
}

function stopRtspConnection(id) {
  const stream = streams.get(sanitizeId(id));
  if (!stream) return { success: false, error: 'RTSP stream not found' };

  stream.stopRequested = true;
  stream.status = 'stopping';
  if (stream.restartTimer) {
    clearTimeout(stream.restartTimer);
    stream.restartTimer = null;
  }
  if (stream.process) {
    stream.process.kill('SIGTERM');
  } else {
    stream.status = 'stopped';
  }

  streams.delete(stream.id);
  return { success: true, id: stream.id };
}

function getRtspConnection(id) {
  const stream = streams.get(sanitizeId(id));
  if (!stream) return null;

  const latestFrame = statFrame(stream.latestFramePath);
  return {
    id: stream.id,
    rtspUrl: maskRtspUrl(stream.rtspUrl),
    status: stream.status,
    latestFramePath: stream.latestFramePath,
    snapshotDir: stream.snapshotDir,
    frameIntervalMs: stream.frameIntervalMs,
    autoRestart: stream.autoRestart,
    createdAt: stream.createdAt,
    startedAt: stream.startedAt,
    stoppedAt: stream.stoppedAt,
    lastError: stream.lastError,
    lastFfmpegMessage: stream.lastFfmpegMessage,
    latestFrame,
  };
}

function listRtspConnections() {
  return Array.from(streams.keys()).map(getRtspConnection);
}

async function waitForFrame(stream, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_CAPTURE_TIMEOUT_MS);
  const requestTimeMs = options.fresh ? Date.now() : 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const frame = statFrame(stream.latestFramePath);
    if (frame && frame.updatedAtMs >= requestTimeMs) {
      return frame;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`No ${options.fresh ? 'fresh ' : ''}frame available after ${timeoutMs}ms`);
}

async function captureRtspSnapshot(id, options = {}) {
  const stream = streams.get(sanitizeId(id));
  if (!stream) {
    return { success: false, statusCode: 404, error: 'RTSP stream not found' };
  }

  try {
    const frame = await waitForFrame(stream, {
      timeoutMs: options.timeoutMs,
      fresh: options.fresh !== false,
    });

    const staleMs = Number(options.staleMs || DEFAULT_STALE_FRAME_MS);
    if (Date.now() - frame.updatedAtMs > staleMs) {
      return {
        success: false,
        statusCode: 504,
        error: `Latest RTSP frame is stale (${Math.round(Date.now() - frame.updatedAtMs)}ms old)`,
      };
    }

    const buffer = fs.readFileSync(stream.latestFramePath);
    let snapshotPath = stream.latestFramePath;
    if (options.save !== false) {
      snapshotPath = options.outputPath || createSnapshotPath(stream, 'jpg');
      fs.copyFileSync(stream.latestFramePath, snapshotPath);
    }

    const result = {
      success: true,
      id: stream.id,
      contentType: 'image/jpeg',
      snapshotPath,
      latestFramePath: stream.latestFramePath,
      capturedAt: new Date(frame.updatedAtMs).toISOString(),
      size: buffer.length,
    };

    if (options.includeBuffer) result.buffer = buffer;
    if (options.includeBase64 !== false) {
      result.snapshotBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }

    return result;
  } catch (err) {
    return {
      success: false,
      statusCode: 504,
      error: err.message || String(err),
      stream: getRtspConnection(stream.id),
    };
  }
}

function createRtspSnapshotRouter(options = {}) {
  const router = express.Router();
  const authMiddleware = options.authMiddleware || ((req, res, next) => next());

  router.get('/api/v1/rtsp-streams', authMiddleware, (req, res) => {
    res.json({ success: true, streams: listRtspConnections() });
  });

  router.post('/api/v1/rtsp-streams', authMiddleware, (req, res) => {
    try {
      const stream = createRtspConnection(req.body || {});
      res.status(201).json({ success: true, stream });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || String(err) });
    }
  });

  router.get('/api/v1/rtsp-streams/:id', authMiddleware, (req, res) => {
    const stream = getRtspConnection(req.params.id);
    if (!stream) return res.status(404).json({ success: false, error: 'RTSP stream not found' });
    res.json({ success: true, stream });
  });

  router.delete('/api/v1/rtsp-streams/:id', authMiddleware, (req, res) => {
    const result = stopRtspConnection(req.params.id);
    res.status(result.success ? 200 : 404).json(result);
  });

  router.post('/api/v1/rtsp-streams/:id/snapshot', authMiddleware, async (req, res) => {
    const wantsImage = req.query.format === 'image' || req.get('accept') === 'image/jpeg';
    const result = await captureRtspSnapshot(req.params.id, {
      ...(req.body || {}),
      includeBuffer: wantsImage,
      includeBase64: !wantsImage,
    });

    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }

    if (wantsImage) {
      res.setHeader('content-type', result.contentType);
      res.setHeader('x-snapshot-path', result.snapshotPath);
      return res.send(result.buffer);
    }

    res.json(result);
  });

  return router;
}

function stopAllRtspConnections() {
  return Array.from(streams.keys()).map(stopRtspConnection);
}

module.exports = {
  createRtspConnection,
  stopRtspConnection,
  stopAllRtspConnections,
  getRtspConnection,
  listRtspConnections,
  captureRtspSnapshot,
  createRtspSnapshotRouter,
};
