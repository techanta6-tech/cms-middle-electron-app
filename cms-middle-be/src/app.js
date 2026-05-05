// ─── EXPRESS APP & MIDDLEWARE ─────────────────────────────────────────────────
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const { getCMSBackendURL } = require('./config');

// Route imports
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const logsRoutes = require('./routes/logs.routes');
const connectionsRoutes = require('./routes/connections.routes');
const serverRoutes = require('./routes/server.routes');
const mqttRoutes = require('./routes/mqtt.routes');
const camerasRoutes = require('./routes/cameras.routes');
const deviceCameraLinkRoutes = require('./routes/device-camera-link.routes');
const gridLayoutRoutes = require('./routes/grid-layout.routes');
const { getClientSockets } = require('./socketState');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));

let isLogSavingEnabled = true;

app.post('/api/v1/config/log-saving', (req, res) => {
  if (req.body.enabled !== undefined) {
    isLogSavingEnabled = !!req.body.enabled;
  }
  const logDir = process.env.USER_DATA_PATH 
    ? path.join(process.env.USER_DATA_PATH, 'request_logs') 
    : path.join(__dirname, '..', 'request_logs');
  res.json({ success: true, enabled: isLogSavingEnabled, path: logDir });
});

// Request Logger
app.use((req, res, next) => {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();

  let responseBody;

  const originalSend = res.send.bind(res);
  const originalJson = res.json.bind(res);

  res.send = (body) => {
    responseBody = body;
    return originalSend(body);
  };

  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const contentLength = res.getHeader('content-length');

    const serialize = (body) => {
      if (body === undefined) return undefined;
      if (Buffer.isBuffer(body)) return `<Buffer length=${body.length}>`;
      if (typeof body === 'string') return body;
      try {
        return JSON.stringify(body);
      } catch {
        return String(body);
      }
    };

    const maxLen = 2000;
    let responseText = serialize(responseBody);
    if (typeof responseText === 'string' && responseText.length > maxLen) {
      responseText = `${responseText.slice(0, maxLen)}...<truncated>`;
    }

    let requestText = serialize(req.body);
    if (typeof requestText === 'string' && requestText.length > maxLen) {
      requestText = `${requestText.slice(0, maxLen)}...<truncated>`;
    }

    const lengthPart = contentLength ? ` ${contentLength}b` : '';
    const reqPart = requestText === undefined ? '' : ` | request=${requestText}`;
    const resPart = responseText === undefined ? '' : ` | response=${responseText}`;

    // --- Custom File Logger ---
    if (!isLogSavingEnabled) return;
    const SVMSAPIs = [
      'logs', 'server', 'devices', 'login'
    ]
    if (SVMSAPIs.includes(req.originalUrl.split('/')[3])) {
      const sanitizedApiName = req.originalUrl.split('?')[0].replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+/, '');
      if (sanitizedApiName) {
        let logDir;
        if (process.env.USER_DATA_PATH) {
          logDir = path.join(process.env.USER_DATA_PATH, 'request_logs');
        } else {
          logDir = path.join(__dirname, '..', 'request_logs');
        }
        
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        const logFilePath = path.join(logDir, `${sanitizedApiName}.txt`);

        const serializeForFile = (body, removeSnapshot = false) => {
          if (body === undefined) return '';
          if (Buffer.isBuffer(body)) return `<Buffer length=${body.length}>`;
          if (typeof body === 'string') return body;
          try {
            return JSON.stringify(
              body,
              removeSnapshot ? (k, v) => (k === 'snapshot' ? ' ' : v) : null,
              2
            );
          } catch {
            return String(body);
          }
        };

        const fullRequestText = serializeForFile(req.body);
        const fullResponseText = serializeForFile(responseBody);
        const authHeader = req.headers['authorization'] || req.headers['accesstoken'] || req.headers['auth'] || 'None';

        const logContent = `\n==================================================\nTime: ${timestamp}\nAPI: ${req.originalUrl}\nMethod: ${req.method}\nAuth Header: ${authHeader}\n----- Payload -----\n${fullRequestText}\n----- Response -----\n${fullResponseText}\n==================================================\n`;

        fs.appendFile(logFilePath, logContent, (err) => {
          if (err) console.error('Error writing api log file:', err);
        });

        if (req.originalUrl.includes('/logs')) {
          const logFilePathNoSnapshot = path.join(logDir, `${sanitizedApiName}_no_snapshot.txt`);
          const fullRequestTextNoSnapshot = serializeForFile(req.body, true);
          const fullResponseTextNoSnapshot = serializeForFile(responseBody, true);
          const logContentNoSnapshot = `\n==================================================\nTime: ${timestamp}\nAPI: ${req.originalUrl}\nMethod: ${req.method}\nAuth Header: ${authHeader}\n----- Payload -----\n${fullRequestTextNoSnapshot}\n----- Response -----\n${fullResponseTextNoSnapshot}\n==================================================\n`;

          fs.appendFile(logFilePathNoSnapshot, logContentNoSnapshot, (err) => {
            if (err) console.error('Error writing api log file no snapshot:', err);
          });
        }
      }
    }
    // --------------------------

  });

  next();
});

// ─── Mount Routes ────────────────────────────────────────────────────────────
app.use(healthRoutes);
app.use(authRoutes);
app.use(logsRoutes);
app.use(connectionsRoutes);
app.use(serverRoutes.router);
app.use(mqttRoutes);
app.use(camerasRoutes);
app.use(deviceCameraLinkRoutes);
app.use(gridLayoutRoutes);
// ─── Debug: dump toàn bộ in-memory state ─────────────────────────────────────
const socketState = require('./socketState');

app.get('/api/v1/debug/state', (req, res) => {
  const serversObj = {};
  socketState.servers.forEach((v, k) => { serversObj[k] = v; });

  const devicesObj = {};
  socketState.devices.forEach((v, k) => { devicesObj[k] = v; });

  res.json({
    _export_time: new Date().toISOString(),
    connections: socketState.connections,
    servers: serversObj,
    devices: devicesObj,
    mqttServers: socketState.mqttServers,
    cameraDevices: socketState.cameraDevices,
    deviceCameraLinks: socketState.deviceCameraLinks,
    gridLayout: socketState.gridLayout,
  });
});

module.exports = app;
