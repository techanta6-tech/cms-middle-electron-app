// ─── TRAFFIC MODULE STATE ──────────────────────────────────────────────────────
// Lưu trữ các bản ghi biển số xe phát hiện từ camera Sunell (LPR events)

/**
 * Mảng lưu trữ bản ghi biển số xe.
 * Structure: [{
 *   id: string,                   // unique id
 *   plate_num: string,           // biển số xe (VD: "59DB14426")
 *   camera_id: string,           // id camera phát hiện
 *   camera_name: string,         // tên camera
 *   snapshot_path: string|null,  // đường dẫn file snapshot
 *   snapshot_base64: string|null,// ảnh base64 (không lưu vào file, chỉ emit qua socket)
 *   receive_time: number,        // Unix timestamp (ms) khi nhận log
 *   created_at: string,          // ISO string thời gian tạo
 *   confidence: number|null,     // độ tin cậy nhận diện (Plate_confidence)
 *   plate_color: number|null,    // màu biển
 *   plate_type: number|null,     // loại biển
 *   raw: object|null,            // PlateInfo gốc từ SDK
 * }]
 */
const trafficRecords = [];

/** Số bản ghi tối đa được giữ trong trafficRecords (FIFO) */
const TRAFFIC_RECORDS_MAX = 1000;

/** Danh sách biển số xe thuộc Blacklist */
const blacklistPlates = ['59P198278', '50N140063', '71C309683', '59PA16833'];

/**
 * Cơ chế xử lý khi biển số thuộc danh sách đen:
 * 1: Tạo THÊM 1 log mới với log_type là lpr_blacklist (Giữ log thường + Tạo log blacklist mới)
 * 2: THAY THẾ log_type hiện tại thành lpr_blacklist (Mặc định)
 */
let blacklistMechanism = 2;

module.exports = {
  trafficRecords,
  TRAFFIC_RECORDS_MAX,
  blacklistPlates,
  getBlacklistMechanism: () => blacklistMechanism,
  setBlacklistMechanism: (val) => {
    blacklistMechanism = Number(val) === 1 ? 1 : 2;
  },
};
