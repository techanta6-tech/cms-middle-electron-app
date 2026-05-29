// ─── SVMS EVENT REGISTRY SERVICE ─────────────────────────────────────────────
// Quản lý danh sách các loại sự kiện SVMS đã biết.
// - Load từ file JSON khi BE khởi động.
// - Tự động bổ sung event mới (auto-discover) khi nhận log có log_type chưa có.
// - Cung cấp danh sách cho FE qua socket (update-svms-known-events).
//
// Schema mỗi entry:
//   {
//     event_type: string,          // ví dụ: "ai.alarm.crosswire.all"
//     event_description: string,   // i18n key tham chiếu: "ai_alarm_crosswire_all_description"
//     default_enabled: boolean     // có bật mặc định khi chưa có cấu hình per-device không
//   }
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

/**
 * Lấy đường dẫn thư mục data — ưu tiên USER_DATA_PATH (Electron packaged).
 */
function getDataDir() {
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'event_registry');
  }
  return path.join(__dirname, '..', '..', 'data');
}

const FILE_NAME = 'svms_events.json';

/**
 * In-memory registry.
 * @type {Array<{event_type: string, event_description: string, default_enabled: boolean}>}
 */
let svmsEvents = [];

/**
 * Seed events: các event đã biết trước khi có log thực tế.
 * event_description = i18n key theo chuẩn: replace . → _, thêm _description.
 */
const SEED_EVENTS = [
  { event_type: 'motion', event_description: 'motion_description', default_enabled: true },
  { event_type: 'ai.alarm.crosswire.all', event_description: 'ai_alarm_crosswire_all_description', default_enabled: false },
  { event_type: 'ai.alarm.direction.all', event_description: 'ai_alarm_direction_all_description', default_enabled: false },
  { event_type: 'ai.alarm.missing.all', event_description: 'ai_alarm_missing_all_description', default_enabled: false },
  { event_type: 'videoloss', event_description: 'videoloss_description', default_enabled: false },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load registry từ file vào memory. Tạo file với seed events nếu chưa tồn tại.
 * Gọi một lần khi BE khởi động.
 */
function loadRegistry() {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    svmsEvents = _migrateLegacyEntries(SEED_EVENTS);
    _writeFile(filePath, svmsEvents);
    console.log(`[SVMS-Registry] Initialized with ${svmsEvents.length} seed events → ${filePath}`);
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Migrate: bổ sung default_enabled nếu file cũ chưa có trường này
    svmsEvents = _migrateLegacyEntries(parsed);

    // Nếu có migration → ghi lại file
    const hadMigration = parsed.some(e => e.default_enabled === undefined);
    if (hadMigration) {
      _writeFile(filePath, svmsEvents);
      console.log(`[SVMS-Registry] Migrated legacy file (added default_enabled) → ${filePath}`);
    }

    console.log(`[SVMS-Registry] Loaded ${svmsEvents.length} events from ${filePath}`);
  } catch (err) {
    console.error('[SVMS-Registry] Failed to parse registry file, using seeds:', err.message);
    svmsEvents = _migrateLegacyEntries(SEED_EVENTS);
  }
}

/**
 * Trả về bản sao của danh sách event hiện tại (để gửi qua socket).
 */
function getEvents() {
  return [...svmsEvents];
}

/**
 * Trả về Set các event_type đã biết (để check nhanh O(1)).
 */
function getKnownTypesSet() {
  return new Set(svmsEvents.map(e => e.event_type));
}

/**
 * Lấy giá trị default_enabled cho một event_type.
 * Dùng thay thế SVMS_DEFAULT_ON_CODES hardcode trong logs.routes.js.
 *
 * @param {string} eventType
 * @returns {boolean}
 */
function getDefaultEnabled(eventType) {
  const entry = svmsEvents.find(e => e.event_type === eventType);
  if (!entry) return false; // event lạ chưa trong registry → mặc định tắt
  return !!entry.default_enabled;
}

/**
 * Kiểm tra và bổ sung event_type mới vào registry nếu chưa có (auto-discover).
 * event_description được tạo tự động theo chuẩn i18n key.
 * Trả về true nếu có event mới được thêm vào.
 *
 * @param {string} eventType
 * @returns {boolean} isDirty
 */
function discoverEvent(eventType) {
  if (!eventType) return false;

  const alreadyExists = svmsEvents.some(e => e.event_type === eventType);
  if (alreadyExists) return false;

  // Tạo i18n key tham chiếu: replace dấu . thành _, thêm _description
  const i18nDescKey = 'svms_' + eventType.replace(/\./g, '_') + '_description';

  const newEntry = {
    event_type: eventType,
    event_description: i18nDescKey,
    default_enabled: false, // event mới phát hiện: mặc định tắt cho an toàn
  };
  svmsEvents.push(newEntry);

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);
  _writeFile(filePath, svmsEvents);
  console.log(`[SVMS-Registry] Discovered new event: '${eventType}' (i18n key: '${i18nDescKey}') → saved`);

  return true;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Bổ sung trường còn thiếu vào các entry legacy (file cũ không có default_enabled).
 * Tra cứu trong SEED_EVENTS để lấy default_enabled đúng; nếu không tìm thấy → false.
 */
function _migrateLegacyEntries(entries) {
  return entries.map(e => {
    const seed = SEED_EVENTS.find(s => s.event_type === e.event_type);
    return {
      event_type: e.event_type,
      // Nếu event_description cũ không theo chuẩn key → overwrite bằng key chuẩn
      event_description: seed
        ? seed.event_description
        : (e.event_description || e.event_type.replace(/\./g, '_') + '_description'),
      default_enabled: e.default_enabled !== undefined
        ? !!e.default_enabled
        : (seed ? seed.default_enabled : false),
    };
  });
}

function _writeFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[SVMS-Registry] Failed to write registry file:', err.message);
  }
}

module.exports = {
  loadRegistry,
  getEvents,
  getKnownTypesSet,
  getDefaultEnabled,
  discoverEvent,
};
