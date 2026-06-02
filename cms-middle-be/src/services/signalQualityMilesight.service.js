const fs = require('fs');
const path = require('path');
const { getClientSockets, mqttDeviceList } = require('../socketState');

// config resides at cms-middle-be/signalQualityMilesightConfig.json
const CONFIG_PATH = path.join(__dirname, '../../signalQualityMilesightConfig.json');

let config = {
  X: 60,
  Y: 5
};

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(rawData);
    if (typeof parsed.X === 'number') config.X = parsed.X;
    if (typeof parsed.Y === 'number') config.Y = parsed.Y;
  }
} catch (err) {
  console.error('[SignalQuality] Failed to load config', err);
}

const milesightLossRate = new Map();
let cronRuns = 0;
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

function processIncomingLog(devEui, rssis, sf, entry) {
  if (!devEui) return;
  const now = Date.now();

  if (!milesightLossRate.has(devEui)) {
    milesightLossRate.set(devEui, []);
  }
  milesightLossRate.get(devEui).push(now);

  if (entry && typeof rssis === 'number') {
    const resolvedSf = typeof sf === 'number' ? sf : 7;
    const result = evaluateMilesightSignal({ rssis, sf: resolvedSf });
    entry.signalQuality = result;
  }
}

function _emitState() {
  const clientSockets = getClientSockets();
  if (clientSockets) {
    const deviceList = mqttDeviceList.map((d) => ({ ...d }));
    clientSockets.emit('update-mqtt-devices', deviceList);
    clientSockets.emit('update-mqtt-milesight-devices', deviceList);
  }
}

function startCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  
  cronIntervalId = setInterval(() => {
    cronRuns++;
    const now = Date.now();
    const PERIOD_MS = config.X * config.Y * 1000;
    const thresholdTime = now - PERIOD_MS;
    let changed = false;

    // Cleanup and count Z
    for (const [devEui, timestamps] of milesightLossRate.entries()) {
      const recentTimestamps = timestamps.filter(t => t >= thresholdTime);
      if (recentTimestamps.length === 0) {
        milesightLossRate.delete(devEui);
      } else {
        milesightLossRate.set(devEui, recentTimestamps);
      }
    }

    if (cronRuns <= config.Y) {
      return; // Skip evaluation for first Y runs
    }

    for (const entry of mqttDeviceList) {
      if (isButtonDevice(entry)) continue;

      const devEui = entry.deviceInfo?.devEui;
      if (!devEui) continue;

      const timestamps = milesightLossRate.get(devEui) || [];
      let Z = timestamps.length;
      if (Z > config.Y) Z = config.Y;

      const packetLossRate = ((config.Y - Z) / config.Y) * 100;
      entry.packetLoss = packetLossRate;
      
      const result = evaluateMilesightSignal({ packetLossRate });
      entry.signalQuality = result;
      changed = true;
    }

    if (changed) {
      _emitState();
    }
  }, config.X * 1000);
  console.log(`[SIGNAL_QUALITY] Cron started with X=${config.X}s, Y=${config.Y}`);
}

module.exports = {
  startCron,
  processIncomingLog,
  evaluateMilesightSignal
};
