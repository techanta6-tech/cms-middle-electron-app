const fs = require('fs');
const path = require('path');

const FILE_NAME = 'emap-layout.json';

function getDataDir() {
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'layout');
  }
  return path.join(__dirname, '..', '..', 'data');
}

function getFilePath() {
  return path.join(getDataDir(), FILE_NAME);
}

function emptyLayout() {
  return {
    version: 1,
    pins: [],
    tileProviderId: 'openstreetmap',
    updatedAt: new Date().toISOString(),
  };
}

function loadLayout() {
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) return emptyLayout();

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      ...emptyLayout(),
      ...parsed,
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    };
  } catch (err) {
    console.error('[EMap-Layout] Failed to load layout:', err.message);
    return emptyLayout();
  }
}

function saveLayout(layout) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const next = {
    ...emptyLayout(),
    ...layout,
    pins: Array.isArray(layout?.pins) ? layout.pins : [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getFilePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  getFilePath,
  loadLayout,
  saveLayout,
};
