const fs = require('fs');
const path = require('path');
const { getClientSockets, mqttDeviceList } = require('../socketState');

// config resides at cms-middle-be/signalQualityMilesightConfig.json
const CONFIG_PATH = path.join(__dirname, '../../signalQualityMilesightConfig.json');

let config = {
  X: 60,
  Y: 5,
  countTimeOut: 3
};

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(rawData);
    if (typeof parsed.X === 'number') config.X = parsed.X;
    if (typeof parsed.Y === 'number') config.Y = parsed.Y;
    if (typeof parsed.countTimeOut === 'number') config.countTimeOut = parsed.countTimeOut;
  }
} catch (err) {
  console.error('[SignalQuality] Failed to load config', err);
}

const milesightLossRate = new Map();
const lastSeenMap = new Map();
const startupTime = Date.now();
let cronIntervalId = null;

function evaluateByPacketLoss(packetLossRate) {
  if (packetLossRate >= 50) {
    return { level: "ABNORMAL", reason: `Packet loss ${packetLossRate}% ≥ 50%`, input: { packetLossRate } };
  }
  if (packetLossRate > 10) {
    return { level: "WEAK", reason: `10% < Packet loss ${packetLossRate}% < 50%`, input: { packetLossRate } };
  }
  if (packetLossRate > 5) {
    return { level: "MEDIUM", reason: `5% < Packet loss ${packetLossRate}% ≤ 10%`, input: { packetLossRate } };
  }
  return { level: "STRONG", reason: `Packet loss ${packetLossRate}% ≤ 5%`, input: { packetLossRate } };
}

function evaluateByRssis(rssis, sf) {
  if (![7, 8, 9, 10, 11, 12].includes(sf)) {
    return { level: "UNKNOWN", reason: "Thiếu SF hoặc SF không nằm trong khoảng SF7-SF12.", input: { rssis, sf } };
  }
  const weakMinBySf = { 7: -115, 8: -120, 9: -125, 10: -130, 11: -135, 12: -141 };
  const abnormalBySf = { 7: -110, 8: -120, 9: -125, 10: -130, 11: -135, 12: -141 };

  if (rssis < abnormalBySf[sf]) {
    return { level: "ABNORMAL", reason: `SF${sf}: RSSIS ${rssis} dBm < ${abnormalBySf[sf]} dBm`, input: { rssis, sf } };
  }
  if (rssis >= weakMinBySf[sf] && rssis < -100) {
    return { level: "WEAK", reason: `SF${sf}: ${weakMinBySf[sf]} dBm ≤ RSSIS ${rssis} dBm < -100 dBm`, input: { rssis, sf } };
  }
  if (rssis >= -100 && rssis < -60) {
    return { level: "MEDIUM", reason: `-100 dBm ≤ RSSIS ${rssis} dBm < -60 dBm`, input: { rssis, sf } };
  }
  if (rssis >= -60) {
    return { level: "STRONG", reason: `RSSIS ${rssis} dBm ≥ -60 dBm`, input: { rssis, sf } };
  }
  return { level: "OUT_OF_TABLE", reason: "RSSIS không khớp bảng Milesight.", input: { rssis, sf } };
}

function evaluateMilesightSignal(input) {
  const hasPacketLoss = typeof input.packetLossRate === "number";
  const hasRssis = typeof input.rssis === "number";

  if (hasPacketLoss && hasRssis) {
    return { level: "UNKNOWN", reason: "Chỉ truyền một trong hai: packetLossRate hoặc rssis.", input };
  }
  if (!hasPacketLoss && !hasRssis) {
    return { level: "UNKNOWN", reason: "Thiếu input: cần packetLossRate hoặc rssis.", input };
  }
  if (hasPacketLoss) {
    return evaluateByPacketLoss(input.packetLossRate);
  }
  return evaluateByRssis(input.rssis, input.sf);
}

function isButtonDevice(entry) {
  if (!entry || !entry.deviceInfo) return false;
  const profileName = (entry.deviceInfo.deviceProfileName || '').toLowerCase();
  const devName = (entry.deviceInfo.deviceName || '').toLowerCase();
  return profileName.includes('ws101') || devName.includes('ws101') || 
         profileName.includes('button') || devName.includes('button');
}

function processIncomingLog(devEui, rssis, sf) {
  if (!devEui) return null;
  const now = Date.now();

  if (!milesightLossRate.has(devEui)) {
    milesightLossRate.set(devEui, []);
  }
  milesightLossRate.get(devEui).push(now);

  if (typeof rssis === 'number') {
    const resolvedSf = typeof sf === 'number' ? sf : 7;
    return evaluateMilesightSignal({ rssis, sf: resolvedSf });
  }
  
  return null;
}

function markDeviceOnline(deviceId) {
  lastSeenMap.set(deviceId, Date.now());
  const entry = mqttDeviceList.find((d) => d.id === deviceId);
  if (entry && entry.connectionStatus !== 'online') {
    entry.connectionStatus = 'online';
  }
}

function removeDevice(deviceId) {
  lastSeenMap.delete(deviceId);
}

function _emitState() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    const { getMqttDevicesList } = require('./mqtt.service');
    const deviceList = getMqttDevicesList();
    clientSockets.emit('update-mqtt-devices', deviceList);
    clientSockets.emit('update-mqtt-milesight-devices', deviceList);
  }
}

function startCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  
  cronIntervalId = setInterval(() => {
    const now = Date.now();
    let changed = false;

    // Cleanup and count Z
    for (const [devEui, timestamps] of milesightLossRate.entries()) {
      const entry = mqttDeviceList.find(d => d.deviceInfo?.devEui === devEui);
      const devX = entry?.packetLossConfig?.x ?? config.X;
      const devY = entry?.packetLossConfig?.y ?? config.Y;
      const thresholdTime = now - (devX * devY * 1000);
      const recentTimestamps = timestamps.filter(t => t >= thresholdTime);
      if (recentTimestamps.length === 0) {
        milesightLossRate.delete(devEui);
      } else {
        milesightLossRate.set(devEui, recentTimestamps);
      }
    }

    for (const entry of mqttDeviceList) {
      const devEui = entry.deviceInfo?.devEui;
      if (!devEui) continue;

      const devX = entry.packetLossConfig?.x ?? config.X;
      const devY = entry.packetLossConfig?.y ?? config.Y;
      const bucketSizeMs = devX * 1000;
      const PERIOD_MS = bucketSizeMs * devY;
      
      if (now - startupTime < PERIOD_MS) continue;

      const timestamps = milesightLossRate.get(devEui) || [];
      
      let Z = 0;
      const history = new Array(devY).fill(0);
      for (let i = 0; i < devY; i++) {
        const bucketStart = now - (i + 1) * bucketSizeMs;
        const bucketEnd = now - i * bucketSizeMs;
        const hasLog = timestamps.some(t => t > bucketStart && t <= bucketEnd);
        if (hasLog) {
          Z++;
          history[devY - 1 - i] = 1;
        }
      }

      const packetLossRate = ((devY - Z) / devY) * 100;
      
      let entryChanged = false;
      const historyStr = history.join('-');
      if (entry.packetLossHistory !== historyStr) {
        entry.packetLossHistory = historyStr;
        entryChanged = true;
      }
      
      if (entry.packetLoss !== packetLossRate) {
        entry.packetLoss = packetLossRate;
        entry.signalQuality = evaluateByPacketLoss(packetLossRate);
        entryChanged = true;
      }
      
      const lastSeen = lastSeenMap.has(entry.id)
        ? lastSeenMap.get(entry.id)
        : (entry.lastSeen ? new Date(entry.lastSeen).getTime() : null);

      const countTimeOut = entry.packetLossConfig?.countTimeOut ?? config.countTimeOut;
      
      if (lastSeen) {
        if (now - lastSeen > (countTimeOut * bucketSizeMs) && entry.connectionStatus !== 'offline') {
          entry.connectionStatus = 'offline';
          entryChanged = true;
        }
      } else if (now - startupTime > (countTimeOut * bucketSizeMs) && entry.connectionStatus !== 'offline') {
          entry.connectionStatus = 'offline';
          entryChanged = true;
      }
      
      if (entryChanged) changed = true;
    }

    if (changed) {
      _emitState();
    }
  }, 1000);
}

function stopCron() {
  if (!cronIntervalId) return;
  clearInterval(cronIntervalId);
  cronIntervalId = null;
}

module.exports = {
  startCron,
  stopCron,
  processIncomingLog,
  evaluateMilesightSignal,
  markDeviceOnline,
  removeDevice
};
