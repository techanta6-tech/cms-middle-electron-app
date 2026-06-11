const fs = require('fs');
const path = require('path');

let eventGroups = {};

function getDataDir() {
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'data');
  }
  return path.join(__dirname, '..', '..', 'data');
}

function loadEventGroups() {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, 'event_group.json');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    eventGroups = {
      motion: ["motion", "motion_event", "svms_motion"]
    };
    try {
      fs.writeFileSync(filePath, JSON.stringify(eventGroups, null, 2), 'utf-8');
      console.log(`[EventGroup] Initialized default event_group.json at ${filePath}`);
    } catch (err) {
      console.error('[EventGroup] Failed to write default event_group.json:', err.message);
    }
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    eventGroups = JSON.parse(raw);
    console.log(`[EventGroup] Loaded event groups:`, eventGroups);
  } catch (err) {
    console.error('[EventGroup] Failed to load event_group.json, using defaults:', err.message);
    eventGroups = {
      motion: ["motion", "motion_event", "svms_motion"]
    };
  }
}

function getEventGroupForLogType(logType) {
  if (!logType) return null;
  const normalizedLogType = String(logType).toLowerCase();
  for (const [groupName, eventTypes] of Object.entries(eventGroups)) {
    if (Array.isArray(eventTypes)) {
      if (eventTypes.some(type => String(type).toLowerCase() === normalizedLogType)) {
        return groupName;
      }
    }
  }
  return null;
}

function normalizeLog(log) {
  if (!log) return log;
  log.event_group = getEventGroupForLogType(log.log_type);
  return log;
}

module.exports = {
  loadEventGroups,
  getEventGroupForLogType,
  normalizeLog,
};
