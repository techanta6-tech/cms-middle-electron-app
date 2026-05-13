/**
 * ─── SIMULATE INPUT SCRIPT ───────────────────────────────────────────────────
 * Giả lập 1 server + 1 device, gửi log mỗi 5 giây vào BE.
 * Dùng cho mục đích thiết kế giao diện (UI design mode).
 *
 * Cách dùng:
 *   node scripts/simulate-input.js
 *
 * Yêu cầu: BE đang chạy tại http://localhost:5050
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BE_URL = 'http://localhost:5050';
const INTERVAL = 5000; // ms giữa mỗi log

// Thông tin giả lập
const FAKE_SERVER = {
  id: 'SIM-SERVER-001',
  serial: 'SIM-SERVER-001',
  server_id: 'SIM-SERVER-001',
  server_ip: '192.168.99.1',
  server_name: '(Giả lập) Main SVMS Server',
  version: '1.0.0-sim',
  location: 'Phòng Lab - Tầng 3',
  day: 1,
  month: 1,
  year: 2025,
  svms_ipv4_ip: '192.168.99.1',
};

const FAKE_DEVICE = {
  index: 1,
  name: '(Giả lập) Camera Hành Lang',
  ip: '192.168.99.101:2000',
  type: 'camera',
  device_ip: '192.168.99.101',
  device_port: 2000,
  // ← MARK: set này là 'connected'. Khi test disconnect, đổi thành 'disconnected'
  // connectionStatus: 'disconnected',
};

const FAKE_DEVICES_PAYLOAD = {
  server: {
    serial: FAKE_SERVER.serial,
    server_id: FAKE_SERVER.id,
  },
  devices: [FAKE_DEVICE],
};

// 'ai.alarm.crosswire.all',
// 'ai.alarm.direction.all',
// 'ai.alarm.missing.all',
// 'videoloss',

// ─── LOG TEMPLATES ────────────────────────────────────────────────────────────
const LOG_TYPES = [
  { log_type: 'ai.alarm.crosswire.all', description: String(Math.floor(Math.random() * 100)) },
  { log_type: 'ai.alarm.direction.all', description: 'Intrusion alert triggered' },
  { log_type: 'ai.alarm.missing.all', description: 'Camera reconnected after brief offline' },
  { log_type: 'videoloss', description: 'Unknown face detected' },
  { log_type: 'ai.alarm.crosswire.all', description: String(Math.floor(Math.random() * 100)) },
  { log_type: 'motion', description: String(Math.floor(Math.random() * 100)) },
  { log_type: 'motion', description: String(Math.floor(Math.random() * 100)) },
];

let logSequence = 0;

function buildLogPayload() {
  const template = LOG_TYPES[logSequence % LOG_TYPES.length];
  logSequence++;

  return {
    server: {
      serial: FAKE_SERVER.serial,
      server_id: FAKE_SERVER.id,
    },
    time: Math.floor(Date.now() / 1000),
    server_id: FAKE_SERVER.id,
    device_index: FAKE_DEVICE.index,
    device_ip: FAKE_DEVICE.ip,
    device_type: FAKE_DEVICE.type,
    device_name: FAKE_DEVICE.name,
    log_type: template.log_type,
    description: template.description,
    snapshot: '', // ← bỏ trống theo yêu cầu
  };
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
let accessToken = null;

async function login() {
  try {
    const res = await axios.post(`${BE_URL}/api/v1/login`, {
      email: 'admin@cms.com',
      password: 'admin1234',
    }, { timeout: 5000 });

    if (res.data?.success && res.data?.data?.accessToken) {
      accessToken = res.data.data.accessToken;
      console.log('[SIM] ✅ Login thành công');
      return true;
    } else {
      console.error('[SIM] ❌ Login thất bại: không có token');
      return false;
    }
  } catch (err) {
    console.error('[SIM] ❌ Login error:', err.message);
    return false;
  }
}

function authHeaders() {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

// ─── PUSH FUNCTIONS ───────────────────────────────────────────────────────────

async function pushServer() {
  try {
    await axios.post(`${BE_URL}/api/v1/server`, FAKE_SERVER, {
      headers: authHeaders(),
      timeout: 5000,
    });
    console.log('[SIM] 📡 Server info pushed');
  } catch (err) {
    console.warn('[SIM] ⚠️  Push server failed:', err.message);
  }
}

async function pushDevices() {
  try {
    await axios.post(`${BE_URL}/api/v1/devices`, FAKE_DEVICES_PAYLOAD, {
      headers: authHeaders(),
      timeout: 5000,
    });
    console.log('[SIM] 🖥️  Devices pushed');
  } catch (err) {
    console.warn('[SIM] ⚠️  Push devices failed:', err.message);
  }
}

async function pushLog() {
  const payload = buildLogPayload();
  try {
    await axios.post(`${BE_URL}/api/v1/logs`, payload, {
      headers: authHeaders(),
      timeout: 5000,
    });
    console.log(`[SIM] 📝 Log #${logSequence} sent: ${payload.log_type}`);
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn('[SIM] 🔄 Token hết hạn, re-login...');
      await login();
    } else {
      console.warn('[SIM] ⚠️  Push log failed:', err.message);
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[SIM] 🚀 Simulate input bắt đầu — BE: ${BE_URL}`);
  console.log(`[SIM]    Server: ${FAKE_SERVER.server_name} (${FAKE_SERVER.id})`);
  console.log(`[SIM]    Device: ${FAKE_DEVICE.name} @ ${FAKE_DEVICE.ip}`);
  console.log(`[SIM]    Log interval: ${INTERVAL / 1000}s\n`);

  const ok = await login();
  if (!ok) {
    console.error('[SIM] Không thể login vào BE. Thoát.');
    process.exit(1);
  }

  // Push server và device info lần đầu
  await pushServer();
  await pushDevices();

  // Gửi log định kỳ
  setInterval(pushLog, INTERVAL);
}

main();
