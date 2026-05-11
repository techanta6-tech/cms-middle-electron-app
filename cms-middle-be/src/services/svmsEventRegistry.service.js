// ─── SVMS EVENT REGISTRY SERVICE ─────────────────────────────────────────────
// Quản lý danh sách các loại sự kiện SVMS đã biết.
// - Load từ file JSON khi BE khởi động.
// - Tự động bổ sung event mới khi nhận log có log_type chưa có.
// - Cung cấp danh sách cho FE qua socket.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

/**
 * Lấy đường dẫn thư mục data — ưu tiên USER_DATA_PATH (Electron packaged).
 * @returns {string}
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
 * Structure: [{ event_type: string, event_description: string }]
 */
let svmsEvents = [];

/**
 * Các event mặc định được seed vào file nếu file chưa tồn tại.
 * Đây là các event đã biết trước, có thể bổ sung thêm.
 */
const SEED_EVENTS = [
  { event_type: 'motion',                event_description: '' },
  { event_type: 'ai.alarm.crosswire.all', event_description: '' },
  { event_type: 'ai.alarm.direction.all', event_description: '' },
  { event_type: 'ai.alarm.missing.all',   event_description: '' },
  { event_type: 'videoloss',             event_description: '' },
];

/**
 * Load registry từ file vào memory. Tạo file với seed events nếu chưa tồn tại.
 */
function loadRegistry() {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    svmsEvents = [...SEED_EVENTS];
    _writeFile(filePath, svmsEvents);
    console.log(`[SVMS-Registry] Initialized with ${svmsEvents.length} seed events → ${filePath}`);
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    svmsEvents = JSON.parse(raw);
    console.log(`[SVMS-Registry] Loaded ${svmsEvents.length} events from ${filePath}`);
  } catch (err) {
    console.error('[SVMS-Registry] Failed to parse registry file, using seeds:', err.message);
    svmsEvents = [...SEED_EVENTS];
  }
}

/**
 * Trả về bản sao của danh sách event hiện tại.
 * @returns {Array<{event_type: string, event_description: string}>}
 */
function getEvents() {
  return [...svmsEvents];
}

/**
 * Trả về Set các event_type đã biết (để check nhanh).
 * @returns {Set<string>}
 */
function getKnownTypesSet() {
  return new Set(svmsEvents.map(e => e.event_type));
}

/**
 * Kiểm tra và bổ sung event_type mới vào registry nếu chưa có.
 * Trả về true nếu có event mới được thêm vào.
 *
 * @param {string} eventType
 * @param {string} [eventDescription='']
 * @returns {boolean} isDirty
 */
function discoverEvent(eventType, eventDescription = '') {
  if (!eventType) return false;

  const alreadyExists = svmsEvents.some(e => e.event_type === eventType);
  if (alreadyExists) return false;

  const newEntry = {
    event_type: eventType,
    event_description: eventDescription || '',
  };
  svmsEvents.push(newEntry);

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);
  _writeFile(filePath, svmsEvents);
  console.log(`[SVMS-Registry] Discovered new event type: '${eventType}' → saved to file`);

  return true;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

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
  discoverEvent,
};
