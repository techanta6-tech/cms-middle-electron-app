const fs = require('fs');
const path = require('path');

function getDataDir() {
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'event_registry');
  }
  return path.join(__dirname, '..', '..', 'data');
}

const FILE_NAME = 'milesight_events.json';

let milesightEvents = [];

const SEED_EVENTS = [
  { event_type: 'fall',        event_description: 'milesight_fall_description',        default_enabled: true  },
  { event_type: 'motionless',  event_description: 'milesight_motionless_description',  default_enabled: false },
  { event_type: 'dwell',       event_description: 'milesight_dwell_description',       default_enabled: false },
  { event_type: 'out_of_bed',  event_description: 'milesight_out_of_bed_description',  default_enabled: false },
  { event_type: 'occupied',    event_description: 'milesight_occupied_description',    default_enabled: false },
  { event_type: 'vacant',      event_description: 'milesight_vacant_description',      default_enabled: false },
  { event_type: 'bradynea',    event_description: 'milesight_bradynea_description',    default_enabled: false },
  { event_type: 'tachypnea',   event_description: 'milesight_tachypnea_description',   default_enabled: false },
  { event_type: 'lying',       event_description: 'milesight_lying_description',       default_enabled: false },
];

function loadRegistry() {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    milesightEvents = _migrateLegacyEntries(SEED_EVENTS);
    _writeFile(filePath, milesightEvents);
    console.log(`[Milesight-Registry] Initialized with ${milesightEvents.length} seed events → ${filePath}`);
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    milesightEvents = _migrateLegacyEntries(parsed);

    const hadMigration = parsed.some(e => e.default_enabled === undefined);
    if (hadMigration) {
      _writeFile(filePath, milesightEvents);
      console.log(`[Milesight-Registry] Migrated legacy file (added default_enabled) → ${filePath}`);
    }

    console.log(`[Milesight-Registry] Loaded ${milesightEvents.length} events from ${filePath}`);
  } catch (err) {
    console.error('[Milesight-Registry] Failed to parse registry file, using seeds:', err.message);
    milesightEvents = _migrateLegacyEntries(SEED_EVENTS);
  }
}

function getEvents() {
  return [...milesightEvents];
}

function getKnownTypesSet() {
  return new Set(milesightEvents.map(e => e.event_type));
}

function getDefaultEnabled(eventType) {
  const entry = milesightEvents.find(e => e.event_type === eventType);
  if (!entry) return false;
  return !!entry.default_enabled;
}

function discoverEvent(eventType) {
  if (!eventType) return false;

  const alreadyExists = milesightEvents.some(e => e.event_type === eventType);
  if (alreadyExists) return false;

  const i18nDescKey = 'milesight_' + eventType.replace(/\./g, '_') + '_description';

  const newEntry = {
    event_type: eventType,
    event_description: i18nDescKey,
    default_enabled: false,
  };
  milesightEvents.push(newEntry);

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, FILE_NAME);
  _writeFile(filePath, milesightEvents);
  console.log(`[Milesight-Registry] Discovered new event: '${eventType}' (i18n key: '${i18nDescKey}') → saved`);

  return true;
}

function _migrateLegacyEntries(entries) {
  return entries.map(e => {
    const seed = SEED_EVENTS.find(s => s.event_type === e.event_type);
    return {
      event_type: e.event_type,
      event_description: seed
        ? seed.event_description
        : (e.event_description || ('milesight_' + e.event_type.replace(/\./g, '_') + '_description')),
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
    console.error('[Milesight-Registry] Failed to write registry file:', err.message);
  }
}

module.exports = {
  loadRegistry,
  getEvents,
  getKnownTypesSet,
  getDefaultEnabled,
  discoverEvent,
};
