// ─── AGGREGATED STATE (reporting / API — tách khỏi socketState để dễ quản lý) ───

/**
 * Tổng hợp toàn bộ log nhận được từ tất cả nguồn (SVMS + MQTT).
 * Mỗi entry theo cấu trúc New_LogData (types.ts FE):
 * Structure: [{
 *   id?: string,
 *   receive_time: number,          // Unix timestamp (ms)
 *   log_type: string,
 *   log_description: string,
 *   snapshot?: string,
 *   log_source: 'svms' | 'milesight-radar' | 'sunell-camera',
 *   device_info: { name: string, id: string },  // id = device_index (SVMS) | devEui (MQTT)
 *   server_unique_id: string,      // 'serial-server_id' (SVMS) | 'mqtt-<id>' (MQTT)
 *   raw: any
 * }]
 */
const allLogs = [];

/** Số log tối đa được giữ trong allLogs (FIFO) */
const ALL_LOGS_MAX = 5000;

/**
 * Lưu raw req.body khi nhận server info từ SVMS (POST /api/v1/server).
 * Upsert theo id/serial — mỗi server SVMS chỉ có 1 entry, cập nhật khi nhận lại.
 * Structure: [{ ...raw server body từ SVMS, _receivedAt: ISO string }]
 */
const svmsServers = [];

/**
 * Lưu raw req.body khi nhận device list từ SVMS (POST /api/v1/devices).
 * Upsert theo server.server_id/serial — mỗi server chỉ có 1 entry device list.
 * Structure: [{ ...raw device body từ SVMS, _receivedAt: ISO string }]
 */
const svmsDevices = [];

/**
 * Danh sách MQTT devices đã gặp, tổng hợp từ các log MQTT nhận được.
 * Mỗi device được định danh duy nhất bằng (devEui + mqttServerId) — giống logic FE.
 * Structure: [{
 *   devEui: string,
 *   mqttServerId: string,
 *   deviceName: string,
 *   deviceProfileName: string,
 *   applicationId: string,
 *   applicationName: string,
 *   lastSeen: ISO string,
 *   raw: any   // payload.deviceInfo gốc
 * }]
 */
const mqttDeviceList = [];

module.exports = {
  allLogs,
  ALL_LOGS_MAX,
  svmsServers,
  svmsDevices,
  mqttDeviceList,
};
