// ─── TRAFFIC SERVICE ───────────────────────────────────────────────────────────
// Xử lý lưu trữ và truy vấn bản ghi biển số xe (LPR) từ camera Sunell.

const fs = require('fs');
const path = require('path');
const { trafficRecords, TRAFFIC_RECORDS_MAX, blacklistPlates } = require('../trafficState');

// ─── File persistence ──────────────────────────────────────────────────────────
const _writableBase = process.env.USER_DATA_PATH || process.cwd();
const _trafficDir = path.join(_writableBase, 'data');
const _trafficFilePath = path.join(_trafficDir, 'trafficRecords.json');
const _blacklistFilePath = path.join(_trafficDir, 'blacklistPlates.json');
const _configFilePath = path.join(_trafficDir, 'trafficConfig.json');

if (!fs.existsSync(_trafficDir)) {
  fs.mkdirSync(_trafficDir, { recursive: true });
}

/**
 * Load traffic records và blacklist từ file khi BE khởi động.
 */
function loadTrafficRecords() {
  try {
    // 1. Phục hồi traffic records
    if (fs.existsSync(_trafficFilePath)) {
      const raw = fs.readFileSync(_trafficFilePath, 'utf8');
      const restored = JSON.parse(raw);
      if (Array.isArray(restored) && restored.length > 0) {
        const toRestore = restored.slice(-TRAFFIC_RECORDS_MAX);
        trafficRecords.push(...toRestore);
        console.log(`[Traffic] Khoi phuc ${toRestore.length} ban ghi tu ${_trafficFilePath}`);
      }
    }

    // 2. Phục hồi danh sách đen (blacklist)
    if (fs.existsSync(_blacklistFilePath)) {
      const raw = fs.readFileSync(_blacklistFilePath, 'utf8');
      const restored = JSON.parse(raw);
      if (Array.isArray(restored)) {
        blacklistPlates.length = 0;
        blacklistPlates.push(...restored);
        console.log(`[Traffic] Khoi phuc ${restored.length} bien so blacklist tu ${_blacklistFilePath}`);
      }
    } else {
      // Nếu file chưa tồn tại, lưu danh sách mặc định ra đĩa
      fs.writeFileSync(_blacklistFilePath, JSON.stringify(blacklistPlates), 'utf8');
    }

    // 3. Phục hồi cấu hình cơ chế blacklist
    if (fs.existsSync(_configFilePath)) {
      try {
        const raw = fs.readFileSync(_configFilePath, 'utf8');
        const config = JSON.parse(raw);
        if (config && config.blacklistMechanism !== undefined) {
          const { setBlacklistMechanism } = require('../trafficState');
          setBlacklistMechanism(config.blacklistMechanism);
          console.log(`[Traffic] Khoi phuc blacklistMechanism: ${config.blacklistMechanism} tu ${_configFilePath}`);
        }
      } catch (e) {
        console.error('[Traffic] Loi load config file:', e.message);
      }
    }
  } catch (err) {
    console.error('[Traffic] Loi khi khoi phuc trafficRecords/blacklist:', err.message);
  }
}

/**
 * Lưu traffic records và blacklist ra file (gọi định kỳ mỗi 1 phút).
 */
let _lastSavedCount = 0;
function saveTrafficRecords() {
  try {
    // Lưu traffic records
    if (trafficRecords.length !== _lastSavedCount) {
      // Khi lưu ra file, bỏ field base64 để giảm dung lượng
      const toSave = trafficRecords.map(r => {
        const { snapshot_base64, plateImageBase64, fullPlateImageBase64, overview_snapshot_base64, ...rest } = r;
        return rest;
      });
      fs.writeFileSync(_trafficFilePath, JSON.stringify(toSave), 'utf8');
      _lastSavedCount = trafficRecords.length;
      console.log(`[Traffic] Da luu ${trafficRecords.length} ban ghi ra ${_trafficFilePath}`);
    }

    // Lưu danh sách đen
    fs.writeFileSync(_blacklistFilePath, JSON.stringify(blacklistPlates), 'utf8');

    // Lưu cấu hình cơ chế blacklist
    const { getBlacklistMechanism } = require('../trafficState');
    const configToSave = {
      blacklistMechanism: getBlacklistMechanism(),
    };
    fs.writeFileSync(_configFilePath, JSON.stringify(configToSave), 'utf8');
  } catch (err) {
    console.error('[Traffic] Loi khi luu trafficRecords/blacklist:', err.message);
  }
}

/**
 * Trích xuất thông tin biển số từ Sunell LPR payload và thêm vào mảng trafficRecords.
 * @param {object} payload - Raw payload từ Sunell detect callback.
 * @param {object} device  - Device object { id, name, ... }
 * @returns {object|null} - Bản ghi vừa thêm, hoặc null nếu không có biển số.
 */
function appendTrafficRecord(payload, device) {
  if (!payload || !payload.TargetDetectList || !Array.isArray(payload.TargetDetectList)) {
    return null;
  }

  const results = [];

  for (const target of payload.TargetDetectList) {
    // Type === 3 là LPR
    if (target.Type !== 3) continue;

    const plateInfo = target.PlateInfo;
    if (!plateInfo) continue;

    const plateNum = plateInfo.Plate_num || '';
    if (!plateNum || plateNum.trim() === '') continue;

    const now = Date.now();
    const plateClean = plateNum.trim();
    const hasFullStreamSnapshot = !!payload.fullStreamSnapshotBase64 || !!payload.fullStreamSnapshotPath;
    const plateImagePath = payload.plateImagePath || (!hasFullStreamSnapshot ? (payload.snapshotPath || payload.sunellSnapshotPath || null) : null);
    const plateImageBase64 = payload.plateImageBase64 || (!hasFullStreamSnapshot ? (payload.snapshotBase64 || null) : null);
    const fullPlateImagePath = payload.fullStreamSnapshotPath || null;
    const fullPlateImageBase64 = payload.fullStreamSnapshotBase64 || null;
    
    // 1. Kiểm tra xem biển số xe có thuộc danh sách đen hay không
    const isBlack = blacklistPlates.includes(plateClean.toUpperCase());
    const { getBlacklistMechanism } = require('../trafficState');
    const mechanism = getBlacklistMechanism(); // 1: THÊM log, 2: THAY THẾ (Mặc định: 2)

    if (isBlack && mechanism === 2) {
      // Cơ chế 2 (Mặc định): THAY THẾ log_type hiện tại thành lpr_blacklist
      const record = {
        id: `traffic-${now}-${Math.floor(Math.random() * 10000)}`,
        plate_num: plateClean,
        camera_id: device.id || '',
        camera_name: device.name || 'Sunell Camera',
        snapshot_path: plateImagePath,
        snapshot_base64: plateImageBase64,
        plateImagePath,
        plateImageBase64,
        fullPlateImagePath,
        fullPlateImageBase64,
        overview_snapshot_path: payload.overviewSnapshotPath || null,
        overview_snapshot_base64: payload.overviewSnapshotBase64 || null,
        overview_snapshot_source: payload.overviewSnapshotSource || null,
        receive_time: now,
        created_at: new Date(now).toISOString(),
        confidence: plateInfo.Plate_confidence || null,
        plate_color: plateInfo.Plate_color != null ? plateInfo.Plate_color : null,
        plate_type: plateInfo.Plate_type != null ? plateInfo.Plate_type : null,
        log_type: 'lpr_blacklist', // Thay thế thành lpr_blacklist
        raw: plateInfo,
      };
      trafficRecords.push(record);
      results.push(record);
    } else {
      // Bản ghi gốc (lpr_normal)
      const record = {
        id: `traffic-${now}-${Math.floor(Math.random() * 10000)}`,
        plate_num: plateClean,
        camera_id: device.id || '',
        camera_name: device.name || 'Sunell Camera',
        snapshot_path: plateImagePath,
        snapshot_base64: plateImageBase64,
        plateImagePath,
        plateImageBase64,
        fullPlateImagePath,
        fullPlateImageBase64,
        overview_snapshot_path: payload.overviewSnapshotPath || null,
        overview_snapshot_base64: payload.overviewSnapshotBase64 || null,
        overview_snapshot_source: payload.overviewSnapshotSource || null,
        receive_time: now,
        created_at: new Date(now).toISOString(),
        confidence: plateInfo.Plate_confidence || null,
        plate_color: plateInfo.Plate_color != null ? plateInfo.Plate_color : null,
        plate_type: plateInfo.Plate_type != null ? plateInfo.Plate_type : null,
        log_type: 'lpr_normal',
        raw: plateInfo,
      };
      trafficRecords.push(record);
      results.push(record);

      if (isBlack && mechanism === 1) {
        // Cơ chế 1: Tạo THÊM 1 log mới với log_type là lpr_blacklist (Double logging)
        const blacklistRecord = {
          ...record,
          id: `traffic-${now}-${Math.floor(Math.random() * 10000)}`, // id mới để tránh trùng key
          log_type: 'lpr_blacklist',
        };
        trafficRecords.push(blacklistRecord);
        results.push(blacklistRecord);
      }
    }
  }

  // FIFO: giữ tối đa TRAFFIC_RECORDS_MAX
  while (trafficRecords.length > TRAFFIC_RECORDS_MAX) {
    trafficRecords.shift();
  }

  if (results.length === 0) return null;

  // Emit qua socket cho FE real-time
  try {
    const { getClientSockets } = require('../socketState');
    const clientSockets = getClientSockets();
    if (clientSockets) {
      clientSockets.emit('traffic-new-records', results);
    }
  } catch (err) {
    console.error('[Traffic] Loi emit socket:', err.message);
  }

  return results.length === 1 ? results[0] : results;
}

/**
 * Lấy danh sách bản ghi biển số với phân trang và tìm kiếm.
 * @param {object} options - { page, limit, search, camera_id }
 * @returns {object} - { total, page, limit, records }
 */
function getTrafficRecords(options = {}) {
  const { page = 1, limit = 50, search = '', camera_id = '' } = options;

  let filtered = [...trafficRecords];

  // Lọc theo camera_id
  if (camera_id) {
    filtered = filtered.filter(r => r.camera_id === camera_id);
  }

  // Tìm kiếm theo biển số
  if (search) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(r => r.plate_num.toLowerCase().includes(q));
  }

  // Sắp xếp mới nhất trước
  filtered.sort((a, b) => b.receive_time - a.receive_time);

  const total = filtered.length;
  const startIdx = (page - 1) * limit;
  const records = filtered.slice(startIdx, startIdx + limit);

  return { total, page, limit, records };
}

/**
 * Lấy thống kê tổng quan.
 */
function getTrafficStats() {
  const total = trafficRecords.length;

  // Đếm biển số duy nhất
  const uniquePlates = new Set(trafficRecords.map(r => r.plate_num));

  // Đếm theo camera
  const byCameraMap = {};
  trafficRecords.forEach(r => {
    if (!byCameraMap[r.camera_id]) {
      byCameraMap[r.camera_id] = { camera_id: r.camera_id, camera_name: r.camera_name, count: 0 };
    }
    byCameraMap[r.camera_id].count++;
  });

  // 10 biển số gần nhất
  const latest10 = [...trafficRecords]
    .sort((a, b) => b.receive_time - a.receive_time)
    .slice(0, 10)
    .map(r => ({
      plate_num: r.plate_num,
      camera_name: r.camera_name,
      receive_time: r.receive_time,
      created_at: r.created_at,
    }));

  return {
    total_records: total,
    unique_plates: uniquePlates.size,
    by_camera: Object.values(byCameraMap),
    latest_10: latest10,
    max_records: TRAFFIC_RECORDS_MAX,
    persist_file: _trafficFilePath,
  };
}

/**
 * Lấy toàn bộ records (dùng cho socket sync khi FE connect).
 * Trả về bản sao không có snapshot_base64 (quá nặng cho socket sync).
 */
function getTrafficRecordsForSync() {
  return trafficRecords.map(r => {
    const { snapshot_base64, plateImageBase64, fullPlateImageBase64, overview_snapshot_base64, raw, ...rest } = r;
    return rest;
  });
}

module.exports = {
  loadTrafficRecords,
  saveTrafficRecords,
  appendTrafficRecord,
  getTrafficRecords,
  getTrafficStats,
  getTrafficRecordsForSync,
  getFilePath: () => _trafficFilePath,
};
