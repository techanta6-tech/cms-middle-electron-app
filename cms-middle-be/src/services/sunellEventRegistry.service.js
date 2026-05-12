const fs = require('fs');
const path = require('path');

function getDataDir() {
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'event_registry');
  }
  return path.join(__dirname, '..', '..', 'data');
}

const FILE_NAME = 'sunell_events.json';

let sunellEvents = [];

const SEED_EVENTS = [
  { event_type: 'motion_event',          event_description: 'sunell_motion_event_description',          default_enabled: true  },
  { event_type: 'lpr_event',             event_description: 'sunell_lpr_event_description',             default_enabled: true  },
  { event_type: 'face_event',            event_description: 'sunell_face_event_description',            default_enabled: true  },
  { event_type: 'iva_trip_wire',         event_description: 'sunell_iva_trip_wire_description',         default_enabled: true  },
  { event_type: 'iva_perimeter_intrusion',event_description: 'sunell_iva_perimeter_intrusion_description',default_enabled: true  },
];

function loadRegistry() {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    sunellEvents = _migrateLegacyEntries(SEED_EVENTS);
    _writeFile(filePath, sunellEvents);
    console.log(`[Sunell-Registry] Initialized with ${sunellEvents.length} seed events → ${filePath}`);
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    sunellEvents = _migrateLegacyEntries(parsed);

    const hadMigration = parsed.some(e => e.default_enabled === undefined);
    if (hadMigration) {
      _writeFile(filePath, sunellEvents);
      console.log(`[Sunell-Registry] Migrated legacy file (added default_enabled) → ${filePath}`);
    }

    console.log(`[Sunell-Registry] Loaded ${sunellEvents.length} events from ${filePath}`);
  } catch (err) {
    console.error('[Sunell-Registry] Failed to parse registry file, using seeds:', err.message);
    sunellEvents = _migrateLegacyEntries(SEED_EVENTS);
  }
}

function getEvents() {
  return [...sunellEvents];
}

function getKnownTypesSet() {
  return new Set(sunellEvents.map(e => e.event_type));
}

function getDefaultEnabled(eventType) {
  const entry = sunellEvents.find(e => e.event_type === eventType);
  if (!entry) return false;
  return !!entry.default_enabled;
}

function discoverEvent(eventType) {
  if (!eventType) return false;

  const alreadyExists = sunellEvents.some(e => e.event_type === eventType);
  if (alreadyExists) return false;

  const i18nDescKey = 'sunell_' + eventType.replace(/\./g, '_') + '_description';

  const newEntry = {
    event_type: eventType,
    event_description: i18nDescKey,
    default_enabled: false,
  };
  sunellEvents.push(newEntry);

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);
  _writeFile(filePath, sunellEvents);
  console.log(`[Sunell-Registry] Discovered new event: '${eventType}' (i18n key: '${i18nDescKey}') → saved`);

  return true;
}

function _migrateLegacyEntries(entries) {
  return entries.map(e => {
    const seed = SEED_EVENTS.find(s => s.event_type === e.event_type);
    return {
      event_type: e.event_type,
      event_description: seed
        ? seed.event_description
        : (e.event_description || ('sunell_' + e.event_type.replace(/\./g, '_') + '_description')),
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
    console.error('[Sunell-Registry] Failed to write registry file:', err.message);
  }
}

module.exports = {
  loadRegistry,
  getEvents,
  getKnownTypesSet,
  getDefaultEnabled,
  discoverEvent,
};
