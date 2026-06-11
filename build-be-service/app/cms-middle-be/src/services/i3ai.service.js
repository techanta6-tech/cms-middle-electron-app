const { appendLog } = require('./system-state.service');
const { getClientSockets, servers } = require('../socketState');
const persistedDevices = require('./persisted-devices.service');

function normalizeIp(value) {
  return String(value || '')
    .split(',')[0]
    .trim()
    .replace(/^::ffff:/, '');
}

function getSourceIp(req) {
  const body = req.body || {};
  return normalizeIp(
    body.sender_ip ||
    body.source_ip ||
    body.server_ip ||
    body.ip ||
    body.i3ai_ip ||
    req.headers['x-i3ai-ip'] ||
    req.headers['x-source-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    req.ip
  );
}

function makeServerId(sourceIp) {
  return `i3ai-${sourceIp}`;
}

function sanitizeServer(entry) {
  return {
    id: entry.id,
    server_id: entry.server_id,
    serial: entry.serial,
    server_name: entry.server_name,
    custom_server_name: entry.custom_server_name || '',
    server_ip: entry.server_ip,
    sender_ip: entry.sender_ip,
    type: 'i3ai',
    connectionStatus: entry.connectionStatus || 'connected',
    lastSeen: entry.lastSeen,
    lastLogReceived: entry.lastLogReceived,
  };
}

function upsertI3AiServer(sourceIp, updates = {}) {
  if (!sourceIp) {
    throw new Error('Missing i3AI source IP');
  }

  const serverId = makeServerId(sourceIp);
  const now = new Date().toISOString();
  const existing = servers.get(serverId) || {};
  const alias = updates.alias !== undefined ? String(updates.alias || '').trim() : existing.custom_server_name || '';
  const displayName = alias || sourceIp;
  const entry = {
    ...existing,
    ...updates,
    id: serverId,
    server_id: sourceIp,
    serial: sourceIp,
    server_name: displayName,
    custom_server_name: alias,
    server_ip: sourceIp,
    sender_ip: sourceIp,
    type: 'i3ai',
    connectionStatus: 'connected',
    lastSeen: now,
    lastLogReceived: updates.lastLogReceived || existing.lastLogReceived || now,
  };

  servers.set(serverId, entry);
  persistedDevices.persistI3AiServer(entry);
  emitI3AiServers();
  return entry;
}

function buildPlaceholderLog(payload, sourceIp, serverEntry) {
  const now = Date.now();
  const randomId = `i3ai-${now}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: randomId,
    receive_time: now,
    log_type: 'placeholder',
    log_description: 'placeholder',
    snapshot: undefined,
    log_source: 'i3ai',
    device_info: {
      name: 'placeholder',
      id: randomId,
    },
    server_unique_id: serverEntry.id,
    raw: payload,
    server: {
      server_id: sourceIp,
      serial: sourceIp,
      server_name: serverEntry.server_name || sourceIp,
    },
  };
}

function ingestExternalAlert(req) {
  const sourceIp = getSourceIp(req);
  const serverEntry = upsertI3AiServer(sourceIp, {
    lastLogReceived: new Date().toISOString(),
  });
  const logData = buildPlaceholderLog(req.body || {}, sourceIp, serverEntry);
  appendLog(logData);
  return { server: sanitizeServer(serverEntry), log: logData };
}

function listI3AiServers() {
  return Array.from(servers.values())
    .filter(entry => entry.type === 'i3ai')
    .map(sanitizeServer);
}

function updateI3AiServer(serverId, updates = {}) {
  const existing = servers.get(serverId);
  if (!existing || existing.type !== 'i3ai') {
    return null;
  }
  return sanitizeServer(upsertI3AiServer(existing.server_ip || existing.sender_ip || existing.server_id, {
    alias: updates.alias,
  }));
}

function removeI3AiServer(serverId) {
  const existing = servers.get(serverId);
  if (!existing || existing.type !== 'i3ai') {
    return false;
  }
  servers.delete(serverId);
  persistedDevices.removeI3AiServer(serverId);
  emitI3AiServers();
  return true;
}

function restoreI3AiServers(items = []) {
  let count = 0;
  for (const item of items) {
    const data = item.data || item;
    const sourceIp = data.server_ip || data.sender_ip || data.server_id || item.sourceIp;
    if (!sourceIp) continue;
    const serverId = data.id || makeServerId(sourceIp);
    servers.set(serverId, {
      ...data,
      id: serverId,
      server_id: sourceIp,
      serial: data.serial || sourceIp,
      server_name: data.custom_server_name || data.server_name || sourceIp,
      server_ip: sourceIp,
      sender_ip: sourceIp,
      type: 'i3ai',
      connectionStatus: 'disconnected',
      lastSeen: new Date().toISOString(),
    });
    count += 1;
  }
  return count;
}

function emitI3AiServers() {
  const clientSockets = getClientSockets();
  if (!clientSockets) return;
  clientSockets.emit('receive-server-information', { allServers: Object.fromEntries(servers) });
  clientSockets.emit('update-i3ai-servers', listI3AiServers());
}

module.exports = {
  getSourceIp,
  ingestExternalAlert,
  listI3AiServers,
  updateI3AiServer,
  removeI3AiServer,
  restoreI3AiServers,
};
