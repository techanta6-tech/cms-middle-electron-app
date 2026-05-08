const fs = require('fs');
const path = require('path');
const { cameraDevices, getClientSockets } = require('../socketState');

// Trong môi trường pkg, __dirname nằm trong virtual snapshot (read-only).
// Phải dùng đường dẫn thực tế ngoài snapshot để có thể ghi file.
const _writableBase = process.env.USER_DATA_PATH || process.cwd();
const sampleLogsDir = path.join(_writableBase, 'sunell_logs_samples');
if (!fs.existsSync(sampleLogsDir)) {
  fs.mkdirSync(sampleLogsDir, { recursive: true });
}
const loggedEventTypes = new Set();
let CameraDevice;
let getAlarmName;
let _cameraModuleSource = 'DummyCamera'; // track which module is loaded
try {
  if (process.pkg) {
    // Production: cameraModule.js nằm cạnh file exe
    const mod = require(path.join(path.dirname(process.execPath), 'cameraModule.js'));
    CameraDevice = mod.CameraDevice;
    getAlarmName = mod.getAlarmName;
    _cameraModuleSource = 'pkg/cameraModule.js';
  } else {
    // Dev: cms-middle-be/src/services/ → ../../../ = repo root
    const mod = require('../../../cameraModule');
    CameraDevice = mod.CameraDevice;
    getAlarmName = mod.getAlarmName;
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
    status: 'connecting',
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
      if (!cameraDevices.some(d => d.id === id)) return;
      const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      const arrow = direction === 'IN' ? '⬇️' : '⬆️';
      const msg = `[${ts}] ${arrow} | [${id}] ${label}` + (data !== undefined ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}` : '');
      console.log(msg);

      const sockets = getClientSockets();
      if (sockets) {
        sockets.emit('debug-camera-snapshot', { time: new Date().toISOString(), message: msg });
      }
    },
    onAlarm: async (rawJsonStr) => {
      if (!cameraDevices.some(d => d.id === id)) return;
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
        let ivaSubType = -1; // lưu sub_type của IVA để map chi tiết
        let logType = 'unknown';
        let description = 'Sự kiện không xác định';

        // 1. Phân tích sự kiện nhận diện (AI Targets) từ detect_cb
        if (payload.TargetDetectList && Array.isArray(payload.TargetDetectList)) {
          for (const target of payload.TargetDetectList) {
            if (target.Type === 3) isLpr = true;
            if (target.Type === 0) isFace = true;
          }
        }

        // 2. Phân tích sự kiện báo động (Alarms) từ alarm_cb
        let globalMainType = null;
        let globalSubType = null;
        if (payload.data && typeof payload.data.main_type !== 'undefined') {
          globalMainType = payload.data.main_type;
          globalSubType = payload.data.sub_type;

          if (globalMainType === 1 && globalSubType === 2) {
            isMotion = true;
          } else if (globalMainType === 6 || globalMainType === 9) {
            isIVA = true;
            ivaSubType = globalSubType;
          } else if (globalMainType === 1 || globalMainType === 4 || globalMainType === 5 || globalMainType === 7) {
            // 1: Safety, 4: Disk, 5: Video, 7: Temperature/Thermal
            isSystem = true;
          }
        }

        // Nếu không nhận diện được loại nào thì fallback theo keyword trong JSON
        if (!isLpr && !isFace && !isMotion && !isIVA && !isSystem) {
          const strBody = JSON.stringify(payload).toLowerCase();
          if (strBody.includes('plate')) isLpr = true;
          else isMotion = true; // Fallback cuối cùng
        }

        // Map IVA sub_type → logType
        const IVA_SUBTYPE_MAP = {
          21: { logType: 'iva_trip_wire' },
          22: { logType: 'iva_smd' },
          23: { logType: 'iva_occlusion' },
          24: { logType: 'iva_perimeter_intrusion' },
          25: { logType: 'iva_double_trip_wire' },
          26: { logType: 'iva_loitering' },
          27: { logType: 'iva_crowd_loitering' },
          28: { logType: 'iva_object_left' },
          29: { logType: 'iva_object_removed' },
          30: { logType: 'iva_abnormal_speed' },
          31: { logType: 'iva_retrograde' },
          32: { logType: 'iva_illegal_parking' },
          33: { logType: 'iva_camera_shift' },
          34: { logType: 'iva_signal_bad' },
        };

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
          description = (globalMainType != null && globalSubType != null) 
            ? getAlarmName(globalMainType, globalSubType) 
            : 'Phát hiện chuyển động (Motion)';
        } else if (isIVA && enableIVA) {
          shouldProcess = true;
          const ivaInfo = IVA_SUBTYPE_MAP[ivaSubType];
          logType = ivaInfo ? ivaInfo.logType : `iva_event_${ivaSubType}`;
          description = (globalMainType != null && globalSubType != null) 
            ? getAlarmName(globalMainType, globalSubType) 
            : 'Phân tích AI (IVS/IVA)';
        } else if (isSystem && enableSystem) {
          shouldProcess = true;
          logType = (globalMainType != null && globalSubType != null) 
            ? `system_event_${globalMainType}_${globalSubType}` 
            : 'system_event';
          description = (globalMainType != null && globalSubType != null) 
            ? getAlarmName(globalMainType, globalSubType) 
            : 'Cảnh báo hệ thống / an ninh';
        }

        // Nếu sự kiện không thuộc loại nào được bật thì bỏ qua
        if (!shouldProcess) return;

        // --- FALLBACK SNAPSHOT ---
        // Nếu sự kiện lọt qua được bộ lọc mà chưa có ảnh từ SDK, ta tiến hành chụp RTSP
        if (!payload.snapshotBase64) {
          try {
            console.log(`[Camera-${id}] [FALLBACK] Bắt đầu chụp ảnh RTSP cho sự kiện [${description}]`);
            const b64 = await device.instance.captureSnapshotBase64();
            if (b64) {
              payload.snapshotBase64 = b64;
              console.log(`[Camera-${id}] [FALLBACK] ✅ RTSP snapshot OK, size=${b64.length}`);
            } else {
              console.log(`[Camera-${id}] [FALLBACK] ❌ RTSP snapshot trả về null`);
            }
          } catch (err) {
            console.error(`[Camera-${id}] [FALLBACK] ❌ RTSP snapshot lỗi: ${err.message}`);
          }
        }


        // YÊU CẦU: Ghi log sự kiện lần đầu tiên ra file txt
        // Nếu có eventName thì lưu ra file riêng cho từng loại eventName (như IVA có nhiều loại)
        let eventKey = logType;
        let eventNameSafe = '';
        const rawEventName = payload.eventName || (payload.data && payload.data.eventName) || '';
        
        if (rawEventName) {
           // Tìm chuỗi nằm trong dấu ngoặc đơn (VD: "Perimeter intrusion")
           const match = rawEventName.match(/\(([^)]+)\)/);
           const extractedName = match ? match[1] : rawEventName;
           
           // Lọc bỏ các ký tự đặc biệt để làm tên file
           eventNameSafe = extractedName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase();
           // Xóa gạch dưới ở 2 đầu nếu có
           eventNameSafe = eventNameSafe.replace(/^_|_$/g, '');
           eventKey = `${logType}_${eventNameSafe}`;
        }

        if (!loggedEventTypes.has(eventKey)) {
          loggedEventTypes.add(eventKey);
          const fileName = eventNameSafe ? `${logType}_${eventNameSafe}.txt` : `${logType}.txt`;
          const logFilePath = path.join(sampleLogsDir, fileName);
          
          let dataToWrite = `--- SUNELL EVENT: ${logType.toUpperCase()} ${rawEventName ? `(${rawEventName})` : ''} ---\n`;
          dataToWrite += `Time: ${new Date().toISOString()}\n`;
          dataToWrite += `Camera: ${device.name} (${device.id})\n`;
          dataToWrite += `Description: ${description}\n`;
          dataToWrite += `Raw JSON:\n`;
          dataToWrite += (typeof rawJsonStr === 'string' ? rawJsonStr : JSON.stringify(rawJsonStr, null, 2)) + '\n\n';
          
          if (payload.snapshotBase64) {
             dataToWrite += `[HAS SNAPSHOT BASE64 IMAGE - LENGTH: ${payload.snapshotBase64.length}]\n`;
          }
          
          try {
            fs.writeFileSync(logFilePath, dataToWrite, 'utf8');
            console.log(`[Sunell-Sample] Đã ghi file log mẫu cho sự kiện ${eventKey} tại ${logFilePath}`);
          } catch(err) {
            console.error(`[Sunell-Sample] Lỗi ghi file log mẫu:`, err);
          }
        }

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
  } else {
    // Camera độc lập: probe RTSP để kiểm tra kết nối thực tế
    try {
      const probeResult = await device.instance.probeRtsp(5000);
      device.status = probeResult.online ? 'connected' : 'error';
      console.log(`[Camera-Device] RTSP probe for '${id}':`, probeResult);
    } catch (err) {
      device.status = 'error';
      console.error(`[Camera-Device] RTSP probe error for '${id}':`, err);
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
  } else if (device.instance && device.instance.probeRtsp) {
    // Camera độc lập: re-probe RTSP nếu có thay đổi kết nối
    if (requiresReconnect || updates.rtspUrl !== undefined) {
      try {
        const probeResult = await device.instance.probeRtsp(5000);
        device.status = probeResult.online ? 'connected' : 'error';
        console.log(`[Camera-Device] RTSP re-probe for '${deviceId}':`, probeResult);
      } catch (err) {
        device.status = 'error';
        console.error(`[Camera-Device] RTSP re-probe error for '${deviceId}':`, err);
      }
    }
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

  // Camera độc lập: probe RTSP trước khi chụp, cập nhật status
  if (device.type !== 'sunell' && device.instance && device.instance.probeRtsp) {
    try {
      const probeResult = await device.instance.probeRtsp(5000);
      const newStatus = probeResult.online ? 'connected' : 'error';
      if (device.status !== newStatus) {
        device.status = newStatus;
        _emitCamerasUpdate();
      }
      if (!probeResult.online) {
        _debugFE(`[Camera-Snapshot] RTSP probe failed for '${device.id}': ${probeResult.error}`);
        return null;
      }
    } catch (err) {
      device.status = 'error';
      _emitCamerasUpdate();
      _debugFE(`[Camera-Snapshot] RTSP probe error for '${device.id}': ${err.message}`);
      return null;
    }
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
