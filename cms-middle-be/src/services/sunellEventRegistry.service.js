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
  { event_type: 'motion_event',          event_description: 'sunell_motion_event_description',          default_enabled: true, event_group: 'motion'  },
  { event_type: 'lpr_event',             event_description: 'sunell_lpr_event_description',             default_enabled: true, event_group: 'lpr'  },
  { event_type: 'face_event',            event_description: 'sunell_face_event_description',            default_enabled: true, event_group: 'face'  },
  { event_type: 'iva_trip_wire',         event_description: 'sunell_iva_trip_wire_description',         default_enabled: true, event_group: 'iva'  },
  { event_type: 'iva_perimeter_intrusion',event_description: 'sunell_iva_perimeter_intrusion_description',default_enabled: true, event_group: 'iva'  },
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

    const missingSeeds = SEED_EVENTS.filter(seed => !sunellEvents.some(e => e.event_type === seed.event_type));
    if (missingSeeds.length > 0) {
      sunellEvents.push(...missingSeeds);
    }

    const hadMigration = parsed.some(e => e.default_enabled === undefined || e.event_group === undefined) || missingSeeds.length > 0;
    if (hadMigration) {
      _writeFile(filePath, sunellEvents);
      console.log(`[Sunell-Registry] Migrated legacy file (added default_enabled/event_group) → ${filePath}`);
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

  let group = undefined;
  if (eventType.startsWith('iva_')) group = 'iva';
  else if (eventType.includes('lpr')) group = 'lpr';
  else if (eventType.includes('face')) group = 'face';
  else if (eventType.includes('motion')) group = 'motion';

  const newEntry = {
    event_type: eventType,
    event_description: i18nDescKey,
    default_enabled: false,
    event_group: group
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
      event_group: e.event_group || seed?.event_group || undefined
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
