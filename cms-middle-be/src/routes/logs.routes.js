const express = require('express');
const axios = require('axios');
const { getClientSockets, connections, servers, devices, svmsDeviceFeatures } = require('../socketState');
const { notifyStatusToClients } = require('../helpers/notify');
const authMiddleware = require('../middleware/auth.middleware');
const connectivityMonitor = require('../services/connectivity-monitor.service');
const svmsEventRegistry = require('../services/svmsEventRegistry.service');

// __other_events__: pseudo-key đặc biệt, mặc định bật (không lưu trong registry)
const OTHER_EVENTS_DEFAULT_ON = true;

const router = express.Router();

/**
 * Hàm hỗ trợ re-login và retry nếu gặp 401
 */
async function forwardWithRetry(conn, logData) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cms.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';



  const sendRequest = (token) => {
    return axios.post(`${conn.url}/api/v1/logs`, logData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-sync-forwarded': 'true'
      },
      timeout: 5000
    });
  };

  try {
    // Thử gửi log với token hiện có
    await sendRequest(conn.accessToken);
    return true;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      console.log(`[AUTH_RETRY] Token expired for ${conn.url}, attempting re-login...`);
      try {
        const loginRes = await axios.post(`${conn.url}/api/v1/login`, {
          email: adminEmail,
          password: adminPass
        }, { timeout: 5000 });


        if (loginRes.data && loginRes.data.success && loginRes.data.data.accessToken) {
          conn.accessToken = loginRes.data.data.accessToken;
          console.log(`[AUTH_RETRY] Re-login successful for ${conn.url}`);
          // Thử lại lần cuối
          await sendRequest(conn.accessToken);
          return true;
        }
      } catch (loginErr) {
        console.error(`[AUTH_RETRY_FAIL] Could not re-login to ${conn.url}: ${loginErr.message}`);
      }
    }
    throw err; // Ném lỗi gốc nếu không phải 401 hoặc retry thất bại
  }
}

// ─── Nhận log từ nguồn gốc (Camera, VMS, etc.) ──────────────────────────────
/**
 * @route POST /api/v1/logs
 * @description Receives logs from sources, broadcasts to FE clients, and forwards to registered target servers.
 */
router.post('/api/v1/logs', async (req, res) => {
  // console.log('received requets from :', req.originalUrl)  
  const clientSockets = getClientSockets();

  if (req.body && !req.body.sender_ip) {
    req.body.sender_ip = (req.socket?.remoteAddress || req.ip || '').replace('::ffff:', '');
  }

  const logBodyForFrontend = req.body || {};
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    originalUrl: req.originalUrl,
    statusCode: res.statusCode,
    ip: req.ip,
    body: logBodyForFrontend,
  };

  // ─── CONNECTIVITY: AUTO-RECONNECT & TIMER RESET ────────────────────────────
  const logBody = logBodyForFrontend;
  const serverId = logBody.server_id || logBody.server?.server_id;
  const deviceIndex = logBody.device_index;

  if (serverId) {
    const now = new Date().toISOString();

    // Auto-reconnect server nếu đang disconnected
    const serverEntry = servers.get(serverId);
    if (serverEntry && serverEntry.connectionStatus === 'disconnected') {
      console.log(`[CONNECTIVITY] ✅ Server ${serverId} auto-reconnected (log received)`);
      serverEntry.connectionStatus = 'connected';
      serverEntry.lastLogReceived = now;
    } else if (serverEntry) {
      serverEntry.lastLogReceived = now;
    }

    // Auto-reconnect device nếu đang disconnected
    if (deviceIndex != null) {
      const deviceEntry = devices.get(serverId);
      if (deviceEntry) {
        const device = deviceEntry.devices.find(d => String(d.index) === String(deviceIndex));
        if (device) {
          if (device.connectionStatus === 'disconnected') {
            console.log(`[CONNECTIVITY] ✅ Device ${serverId}::${deviceIndex} auto-reconnected (log received)`);
            device.connectionStatus = 'connected';
          }
          device.lastLogReceived = now;
        }
      }
    }

    // Reset 30s timer
    connectivityMonitor.onLogReceived(serverId, deviceIndex);
  }

  // ─── SVMS Event Filtering + Auto-discovery ──────────────────────────────────
  // Luôn áp dụng lọc, kể cả khi chưa có cấu hình trong svmsDeviceFeatures.
  if (serverId && deviceIndex != null) {
    const logType = (logBodyForFrontend.log_type || '').toLowerCase();
    if (logType) {
      // Auto-discover: nếu event chưa có trong registry → bổ sung và notify FE
      const isNewEvent = svmsEventRegistry.discoverEvent(logType);
      if (isNewEvent) {
        clientSockets.emit('update-svms-known-events', svmsEventRegistry.getEvents());
      }

      const deviceEntry = svmsDeviceFeatures.find(
        e => e.serverId === serverId && String(e.deviceIndex) === String(deviceIndex)
      );
      const feats = deviceEntry ? (deviceEntry.features || {}) : {};

      // isKnown = event nằm trong registry (đã biết trước hoặc vừa được discover)
      const knownTypesSet = svmsEventRegistry.getKnownTypesSet();
      const isKnown = knownTypesSet.has(logType);

      if (isKnown) {
        // Event quen thuộc: ưu tiên cấu hình của user, fallback về default_enabled từ registry
        const enabled = feats[logType] !== undefined
          ? !!feats[logType]
          : svmsEventRegistry.getDefaultEnabled(logType);
        if (!enabled) {
          console.log(`[SVMS] Filtered event '${logType}' for device ${serverId}::${deviceIndex}`);
          return res.status(200).send({ success: true });
        }
      } else {
        // Event lạ (chưa trong registry): kiểm tra __other_events__, mặc định true
        const otherEnabled = feats['__other_events__'] !== undefined
          ? !!feats['__other_events__']
          : OTHER_EVENTS_DEFAULT_ON;
        if (!otherEnabled) {
          console.log(`[SVMS] Filtered unknown event '${logType}' (__other_events__ disabled) for ${serverId}::${deviceIndex}`);
          return res.status(200).send({ success: true });
        }
      }
    }
  }


  // 1. Phát dữ liệu cho các Client của mình (Frontend) qua Socket.IO
  clientSockets.emit('receive-log', logData);

  // Track receivedCount và server_id
  const senderIp = (req.ip || '').replace('::ffff:', '');
  connections.forEach(entry => {
    // console.log('entry still work', entry)
    if (entry.ip === senderIp) {
      entry.receivedCount = (entry.receivedCount || 0) + 1;
      if ((!entry.server_id || entry.server_id === 'PENDING') && req.body?.server?.server_id) {
        entry.server_id = req.body.server.server_id + '-' + (req.body.server.serial || '');
      }
    }
  });

  const sendTargets = connections.filter(c => c.mode === 'send').filter(c => c.status === 'connected');

  // Trả về thành công ngay lập tức để không block phía gửi
  res.status(200).send({ success: true });

  // Xử lý forward không đồng bộ (background)
  (async () => {
    let sentServerList = [];
    await Promise.allSettled(sendTargets.map(async conn => {
      try {
        await forwardWithRetry(conn, req.body);
        conn.sentCount = (conn.sentCount || 0) + 1;
        sentServerList.push(conn.url);
        if (conn.status !== 'connected') {
          conn.status = 'connected';
          notifyStatusToClients(conn.url, conn.mode, 'connected');
        }
      } catch (err) {
        console.error(`  ├─ [FORWARD_FAIL] ${conn.url}: ${err.message}`);
        if (conn.status !== 'disconnected') {
          conn.status = 'disconnected';
          notifyStatusToClients(conn.url, conn.mode, 'disconnected');
        }
      }
    }));
    clientSockets.emit('log-dispatched', { timestamp: logData.timestamp, sentServerList });
  })();
});

module.exports = router;