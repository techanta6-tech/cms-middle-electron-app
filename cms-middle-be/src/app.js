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
const logsRoutes = require('./routes/svms/logs.routes');
const connectionsRoutes = require('./routes/connections.routes');
const serverRoutes = require('./routes/svms/server.routes');
const mqttRoutes = require('./routes/mqtt_milesight/mqtt.routes');
const camerasRoutes = require('./routes/cameras.routes');
const deviceCameraLinkRoutes = require('./routes/device-camera-link.routes');
const gridLayoutRoutes = require('./routes/grid-layout.routes');
const eMapLayoutRoutes = require('./routes/emap-layout.routes');
const areaLayoutRoutes = require('./routes/area-layout.routes');
const trafficRoutes = require('./routes/traffic.routes');
const i3AiRoutes = require('./routes/i3ai.routes');
const { createRtspSnapshotRouter } = require('./module/rtspSnapshotStream');
const { getClientSockets } = require('./socketState');
const authMiddleware = require('./middleware/auth.middleware');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
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
app.use(eMapLayoutRoutes);
app.use(areaLayoutRoutes);
app.use(trafficRoutes);
app.use(i3AiRoutes);
app.use(createRtspSnapshotRouter({ authMiddleware }));
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
    mqttGroups: socketState.mqttGroups,
    mqttServers: socketState.mqttServers,
    mqttDevices: socketState.mqttDeviceList,
    cameraDevices: socketState.cameraDevices,
    deviceCameraLinks: socketState.deviceCameraLinks,
    gridLayout: socketState.gridLayout,
    eMapLayout: socketState.eMapLayout,
    areaLayout: socketState.areaLayout,
  });
});

app.post('/api/v1/debug/save-events-report', (req, res) => {
  try {
    const payload = req.body;
    
    // Format timestamp
    const now = new Date();
    const timestampStr = now.toLocaleString('vi-VN');
    const fileTimestamp = now.toISOString().replace(/[:.]/g, '-');
    
    // Construct beautiful markdown report contents
    let mdContent = `# BÁO CÁO GIÁM SÁT SỰ KIỆN (EVENT MONITORING REPORT)\n\n`;
    mdContent += `* **Thời gian xuất báo cáo:** ${timestampStr}\n`;
    mdContent += `* **Trạng thái Socket FE-BE:** ${payload.socketConnected ? '🟢 ĐÃ KẾT NỐI' : '🔴 MẤT KẾT NỐI'}\n`;
    mdContent += `* **Cấu hình BE Target:** \`${payload.hostTarget}\`\n`;
    mdContent += `* **Tổng số log hệ thống ghi nhận:** ${payload.totalLogs}\n\n`;
    
    mdContent += `---\n\n`;
    
    // SVMS Servers Section
    mdContent += `## 1. DANH SÁCH SVMS SERVERS (${payload.totalSvmsServers})\n\n`;
    if (payload.svmsServers && payload.svmsServers.length > 0) {
      mdContent += `| Tên Server | Địa chỉ IP | Trạng thái | Số thiết bị |\n`;
      mdContent += `| :--- | :--- | :--- | :--- |\n`;
      payload.svmsServers.forEach(s => {
        const statusEmoji = s.status === 'ONLINE' ? '🟢 ONLINE' : '🔴 OFFLINE';
        mdContent += `| ${s.name} | \`${s.ip}\` | ${statusEmoji} | ${s.deviceCount} |\n`;
      });
    } else {
      mdContent += `*Không có SVMS Server nào được cấu hình.*\n`;
    }
    mdContent += `\n`;
    
    // MQTT Servers Section
    mdContent += `## 2. DANH SÁCH MQTT SERVERS (${payload.totalMqttServers})\n\n`;
    if (payload.mqttServers && payload.mqttServers.length > 0) {
      mdContent += `| Broker Host | Port | Trạng thái | Số thiết bị (Milesight) |\n`;
      mdContent += `| :--- | :--- | :--- | :--- |\n`;
      payload.mqttServers.forEach(s => {
        const statusEmoji = s.status === 'CONNECTED' ? '🟢 CONNECTED' : '🔴 DISCONNECTED';
        mdContent += `| \`${s.brokerHost}\` | ${s.brokerPort} | ${statusEmoji} | ${s.deviceCount} |\n`;
      });
    } else {
      mdContent += `*Không có MQTT Server nào được cấu hình.*\n`;
    }
    mdContent += `\n`;

    // Cameras Section
    mdContent += `## 3. DANH SÁCH CAMERA ĐỘC LẬP (${payload.totalCameras})\n\n`;
    if (payload.cameras && payload.cameras.length > 0) {
      mdContent += `| Tên Camera | Địa chỉ | Loại | Trạng thái |\n`;
      mdContent += `| :--- | :--- | :--- | :--- |\n`;
      payload.cameras.forEach(c => {
        const statusEmoji = c.status === 'connected' ? '🟢 CONNECTED' : '🔴 OFFLINE';
        mdContent += `| ${c.name} | \`${c.ip}\` | ${c.type} | ${statusEmoji} |\n`;
      });
    } else {
      mdContent += `*Không có camera độc lập nào được kết nối.*\n`;
    }
    mdContent += `\n`;

    // Connections Section
    mdContent += `## 4. KẾT NỐI CHUYỂN TIẾP (SEND/RECEIVE TARGETS)\n\n`;
    mdContent += `### Kết nối Gửi (Send Targets - ${payload.totalSendConnections}):\n`;
    if (payload.sendConnections && payload.sendConnections.length > 0) {
      mdContent += `| Địa chỉ target | Port | Giao thức | Trạng thái |\n`;
      mdContent += `| :--- | :--- | :--- | :--- |\n`;
      payload.sendConnections.forEach(c => {
        const statusEmoji = c.status === 'ONLINE' ? '🟢 ONLINE' : '🔴 OFFLINE';
        mdContent += `| \`${c.ip}\` | ${c.port} | ${c.protocol || 'Socket.IO'} | ${statusEmoji} |\n`;
      });
    } else {
      mdContent += `*Không có máy chủ nhận (Send Target) nào.*\n`;
    }
    mdContent += `\n`;
    mdContent += `* **Số lượng kết nối Nhận (Receive Connections):** ${payload.totalReceiveConnections}\n\n`;

    // Recent Logs Section
    mdContent += `## 5. CÁC SỰ KIỆN GẦN NHẤT (TỐI ĐA 20 SỰ KIỆN)\n\n`;
    if (payload.recentLogs && payload.recentLogs.length > 0) {
      mdContent += `| Thời gian | Nguồn log | Loại sự kiện | Nội dung chi tiết |\n`;
      mdContent += `| :--- | :--- | :--- | :--- |\n`;
      payload.recentLogs.forEach(l => {
        mdContent += `| ${l.time} | \`${l.source}\` | \`${l.type}\` | ${l.description} |\n`;
      });
    } else {
      mdContent += `*Chưa nhận được sự kiện nào trong phiên giám sát.*\n`;
    }
    mdContent += `\n`;
    
    // Save directory (docs/ under project root)
    const docsDir = path.join(__dirname, '..', '..', 'docs');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    
    const fileName = `events_report_${fileTimestamp}.md`;
    const filePath = path.join(docsDir, fileName);
    
    fs.writeFileSync(filePath, mdContent, 'utf8');
    
    res.json({
      success: true,
      fileName,
      filePath
    });
  } catch (error) {
    console.error('Error saving events report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
