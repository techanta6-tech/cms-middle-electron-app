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
const TRAFFIC_RECORDS_MAX = 10000;

module.exports = {
  trafficRecords,
  TRAFFIC_RECORDS_MAX,
};
