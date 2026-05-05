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
    : path.join(__dirname, '..', 'module', 'sunell'); // fixed path to sdk

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
    onAlarm: (rawJsonStr) => {
      try {
        const payload = typeof rawJsonStr === 'string' ? JSON.parse(rawJsonStr) : rawJsonStr;
        
        // Neu device chua co features mac dinh thi coi nhu dc bat
        const features = device.features || {};
        const enableLPR = features.enableLPR ?? true;
        const enableMotion = features.enableMotion ?? true;
        const enableFace = features.enableFace ?? true;
        const enableIVA = features.enableIVA ?? true;
        const enableSystem = features.enableSystem ?? true;

        // Phân tích loại sự kiện
        let isLpr = false;
        let isFace = false;
        let isMotion = false;
        let isIVA = false;
        let isSystem = false;
        let logType = 'unknown';
        let description = 'Sự kiện không xác định';

        // 1. Phân tích sự kiện nhận diện (AI Targets)
        if (payload.TargetDetectList && Array.isArray(payload.TargetDetectList)) {
          for (const target of payload.TargetDetectList) {
            if (target.Type === 3) isLpr = true;
            if (target.Type === 0) isFace = true;
          }
        }

        // 2. Phân tích sự kiện báo động (Alarms)
        if (payload.data && typeof payload.data.main_type !== 'undefined') {
          const mainType = payload.data.main_type;
          const subType = payload.data.sub_type;

          if (mainType === 1 && subType === 2) {
            isMotion = true;
          } else if (mainType === 6) {
            isIVA = true;
          } else if (mainType === 1 || mainType === 4 || mainType === 5) {
            isSystem = true;
          }
        }

        // Nếu parse lỗi JSON nhưng vẫn có 'plate' trong string thô thì fallback
        if (!isLpr && !isFace && !isMotion && !isIVA && !isSystem) {
          const strBody = JSON.stringify(payload).toLowerCase();
          if (strBody.includes('plate')) isLpr = true;
          else isMotion = true; // Fallback
        }

        // --- FILTERING ---
        let shouldProcess = false;

        if (isLpr && enableLPR) {
          shouldProcess = true;
          logType = 'lpr_event';
          description = 'Phát hiện biển số (LPR)';
        } else if (isFace && enableFace) {
          shouldProcess = true;
          logType = 'face_event';
          description = 'Phát hiện khuôn mặt (Face)';
        } else if (isMotion && enableMotion) {
          shouldProcess = true;
          logType = 'motion_event';
          description = 'Phát hiện chuyển động (Motion)';
        } else if (isIVA && enableIVA) {
          shouldProcess = true;
          logType = 'iva_event';
          description = 'Phân tích AI (IVS/IVA)';
        } else if (isSystem && enableSystem) {
          shouldProcess = true;
          logType = 'system_event';
          description = 'Cảnh báo hệ thống / an ninh';
        }

        // Nếu sự kiện không thuộc loại nào được bật thì bỏ qua
        if (!shouldProcess) return;

        const sockets = getClientSockets();
        if (sockets) {
          // DEBUG: Emit toàn bộ raw data Sunell gửi về để FE console.log
          sockets.emit('sunell-test', {
            _debug_timestamp: new Date().toISOString(),
            _raw_json_string: typeof rawJsonStr === 'string' ? rawJsonStr : JSON.stringify(rawJsonStr),
            _parsed_payload: payload,
            _camera_id: device.id,
            _camera_name: device.name,
            _log_type: logType,
            _has_snapshot: !!payload.snapshotBase64,
            _snapshot_length: payload.snapshotBase64 ? payload.snapshotBase64.length : 0,
            _snapshot_preview: payload.snapshotBase64 ? payload.snapshotBase64.substring(0, 100) + '...' : '(empty)'
          });

          // Bắn log qua socket với mục raw_data chứa toàn bộ event
          sockets.emit('receive-sunell-log', {
            id: `sunell-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            timestamp: new Date().toISOString(),
            source: 'sunell-camera',
            camera_id: device.id,
            camera_name: device.name,
            log_type: logType,
            description: description,
            raw_data: payload,
            image_data: payload.snapshotBase64
          });
        }
      } catch (e) {
        console.error(`[Camera-${id}] Lỗi xử lý alarm:`, e);
      }
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

async function removeCameraDevice(deviceId) {
  const idx = cameraDevices.findIndex(d => d.id === deviceId);
  if (idx === -1) return { success: false, error: 'Device not found' };

  const device = cameraDevices[idx];
  if (device.type === 'sunell' && device.instance) {
    try {
      await device.instance.disconnectCamera();
    } catch (e) {
      console.error(`[Camera-Device] Error disconnecting device '${deviceId}':`, e);
    }
  }

  cameraDevices.splice(idx, 1);
  console.log(`[Camera-Device] Removed device '${deviceId}'`);
  _emitCamerasUpdate();
  return { success: true };
}

async function updateCameraDevice(deviceId, updates) {
  const device = cameraDevices.find(d => d.id === deviceId);
  if (!device) return { success: false, error: 'Device not found' };

  let requiresReconnect = false;

  if (updates.name !== undefined) device.name = updates.name;
  if (updates.rtspUrl !== undefined) {
    device.rtspUrl = updates.rtspUrl;
    if (device.instance) device.instance.rtspUrl = updates.rtspUrl;
  }
  if (updates.cameraIp !== undefined && updates.cameraIp !== device.cameraIp) {
    device.cameraIp = updates.cameraIp;
    if (device.instance) device.instance.cameraIp = updates.cameraIp;
    requiresReconnect = true;
  }
  if (updates.cameraPort !== undefined && updates.cameraPort !== device.cameraPort) {
    device.cameraPort = updates.cameraPort;
    if (device.instance) device.instance.cameraPort = updates.cameraPort;
    requiresReconnect = true;
  }
  if (updates.cameraUser !== undefined && updates.cameraUser !== device.cameraUser) {
    device.cameraUser = updates.cameraUser;
    if (device.instance) device.instance.cameraUser = updates.cameraUser;
    requiresReconnect = true;
  }
  if (updates.cameraPass !== undefined && updates.cameraPass !== device.cameraPass) {
    device.cameraPass = updates.cameraPass;
    if (device.instance) device.instance.cameraPass = updates.cameraPass;
    requiresReconnect = true;
  }
  if (updates.type !== undefined && updates.type !== device.type) {
    device.type = updates.type;
    requiresReconnect = true;
  }

  let sdkResult = undefined;
  if (requiresReconnect && device.type === 'sunell' && device.instance) {
    console.log(`[Camera-Device] Reconnecting device '${deviceId}' due to credential updates...`);
    try {
      await device.instance.disconnectCamera();
    } catch (e) {
      console.error(`[Camera-Device] Disconnect error during update for '${deviceId}':`, e);
    }

    try {
      sdkResult = await device.instance.connectCamera();
      device.status = sdkResult.online ? 'connected' : 'error';
      device.handle = sdkResult.handle || null;
      console.log(`[Camera-Device] Reconnected device '${deviceId}':`, sdkResult);
    } catch (err) {
      device.status = 'error';
      sdkResult = { online: false, error: err.message || String(err) };
      console.error(`[Camera-Device] Reconnect error for '${deviceId}':`, err);
    }
  } else if (updates.type === 'other') {
    device.status = 'ready';
  }

  console.log(`[Camera-Device] Updated device '${deviceId}':`, JSON.stringify(updates));
  _emitCamerasUpdate();
  return { success: true, device: _sanitizeDevice(device) };
}

function getCamerasList() {
  return cameraDevices.map(_sanitizeDevice);
}

function updateCameraFeatures(deviceId, features) {
  const device = cameraDevices.find(d => d.id === deviceId);
  if (!device) return { success: false, error: 'Device not found' };

  if (!device.features) {
    device.features = { enableMotion: true, enableLPR: true };
  }
  
  Object.assign(device.features, features);
  console.log(`[Camera-Device] Updated features for '${deviceId}':`, device.features);
  
  _emitCamerasUpdate();
  return { success: true, features: device.features };
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
    features: d.features || { enableMotion: true, enableLPR: true },
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
  getSnapshotForCamera,
  updateCameraFeatures
};
