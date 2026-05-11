// ─── CONNECTIVITY MONITOR SERVICE ─────────────────────────────────────────────
// Timeout-based connectivity detection cho servers và devices.
// - Forwarded servers: sau 30s không nhận log → TCP ping SVMS ports
// - Direct servers' devices: sau 30s device không gửi log → TCP ping SERVER qua SVMS ports
//   (không ping trực tiếp vào device). Nếu server fail → disconnect server + ALL devices.
// ──────────────────────────────────────────────────────────────────────────────

const net = require('net');
const axios = require('axios');
const { servers, devices, getClientSockets } = require('../socketState');
const { SVMS_PORT_LIST, CONNECTIVITY_TIMEOUT_MS, port: localPort } = require('../config');

// Internal timer stores
const serverTimers = new Map();   // Map<serverId, NodeJS.Timeout> — cho forwarded servers
const deviceTimers = new Map();   // Map<"serverId::deviceIndex", NodeJS.Timeout> — cho direct devices

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * Gọi khi nhận log — reset timer cho server hoặc device tương ứng.
 * @param {string} serverId - server_id từ log payload
 * @param {number|string|null} deviceIndex - device_index từ log payload (top-level)
 */
function onLogReceived(serverId, deviceIndex) {
  const serverEntry = servers.get(serverId);
  if (!serverEntry) return;

  if (serverEntry.type === 'forwarded') {
    resetServerTimer(serverId);
  } else if (serverEntry.type === 'direct' && deviceIndex != null) {
    resetDeviceTimer(serverId, deviceIndex);
  }
}

/**
 * Đăng ký server mới vào monitor. Chỉ khởi tạo timer cho forwarded servers.
 * @param {string} serverId
 */
function registerServer(serverId) {
  const serverEntry = servers.get(serverId);
  if (serverEntry && serverEntry.type === 'forwarded') {
    console.log(`[CONNECTIVITY] Registered forwarded server timer: ${serverId}`);
    resetServerTimer(serverId);
  }
}

/**
 * Đăng ký devices vào monitor. Chỉ cho direct servers.
 * @param {string} serverId
 * @param {Array} deviceList - danh sách devices đã parsed (có device_ip, device_port)
 */
function registerDevices(serverId, deviceList) {
  const serverEntry = servers.get(serverId);
  if (!serverEntry || serverEntry.type !== 'direct') return;

  for (const device of deviceList) {
    if (device.index != null) {
      console.log(`[CONNECTIVITY] Registered device timer: ${serverId}::${device.index}`);
      resetDeviceTimer(serverId, device.index);
    }
  }
}

/**
 * Cleanup tất cả timers khi server bị xóa khỏi state.
 * @param {string} serverId
 */
function clearAllTimers(serverId) {
  // Clear server timer
  const srvTimer = serverTimers.get(serverId);
  if (srvTimer) {
    clearTimeout(srvTimer);
    serverTimers.delete(serverId);
  }

  // Clear tất cả device timers thuộc server này
  for (const [key, timer] of deviceTimers.entries()) {
    if (key.startsWith(`${serverId}::`)) {
      clearTimeout(timer);
      deviceTimers.delete(key);
    }
  }

  console.log(`[CONNECTIVITY] Cleared all timers for server: ${serverId}`);
}

// ─── FORWARDED SERVER TIMER ──────────────────────────────────────────────────

/**
 * Timer cho FORWARDED server.
 * Khi 30s không nhận log → TCP ping SVMS ports → nếu tất cả fail → disconnected
 * Nếu bất kỳ port nào alive → giữ connected, reset timer vô hạn
 */
function resetServerTimer(serverId) {
  const existing = serverTimers.get(serverId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    const serverEntry = servers.get(serverId);
    if (!serverEntry) {
      serverTimers.delete(serverId);
      return;
    }

    const senderIp = serverEntry.sender_ip;
    if (!senderIp) {
      console.warn(`[CONNECTIVITY] No sender IP for forwarded server ${serverId}, skipping check`);
      return;
    }

    const senderPort = serverEntry.port || 5050; // Dự phòng fallback về 5050 nếu không biết port
    const myIp = process.env.LOCAL_IP || '127.0.0.1';

    console.log(`[CONNECTIVITY] Checking forwarded server ${serverId} from sender ${senderIp}:${senderPort} via healthcheck`);

    let isLogged = false;
    try {
      const response = await axios.get(`http://${senderIp}:${senderPort}/healthcheck`, {
        params: { ip: myIp, port: localPort },
        timeout: 5000
      });
      if (response.data && response.data.isLogged) {
        isLogged = true;
      }
    } catch (err) {
      console.log(`[CONNECTIVITY] Healthcheck to sender ${senderIp} failed: ${err.message}`);
    }

    if (isLogged) {
      // Sender vẫn tồn tại kết nối tới receiver → giữ connected, reset timer
      console.log(`[CONNECTIVITY] Forwarded server ${serverId} still logged in sender, resetting timer`);
      resetServerTimer(serverId);
    } else {
      // Healthcheck fail HOẶC returns isLogged = false → disconnected
      if (serverEntry.connectionStatus !== 'disconnected') {
        console.log(`[CONNECTIVITY] ❌ Forwarded server ${serverId} DISCONNECTED (sender removed connection or unreachable)`);
        serverEntry.connectionStatus = 'disconnected';
        emitServerStatus(serverId, 'disconnected');

        // Disconnect TẤT CẢ devices thuộc forwarded server này
        const deviceEntry = devices.get(serverId);
        if (deviceEntry && deviceEntry.devices) {
          for (const d of deviceEntry.devices) {
            if (d.connectionStatus !== 'disconnected') {
              d.connectionStatus = 'disconnected';
              emitDeviceStatus(serverId, d.index, 'disconnected');
            }
          }
        }

        forwardStatusUpdate(serverId);
      }
    }
  }, CONNECTIVITY_TIMEOUT_MS);

  serverTimers.set(serverId, timer);
}

// ─── DIRECT DEVICE TIMER ─────────────────────────────────────────────────────

/**
 * Timer cho device của DIRECT server.
 * Khi 30s device không gửi log → TCP ping SERVER (không phải device) qua SVMS ports.
 * Nếu server unreachable → disconnect server + TẤT CẢ devices.
 * Nếu server alive → reset timer (device chỉ silent, server vẫn hoạt động).
 */
function resetDeviceTimer(serverId, deviceIndex) {
  const timerKey = `${serverId}::${deviceIndex}`;
  const existing = deviceTimers.get(timerKey);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    const deviceEntry = devices.get(serverId);
    if (!deviceEntry) {
      deviceTimers.delete(timerKey);
      return;
    }

    const device = deviceEntry.devices.find(d => String(d.index) === String(deviceIndex));
    if (!device) {
      deviceTimers.delete(timerKey);
      return;
    }

    // Lấy IP của server (không phải device)
    const serverEntry = servers.get(serverId);
    if (!serverEntry) {
      deviceTimers.delete(timerKey);
      return;
    }

    const serverIp = serverEntry.svms_ipv4_ip || serverEntry.server_ip || serverEntry.sender_ip;
    if (!serverIp) {
      console.warn(`[CONNECTIVITY] No server IP for ${serverId}, skipping device check`);
      return;
    }

    console.log(`[CONNECTIVITY] Device ${serverId}::${deviceIndex} silent 30s — checking SERVER (${serverIp}) via SVMS ports: ${SVMS_PORT_LIST.join(', ')}`);

    // TCP ping SERVER qua SVMS ports (giống forwarded server logic)
    const results = await Promise.all(
      SVMS_PORT_LIST.map(port => tcpPing(serverIp, port))
    );
    const anyAlive = results.some(ok => ok);

    if (anyAlive) {
      // Server vẫn alive, device chỉ silent → reset timer
      console.log(`[CONNECTIVITY] Server ${serverId} still alive, device ${deviceIndex} just silent — resetting timer`);
      resetDeviceTimer(serverId, deviceIndex);
    } else {
      // Server unreachable → disconnect server + TẤT CẢ devices
      console.log(`[CONNECTIVITY] ❌ Server ${serverId} UNREACHABLE — disconnecting server + ALL devices`);

      // Disconnect server
      if (serverEntry.connectionStatus !== 'disconnected') {
        serverEntry.connectionStatus = 'disconnected';
        emitServerStatus(serverId, 'disconnected');
      }

      // Disconnect TẤT CẢ devices
      for (const d of deviceEntry.devices) {
        if (d.connectionStatus !== 'disconnected') {
          d.connectionStatus = 'disconnected';
          emitDeviceStatus(serverId, d.index, 'disconnected');
        }
      }

      // Clear tất cả device timers của server này (không cần check thêm)
      for (const [key, t] of deviceTimers.entries()) {
        if (key.startsWith(`${serverId}::`)) {
          clearTimeout(t);
          deviceTimers.delete(key);
        }
      }

      forwardStatusUpdate(serverId);
    }
  }, CONNECTIVITY_TIMEOUT_MS);

  deviceTimers.set(timerKey, timer);
}

// ─── TCP PING ────────────────────────────────────────────────────────────────

/**
 * TCP ping — kiểm tra ip:port có mở không (timeout 3s).
 * @param {string} ip
 * @param {number} port
 * @param {number} timeout - ms
 * @returns {Promise<boolean>}
 */
function tcpPing(ip, port, timeout = 3000) {
  return new Promise((resolve) => {
    if (!ip || !port) return resolve(false);
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, ip);
  });
}

// ─── EMIT TO FE ──────────────────────────────────────────────────────────────

/**
 * Emit server connection status change tới tất cả FE clients.
 */
function emitServerStatus(serverId, status) {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    const serverEntry = servers.get(serverId);
    clientSockets.emit('server-connection-status', {
      serverId,
      connectionStatus: status,
      serverName: serverEntry?.server_name || serverId,
      type: serverEntry?.type || 'unknown',
    });

    // Cũng emit lại toàn bộ servers để FE sync
    clientSockets.emit('receive-server-information', {
      allServers: Object.fromEntries(servers)
    });
  }
}

/**
 * Emit device connection status change tới tất cả FE clients.
 */
function emitDeviceStatus(serverId, deviceIndex, status) {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('device-connection-status', {
      serverId,
      deviceIndex,
      connectionStatus: status,
    });

    // Cũng emit lại toàn bộ devices để FE sync
    clientSockets.emit('receive-devices-information', {
      allDevices: Object.fromEntries(devices)
    });
  }
}

// ─── FORWARD STATUS TO SEND TARGETS ──────────────────────────────────────────

/**
 * Khi trạng thái server/device thay đổi, forward data cập nhật tới tất cả send targets.
 * Dùng lazy import để tránh circular dependency với server.routes.js.
 */
async function forwardStatusUpdate(serverId) {
  // Lazy import
  const { forwardToSendTargets } = require('../routes/svms/server.routes');

  const serverEntry = servers.get(serverId);
  const deviceEntry = devices.get(serverId);

  if (serverEntry) {
    try {
      await forwardToSendTargets('/api/v1/server', serverEntry);
      console.log(`[CONNECTIVITY] Forwarded server status update for ${serverId} to send targets`);
    } catch (err) {
      console.error(`[CONNECTIVITY] Failed to forward server status: ${err.message}`);
    }
  }
  if (deviceEntry) {
    try {
      await forwardToSendTargets('/api/v1/devices', deviceEntry);
      console.log(`[CONNECTIVITY] Forwarded device status update for ${serverId} to send targets`);
    } catch (err) {
      console.error(`[CONNECTIVITY] Failed to forward device status: ${err.message}`);
    }
  }
}

// ─── DEBUG ────────────────────────────────────────────────────────────────────

/**
 * Trả về trạng thái hiện tại của tất cả timers (cho debug).
 */
function getTimerStats() {
  return {
    serverTimers: Array.from(serverTimers.keys()),
    deviceTimers: Array.from(deviceTimers.keys()),
  };
}

module.exports = {
  onLogReceived,
  registerServer,
  registerDevices,
  clearAllTimers,
  getTimerStats,
};
