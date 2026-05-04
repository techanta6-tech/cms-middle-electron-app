const path = require('path');
const { cameraDevices, getClientSockets } = require('../socketState');
let CameraDevice;
let _cameraModuleSource = 'DummyCamera'; // track which module is loaded
try {
  if (process.pkg) {
    // Production: cameraModule.js nằm cạnh file exe
    const mod = require(path.join(path.dirname(process.execPath), 'cameraModule.js'));
    CameraDevice = mod.CameraDevice;
    _cameraModuleSource = 'pkg/cameraModule.js';
  } else {
    // Dev: cms-middle-be/src/services/ → ../../../ = repo root
    const mod = require('../../../cameraModule');
    CameraDevice = mod.CameraDevice;
    _cameraModuleSource = 'dev/cameraModule.js';
  }
  console.log(`[Cameras-Service] ✅ cameraModule loaded from: ${_cameraModuleSource}`);
} catch (err) {
  console.warn('[Cameras-Service] ❌ cameraModule load failed:', err.message);
  console.warn(`[Cameras-Service] Using DummyCamera (snapshots will return null)`);
  CameraDevice = class DummyCamera {
    constructor() { this.initialized = true; }
    connectCamera() { return Promise.resolve({ online: false, error: 'cameraModule not available' }); }
    captureSnapshotBase64() { return Promise.resolve(null); }
  };
}

async function addCameraDevice(deviceConfig) {
  const { name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl } = deviceConfig;

  const id = `cam-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const baseWritableDir = process.env.USER_DATA_PATH || process.cwd();
  const snapshotDir = path.join(baseWritableDir, 'snapshots');
  const isPackaged = process.env.IS_PACKAGED === 'true' || process.pkg;
  const sdkPath = isPackaged
    ? path.join(path.dirname(process.execPath), 'module', 'sunell')
    : path.join(__dirname, '..', '..', '..', 'module', 'sunell'); // fixed path to sdk

  const device = {
    id,
    name: name || `Camera ${id.slice(-4)}`,
    type: type || 'sunell',
    cameraIp,
    cameraPort: cameraPort || 30001,
    cameraUser: cameraUser || 'admin',
    cameraPass: cameraPass || 'admin1234',
    rtspUrl,
    snapshotDir,
    sdkPath,
    status: type === 'sunell' ? 'connecting' : 'ready',
    handle: null,
    instance: null
  };

  cameraDevices.push(device);
  console.log(`[Camera-Device] Added device '${id}' (${type})`);

  // Khởi tạo instance cho TẤT CẢ các loại để gọi được captureSnapshotBase64
  device.instance = new CameraDevice({
    id,
    rtspUrl,
    snapshotDir,
    sdkPath,
    cameraIp,
    cameraPort: cameraPort || 30001,
    cameraUser: cameraUser || 'admin',
    cameraPass: cameraPass || 'admin1234',
    logger: (direction, label, data) => {
      const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      const arrow = direction === 'IN' ? '⬇️' : '⬆️';
      const msg = `[${ts}] ${arrow} | [${id}] ${label}` + (data !== undefined ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}` : '');
      console.log(msg);
      
      const sockets = getClientSockets();
      if (sockets) {
        sockets.emit('debug-camera-snapshot', { time: new Date().toISOString(), message: msg });
      }
    },
    onAlarm: (payload) => {
      // Tương lai: broadcast websocket nếu cần
      console.log(`[Camera-${id}] Báo động SDK:`, payload.substring(0, 100));
    }
  });

  let sdkResult = null;
  if (type === 'sunell') {
    try {
      sdkResult = await device.instance.connectCamera();
      device.status = sdkResult.online ? 'connected' : 'error';
      device.handle = sdkResult.handle || null;
      console.log(`[Camera-Device] SDK connect result for '${id}':`, sdkResult);
    } catch (err) {
      device.status = 'error';
      sdkResult = { online: false, error: err.message || String(err) };
      console.error(`[Camera-Device] SDK connect error for '${id}':`, err);
    }
  }

  _emitCamerasUpdate();
  return { success: true, device: _sanitizeDevice(device), sdkResult };
}

function removeCameraDevice(deviceId) {
  const idx = cameraDevices.findIndex(d => d.id === deviceId);
  if (idx === -1) return { success: false, error: 'Device not found' };

  // TODO: Nếu là sunell, gọi disconnect SDK nếu SDK hỗ trợ
  cameraDevices.splice(idx, 1);
  console.log(`[Camera-Device] Removed device '${deviceId}'`);
  _emitCamerasUpdate();
  return { success: true };
}

function updateCameraDevice(deviceId, updates) {
  const device = cameraDevices.find(d => d.id === deviceId);
  if (!device) return { success: false, error: 'Device not found' };

  if (updates.name !== undefined) device.name = updates.name;
  if (updates.rtspUrl !== undefined) {
    device.rtspUrl = updates.rtspUrl;
    if (device.instance) device.instance.rtspUrl = updates.rtspUrl;
  }
  if (updates.cameraIp !== undefined) {
    device.cameraIp = updates.cameraIp;
    if (device.instance) device.instance.cameraIp = updates.cameraIp;
  }
  if (updates.cameraPort !== undefined) {
    device.cameraPort = updates.cameraPort;
    if (device.instance) device.instance.cameraPort = updates.cameraPort;
  }
  if (updates.cameraUser !== undefined) {
    device.cameraUser = updates.cameraUser;
    if (device.instance) device.instance.cameraUser = updates.cameraUser;
  }
  if (updates.cameraPass !== undefined) {
    device.cameraPass = updates.cameraPass;
    if (device.instance) device.instance.cameraPass = updates.cameraPass;
  }
  if (updates.type !== undefined) {
    device.type = updates.type;
    if (updates.type === 'other') device.status = 'ready';
  }

  console.log(`[Camera-Device] Updated device '${deviceId}':`, JSON.stringify(updates));
  _emitCamerasUpdate();
  return { success: true, device: _sanitizeDevice(device) };
}

function getCamerasList() {
  return cameraDevices.map(_sanitizeDevice);
}

function _sanitizeDevice(d) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    cameraIp: d.cameraIp,
    cameraPort: d.cameraPort,
    cameraUser: d.cameraUser,
    rtspUrl: d.rtspUrl || null,
    status: d.status,
    handle: d.handle,
  };
}

function _emitCamerasUpdate() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    clientSockets.emit('update-cameras', getCamerasList());
  }
}

async function getSnapshotForCamera(cameraId) {
  const clientSockets = getClientSockets();
  const _debugFE = (msg) => {
    console.log(msg);
    if (clientSockets) clientSockets.emit('debug-camera-snapshot', { time: new Date().toISOString(), message: msg });
  };

  const device = cameraDevices.find(d => d.id === cameraId);
  if (!device) {
    _debugFE(`[Camera-Snapshot] Camera '${cameraId}' not found. Available: ${cameraDevices.map(d => d.id).join(', ') || 'none'}`);
    return null;
  }

  if (device.type === 'sunell' && device.status !== 'connected') {
    _debugFE(`[Camera-Snapshot] Camera '${cameraId}' is sunell but not connected (status: ${device.status})`);
    return null;
  }

  if (!device.instance) {
    _debugFE(`[Camera-Snapshot] Camera '${cameraId}' has no instance`);
    return null;
  }

  _debugFE(`[Camera-Snapshot] Capturing from camera '${device.id}' (${device.type}) ...`);
  try {
    const base64 = await device.instance.captureSnapshotBase64();
    _debugFE(`[Camera-Snapshot] Result: ${base64 ? `OK (${base64.length} chars)` : 'null/empty'}`);
    return base64;
  } catch (err) {
    _debugFE(`[Camera-Snapshot] Capture FAILED for camera '${device.id}': ${err.message}`);
    return null;
  }
}

module.exports = {
  addCameraDevice,
  removeCameraDevice,
  updateCameraDevice,
  getCamerasList,
  getSnapshotForCamera
};
