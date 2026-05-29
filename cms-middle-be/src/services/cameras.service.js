const fs = require('fs');
const path = require('path');
const { cameraDevices, getClientSockets } = require('../socketState');
const { appendLog } = require('./system-state.service');
const sunellEventRegistry = require('./sunellEventRegistry.service');
const persistedDevices = require('./persisted-devices.service');
const trafficService = require('./traffic.service');
const {
  createRtspConnection,
  stopRtspConnection,
  getRtspConnection,
  captureRtspSnapshot,
} = require('../module/rtspSnapshotStream');

// Trong môi trường pkg, __dirname nằm trong virtual snapshot (read-only).
// Phải dùng đường dẫn thực tế ngoài snapshot để có thể ghi file.
const _writableBase = process.env.USER_DATA_PATH || process.cwd();
const sampleLogsDir = path.join(_writableBase, '/log_samples/sunell_logs_samples');
if (!fs.existsSync(sampleLogsDir)) {
  fs.mkdirSync(sampleLogsDir, { recursive: true });
}
const sunellSnapshotDir = path.join(_writableBase, 'sunellSnapshot');
if (!fs.existsSync(sunellSnapshotDir)) {
  fs.mkdirSync(sunellSnapshotDir, { recursive: true });
}
const sunellSnapshotErrorLogPath = path.join(sunellSnapshotDir, 'snapshot-errors.log');
const SUNELL_SUPPLEMENTAL_SNAPSHOT_ENABLED = true;
const SUNELL_RTSP_FALLBACK_SNAPSHOT_ENABLED = false;
const CAMERA_STREAM_RESTART_DELAY_MS = 10000;
const OVERVIEW_SNAPSHOT_TIMEOUT_MS = 5000;
const SNAPSHOT_URL_TIMEOUT_MS = 5000;
const LPR_SNAPSHOT_DELAY_MS = 0;
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
    captureSnapshotSdkBase64() { return Promise.resolve({ success: false, error: 'cameraModule not available' }); }
  };
}

function logSunellSnapshotError(device, err, payload = {}) {
  const message = err && err.message ? err.message : String(err || 'Unknown SDK snapshot error');
  const snapshotResult = payload.sunellSnapshotResult || {};
  const line = JSON.stringify({
    time: new Date().toISOString(),
    cameraId: device && device.id,
    cameraName: device && device.name,
    cameraIp: device && device.cameraIp,
    status: 'error',
    error: message,
    eventName: payload.eventName || (payload.data && payload.data.eventName) || null,
    rawMainType: payload.data && payload.data.main_type,
    rawSubType: payload.data && payload.data.sub_type,
    handle: snapshotResult.handle,
    mdHandle: snapshotResult.mdHandle,
    snapshotPath: snapshotResult.snapshotPath,
  });

  try {
    fs.appendFileSync(sunellSnapshotErrorLogPath, `${line}\n`, 'utf8');
  } catch (writeErr) {
    console.error('[Sunell-Snapshot] Failed to write snapshot error log:', writeErr);
  }

  const sockets = getClientSockets();
  if (sockets) {
    sockets.emit('debug-camera-snapshot', {
      time: new Date().toISOString(),
      message: `[Sunell-Snapshot] LPR SDK snapshot failed for '${device && device.id}': ${message}`
    });
  }
}

function logSunellSnapshotSuccess(device, payload = {}) {
  const snapshotResult = payload.sunellSnapshotResult || {};
  const line = JSON.stringify({
    time: new Date().toISOString(),
    cameraId: device && device.id,
    cameraName: device && device.name,
    cameraIp: device && device.cameraIp,
    status: 'success',
    eventName: payload.eventName || (payload.data && payload.data.eventName) || null,
    rawMainType: payload.data && payload.data.main_type,
    rawSubType: payload.data && payload.data.sub_type,
    handle: snapshotResult.handle,
    mdHandle: snapshotResult.mdHandle,
    snapshotPath: payload.snapshotPath || payload.sunellSnapshotPath || snapshotResult.snapshotPath,
    snapshotSource: payload.snapshotSource,
  });

  try {
    fs.appendFileSync(sunellSnapshotErrorLogPath, `${line}\n`, 'utf8');
  } catch (writeErr) {
    console.error('[Sunell-Snapshot] Failed to write snapshot success log:', writeErr);
  }
}

function saveSunellSnapshotAfterPrefilter(device, payload, logType) {
  if (!payload || !payload.snapshotBase64 || payload.snapshotPath || payload.sunellSnapshotPath) {
    return null;
  }

  try {
    const snapshotDir = device.snapshotDir || path.join(_writableBase, 'snapshots');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const raw = String(payload.snapshotBase64);
    const dataUrlMatch = raw.match(/^data:image\/([^;]+);base64,(.+)$/);
    const ext = dataUrlMatch ? (dataUrlMatch[1] === 'jpeg' ? 'jpg' : dataUrlMatch[1]) : 'jpg';
    const base64 = dataUrlMatch ? dataUrlMatch[2] : raw;
    const safeLogType = String(logType || 'event').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDeviceId = String(device.id || 'camera').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `sunell_${safeLogType}_${safeDeviceId}_${Date.now()}.${ext}`;
    const outputPath = path.join(snapshotDir, filename);

    fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
    payload.snapshotPath = outputPath;
    console.log(`[Sunell-Snapshot] Saved after prefilter: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`[Sunell-Snapshot] Failed to save after prefilter for '${device && device.id}':`, err);
    logSunellSnapshotError(device, err, payload);
    return null;
  }
}

function normalizeRtspUrlForCamera(device) {
  let url = device && device.rtspUrl;
  if (!url && device && device.cameraIp) {
    const user = encodeURIComponent(device.cameraUser || 'admin');
    const pass = encodeURIComponent(device.cameraPass || 'admin1234');
    url = `rtsp://${user}:${pass}@${device.cameraIp}:554/snl/live/1/1`;
  }

  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const configuredPort = parseInt(parsedUrl.port, 10);
    if ([30001, 30000].includes(configuredPort)) {
      parsedUrl.port = '554';
      return parsedUrl.toString();
    }
  } catch (_) {
    // Keep original URL if URL parsing fails; FFmpeg will report the detailed error.
  }

  return url;
}

function buildDefaultSnapshotUrl(device) {
  if (!device || !device.cameraIp) return null;
  const user = encodeURIComponent(device.cameraUser || 'admin');
  const pass = encodeURIComponent(device.cameraPass || 'admin1234');
  return `http://${user}:${pass}@${device.cameraIp}/cgi-bin/image.cgi?cameraID=1&quality=5`;
}

function normalizeSnapshotUrlForCamera(device) {
  return (device && device.snapshotUrl) || buildDefaultSnapshotUrl(device);
}

function maskSnapshotUrl(snapshotUrl) {
  return String(snapshotUrl || '').replace(/:\/\/([^:/@]+):([^@]+)@/, '://$1:***@');
}

function getImageContentInfo(buffer, contentType = '') {
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng = buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  if (isPng || /image\/png/i.test(contentType)) return { mimeType: 'image/png', ext: 'png' };
  if (isJpeg || /image\/jpe?g/i.test(contentType)) return { mimeType: 'image/jpeg', ext: 'jpg' };
  return null;
}

async function captureSnapshotUrlForCamera(device, options = {}) {
  const snapshotUrl = normalizeSnapshotUrlForCamera(device);
  if (!snapshotUrl) {
    return { success: false, statusCode: 400, error: 'Snapshot URL is not configured' };
  }

  try {
    const axios = require('axios');
    const response = await axios.get(snapshotUrl, {
      responseType: 'arraybuffer',
      timeout: Number(options.timeoutMs || SNAPSHOT_URL_TIMEOUT_MS),
      validateStatus: (status) => status < 500,
      maxRedirects: 3,
    });

    const buffer = Buffer.from(response.data || []);
    const imageInfo = getImageContentInfo(buffer, response.headers && response.headers['content-type']);
    if (response.status !== 200 || buffer.length <= 100 || !imageInfo) {
      return {
        success: false,
        statusCode: response.status || 502,
        error: `Snapshot URL returned status=${response.status} size=${buffer.length}`,
      };
    }

    let snapshotPath = null;
    if (options.save !== false) {
      const snapshotDir = device.snapshotDir || path.join(_writableBase, 'snapshots');
      if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
      }
      const safeDeviceId = String(device.id || 'camera').replace(/[^a-zA-Z0-9_-]/g, '_');
      snapshotPath = path.join(snapshotDir, `snapshot_url_${safeDeviceId}_${Date.now()}.${imageInfo.ext}`);
      fs.writeFileSync(snapshotPath, buffer);
    }

    const result = {
      success: true,
      method: 'snapshot_url',
      camera: _sanitizeDevice(device),
      contentType: imageInfo.mimeType,
      snapshotPath,
      sourceUrl: maskSnapshotUrl(snapshotUrl),
      size: buffer.length,
    };

    if (options.includeBuffer) result.buffer = buffer;
    if (options.includeBase64 !== false) {
      result.snapshotBase64 = `data:${imageInfo.mimeType};base64,${buffer.toString('base64')}`;
    }

    return result;
  } catch (err) {
    return {
      success: false,
      statusCode: 502,
      error: err.message || String(err),
      sourceUrl: maskSnapshotUrl(snapshotUrl),
    };
  }
}

function startCameraRtspStream(device) {
  const rtspUrl = normalizeRtspUrlForCamera(device);
  if (!rtspUrl) {
    console.warn(`[Camera-Stream] Skip stream for '${device && device.id}': RTSP URL is not configured`);
    return { success: false, error: 'RTSP URL is not configured' };
  }

  try {
    if (getRtspConnection(device.id)) {
      stopRtspConnection(device.id);
    }

    const stream = createRtspConnection({
      id: device.id,
      rtspUrl,
      snapshotDir: device.snapshotDir || path.join(_writableBase, 'snapshots'),
      frameIntervalMs: 1000,
      restartDelayMs: CAMERA_STREAM_RESTART_DELAY_MS,
      autoRestart: true,
    });
    device.rtspStreamStatus = stream.status;
    device.rtspStreamLatestFramePath = stream.latestFramePath;
    console.log(`[Camera-Stream] Started RTSP stream for '${device.id}', restart=${CAMERA_STREAM_RESTART_DELAY_MS}ms`);
    return { success: true, stream };
  } catch (err) {
    const message = err.message || String(err);
    device.rtspStreamStatus = 'error';
    device.rtspStreamError = message;
    console.error(`[Camera-Stream] Failed to start stream for '${device.id}': ${message}`);
    return { success: false, error: message };
  }
}

function stopCameraRtspStream(deviceId) {
  const result = stopRtspConnection(deviceId);
  if (result.success) {
    console.log(`[Camera-Stream] Stopped RTSP stream for '${deviceId}'`);
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveOverviewSnapshotBase64(device, base64Data) {
  if (!base64Data) return null;

  const snapshotDir = device.snapshotDir || path.join(_writableBase, 'snapshots');
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  const raw = String(base64Data);
  const dataUrlMatch = raw.match(/^data:image\/([^;]+);base64,(.+)$/);
  const ext = dataUrlMatch ? (dataUrlMatch[1] === 'jpeg' ? 'jpg' : dataUrlMatch[1]) : 'jpg';
  const payload = dataUrlMatch ? dataUrlMatch[2] : raw;
  const safeDeviceId = String(device.id || 'camera').replace(/[^a-zA-Z0-9_-]/g, '_');
  const outputPath = path.join(snapshotDir, `overview_${safeDeviceId}_${Date.now()}.${ext}`);
  fs.writeFileSync(outputPath, Buffer.from(payload, 'base64'));
  return outputPath;
}

async function attachOverviewSnapshotForLpr(device, payload) {
  if (!device || !payload) return payload;

  try {
    const result = await captureSnapshotUrlForCamera(device, {
      save: true,
      timeoutMs: OVERVIEW_SNAPSHOT_TIMEOUT_MS,
      includeBase64: true,
    });

    if (result && result.success && result.snapshotBase64) {
      payload.overviewSnapshotBase64 = result.snapshotBase64;
      payload.overviewSnapshotPath = result.snapshotPath || null;
      payload.overviewSnapshotSource = 'snapshot-url';
      console.log(`[Camera-${device.id}] [OVERVIEW SNAPSHOT] Snapshot URL OK, file=${result.snapshotPath || '(none)'}`);
      return payload;
    }

    payload.overviewSnapshotError = result && result.error ? result.error : 'Snapshot URL failed';
    console.warn(`[Camera-${device.id}] [OVERVIEW SNAPSHOT] Snapshot URL failed: ${payload.overviewSnapshotError}`);
  } catch (err) {
    payload.overviewSnapshotError = err.message || String(err);
    console.warn(`[Camera-${device.id}] [OVERVIEW SNAPSHOT] Snapshot URL error: ${payload.overviewSnapshotError}`);
  }

  return payload;
}

async function addCameraDevice(deviceConfig, options = {}) {
  const { persist = true, id: providedId } = options;
  const { name, type, cameraIp, cameraPort, cameraUser, cameraPass, rtspUrl } = deviceConfig;
  const snapshotUrl = deviceConfig.snapshotUrl || buildDefaultSnapshotUrl(deviceConfig);

  const id = providedId || deviceConfig.id || `cam-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
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
    snapshotUrl,
    snapshotDir,
    sdkPath,
    status: 'connecting',
    handle: null,
    instance: null,
    features: deviceConfig.features || {}
  };

  cameraDevices.push(device);
  console.log(`[Camera-Device] Added device '${id}' (${type})`);

  // Khởi tạo instance cho TẤT CẢ các loại để gọi được captureSnapshotBase64
  device.instance = new CameraDevice({
    id,
    rtspUrl,
    snapshotUrl,
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
        const originalRawJson = typeof rawJsonStr === 'string'
          ? rawJsonStr
          : JSON.stringify(rawJsonStr, null, 2);
        const payload = typeof rawJsonStr === 'string' ? JSON.parse(rawJsonStr) : rawJsonStr;
        const alarmReceivedAtMs = Date.now();

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

        // --- DETERMINE EVENT TYPE ---
        if (isLpr) {
          logType = 'lpr_event';
          description = 'Phát hiện biển số (LPR)';
        } else if (isFace) {
          logType = 'face_event';
          description = 'Phát hiện khuôn mặt (Face)';
        } else if (isMotion) {
          logType = 'motion_event';
          description = (globalMainType != null && globalSubType != null)
            ? getAlarmName(globalMainType, globalSubType)
            : 'Phát hiện chuyển động (Motion)';
        } else if (isIVA) {
          const ivaInfo = IVA_SUBTYPE_MAP[ivaSubType];
          logType = ivaInfo ? ivaInfo.logType : `iva_event_${ivaSubType}`;
          description = (globalMainType != null && globalSubType != null)
            ? getAlarmName(globalMainType, globalSubType)
            : 'Phân tích AI (IVS/IVA)';
        } else if (isSystem) {
          logType = (globalMainType != null && globalSubType != null)
            ? `system_event_${globalMainType}_${globalSubType}`
            : 'system_event';
          description = (globalMainType != null && globalSubType != null)
            ? getAlarmName(globalMainType, globalSubType)
            : 'Cảnh báo hệ thống / an ninh';
        } else {
          return; // Bỏ qua nếu không nhận dạng được event nào
        }

        // --- AUTO-DISCOVER & FILTERING ---
        const isNewEvent = sunellEventRegistry.discoverEvent(logType);
        if (isNewEvent) {
          const clientSockets = getClientSockets();
          if (clientSockets) {
            clientSockets.emit('update-sunell-known-events', sunellEventRegistry.getEvents());
          }
        }

        // Hỗ trợ backwards compatibility: nếu user đã set 'enableLPR', 'enableMotion' vv thì chuyển qua logType
        const legacyMap = {
          'lpr_event': features.enableLPR,
          'face_event': features.enableFace,
          'motion_event': features.enableMotion,
        };
        if (isIVA) legacyMap[logType] = features.enableIVA;
        if (isSystem) legacyMap[logType] = features.enableSystem;

        let shouldProcess = false;

        // Ưu tiên 1: features[logType] (nếu FE update theo dạng phẳng)
        // Ưu tiên 2: features.enableLPR/enableMotion (nếu FE dùng dạng nhóm cũ)
        // Ưu tiên 3: sunellEventRegistry.getDefaultEnabled
        if (features[logType] !== undefined) {
          shouldProcess = !!features[logType];
        } else if (legacyMap[logType] !== undefined) {
          shouldProcess = !!legacyMap[logType];
        } else {
          shouldProcess = sunellEventRegistry.getDefaultEnabled(logType);
        }

        // Nếu sự kiện không được bật thì bỏ qua
        if (!shouldProcess) {
          console.log(`[Camera-${id}] Bỏ qua sự kiện bị vô hiệu hóa: ${logType}`);
          return;
        }

        if (isLpr) {
          if (trafficService.isDuplicateLpr(payload, device.id)) {
            console.log(`[Camera-${id}] [Traffic] Bỏ qua LPR log trùng lặp (chống lặp 30s)`);
            return;
          }
        }

        // YÊU CẦU: Áp dụng lấy ảnh toàn cảnh (fullshot) từ luồng RTSP streaming ngầm CHỈ cho lpr_event
        if (isLpr) {
          saveSunellSnapshotAfterPrefilter(device, payload, logType);
          payload.plateImageBase64 = payload.snapshotBase64 || null;
          payload.plateImagePath = payload.snapshotPath || payload.sunellSnapshotPath || null;
        }

        if (isLpr) {
          payload.lprSnapshotLatencyMs = null;
          try {
            await sleep(LPR_SNAPSHOT_DELAY_MS);
            
            // Dùng luồng stream RTSP thay vì gọi HTTP tới Camera
            const snapshotResult = await captureRtspSnapshot(device.id, {
              includeBase64: true,
              timeoutMs: OVERVIEW_SNAPSHOT_TIMEOUT_MS,
              fresh: true,
            });

            if (snapshotResult && snapshotResult.success && snapshotResult.snapshotBase64) {
              payload.fullStreamSnapshotBase64 = snapshotResult.snapshotBase64;
              payload.fullStreamSnapshotPath = snapshotResult.snapshotPath || null;

              payload.snapshotBase64 = snapshotResult.snapshotBase64;
              payload.snapshotPath = snapshotResult.snapshotPath || null;
              payload.snapshotSource = 'rtsp-stream';
              payload.lprSnapshotLatencyMs = Date.now() - alarmReceivedAtMs;
              console.log(`[Camera-${id}] [LPR SNAPSHOT] RTSP Stream Frame captured and applied to log snapshot, size=${snapshotResult.snapshotBase64.length}`);
            } else {
              console.warn(`[Camera-${id}] [FULL SHOT] RTSP Stream Snapshot failed: ${snapshotResult ? snapshotResult.error : 'Unknown'}`);
            }
          } catch (err) {
            console.error(`[Camera-${id}] [FULL SHOT] RTSP Stream Snapshot error: ${err.message}`);
          }
        }

        if (!isLpr) {
          saveSunellSnapshotAfterPrefilter(device, payload, logType);
        }

        // ─── Traffic module: ghi nhận biển số xe (LPR) ───
        if (isLpr) {
          try {
            const trafficResult = trafficService.appendTrafficRecord(payload, device);
            if (trafficResult) {
              const plates = Array.isArray(trafficResult) ? trafficResult : [trafficResult];
              console.log(`[Camera-${id}] [Traffic] Ghi nhan ${plates.length} bien so: ${plates.map(p => p.plate_num).join(', ')}`);
            }
          } catch (trafficErr) {
            console.error(`[Camera-${id}] [Traffic] Loi ghi nhan bien so:`, trafficErr.message);
          }
        }

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
          dataToWrite += originalRawJson + '\n\n';

          try {
            fs.writeFileSync(logFilePath, dataToWrite, 'utf8');
            console.log(`[Sunell-Sample] Đã ghi file log mẫu cho sự kiện ${eventKey} tại ${logFilePath}`);
          } catch (err) {
            console.error(`[Sunell-Sample] Lỗi ghi file log mẫu:`, err);
          }
        }

        const logData = {
          id: `sunell-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          receive_time: Date.now(),
          log_type: logType,
          log_description: description,
          snapshot: payload.snapshotBase64 || undefined,
          fullshotimage: payload.fullStreamSnapshotBase64 || payload.snapshotBase64 || undefined,
          snapshot_path: payload.snapshotPath || payload.sunellSnapshotPath || undefined,
          overviewSnapshotBase64: payload.overviewSnapshotBase64 || undefined,
          overviewSnapshotPath: payload.overviewSnapshotPath || undefined,
          overviewSnapshotSource: payload.overviewSnapshotSource || undefined,
          log_source: 'sunell-camera',
          device_info: {
            name: device.name || 'Sunell Camera',
            id: device.id,
          },
          server_unique_id: `camera-${device.id}`,
          raw: payload,
        };
        appendLog(logData);

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
            _snapshot_preview: payload.snapshotBase64 ? payload.snapshotBase64.substring(0, 100) + '...' : '(empty)',
            _has_overview_snapshot: !!payload.overviewSnapshotBase64,
            _overview_snapshot_length: payload.overviewSnapshotBase64 ? payload.overviewSnapshotBase64.length : 0,
          });

          // Bắn log qua socket với mục raw_data chứa toàn bộ event
          sockets.emit('receive-sunell-log', {
            id: logData.id,
            timestamp: new Date().toISOString(),
            source: 'sunell-camera',
            camera_id: device.id,
            camera_name: device.name,
            log_type: logType,
            description: description,
            raw_data: payload,
            image_data: payload.snapshotBase64,
            fullshotimage: payload.fullStreamSnapshotBase64 || payload.snapshotBase64 || undefined,
            image_path: payload.snapshotPath || payload.sunellSnapshotPath || undefined,
            overview_image_data: payload.overviewSnapshotBase64,
            overview_image_path: payload.overviewSnapshotPath || undefined,
            overview_image_source: payload.overviewSnapshotSource || undefined,
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

  let streamResult = null;
  if (device.status === 'connected') {
    streamResult = startCameraRtspStream(device);
  } else {
    stopCameraRtspStream(device.id);
  }

  _emitCamerasUpdate();
  if (persist && device.status === 'connected') {
    persistedDevices.persistCamera(device);
  }
  return { success: true, device: _sanitizeDevice(device), sdkResult, streamResult };
}

async function removeCameraDevice(deviceId, options = {}) {
  const { persist = true } = options;
  const idx = cameraDevices.findIndex(d => d.id === deviceId);
  if (idx === -1) return { success: false, error: 'Device not found' };

  const device = cameraDevices[idx];
  stopCameraRtspStream(deviceId);
  if (device.type === 'sunell' && device.instance) {
    try {
      await device.instance.disconnectCamera();
    } catch (e) {
      console.error(`[Camera-Device] Error disconnecting device '${deviceId}':`, e);
    }
  }

  cameraDevices.splice(idx, 1);
  if (persist) {
    persistedDevices.removeCamera(deviceId);
  }
  console.log(`[Camera-Device] Removed device '${deviceId}'`);
  _emitCamerasUpdate();
  return { success: true };
}

async function updateCameraDevice(deviceId, updates) {
  const device = cameraDevices.find(d => d.id === deviceId);
  if (!device) return { success: false, error: 'Device not found' };

  let requiresReconnect = false;
  let requiresStreamRefresh = false;

  if (updates.name !== undefined) device.name = updates.name;
  if (updates.rtspUrl !== undefined) {
    device.rtspUrl = updates.rtspUrl;
    if (device.instance) device.instance.rtspUrl = updates.rtspUrl;
    requiresStreamRefresh = true;
  }
  if (updates.snapshotUrl !== undefined) {
    device.snapshotUrl = updates.snapshotUrl || buildDefaultSnapshotUrl(device);
    if (device.instance) device.instance.snapshotUrl = device.snapshotUrl;
  }
  if (updates.cameraIp !== undefined && updates.cameraIp !== device.cameraIp) {
    device.cameraIp = updates.cameraIp;
    if (device.instance) device.instance.cameraIp = updates.cameraIp;
    requiresReconnect = true;
    requiresStreamRefresh = true;
    if (updates.snapshotUrl === undefined) {
      device.snapshotUrl = buildDefaultSnapshotUrl(device);
      if (device.instance) device.instance.snapshotUrl = device.snapshotUrl;
    }
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
    requiresStreamRefresh = true;
    if (updates.snapshotUrl === undefined) {
      device.snapshotUrl = buildDefaultSnapshotUrl(device);
      if (device.instance) device.instance.snapshotUrl = device.snapshotUrl;
    }
  }
  if (updates.cameraPass !== undefined && updates.cameraPass !== device.cameraPass) {
    device.cameraPass = updates.cameraPass;
    if (device.instance) device.instance.cameraPass = updates.cameraPass;
    requiresReconnect = true;
    requiresStreamRefresh = true;
    if (updates.snapshotUrl === undefined) {
      device.snapshotUrl = buildDefaultSnapshotUrl(device);
      if (device.instance) device.instance.snapshotUrl = device.snapshotUrl;
    }
  }
  if (updates.type !== undefined && updates.type !== device.type) {
    device.type = updates.type;
    requiresReconnect = true;
    requiresStreamRefresh = true;
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
  if (requiresStreamRefresh) {
    if (device.status === 'connected') {
      startCameraRtspStream(device);
    } else {
      stopCameraRtspStream(device.id);
    }
  }
  if (device.status === 'connected') {
    persistedDevices.persistCamera(device);
  }
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
    device.features = {};
  }

  Object.assign(device.features, features);
  console.log(`[Camera-Device] Updated features for '${deviceId}':`, device.features);

  if (device.status === 'connected') {
    persistedDevices.persistCamera(device);
  }
  _emitCamerasUpdate();
  return { success: true, features: device.features };
}

function _sanitizeDevice(d) {
  const rtspStream = getRtspConnection(d.id);
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    cameraIp: d.cameraIp,
    cameraPort: d.cameraPort,
    cameraUser: d.cameraUser,
    rtspUrl: d.rtspUrl || null,
    snapshotUrl: d.snapshotUrl || null,
    status: d.status,
    handle: d.handle,
    rtspStream: rtspStream ? {
      status: rtspStream.status,
      latestFramePath: rtspStream.latestFramePath,
      lastError: rtspStream.lastError,
      latestFrame: rtspStream.latestFrame,
    } : null,
    features: d.features || {},
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

async function getSdkSnapshotForCamera(cameraId) {
  const clientSockets = getClientSockets();
  const _debugFE = (msg) => {
    console.log(msg);
    if (clientSockets) clientSockets.emit('debug-camera-snapshot', { time: new Date().toISOString(), message: msg });
  };

  const device = cameraDevices.find(d => d.id === cameraId);
  if (!device) {
    _debugFE(`[Camera-SDK-Snapshot] Camera '${cameraId}' not found. Available: ${cameraDevices.map(d => d.id).join(', ') || 'none'}`);
    return { success: false, statusCode: 404, error: 'Camera not found' };
  }

  if (device.type !== 'sunell') {
    _debugFE(`[Camera-SDK-Snapshot] Camera '${cameraId}' is '${device.type}', SDK snapshot is only available for Sunell cameras`);
    return { success: false, statusCode: 400, error: 'SDK snapshot is only available for Sunell cameras' };
  }

  if (device.status !== 'connected') {
    _debugFE(`[Camera-SDK-Snapshot] Camera '${cameraId}' is not connected (status: ${device.status})`);
    return { success: false, statusCode: 409, error: `Camera is not connected (status: ${device.status})` };
  }

  if (!device.instance || typeof device.instance.captureSnapshotSdkBase64 !== 'function') {
    _debugFE(`[Camera-SDK-Snapshot] Camera '${cameraId}' has no SDK snapshot method`);
    return { success: false, statusCode: 500, error: 'SDK snapshot method is not available' };
  }

  // ──────────────────────────────────────────────────────────────────
  // PHƯƠNG PHÁP 1: Chụp qua SDK gốc C# (sdk_md_capture / sdk_open_snap)
  // ──────────────────────────────────────────────────────────────────
  _debugFE(`[Camera-SDK-Snapshot] [1/3] Trying SDK native capture from camera '${device.id}'...`);
  try {
    const result = await device.instance.captureSnapshotSdkBase64({ forceFresh: true });
    const base64 = result && result.snapshotBase64;
    _debugFE(`[Camera-SDK-Snapshot] [1/3] SDK result: ${base64 ? `OK (${base64.length} chars)` : 'null/empty'} | handle=${result && result.handle} | mdHandle=${result && result.mdHandle}`);

    if (result && result.success && base64) {
      return {
        success: true,
        method: 'sdk_native',
        camera: _sanitizeDevice(device),
        snapshotBase64: base64,
        snapshotPath: result.snapshotPath || null,
        handle: result.handle,
        mdHandle: result.mdHandle
      };
    }
    _debugFE(`[Camera-SDK-Snapshot] [1/3] SDK native capture returned empty — trying HTTP fallback...`);
  } catch (err) {
    _debugFE(`[Camera-SDK-Snapshot] [1/3] SDK native capture error: ${err.message} — trying HTTP fallback...`);
  }

  // ──────────────────────────────────────────────────────────────────
  // PHƯƠNG PHÁP 2: HTTP CGI/ISAPI snapshot (không cần SDK, chỉ cần mạng)
  //   Thử nhiều endpoint phổ biến của camera Sunell:
  //     - /ISAPI/Streaming/channels/101/picture (ISAPI chuẩn Hikvision-compatible)
  //     - /cgi-bin/snapshot.cgi (CGI chuẩn)
  //     - /cgi-bin/snapshot.cgi?channel=1
  // ──────────────────────────────────────────────────────────────────
  const camIp = device.cameraIp;
  const camUser = device.cameraUser || 'admin';
  const camPass = device.cameraPass || 'admin1234';
  const httpPort = 80; // Sunell HTTP port mặc định

  const HTTP_SNAPSHOT_URLS = [
    `http://${camIp}:${httpPort}/ISAPI/Streaming/channels/101/picture`,
    `http://${camIp}:${httpPort}/cgi-bin/snapshot.cgi`,
    `http://${camIp}:${httpPort}/cgi-bin/snapshot.cgi?channel=1`,
    `http://${camIp}:${httpPort}/snap.jpg`,
    `http://${camIp}:${httpPort}/snapshot.jpg`,
  ];

  _debugFE(`[Camera-SDK-Snapshot] [2/3] Trying HTTP CGI/ISAPI snapshot from ${camIp} (${HTTP_SNAPSHOT_URLS.length} endpoints)...`);

  const axios = require('axios');
  for (const url of HTTP_SNAPSHOT_URLS) {
    try {
      _debugFE(`[Camera-SDK-Snapshot] [2/3] Trying: ${url}`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        auth: { username: camUser, password: camPass },
        // Sunell thường dùng digest auth, axios hỗ trợ basic auth
        // Nếu basic auth bị reject, camera sẽ trả về 401
        validateStatus: (status) => status < 500,
        maxRedirects: 3,
      });

      if (response.status === 200 && response.data && response.data.length > 100) {
        const imgBuffer = Buffer.from(response.data);
        // Kiểm tra JPEG header (FF D8 FF)
        const isJpeg = imgBuffer.length >= 3 && imgBuffer[0] === 0xFF && imgBuffer[1] === 0xD8 && imgBuffer[2] === 0xFF;
        // Kiểm tra PNG header (89 50 4E 47)
        const isPng = imgBuffer.length >= 4 && imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50 && imgBuffer[2] === 0x4E && imgBuffer[3] === 0x47;

        if (isJpeg || isPng) {
          const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
          const base64 = `data:${mimeType};base64,${imgBuffer.toString('base64')}`;
          _debugFE(`[Camera-SDK-Snapshot] [2/3] ✅ HTTP snapshot OK from ${url} | ${imgBuffer.length} bytes | ${mimeType}`);

          // Lưu file để debug
          try {
            const filename = `snap_http_${device.id}_${Date.now()}.${isJpeg ? 'jpg' : 'png'}`;
            const savePath = path.join(sunellSnapshotDir, filename);
            fs.writeFileSync(savePath, imgBuffer);
            return {
              success: true,
              method: 'http_cgi',
              camera: _sanitizeDevice(device),
              snapshotBase64: base64,
              snapshotPath: savePath,
              sourceUrl: url
            };
          } catch (_) {
            return {
              success: true,
              method: 'http_cgi',
              camera: _sanitizeDevice(device),
              snapshotBase64: base64,
              snapshotPath: null,
              sourceUrl: url
            };
          }
        } else {
          const headerHex = imgBuffer.slice(0, 16).toString('hex');
          _debugFE(`[Camera-SDK-Snapshot] [2/3] ${url} returned ${response.status} but not a valid image (header: ${headerHex})`);
        }
      } else {
        _debugFE(`[Camera-SDK-Snapshot] [2/3] ${url} returned status=${response.status} size=${response.data ? response.data.length : 0}`);
      }
    } catch (httpErr) {
      const errMsg = httpErr.code || httpErr.message || String(httpErr);
      _debugFE(`[Camera-SDK-Snapshot] [2/3] ${url} failed: ${errMsg}`);
    }
  }

  // Tất cả phương pháp đều thất bại
  return {
    success: false,
    statusCode: 502,
    error: 'All snapshot methods failed (SDK native, HTTP CGI/ISAPI)',
    methods_tried: ['sdk_native', 'http_cgi']
  };
}

async function getSnapshotUrlForCamera(cameraId) {
  const clientSockets = getClientSockets();
  const _debugFE = (msg) => {
    console.log(msg);
    if (clientSockets) clientSockets.emit('debug-camera-snapshot', { time: new Date().toISOString(), message: msg });
  };

  const device = cameraDevices.find(d => d.id === cameraId);
  if (!device) {
    _debugFE(`[Camera-Snapshot-URL] Camera '${cameraId}' not found. Available: ${cameraDevices.map(d => d.id).join(', ') || 'none'}`);
    return { success: false, statusCode: 404, error: 'Camera not found' };
  }

  _debugFE(`[Camera-Snapshot-URL] Capturing from ${maskSnapshotUrl(normalizeSnapshotUrlForCamera(device))}`);
  const result = await captureSnapshotUrlForCamera(device, {
    save: true,
    includeBase64: true,
    timeoutMs: SNAPSHOT_URL_TIMEOUT_MS,
  });

  if (!result.success) {
    _debugFE(`[Camera-Snapshot-URL] Failed: ${result.error}`);
  } else {
    _debugFE(`[Camera-Snapshot-URL] OK: ${result.size} bytes`);
  }
  return result;
}

module.exports = {
  addCameraDevice,
  removeCameraDevice,
  updateCameraDevice,
  getCamerasList,
  getSnapshotForCamera,
  getSdkSnapshotForCamera,
  getSnapshotUrlForCamera,
  updateCameraFeatures
};
