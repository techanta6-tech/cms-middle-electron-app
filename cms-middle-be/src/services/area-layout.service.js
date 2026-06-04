const fs = require('fs');
const path = require('path');

const FILE_NAME = 'area-layout.json';

let dirty = false;
let lastSavedSignature = '';

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
    nodes: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLayout(layout) {
  return {
    ...emptyLayout(),
    ...layout,
    nodes: Array.isArray(layout?.nodes) ? layout.nodes : [],
  };
}

function loadLayout() {
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) return emptyLayout();

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const layout = normalizeLayout(parsed);
    lastSavedSignature = JSON.stringify(layout.nodes || []);
    return layout;
  } catch (err) {
    console.error('[Area-Layout] Failed to load layout:', err.message);
    return emptyLayout();
  }
}

function markDirty() {
  dirty = true;
}

function saveLayout(layout) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const next = {
    ...normalizeLayout(layout),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getFilePath(), JSON.stringify(next, null, 2), 'utf8');
  lastSavedSignature = JSON.stringify(next.nodes || []);
  dirty = false;
  return next;
}

function saveIfDirty(layout) {
  const nextSignature = JSON.stringify(Array.isArray(layout?.nodes) ? layout.nodes : []);
  if (!dirty && nextSignature === lastSavedSignature) return null;
  return saveLayout(layout);
}

module.exports = {
  getFilePath,
  loadLayout,
  markDirty,
  saveLayout,
  saveIfDirty,
};
