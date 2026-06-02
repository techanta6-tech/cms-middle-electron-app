// ─── MILESIGHT DEVICE HEARTBEAT MONITOR ──────────────────────────────────────
// Tracks per-device "online / offline" status based on the last received
// MQTT message time.  Completely decoupled from the MQTT client connection
// state (entry.status).  This file owns the new `connectionStatus` field on
// each mqttDeviceList entry.

const { mqttDeviceList, getClientSockets } = require('../socketState');

/**
 * Map<deviceId, lastSeenTimestamp_ms>
 * Updated on every incoming MQTT message via markDeviceOnline().
 */
const lastSeenMap = new Map();

/** Handle returned by setInterval so we can clear it on stop. */
let _intervalId = null;

/** Resolved settings (set once at startHeartbeatMonitor). */
let _offlineThresholdMs = 60 * 1000; // 1 minute default
let _checkIntervalMs = 15 * 1000;    // 15 seconds default

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call this every time a MQTT message is received for a device.
 * Updates lastSeenMap and immediately marks the device as online
 * (so FE gets the update on the next _emitHeartbeatState call by the
 * caller — mqtt.service already calls _emitMqttStateUpdate after each msg).
 *
 * @param {string} deviceId  - entry.id from mqttDeviceList
 */
function markDeviceOnline(deviceId) {
  lastSeenMap.set(deviceId, Date.now());
  const entry = mqttDeviceList.find((d) => d.id === deviceId);
  if (entry) {
    entry.connectionStatus = 'online';
  }
}

/**
 * Remove a device from the heartbeat tracking map.
 * Call this when a device is removed from mqttDeviceList.
 *
 * @param {string} deviceId
 */
function removeDevice(deviceId) {
  lastSeenMap.delete(deviceId);
}

/**
 * Start the periodic heartbeat check.
 * Should be called once after bootstrapPersistedDevices().
 *
 * @param {{ offlineThresholdMinutes?: number, checkIntervalSeconds?: number }} settings
 */
function startHeartbeatMonitor(settings = {}) {
  const thresholdMinutes = Number(settings.offlineThresholdMinutes) || 1;
  const intervalSeconds = Number(settings.checkIntervalSeconds) || 15;

  _offlineThresholdMs = thresholdMinutes * 60 * 1000;
  _checkIntervalMs = intervalSeconds * 1000;

  if (_intervalId) {
    clearInterval(_intervalId);
  }

  _intervalId = setInterval(_checkAllDevices, _checkIntervalMs);

  console.log(
    `[MILESIGHT_HEARTBEAT] Monitor started — threshold: ${thresholdMinutes}m, check every: ${intervalSeconds}s`
  );
}

/**
 * Stop the heartbeat monitor (useful for graceful shutdown / tests).
 */
function stopHeartbeatMonitor() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    console.log('[MILESIGHT_HEARTBEAT] Monitor stopped');
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Runs on every interval tick.
 * Iterates all known mqttDeviceList entries, determines online/offline
 * based on lastSeenMap, and pushes the updated state to all FE clients.
 */
function _checkAllDevices() {
  const now = Date.now();
  let changed = false;

  for (const entry of mqttDeviceList) {
    // Only track devices whose MQTT client connection is active.
    // Devices that are genuinely disconnected/error keep their current
    // connectionStatus and are not marked offline by this monitor.
    if (entry.status !== 'connected') continue;

    const lastSeen = lastSeenMap.has(entry.id)
      ? lastSeenMap.get(entry.id)
      : (entry.lastSeen ? new Date(entry.lastSeen).getTime() : null);

    let nextStatus;
    if (!lastSeen) {
      // No data ever received → treat as offline
      nextStatus = 'offline';
    } else if (now - lastSeen > _offlineThresholdMs) {
      nextStatus = 'offline';
    } else {
      nextStatus = 'online';
    }

    if (entry.connectionStatus !== nextStatus) {
      entry.connectionStatus = nextStatus;
      changed = true;
      console.log(
        `[MILESIGHT_HEARTBEAT] Device '${entry.id}' → ${nextStatus}` +
        (lastSeen ? ` (last seen ${Math.round((now - lastSeen) / 1000)}s ago)` : ' (never seen)')
      );
    }
  }

  if (changed) {
    _emitHeartbeatState();
  }
}

/**
 * Emit the updated MQTT device list to all connected FE clients.
 * Mirrors the relevant events from mqtt.service._emitMqttStateUpdate.
 */
function _emitHeartbeatState() {
  const clientSockets = getClientSockets();
  if (!clientSockets) return;

  // Re-use the same shape that mqtt.service pushes so FE handlers don't
  // need any extra changes — just the new connectionStatus field is added.
  const deviceList = mqttDeviceList.map((d) => ({ ...d }));
  clientSockets.emit('update-mqtt-devices', deviceList);
  clientSockets.emit('update-mqtt-milesight-devices', deviceList);
}

module.exports = {
  markDeviceOnline,
  removeDevice,
  startHeartbeatMonitor,
  stopHeartbeatMonitor,
};
