// ─── TRAFFIC SERVICE ───────────────────────────────────────────────────────────
// Xử lý lưu trữ và truy vấn bản ghi biển số xe (LPR) từ camera Sunell.

const fs = require('fs');
const path = require('path');
const { trafficRecords, TRAFFIC_RECORDS_MAX } = require('../trafficState');

// ─── File persistence ──────────────────────────────────────────────────────────
const _writableBase = process.env.USER_DATA_PATH || process.cwd();
const _trafficDir = path.join(_writableBase, 'data');
const _trafficFilePath = path.join(_trafficDir, 'trafficRecords.json');

if (!fs.existsSync(_trafficDir)) {
  fs.mkdirSync(_trafficDir, { recursive: true });
}

/**
 * Load traffic records từ file khi BE khởi động.
 */
function loadTrafficRecords() {
  try {
    if (fs.existsSync(_trafficFilePath)) {
      const raw = fs.readFileSync(_trafficFilePath, 'utf8');
      const restored = JSON.parse(raw);
      if (Array.isArray(restored) && restored.length > 0) {
        const toRestore = restored.slice(-TRAFFIC_RECORDS_MAX);
        trafficRecords.push(...toRestore);
        console.log(`[Traffic] Khoi phuc ${toRestore.length} ban ghi tu ${_trafficFilePath}`);
      }
    }
  } catch (err) {
    console.error('[Traffic] Loi khi khoi phuc trafficRecords:', err.message);
  }
}

/**
 * Lưu traffic records ra file (gọi định kỳ mỗi 1 phút).
 */
let _lastSavedCount = 0;
function saveTrafficRecords() {
  try {
    if (trafficRecords.length === _lastSavedCount) return;

    // Khi lưu ra file, bỏ field snapshot_base64 để giảm dung lượng
    const toSave = trafficRecords.map(r => {
      const { snapshot_base64, ...rest } = r;
      return rest;
    });

    fs.writeFileSync(_trafficFilePath, JSON.stringify(toSave), 'utf8');
    _lastSavedCount = trafficRecords.length;
    console.log(`[Traffic] Da luu ${trafficRecords.length} ban ghi ra ${_trafficFilePath}`);
  } catch (err) {
    console.error('[Traffic] Loi khi luu trafficRecords:', err.message);
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
    const record = {
      id: `traffic-${now}-${Math.floor(Math.random() * 10000)}`,
      plate_num: plateNum.trim(),
      camera_id: device.id || '',
      camera_name: device.name || 'Sunell Camera',
      snapshot_path: payload.snapshotPath || payload.sunellSnapshotPath || null,
      snapshot_base64: payload.snapshotBase64 || null,
      receive_time: now,
      created_at: new Date(now).toISOString(),
      confidence: plateInfo.Plate_confidence || null,
      plate_color: plateInfo.Plate_color != null ? plateInfo.Plate_color : null,
      plate_type: plateInfo.Plate_type != null ? plateInfo.Plate_type : null,
      raw: plateInfo,
    };

    trafficRecords.push(record);
    results.push(record);
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
    const { snapshot_base64, raw, ...rest } = r;
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
