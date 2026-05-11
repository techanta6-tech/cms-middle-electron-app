const express = require('express');
const axios = require('axios');
const { getClientSockets, servers, devices, connections, svmsServers, svmsDevices } = require('../../socketState');
const { getCMSBackendURL } = require('../../config');
const { notifyStatusToClients } = require('../../helpers/notify');
const authMiddleware = require('../../middleware/auth.middleware');
const connectivityMonitor = require('../../services/connectivity-monitor.service');


const router = express.Router();

/**
 * Hàm forward dữ liệu (server/devices) tới tất cả target server có mode 'send'.
 * Có retry logic khi gặp lỗi 401 (giống forwardWithRetry trong logs.routes).
 */
async function forwardToSendTargets(endpoint, data, extraHeaders = {}) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cms.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
  const sendTargets = connections.filter(c => c.mode === 'send');

  for (const conn of sendTargets) {
    const sendRequest = (token) =>
      axios.post(`${conn.url}${endpoint}`, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-sync-forwarded': 'true',
          ...extraHeaders
        },
        timeout: 5000
      });

    try {
      await sendRequest(conn.accessToken);
      if (conn.status !== 'connected') {
        conn.status = 'connected';
        notifyStatusToClients(conn.url, conn.mode, 'connected');
      }
    } catch (err) {
      if (err.response && err.response.status === 401) {
        try {
          const loginRes = await axios.post(`${conn.url}/api/v1/login`, {
            email: adminEmail,
            password: adminPass
          }, { timeout: 5000 });

          if (loginRes.data && loginRes.data.success && loginRes.data.data.accessToken) {
            conn.accessToken = loginRes.data.data.accessToken;
            await sendRequest(conn.accessToken);
            if (conn.status !== 'connected') {
              conn.status = 'connected';
              notifyStatusToClients(conn.url, conn.mode, 'connected');
            }
          } else {
            conn.status = 'disconnected';
            notifyStatusToClients(conn.url, conn.mode, 'disconnected');
          }
        } catch (loginErr) {
          console.error(`[FORWARD_AUTH_RETRY_FAIL] ${conn.url}: ${loginErr.message}`);
          conn.status = 'disconnected';
          notifyStatusToClients(conn.url, conn.mode, 'disconnected');
        }
      } else {
        console.error(`[FORWARD_FAIL] ${endpoint} to ${conn.url}: ${err.message}`);
        if (conn.status !== 'disconnected') {
          conn.status = 'disconnected';
          notifyStatusToClients(conn.url, conn.mode, 'disconnected');
        }
      }
    }
  }
}

// ─── Nhận thông tin server từ SVMS hoặc qua Sync ──────────────────────────────
/**
 * @route POST /api/v1/server
 * @description Receives server(s) info from SVMS (or another Middle BE).
 * Supports both single Object and Array.
 */
router.post('/api/v1/server', async (req, res) => {
  const clientSockets = getClientSockets();
  clientSockets.emit('test', {
    message: 'new server',
    data: req.body
  })
  const senderIp = (req.ip || '').replace('::ffff:', '');
  const dataArr = Array.isArray(req.body) ? req.body : [req.body];
  clientSockets.emit('new-server', dataArr);
  // TODO: BOOKMARK — logic phân biệt direct/forwarded, có thể sửa sau
  const isForwarded = req.headers['x-sync-forwarded'] === 'true';
  const serverType = isForwarded ? 'forwarded' : 'direct';

  for (const serverData of dataArr) {
    if (!serverData) continue;
    const serverId = serverData.id || serverData.serial || senderIp;
    const existing = servers.get(serverId);

    // Auto-reconnect: nếu server đã tồn tại và đang disconnected → connected
    const wasDisconnected = existing?.connectionStatus === 'disconnected';

    servers.set(serverId, {
      ...serverData,
      svms_ipv4_ip: serverData.svms_ipv4_ip || senderIp,
      sender_ip: senderIp,
      lastSeen: new Date().toISOString(),
      type: serverData.type || (existing?.type) || serverType,
      connectionStatus: 'connected', // Nhận được data → luôn connected
      lastLogReceived: serverData.lastLogReceived || (existing?.lastLogReceived) || new Date().toISOString(),
    });

    if (wasDisconnected) {
      console.log(`[CONNECTIVITY] ✅ Server ${serverId} auto-reconnected (server data received)`);
      clientSockets.emit('server-connection-status', { serverId, status: 'connected' });
    }

    // Đăng ký vào connectivity monitor
    connectivityMonitor.registerServer(serverId);
  }
  // ─── Lưu raw req.body vào svmsServers ─────────────────────────────────────────────────
  const svmsServerPayload = Array.isArray(req.body) ? req.body : [req.body];
  svmsServerPayload.forEach(item => {
    if (!item) return;
    const existing = svmsServers.findIndex(s => (s.id || s.serial) === (item.id || item.serial));
    const entry = { ...item, _receivedAt: new Date().toISOString() };
    if (existing !== -1) {
      svmsServers[existing] = entry;
    } else {
      svmsServers.push(entry);
      if (svmsServers.length > 200) svmsServers.shift();
    }
  });
  clientSockets.emit('new-svms-servers', svmsServers);


  clientSockets.emit('receive-server-information', {
    allServers: Object.fromEntries(servers)
  });

  // Forward tới CMS BE (nếu có)
  const CMS_BE_URL = getCMSBackendURL();
  if (CMS_BE_URL) {
    try {
      await axios.post(`${CMS_BE_URL}/api/v1/server`, req.body, { timeout: 5000 });
    } catch (err) {
      console.error(`[SERVER_FORWARD_FAIL] ${err.message}`);
    }
  }
  // Forward tới tất cả target server có mode 'send'
  forwardToSendTargets('/api/v1/server', {
    ...req.body,
    svms_ipv4_ip: req.body.svms_ipv4_ip || senderIp,
  });
  return res.status(200).send({ success: true });
});

// ─── Nhận danh sách devices từ SVMS hoặc qua Sync ───────────────────────────
/**
 * @route POST /api/v1/devices
 * @description Receives device lists from SVMS (or another Middle BE).
 * Supports both single Object and Array.
 */
router.post('/api/v1/devices', async (req, res) => {
  const clientSockets = getClientSockets();
  const senderIp = (req.ip || '').replace('::ffff:', '');
  const dataArr = Array.isArray(req.body) ? req.body : [req.body];
  clientSockets.emit('test', {
    message: 'new device',
    data: req.body
  });
  for (const item of dataArr) {
    if (!item) continue;
    const { server, devices: deviceList } = item;
    const serverId = server?.server_id || server?.serial || senderIp;
    const existingEntry = devices.get(serverId);

    // Tách ip:port từ device.ip field (SVMS gửi dạng "192.168.1.202:2000")
    const parsedDevices = (deviceList || []).map(d => {
      // Nếu đã có device_ip (từ CMS khác forward), giữ nguyên
      if (d.device_ip) return { ...d, connectionStatus: 'connected', lastLogReceived: d.lastLogReceived || new Date().toISOString() };

      const [deviceIp, devicePortStr] = (d.ip || '').split(':');
      return {
        ...d,
        device_ip: deviceIp || '',
        device_port: devicePortStr ? parseInt(devicePortStr, 10) : null,
        connectionStatus: 'connected', // Nhận được data → luôn connected
        lastLogReceived: d.lastLogReceived || new Date().toISOString(),
      };
    });

    // Auto-reconnect: nếu có device nào đang disconnected → emit connected
    if (existingEntry) {
      for (const newD of parsedDevices) {
        const oldD = existingEntry.devices.find(od => String(od.index) === String(newD.index));
        if (oldD && oldD.connectionStatus === 'disconnected') {
          console.log(`[CONNECTIVITY] ✅ Device ${serverId}::${newD.index} auto-reconnected (device data received)`);
          clientSockets.emit('device-connection-status', { serverId, deviceIndex: newD.index, status: 'connected' });
        }
      }
    }

    // Auto-reconnect server nếu đang disconnected
    const serverEntry = servers.get(serverId);
    if (serverEntry && serverEntry.connectionStatus === 'disconnected') {
      console.log(`[CONNECTIVITY] ✅ Server ${serverId} auto-reconnected (device data received)`);
      serverEntry.connectionStatus = 'connected';
      clientSockets.emit('server-connection-status', { serverId, status: 'connected' });
    }

    devices.set(serverId, {
      server,
      devices: parsedDevices,
      sender_ip: senderIp,
      lastSeen: new Date().toISOString()
    });

    // Đăng ký devices vào connectivity monitor (chỉ cho direct servers)
    connectivityMonitor.registerDevices(serverId, parsedDevices);
  }

  // ─── Lưu raw req.body vào svmsDevices ────────────────────────────────────────────────
  const svmsDevicesPayload = Array.isArray(req.body) ? req.body : [req.body];
  svmsDevicesPayload.forEach(item => {
    if (!item) return;
    const itemServerId = item.server?.server_id || item.server?.serial || senderIp;
    const existing = svmsDevices.findIndex(d => (d.server?.server_id || d.server?.serial) === itemServerId);
    const entry = { ...item, _receivedAt: new Date().toISOString() };
    if (existing !== -1) {
      svmsDevices[existing] = entry;
    } else {
      svmsDevices.push(entry);
      if (svmsDevices.length > 200) svmsDevices.shift();
    }
  });
  clientSockets.emit('new-svms-devices', svmsDevices);

  // Emit toàn bộ devices hiện tại tới FE một lần
  clientSockets.emit('receive-devices-information', {
    allDevices: Object.fromEntries(devices)
  });

  // Forward tới CMS BE (nếu có)
  const CMS_BE_URL = getCMSBackendURL();
  if (CMS_BE_URL) {
    try {
      await axios.post(`${CMS_BE_URL}/api/v1/devices`, req.body, { timeout: 5000 });
    } catch (err) {
      console.error(`[DEVICES_FORWARD_FAIL] ${err.message}`);
    }
  }
  forwardToSendTargets('/api/v1/devices', req.body);
  return res.status(200).send({ success: true });
});


/**
 * Gửi toàn bộ servers và devices hiện có sang một target server cụ thể.
 * Được gọi sau khi healthcheck thành công ở create-connection.
 * @param {string} url - URL của target server (ví dụ: http://192.168.1.66:5050)
 * @param {string} accessToken - Bearer token để xác thực với target
 */
async function syncDataToTarget(url, accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'x-sync-forwarded': 'true' // Đánh dấu đây là dữ liệu sync ngang hàng để chặn loop
  };

  // 1. Gửi TẤT CẢ servers trong 1 array
  if (servers.size > 0) {
    // Đánh dấu server type = 'direct'
    const serversArray = Array.from(servers.values()).map(server => ({
      ...server,
      type: 'forwarded'
    }));
    try {
      await axios.post(`${url}/api/v1/server`, serversArray, { headers, timeout: 5000 });
      console.log(`[SYNC_DATA] Sent ${serversArray.length} servers inside 1 array to ${url}`);
    } catch (err) {
      console.error(`[SYNC_DATA_ERR] Failed to send servers array to ${url}: ${err.message}`);
    }
  }

  // 2. Gửi TẤT CẢ devices trong 1 array
  if (devices.size > 0) {
    const devicesArray = Array.from(devices.values());
    try {
      await axios.post(`${url}/api/v1/devices`, devicesArray, { headers, timeout: 5000 });
      console.log(`[SYNC_DATA] Sent ${devicesArray.length} device packages inside 1 array to ${url}`);
    } catch (err) {
      console.error(`[SYNC_DATA_ERR] Failed to send devices array to ${url}: ${err.message}`);
    }
  }
}

module.exports = { router, syncDataToTarget, forwardToSendTargets };
