import type { ServerData, MqttServerConfig, SVMSServerData } from '../types';

function toStringValue(value: unknown, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function getServerKind(source: any, mapKey?: string): ServerData['type'] {
  const rawType = toStringValue(source?.type);
  const idLike = toStringValue(mapKey || source?.id || source?.server_id);

  switch (rawType) {
    case 'mqtt':
    case 'milesight-radar':
      return 'mqtt';
    case 'direct':
    case 'forwarded':
    case 'svms':
      return 'svms';
    default:
      if (idLike.startsWith('mqtt-')) return 'mqtt';
      return 'svms';
  }
}

function buildSvmsInfo(source: any, serverId: string, serverName: string): SVMSServerData {
  return {
    id: toStringValue(source.id || serverId),
    serial: toStringValue(source.serial),
    server_ip: toStringValue(source.server_ip || source.svms_ipv4_ip || source.sender_ip),
    server_name: serverName,
    version: toStringValue(source.version),
    location: toStringValue(source.location),
    day: Number(source.day || 0),
    month: Number(source.month || 0),
    year: Number(source.year || 0),
  };
}

function buildMqttInfo(source: any, serverId: string): MqttServerConfig {
  return {
    id: toStringValue(source.id || serverId).replace(/^mqtt-/, ''),
    name: source.name || source.server_name || '',
    brokerHost: toStringValue(source.brokerHost || source.server_ip || source.svms_ipv4_ip),
    brokerPort: toStringValue(source.brokerPort || ''),
    protocol: source.protocol || 'mqtt',
    topic: toStringValue(source.topic || source.mqttTopic),
    defaultTopic: toStringValue(source.defaultTopic || ''),
    status: source.status || source.connectionStatus || 'disconnected',
    logCount: source.logCount,
    cameraId: source.cameraId || null,
  };
}

export function normalizeServerData(raw: any, mapKey?: string): ServerData {
  const source = raw || {};
  const serverKind = getServerKind(source, mapKey);
  const serverId = toStringValue(
    source.server_id || source.id || source.serial || mapKey,
    serverKind === 'mqtt' ? toStringValue(source.id || mapKey) : 'unknown-server'
  );
  const serverName = toStringValue(
    source.custom_server_name || source.server_name || source.name || serverId,
    serverId
  );

  let svmsInfo: SVMSServerData | undefined;
  let mqttInfo: MqttServerConfig | undefined;

  switch (serverKind) {
    case 'mqtt':
      mqttInfo = buildMqttInfo(source, serverId);
      break;
    case 'svms':
    case 'direct':
    case 'forwarded':
    default:
      svmsInfo = buildSvmsInfo(source, serverId, serverName);
      break;
  }

  return {
    ...source,
    server_id: serverId,
    server_name: serverName,
    type: serverKind,
    custom_server_name: toStringValue(source.custom_server_name || serverName, serverName),
    svms_server_info: svmsInfo,
    milesight_server_info: mqttInfo,
    raw: source.raw || source,
    id: toStringValue(source.id || serverId),
    serial: toStringValue(source.serial),
    server_ip: toStringValue(source.server_ip || source.svms_ipv4_ip || source.sender_ip),
    svms_ipv4_ip: toStringValue(source.svms_ipv4_ip || source.server_ip || source.sender_ip),
    version: toStringValue(source.version),
    location: toStringValue(source.location),
    day: Number(source.day || 0),
    month: Number(source.month || 0),
    year: Number(source.year || 0),
    sender_ip: toStringValue(source.sender_ip),
    lastSeen: toStringValue(source.lastSeen),
    connectionStatus: source.connectionStatus || source.status || 'connected',
    lastLogReceived: toStringValue(source.lastLogReceived),
  };
}

export function normalizeServersRecord(rawServers: Record<string, any> = {}) {
  return Object.fromEntries(
    Object.entries(rawServers).map(([key, value]) => [key, normalizeServerData(value, key)])
  ) as Record<string, ServerData>;
}
