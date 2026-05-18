import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { socket, updateSocketUrlAsync, getBeHost, getBePort } from '../socket';
import type { LogData, SystemConnection, SystemConfig, ServerData, DeviceData, MqttServerConfig, MQTT_Milesight_LogEntry, MqttDeviceConfig, DeviceCameraLink, SVMSServer, SMVSDevices, MQTT_Milesight_DeviceInfo, EventTypeItem } from '../types';
import apiClient from '../api/apiClient';
import axios from 'axios';

export interface SvmsKnownEvent {
  event_type: string;
  event_description: string; // i18n key tham chiếu, ví dụ: 'ai_alarm_crosswire_all_description'
  default_enabled: boolean;
}

export interface MilesightKnownEvent {
  event_type: string;
  event_description: string;
  default_enabled: boolean;
}

export interface SunellKnownEvent {
  event_type: string;
  event_description: string;
  default_enabled: boolean;
}

const env = {
  MAX_LOGS_LIST: Number(import.meta.env.VITE_MAX_LOGS_LIST) || 5000,
  KEEP_TOTAL_LOG_COUNT: import.meta.env.VITE_KEEP_TOTAL_LOG_COUNT === 'true'
};

console.log('[DEBUG_ENV] VITE_MAX_LOGS_LIST:', import.meta.env.VITE_MAX_LOGS_LIST, '->', env.MAX_LOGS_LIST);

/**
 * LOG_TYPE_GROUPS
 * Map từ "tên nhóm hiển thị trên Filter UI" → danh sách tất cả các giá trị
 * log_type thực tế có thể đến từ các nguồn khác nhau (SVMS, MQTT, Sunell...).
 *
 * KEY FORMAT: Phải trùng với prefix (bỏ svms_/milesight_/sunell_) hoặc tên nhóm.
 * Khi nhận log_type mới không có trong group nào, nó sẽ được add thẳng vào filter.
 */
const LOG_TYPE_GROUPS: Record<string, string[]> = {
  // SVMS: nhóm sự kiện với alias gốc từ thiết bị
  'ai_alarm_crosswire_all': ['ai_alarm_crosswire_all', 'crosswire', 'ai.alarm.crosswire.all', 'iva_trip_wire'],
  'ai_alarm_direction_all': ['ai_alarm_direction_all', 'direction', 'ai.alarm.direction.all'],
  'ai_alarm_missing_all': ['ai_alarm_missing_all', 'ai.alarm.missing.all'],
  'motion': ['motion', 'a_motion_has_been_detected', 'phát_hiện_chuyển_động_(motion)'],
  'videoloss': ['videoloss'],
  // Sunell
  'lpr_event': ['lpr_event', 'phát_hiện_biển_số_(lpr)'],
  'face_event': ['face_event', 'phát_hiện_khuôn_mặt_(face)'],
  'motion_event': ['motion_event'],
  'alarm_event': ['alarm_event'],
  'iva_event': ['iva_event', 'phân_tích_ai_(ivs/iva)'],
};

/**
 * Resolve raw log_type về group key nếu nó là alias trong LOG_TYPE_GROUPS.
 * Dùng khi add vào eventTypeBufferRef để tránh tạo mục filter riêng cho alias.
 * Ví dụ: 'ai.alarm.direction.all' → 'ai_alarm_direction_all'
 */
const resolveToGroupKey = (logType: string): string => {
  for (const [groupKey, members] of Object.entries(LOG_TYPE_GROUPS)) {
    if (members.includes(logType)) return groupKey;
  }
  return logType;
};

/**
 * Kiểm tra log có thuộc filter đang chọn không.
 * Hỗ trợ:
 *  - Khớp trực tiếp (log_type === filterType)
 *  - Khớp qua LOG_TYPE_GROUPS alias
 *  - Khớp khi filterType là key chuẩn hóa từ registry (dấu chấm → gạch dưới)
 */
const isTypeMatched = (logType: string, filterType: string | null) => {
  if (!filterType) return true;
  const normalizedLogType = logType.replace(/\./g, '_');
  const matched =
    logType === filterType ||
    normalizedLogType === filterType ||
    (LOG_TYPE_GROUPS[filterType]?.includes(logType) ?? false) ||
    (LOG_TYPE_GROUPS[filterType]?.includes(normalizedLogType) ?? false);
  return matched;
};

/**
 * Lấy tên hiển thị (đã dịch) cho một log_type bất kỳ.
 *
 * Thứ tự ưu tiên:
 *  1. Tra trực tiếp key có tiền tố source (svms_, milesight_, sunell_).
 *  2. Tra trực tiếp key trong i18n (ví dụ: 'crosswire', 'lpr_event').
 *  3. Tìm group chứa logType, lấy tên của group đó từ i18n.
 *  4. Fallback: trả về chính logType đó.
 *
 * @param logType - Giá trị filter key từ eventTypes state (đã chuẩn hóa: dấu chấm → gạch dưới)
 * @param t       - Hàm dịch từ useTranslation()
 * @returns Chuỗi tên hiển thị đã được dịch
 */
export const getLogTypeDisplayName = (logType: string, t: (key: string) => string): string => {
  const normalized = logType.replace(/\./g, '_');

  // Bước 1: Thử tra key có tiền tố source (registry-based keys)
  for (const prefix of ['svms_', 'milesight_', 'sunell_']) {
    const prefixedKey = `app.logtype.${prefix}${normalized}`;
    const result = t(prefixedKey);
    if (result !== prefixedKey) return result;
  }

  // Bước 2: Thử tra trực tiếp
  const directKey = `app.logtype.${normalized}`;
  const directResult = t(directKey);
  if (directResult !== directKey) return directResult;

  // Bước 3: Tìm group chứa logType này, rồi dùng tên group để tra i18n
  for (const [groupKey, members] of Object.entries(LOG_TYPE_GROUPS)) {
    if (members.includes(logType) || members.includes(normalized)) {
      const groupI18nKey = `app.logtype.${groupKey}`;
      const groupResult = t(groupI18nKey);
      if (groupResult !== groupI18nKey) return groupResult;
    }
  }

  // Bước 4: Fallback — trả về chính logType
  return logType;
};

type SystemSnapshot = {
  connections?: SystemConnection[];
  sendServers?: SystemConnection[];
  receiveServers?: SystemConnection[];
  servers?: Record<string, ServerData>;
  devices?: Record<string, DeviceData>;
  svmsServers?: SVMSServer[];
  svmsDevices?: SMVSDevices[];
  mqttServers?: (MqttServerConfig & { devices?: MQTT_Milesight_DeviceInfo[] })[];
  mqttDeviceList?: MQTT_Milesight_DeviceInfo[];
  cameras?: MqttDeviceConfig[];
  allLogs?: LogData[];
  prefilter?: any[];
  gridLayout?: { grids: any[]; gridCols: number };
  knownEvents?: {
    svms?: SvmsKnownEvent[];
    milesight?: MilesightKnownEvent[];
    sunell?: SunellKnownEvent[];
  };
  compatibility?: {
    svmsDeviceFeatures?: { serverId: string; deviceIndex: string; features: Record<string, boolean> }[];
    deviceCameraLinks?: DeviceCameraLink[];
  };
};

const getFilterLogSource = (source: LogData['log_source'] | undefined): EventTypeItem['log_source'] => {
  if (source === 'milesight-radar') return 'mqtt';
  return source || null;
};

export function useSocketManager() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  useEffect(() => {
    setIsConnected(socket.connected);
  }, [socket.connected]);

  const [logs, setLogs] = useState<LogData[]>([]);
  const [totalLogCount, setTotalLogCount] = useState(0);
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);

  const [eventTypes, setEventTypes] = useState<EventTypeItem[]>([]);
  const [mqttLogs, setMqttLogs] = useState<MQTT_Milesight_LogEntry[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MqttDeviceConfig[]>([]);
  const [deviceCameraLinks, setDeviceCameraLinks] = useState<DeviceCameraLink[]>([]);
  const [gridLayout, setGridLayout] = useState<{ grids: any[]; gridCols: number }>({ grids: [], gridCols: 3 });

  // SVMS per-device event feature config
  const [svmsDeviceFeatures, setSvmsDeviceFeatures] = useState<{ serverId: string; deviceIndex: string; features: Record<string, boolean> }[]>([]);

  // ─── Known Events States (Synced from BE JSON files) ───────────────────────
  const [svmsKnownEvents, setSvmsKnownEvents] = useState<SvmsKnownEvent[]>([]);
  const [milesightKnownEvents, setMilesightKnownEvents] = useState<MilesightKnownEvent[]>([]);
  const [sunellKnownEvents, setSunellKnownEvents] = useState<SunellKnownEvent[]>([]);

  // ─── Seed eventTypes filter list từ registry khi BE sync ────────────────────
  // Mỗi lần registry thay đổi, rebuild lại danh sách filter từ JSON, sau đó
  // merge với các event đã discovered runtime (giữ lại những gì đã tích lũy).
  useEffect(() => {
    const fromRegistry: EventTypeItem[] = [
      // SVMS
      ...svmsKnownEvents.map(e => ({
        event_type: e.event_type.replace(/\./g, '_'),
        log_source: 'svms' as const,
      })),
      // Milesight (source = 'mqtt')
      ...milesightKnownEvents.map(e => ({
        event_type: e.event_type.replace(/\./g, '_'),
        log_source: 'mqtt' as const,
      })),
      // Sunell
      ...sunellKnownEvents.map(e => ({
        event_type: e.event_type.replace(/\./g, '_'),
        log_source: 'sunell-camera' as const,
      })),
    ];
    if (fromRegistry.length === 0) return;
    setEventTypes(prev => {
      // Merge: registry seed + event types đã discovered runtime
      // Ưu tiên giữ log_source từ registry nếu event_type đã tồn tại
      const map = new Map<string, EventTypeItem>();
      prev.forEach(item => map.set(item.event_type, item));
      fromRegistry.forEach(item => map.set(item.event_type, item)); // registry overwrites
      return Array.from(map.values());
    });
  }, [svmsKnownEvents, milesightKnownEvents, sunellKnownEvents]);

  // ─── Log Batching: buffer incoming logs and flush every 500ms ───────────────
  const logBufferRef = useRef<LogData[]>([]);
  const eventTypeBufferRef = useRef<EventTypeItem[]>([]);
  const mqttLogBufferRef = useRef<MQTT_Milesight_LogEntry[]>([]);

  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (logBufferRef.current.length > 0) {
        const batch = logBufferRef.current.splice(0);
        setLogs(prev => {
          const merged = [...prev, ...batch];
          const sliced = merged.length > env.MAX_LOGS_LIST ? merged.slice(-env.MAX_LOGS_LIST) : merged;
          return sliced;
        });
        setTotalLogCount(prev => prev + batch.length);
      }
      if (mqttLogBufferRef.current.length > 0) {
        const mqttBatch = mqttLogBufferRef.current.splice(0);
        setMqttLogs(prev => {
          const merged = [...prev, ...mqttBatch];
          return merged.length > env.MAX_LOGS_LIST ? merged.slice(-env.MAX_LOGS_LIST) : merged;
        });
      }
      if (eventTypeBufferRef.current.length > 0) {
        const newItems = eventTypeBufferRef.current.splice(0);
        setEventTypes(prev => {
          const map = new Map<string, EventTypeItem>(prev.map(item => [item.event_type, item]));
          newItems.forEach(item => {
            if (!map.has(item.event_type)) map.set(item.event_type, item);
          });
          return Array.from(map.values());
        });
      }
    }, 250);
    return () => clearInterval(flushInterval);
  }, []);
  const [servers, setServers] = useState<Record<string, ServerData>>({});
  const [devices, setDevices] = useState<Record<string, DeviceData>>({});
  const [systemConfig, setSystemConfigState] = useState<SystemConfig>({
    fe: {
      ip: import.meta.env.VITE_HOST,
      port: import.meta.env.VITE_PORT
    },
    be: {
      ip: getBeHost(),
      port: getBePort()
    }
  });

  const setSystemConfig = useCallback((configOrUpdater: SystemConfig | ((prev: SystemConfig) => SystemConfig)) => {
    setSystemConfigState(prev => {
      const newConfig = typeof configOrUpdater === 'function' ? configOrUpdater(prev) : configOrUpdater;
      localStorage.setItem('BE_HOST', newConfig.be.ip);
      localStorage.setItem('BE_PORT', newConfig.be.port);
      return newConfig;
    });
  }, []);

  const [sendServers, setSendServers] = useState<SystemConnection[]>([]);
  const [receiveServers, setReceiveServers] = useState<SystemConnection[]>([]);
  const [mqttServers, setMqttServers] = useState<MqttServerConfig[]>([]);

  // ─── New System Data State ────────────────────────────────────────────────────────
  /** BE-owned normalized logs from all sources. */
  const [newSvmsLogs, setNewSvmsLogs] = useState<LogData[]>([]);
  /** Danh sách SVMS server raw (full payload từ BE) */
  const [svmsServers, setSvmsServers] = useState<SVMSServer[]>([]);
  /** Danh sách SVMS device raw (full payload từ BE) */
  const [svmsDevices, setSvmsDevices] = useState<SMVSDevices[]>([]);
  /** Danh sách MQTT Milesight server config */
  const [mqttMilesightServers, setMqttMilesightServers] = useState<MqttServerConfig[]>([]);
  /** Danh sách MQTT Milesight device (tổng hợp từ log) */
  const [mqttMilesightDevices, setMqttMilesightDevices] = useState<MQTT_Milesight_DeviceInfo[]>([]);

  useEffect(() => {
    const newBeURL = `http://${systemConfig.be.ip}:${systemConfig.be.port}`;
    const currentSocketURI = (socket.io as any).uri;

    // Khác nhau -> update socket
    if (currentSocketURI !== newBeURL) {
      console.log(`[SOCKET_RECONFIG] Target shifted to: ${newBeURL}. Initiating reconnection...`);
      updateSocketUrlAsync(newBeURL).then((success) => {
        setIsConnected(socket.connected);
        if (success) {
          console.log(`[SOCKET_SUCCESS] Link established with: ${newBeURL}`);
        } else {
          console.error(`[SOCKET_ERROR] Handshake failed with: ${newBeURL}`);
        }
      });
    }
  }, [systemConfig.be.ip, systemConfig.be.port]);

  // ─── Fetch connections from BE (source of truth) ────────────────────────────
  const fetchConnections = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/connections');
      setSendServers(data.sendList || []);
      setReceiveServers(data.receiveList || []);
      console.log('[FETCH_CONNECTIONS] Synced from BE:', data);
    } catch (err) {
      console.error('[FETCH_CONNECTIONS] Failed:', err);
    }
  }, [systemConfig.be.ip, systemConfig.be.port]);

  // Fetch on mount + on socket reconnect
  useEffect(() => {
    fetchConnections();
    fetchMqttServers();
    socket.on('connect', fetchConnections);
    socket.on('connect', fetchMqttServers);
    return () => { socket.off('connect', fetchConnections); socket.off('connect', fetchMqttServers); };
  }, [fetchConnections]);

  // Fetch MQTT servers from BE
  const fetchMqttServers = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/mqtt-servers');
      setMqttServers(data.servers || []);
      console.log('[FETCH_MQTT_SERVERS] Synced from BE:', data.servers);
    } catch (err) {
      console.error('[FETCH_MQTT_SERVERS] Failed:', err);
    }
  }, [systemConfig.be.ip, systemConfig.be.port]);

  const fetchCameras = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/cameras');
      setCameraDevices(data.cameras || []);
      console.log('[FETCH_CAMERAS] Synced from BE:', data.cameras);
    } catch (err) {
      console.error('[FETCH_CAMERAS] Failed:', err);
    }
  }, [systemConfig.be.ip, systemConfig.be.port]);

  // ─── Fetch device-camera links from BE ──────────────────────────────────────
  const fetchDeviceCameraLinks = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/device-camera-links');
      setDeviceCameraLinks(data.links || []);
      console.log('[FETCH_DEVICE_CAMERA_LINKS] Synced from BE:', data.links);
    } catch (err) {
      console.error('[FETCH_DEVICE_CAMERA_LINKS] Failed:', err);
    }
  }, [systemConfig.be.ip, systemConfig.be.port]);

  // ─── Fetch grid layout from BE ──────────────────────────────────────────────
  const fetchGridLayout = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/grid-layout');
      if (data.grids || data.gridCols) {
        setGridLayout({ grids: data.grids || [], gridCols: data.gridCols || 3 });
        console.log('[FETCH_GRID_LAYOUT] Synced from BE:', data);
      }
    } catch (err) {
      console.error('[FETCH_GRID_LAYOUT] Failed:', err);
    }
  }, [systemConfig.be.ip, systemConfig.be.port]);

  // ─── Save grid layout to BE ─────────────────────────────────────────────────
  const saveGridLayout = useCallback(async (grids: any[], gridCols: number) => {
    try {
      await apiClient.put('/api/v1/grid-layout', { grids, gridCols });
      console.log('[SAVE_GRID_LAYOUT] Saved to BE');
    } catch (err) {
      console.error('[SAVE_GRID_LAYOUT] Failed:', err);
    }
  }, []);

  // ─── Link/unlink MQTT device to camera ──────────────────────────────────────
  const handleLinkDeviceCamera = useCallback(async (devEui: string, mqttServerId: string, cameraId: string | null) => {
    // Optimistic Update: update local state instantly for 0ms lag
    setDeviceCameraLinks((prev) => {
      const existing = prev.find(l => l.devEui === devEui && l.mqttServerId === mqttServerId);
      const filtered = prev.filter(l => !(l.devEui === devEui && l.mqttServerId === mqttServerId));

      // Always keep the link entry if it has features or a cameraId
      if (cameraId || (existing && Object.keys(existing.features || {}).length > 0)) {
        return [...filtered, {
          devEui,
          mqttServerId,
          cameraId: cameraId || null,
          features: existing?.features || {}
        }];
      }
      return filtered;
    });

    try {
      const { data } = await apiClient.patch('/api/v1/mqtt-device-camera-link', { devEui, mqttServerId, cameraId });
      setDeviceCameraLinks(data.links || []);
      console.log('[LINK_DEVICE_CAMERA] Updated:', { devEui, mqttServerId, cameraId });
    } catch (err) {
      console.error('[LINK_DEVICE_CAMERA] Failed:', err);
      fetchDeviceCameraLinks();
    }
  }, [fetchDeviceCameraLinks]);

  // ─── Link/unlink MQTT server to camera ──────────────────────────────────────
  const handleLinkMqttServerCamera = useCallback(async (serverId: string, cameraId: string | null) => {
    // Optimistic Update: update local state instantly for 0ms lag
    setMqttServers((prev) =>
      prev.map(s => s.id === serverId ? { ...s, cameraId: cameraId || undefined } : s)
    );

    try {
      await apiClient.patch(`/api/v1/mqtt-servers/${serverId}`, { cameraId });
      console.log('[LINK_MQTT_SERVER_CAMERA] Updated:', { serverId, cameraId });
      fetchMqttServers();
    } catch (err) {
      console.error('[LINK_MQTT_SERVER_CAMERA] Failed:', err);
      fetchMqttServers();
    }
  }, [fetchMqttServers]);

  useEffect(() => {
    fetchCameras();
    fetchDeviceCameraLinks();
    fetchGridLayout();

    socket.on('connect', fetchCameras);
    socket.on('connect', fetchDeviceCameraLinks);
    socket.on('connect', fetchGridLayout);

    return () => {
      socket.off('connect', fetchCameras);
      socket.off('connect', fetchDeviceCameraLinks);
      socket.off('connect', fetchGridLayout);
    };
  }, [fetchCameras, fetchDeviceCameraLinks, fetchGridLayout]);

  // ─── Delta updates via socket events ────────────────────────────────────────

  const updateReceiveServer = (raw: any, isLogEvent = false) => {
    const isDisconnectOrError = !!raw.url;
    let serverId = '';
    let sourceIp = '';

    if (isDisconnectOrError) {
      const parsed = new URL(raw.url);
      sourceIp = parsed.hostname;
    } else {
      serverId = (raw.body?.server?.server_id ?? '') + '-' + (raw.body?.server?.serial ?? '');
      sourceIp = (raw.ip ?? '').replace('::ffff:', '');
    }

    setReceiveServers(prev => {
      let serverIdx = -1;

      if (isDisconnectOrError) {
        serverIdx = prev.findIndex(s => s.ip === sourceIp);
      } else {
        serverIdx = prev.findIndex(s => s.ip === sourceIp && s.server_id === serverId);
        if (serverIdx === -1) {
          serverIdx = prev.findIndex(s => s.ip === sourceIp && (s.server_id === 'PENDING' || !s.server_id));
        }
      }

      if (serverIdx === -1) {
        if (isDisconnectOrError) return prev;
        // Entry không tồn tại — tạo mới (trường hợp log đến trước khi fetch kịp)
        const newServer: SystemConnection = {
          server_id: serverId,
          ip: sourceIp,
          port: '5588',
          status: 'connected',
          receivedCount: isLogEvent ? 1 : 0
        };
        return [...prev, newServer];
      }

      const updatedServers = [...prev];
      const server = { ...updatedServers[serverIdx] };

      if (!isDisconnectOrError) {
        if (!server.server_id || server.server_id === 'PENDING') {
          server.server_id = serverId;
        }
      }

      if (raw.status) {
        server.status = raw.status;
      } else if (!isDisconnectOrError && !server.status) {
        server.status = 'connected';
      }

      if (isLogEvent) {
        server.receivedCount = (server.receivedCount || 0) + 1;
      }

      updatedServers[serverIdx] = server;
      return updatedServers;
    });
  };

  const updateSendServers = (ip: string, port: string, status: 'connecting' | 'connected' | 'disconnected') => {
    setSendServers(prev => {
      const idx = prev.findIndex(s => s.ip === ip && s.port === port);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status };
        return updated;
      }
      return [...prev, { ip, port, status }];
    });
  };

  const handleAddExternalServer = useCallback(async (ip: string, port: string, mode: 'receive' | 'send') => {
    console.log(`[SYNC_INIT] Requesting local BE to connect to http://${ip}:${port} (${mode})`);

    if (mode === 'send') {
      // GỌI ĐẾN BE CỦA MÌNH ĐỂ THỰC HIỆN KẾT NỐI ĐẾN SERVER ĐÍCH
      apiClient.post(`/api/v1/create-connection`, { ip, port, mode })
        .then((res: any) => {
          console.log(`[SYNC_SUCCESS] Backend response:`, res.data);
          // Sau khi tạo connection thành công → fetch lại full list từ BE
          fetchConnections();
        })
        .catch((err: any) => console.error(`[SYNC_ERROR] Failed to initiate sync:`, err));
    } else if (mode === 'receive') {
      // GỌI ĐẾN BE CỦA IP:PORT ĐỂ ĐÍCH KẾT NỐI ĐẾN SERVER HIỆN TẠI
      axios.post(`http://${ip}:${port}/api/v1/create-connection`,
        { ip: systemConfig.be.ip, port: systemConfig.be.port, mode: 'send' },
        { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } }
      )
        .then((res: any) => {
          console.log(`[SYNC_SUCCESS] Target backend response:`, res.data);
          // Fetch mồi lại list, hệ thống sẽ tự cập nhật khi Data log đổ về
          fetchConnections();
        })
        .catch((err: any) => console.error(`[SYNC_ERROR] Failed to initiate sync on target:`, err));
    }
  }, [systemConfig.be.ip, systemConfig.be.port, fetchConnections]);

  // ─── MQTT Server Handlers ───────────────────────────────────────────────────
  const handleAddMqttServer = useCallback(async (config: MqttServerConfig) => {
    console.log('%c[MQTT_ADD] ▶ Đang gửi yêu cầu tạo MQTT server...', 'color: #06b6d4; font-weight: bold');
    console.log('[MQTT_ADD] Config gửi lên BE:', JSON.stringify(config, null, 2));
    console.log(`[MQTT_ADD] Broker: ${config.protocol || 'mqtt'}://${config.brokerHost}:${config.brokerPort}`);
    console.log(`[MQTT_ADD] Topic: ${config.topic || '(không có topic)'}`);
    try {
      const res = await apiClient.post('/api/v1/mqtt-servers', config);
      console.log('%c[MQTT_ADD] ✅ Tạo thành công!', 'color: #22c55e; font-weight: bold');
      console.log('[MQTT_ADD] Response từ BE:', res.data);
      console.log(`[MQTT_ADD] Server ID: ${res.data?.server?.id || 'N/A'}`);
      console.log(`[MQTT_ADD] Status: ${res.data?.server?.status || 'N/A'}`);
      fetchMqttServers();
    } catch (err: any) {
      console.error('%c[MQTT_ADD] ❌ Thất bại!', 'color: #ef4444; font-weight: bold');
      console.error('[MQTT_ADD] Error:', err?.response?.data || err?.message || err);
      console.error(`[MQTT_ADD] HTTP Status: ${err?.response?.status || 'N/A'}`);
    }
  }, [fetchMqttServers]);

  const handleRemoveMqttServer = useCallback(async (id: string) => {
    console.log('%c[MQTT_REMOVE] ▶ Đang xóa MQTT server...', 'color: #f59e0b; font-weight: bold');
    console.log(`[MQTT_REMOVE] ID: ${id}`);
    try {
      await apiClient.delete(`/api/v1/mqtt-servers/${id}`);
      console.log('%c[MQTT_REMOVE] ✅ Đã xóa thành công', 'color: #22c55e; font-weight: bold');
      fetchMqttServers();
    } catch (err: any) {
      console.error('%c[MQTT_REMOVE] ❌ Xóa thất bại!', 'color: #ef4444; font-weight: bold');
      console.error('[MQTT_REMOVE] Error:', err?.response?.data || err?.message || err);
    }
  }, [fetchMqttServers]);

  const handleUpdateMqttServer = useCallback(async (id: string, config: Partial<MqttServerConfig>) => {
    console.log('%c[MQTT_UPDATE] ▶ Đang cập nhật MQTT server...', 'color: #06b6d4; font-weight: bold');
    console.log(`[MQTT_UPDATE] ID: ${id}`);
    console.log('[MQTT_UPDATE] Config mới:', JSON.stringify(config, null, 2));
    try {
      const res = await apiClient.put(`/api/v1/mqtt-servers/${id}`, config);
      console.log('%c[MQTT_UPDATE] ✅ Cập nhật thành công!', 'color: #22c55e; font-weight: bold');
      console.log('[MQTT_UPDATE] Response:', res.data);
      fetchMqttServers();
    } catch (err: any) {
      console.error('%c[MQTT_UPDATE] ❌ Cập nhật thất bại!', 'color: #ef4444; font-weight: bold');
      console.error('[MQTT_UPDATE] Error:', err?.response?.data || err?.message || err);
    }
  }, [fetchMqttServers]);

  const handleRemoveConnection = useCallback((ip: string, port: string, mode: 'receive' | 'send') => {
    if (mode === 'send') {
      setSendServers(prev => prev.filter(s => !(s.ip === ip && s.port === port)));
    } else {
      setReceiveServers(prev => prev.filter(s => !(s.ip === ip && s.port === port)));
    }
  }, []);

  useEffect(() => {
    function onConnectingExternalServer(raw: any) {
      const { url } = raw;
      const parsed = new URL(url);
      updateSendServers(parsed.hostname, parsed.port, 'connecting');
    }

    function onConnectedExternalServer(raw: any) {
      const { url } = raw;
      const parsed = new URL(url);
      updateSendServers(parsed.hostname, parsed.port, 'connected');
    }

    function onLogDispatched(raw: any) {
      const { sentServerList } = raw;
      setSendServers(prev => prev.map(s => {
        if (sentServerList.includes('http://' + s.ip + ':' + s.port)) {
          return {
            ...s,
            sentCount: (s.sentCount || 0) + 1
          };
        }
        return s;
      }));
    }

    function onUpdateConnections(data: { sendList: SystemConnection[], receiveList: SystemConnection[] }) {
      console.log('[SOCKET] update-connections:', data);

      // Merge để không làm mất 'sentCount' và 'status' hiện tại
      setSendServers(prev => {
        return (data.sendList || []).map(newServer => {
          const existing = prev.find(p => p.ip === newServer.ip && p.port === newServer.port);
          return {
            ...newServer,
            sentCount: existing ? existing.sentCount : 0,
            status: existing && newServer.status === 'connected' ? existing.status : newServer.status
          };
        });
      });

      setReceiveServers(data.receiveList || []);
    }

    // update-client không còn sử dụng — giữ listener để tránh socket warning
    function onUpdateClients() { }

    function onDisconnectedExternalServer(raw: any) {
      const { url, type } = raw;
      if (type === 'send' || !type) {
        const parsed = new URL(url);
        updateSendServers(parsed.hostname, parsed.port, 'disconnected');
      } else {
        updateReceiveServer(raw);
      }
    }

    function onErrorExternalServer(raw: any) {
      // 'error' event is legacy — treat as disconnected
      const { url, type } = raw;
      if (type === 'send' || !type) {
        const parsed = new URL(url);
        updateSendServers(parsed.hostname, parsed.port, 'disconnected');
      } else {
        updateReceiveServer(raw);
      }
    }

    const onReceiveLog = (raw: any) => {
      const serverData = raw.body?.server || { server_id: 'UNKNOWN', serial: 'UNKNOWN' };
      const timeNumber = raw.timestamp ? new Date(raw.timestamp).getTime() / 1000 : Date.now() / 1000;

      const data = raw?.data || raw;

      // Giữ nguyên log_type gốc từ thiết bị gửi về.
      // Việc dịch sang tên hiển thị được thực hiện tại UI thông qua getLogTypeDisplayName().
      // Để nhóm alias vào cùng 1 filter, thêm vào LOG_TYPE_GROUPS phía trên.
      const parsedLogType = data.body?.log_type || 'event.info';

      const newLog: any = {
        id: crypto.randomUUID(),
        time: Math.floor(timeNumber),
        device_index: data.body?.device_index || 0,
        device_ip: data.body?.device_ip || '127.0.0.1',
        device_type: data.body?.device_type || 'camera',
        device_name: data.body?.device_name || 'Channel',
        log_type: parsedLogType,
        description: data.body?.description || 'Event received',
        server: serverData,
        ip: data.ip,
        cameraIp: data.body?.device_ip || 'SYSTEM',
        raw: data,
        snapshot: data.body?.snapshot || data.body?.picture || (data.body?.pictures && data.body?.pictures[0]) || undefined,
        source: 'svms'
      };

      if (data.ip && data.ip !== '127.0.0.1' && data.ip !== '::1') {
        updateReceiveServer(data, true);
      }


      // Push to buffer instead of direct setState — flushed every 500ms
      // Main log state is fed by BE-owned `logs-batch`.
      // Runtime discovery: event_type mới từ SVMS sẽ có log_source='svms'
      eventTypeBufferRef.current.push({
        event_type: resolveToGroupKey(newLog.log_type),
        log_source: 'svms',
      });
    };

    const onReceiveSunellLog = (raw: any) => {
      const timeNumber = raw.timestamp ? new Date(raw.timestamp).getTime() / 1000 : Date.now() / 1000;

      const newLog: any = {
        id: raw.id,
        time: Math.floor(timeNumber),
        device_index: 0,
        device_ip: raw.camera_id, // we don't have ip immediately, use camera_id as fallback
        device_type: 'sunell',
        device_name: raw.camera_name || 'Sunell Camera',
        log_type: raw.log_type,
        description: raw.description,
        snapshot: raw.image_data,
        server: { server_id: 'SUNELL-LOCAL', serial: 'SUNELL' },
        ip: '127.0.0.1',
        cameraIp: raw.camera_id,
        source: 'sunell-camera'
      };


      // Push to buffer
      // Main log state is fed by BE-owned `logs-batch`.
      // Runtime discovery: event_type mới từ Sunell sẽ có log_source='sunell-camera'
      eventTypeBufferRef.current.push({
        event_type: resolveToGroupKey(newLog.log_type),
        log_source: 'sunell-camera',
      });
    };

    // Cập nhật trực tiếp vào, thêm/sửa/xóa đã nằm ở server BE
    const onReceiveServerInformation = (raw: any) => {
      console.log('[SOCKET] receive-server-information:', raw);
      if (raw.allServers) {
        // Log MQTT servers riêng để dễ theo dõi
        const mqttEntries = Object.entries(raw.allServers).filter(([k]) => k.startsWith('mqtt-'));
        if (mqttEntries.length > 0) {
          console.log('%c[SOCKET] 📡 Server info chứa MQTT entries:', 'color: #06b6d4; font-weight: bold');
          mqttEntries.forEach(([key, srv]: [string, any]) => {
            console.log(`  ${key}: status=${srv.connectionStatus}, ip=${srv.server_ip}, topic=${srv.mqttTopic || 'N/A'}`);
          });
        }
        setServers(raw.allServers);
      } else if (raw.serverId && raw.data) {
        setServers(prev => ({ ...prev, [raw.serverId]: raw.data }));
      }
    };

    const onReceiveDevicesInformation = (raw: any) => {
      console.log('[SOCKET] receive-devices-information:', raw);
      if (raw.allDevices) {
        setDevices(raw.allDevices);
      } else if (raw.serverId && raw.data) {
        setDevices(prev => ({ ...prev, [raw.serverId]: raw.data }));
      }
    };

    // ─── Connectivity Monitor Events ──────────────────────────────────────────
    const onServerConnectionStatus = (raw: { serverId: string; connectionStatus: string; serverName?: string; type?: string }) => {
      console.log('[SOCKET] server-connection-status:', raw);
      setServers(prev => {
        const existing = prev[raw.serverId];
        if (!existing) return prev;
        return {
          ...prev,
          [raw.serverId]: {
            ...existing,
            connectionStatus: raw.connectionStatus as 'connected' | 'disconnected',
          }
        };
      });
    };

    const onDeviceConnectionStatus = (raw: { serverId: string; deviceIndex: number; connectionStatus: string }) => {
      console.log('[SOCKET] device-connection-status:', raw);
      setDevices(prev => {
        const existing = prev[raw.serverId];
        if (!existing) return prev;
        const updatedDevices = existing.devices.map(d =>
          String(d.index) === String(raw.deviceIndex)
            ? { ...d, connectionStatus: raw.connectionStatus as 'connected' | 'disconnected' }
            : d
        );
        return {
          ...prev,
          [raw.serverId]: { ...existing, devices: updatedDevices }
        };
      });
    };

    // ─── MQTT events ──────────────────────────────────────────────────────────
    const onUpdateMqttServers = (mqttData: MqttServerConfig[]) => {
      console.log('%c[SOCKET] 📡 update-mqtt-servers — Nhận danh sách MQTT servers cập nhật', 'color: #06b6d4; font-weight: bold');
      console.table(mqttData.map((s: any) => ({
        id: s.id,
        broker: `${s.brokerHost}:${s.brokerPort}`,
        topic: s.topic || '(none)',
        status: s.status,
        logCount: s.logCount ?? 0,
      })));
      setMqttServers(mqttData);
    };

    const onUpdateCameras = (devices: MqttDeviceConfig[]) => {
      console.log('%c[SOCKET] 📷 update-cameras — Nhận danh sách camera devices cập nhật', 'color: #06b6d4; font-weight: bold');
      setCameraDevices(devices);
    };

    const onReceiveMqttLog = (raw: any) => {
      const isSystem = raw.type === 'system';
      const color = isSystem ? '#f59e0b' : '#22c55e';
      const icon = isSystem ? '⚙️' : '📩';
      console.log(`%c[SOCKET] ${icon} receive-mqtt-log [${raw.mqttServerId}] type=${raw.type}`, `color: ${color}; font-weight: bold`);
      console.log(`[MQTT_LOG] Topic: ${raw.topic || 'N/A'}`);
      if (isSystem) {
        console.log(`[MQTT_LOG] System Message: ${raw.message || 'N/A'}`);
      } else if (raw.payload) {
        const deviceInfo = raw.payload?.deviceInfo;
        if (deviceInfo) {
          console.log(`[MQTT_LOG] Device: ${deviceInfo.deviceName} (${deviceInfo.devEui}) — Profile: ${deviceInfo.deviceProfileName}`);
        }
        const events = raw.payload?.object?.events;
        if (events) {
          console.log('[MQTT_LOG] Events:', events);
        }
      }

      // Store raw MQTT_Milesight_LogEntry for device extraction (only data logs with payload)
      if (!isSystem && raw.payload) {
        const MQTT_Milesight_LogEntry: MQTT_Milesight_LogEntry = {
          time: raw.time || new Date().toISOString(),
          type: raw.type || 'data',
          topic: raw.topic || '',
          payload: raw.payload,
          snapshot: raw.snapshot || undefined,
          mqttServerId: raw.mqttServerId,
          brokerHost: raw.brokerHost,
          brokerPort: raw.brokerPort,
        };
        mqttLogBufferRef.current.push(MQTT_Milesight_LogEntry);
      }

      // Use individual event (1 log = 1 event now)
      const deviceInfo = raw.payload?.deviceInfo;
      const event = raw.event;
      const eventDesc = event ? `${event.alarm_type}:${event.alarm_status}` : '';
      const safeRaw = { ...raw };
      if (safeRaw.snapshot) safeRaw.snapshot = '[BASE64_IMAGE_OMITTED_FROM_RAW]';

      const newLog: any = {
        id: crypto.randomUUID(),
        time: Math.floor(new Date(raw.time || Date.now()).getTime() / 1000),
        device_index: 0,
        device_ip: raw.brokerHost || '',
        device_type: 'mqtt',
        device_name: deviceInfo?.deviceName || 'MQTT Device',
        log_type: event?.alarm_type || raw.type || 'data',
        description: eventDesc || `MQTT - ${raw.type || 'data'}`,
        snapshot: raw.snapshot || undefined,
        server: { server_id: `mqtt-${raw.mqttServerId}`, serial: deviceInfo?.devEui || '' },
        ip: raw.brokerHost || '',
        raw: safeRaw,
        source: 'mqtt',
        mqttServerId: raw.mqttServerId,
      };


      // Nếu là log debug_raw, chúng ta bỏ qua việc thêm vào danh sách hiển thị chính (AlertWall)
      if (newLog.log_type === 'debug_raw') {
        return;
      }
      // Main log state is fed by BE-owned `logs-batch`.
      // Runtime discovery: event_type mới từ MQTT sẽ có log_source='mqtt'
      eventTypeBufferRef.current.push({
        event_type: resolveToGroupKey(newLog.log_type),
        log_source: 'mqtt',
      });
    };

    socket.on('external-server-connecting', onConnectingExternalServer);
    socket.on('external-server-connect', onConnectedExternalServer);
    socket.on('external-server-disconnect', onDisconnectedExternalServer);
    socket.on('external-server-err-connect', onErrorExternalServer);
    socket.on('receive-log', onReceiveLog);
    socket.on('receive-sunell-log', onReceiveSunellLog);
    socket.on('test', (data) => {
      console.log('test data', data)
    })
    // DEBUG: Log toàn bộ raw data Sunell camera gửi về
    const onSunellTest = (raw: any) => {
      console.log('%c[SUNELL-TEST] 📷 Raw data từ Sunell Camera:', 'color: #ff6b6b; font-weight: bold; font-size: 14px; background: #1a1a2e; padding: 4px 8px; border-radius: 4px');
      console.log('[SUNELL-TEST] Timestamp:', raw._debug_timestamp);
      console.log('[SUNELL-TEST] Camera:', raw._camera_name, `(${raw._camera_id})`);
      console.log('[SUNELL-TEST] Is LPR:', raw._is_lpr);
      console.log(`%c[SUNELL-TEST] 🖼️ Snapshot: ${raw._has_snapshot ? '✅ CÓ ẢNH' : '❌ KHÔNG CÓ ẢNH'} | Length: ${raw._snapshot_length} chars`,
        `color: ${raw._has_snapshot ? '#22c55e' : '#ef4444'}; font-weight: bold; font-size: 13px`);
      if (raw._has_snapshot) {
        console.log('[SUNELL-TEST] Snapshot preview:', raw._snapshot_preview);
      }
      console.log('[SUNELL-TEST] Parsed Payload:', raw._parsed_payload);
      console.log('[SUNELL-TEST] Full object:', raw);
      console.log('─'.repeat(80));
    };
    socket.on('sunell-test', onSunellTest);
    socket.on('update-client', onUpdateClients);
    socket.on('log-dispatched', onLogDispatched);
    socket.on('receive-server-information', onReceiveServerInformation);
    socket.on('receive-devices-information', onReceiveDevicesInformation);
    socket.on('update-connections', onUpdateConnections);
    socket.on('server-connection-status', onServerConnectionStatus);
    socket.on('device-connection-status', onDeviceConnectionStatus);
    socket.on('update-mqtt-servers', onUpdateMqttServers);
    socket.on('update-cameras', onUpdateCameras);
    socket.on('receive-mqtt-log', onReceiveMqttLog);
    socket.on('test', (data) => {
      console.log('[TEST] test:', data);
    });
    const onUpdateDeviceCameraLinks = (links: DeviceCameraLink[]) => {
      console.log('[SOCKET] update-device-camera-links:', links);
      setDeviceCameraLinks(links);
    };
    const onUpdateGridLayout = (data: { grids: any[]; gridCols: number }) => {
      console.log('[SOCKET] update-grid-layout:', data);
      setGridLayout({ grids: data.grids || [], gridCols: data.gridCols || 3 });
    };
    socket.on('update-device-camera-links', onUpdateDeviceCameraLinks);
    socket.on('update-grid-layout', onUpdateGridLayout);

    const onUpdateSvmsDeviceFeatures = (data: { serverId: string; deviceIndex: string; features: Record<string, boolean> }[]) => {
      console.log('[SOCKET] update-svms-device-features:', data);
      setSvmsDeviceFeatures(data);
    };
    socket.on('update-svms-device-features', onUpdateSvmsDeviceFeatures);

    // DEBUG: Camera snapshot pipeline logs
    const onDebugCameraSnapshot = (data: { time: string; message: string }) => {
      console.log(`%c[CAMERA-SNAPSHOT] ${data.message}`, 'color: #ff6b6b; font-weight: bold; background: #1a1a2e; padding: 2px 6px; border-radius: 3px');
    };
    socket.on('debug-camera-snapshot', onDebugCameraSnapshot);

    // ─── Full BE-owned state sync after socket connection ─────────────────────
    const applySystemSnapshot = (data: SystemSnapshot) => {
      console.log('%c[SOCKET] system-snapshot - synced full BE state', 'color: #a78bfa; font-weight: bold');

      const allLogs = Array.isArray(data.allLogs) ? data.allLogs : [];
      const slicedLogs = allLogs.slice(-env.MAX_LOGS_LIST);
      logBufferRef.current = [];
      setNewSvmsLogs(slicedLogs);
      setLogs(slicedLogs);
      setTotalLogCount(allLogs.length);
      eventTypeBufferRef.current.push(...slicedLogs.map(log => ({
        event_type: resolveToGroupKey(log.log_type),
        log_source: getFilterLogSource(log.log_source),
      })));

      if (Array.isArray(data.sendServers)) setSendServers(data.sendServers);
      if (Array.isArray(data.receiveServers)) setReceiveServers(data.receiveServers);
      if (data.servers) setServers(data.servers);
      if (data.devices) setDevices(data.devices);
      if (Array.isArray(data.svmsServers)) setSvmsServers(data.svmsServers);
      if (Array.isArray(data.svmsDevices)) setSvmsDevices(data.svmsDevices);
      if (Array.isArray(data.mqttServers)) {
        setMqttServers(data.mqttServers);
        setMqttMilesightServers(data.mqttServers);
      }
      if (Array.isArray(data.mqttDeviceList)) setMqttMilesightDevices(data.mqttDeviceList);
      if (Array.isArray(data.cameras)) setCameraDevices(data.cameras);
      if (data.gridLayout) setGridLayout({ grids: data.gridLayout.grids || [], gridCols: data.gridLayout.gridCols || 3 });
      if (Array.isArray(data.knownEvents?.svms)) setSvmsKnownEvents(data.knownEvents.svms);
      if (Array.isArray(data.knownEvents?.milesight)) setMilesightKnownEvents(data.knownEvents.milesight);
      if (Array.isArray(data.knownEvents?.sunell)) setSunellKnownEvents(data.knownEvents.sunell);
      if (Array.isArray(data.compatibility?.svmsDeviceFeatures)) setSvmsDeviceFeatures(data.compatibility.svmsDeviceFeatures);
      if (Array.isArray(data.compatibility?.deviceCameraLinks)) setDeviceCameraLinks(data.compatibility.deviceCameraLinks);
    };

    const onSyncNewSystemData = applySystemSnapshot;

    const onLogsBatch = (batch: LogData[]) => {
      if (!Array.isArray(batch) || batch.length === 0) return;

      logBufferRef.current.push(...batch);
      eventTypeBufferRef.current.push(...batch.map(log => ({
        event_type: resolveToGroupKey(log.log_type),
        log_source: getFilterLogSource(log.log_source),
      })));
      setNewSvmsLogs(prev => {
        const merged = [...prev, ...batch];
        return merged.length > env.MAX_LOGS_LIST ? merged.slice(-env.MAX_LOGS_LIST) : merged;
      });
    };

    const requestFullSync = () => {
      console.log('[SOCKET] Connected to BE - requesting full state sync');
      socket.emit('request-sync');
    };

    socket.on('system-snapshot', applySystemSnapshot);
    socket.on('sync-new-system-data', onSyncNewSystemData);
    socket.on('logs-batch', onLogsBatch);
    socket.on('connect', requestFullSync);
    if (socket.connected) requestFullSync();

    // ─── New System Data listeners ────────────────────────────────────────────────────────
    const onNewSvmsLog = (data: LogData) => {
      eventTypeBufferRef.current.push({
        event_type: resolveToGroupKey(data.log_type),
        log_source: getFilterLogSource(data.log_source),
      });
    };
    const onNewSvmsServers = (data: SVMSServer[]) => {
      setSvmsServers(data);
    };
    const onNewSvmsDevices = (data: SMVSDevices[]) => {
      setSvmsDevices(data);
    };
    const onUpdateMqttMilesightServers = (data: MqttServerConfig[]) => {
      setMqttMilesightServers(data);
    };
    const onUpdateMqttMilesightDevices = (data: MQTT_Milesight_DeviceInfo[]) => {
      setMqttMilesightDevices(data);
    };

    socket.on('new-svms-log', onNewSvmsLog);
    socket.on('new-svms-servers', onNewSvmsServers);
    socket.on('new-svms-devices', onNewSvmsDevices);
    socket.on('update-mqtt-milesight-servers', onUpdateMqttMilesightServers);
    socket.on('update-mqtt-milesight-devices', onUpdateMqttMilesightDevices);

    const onUpdateSvmsKnownEvents = (events: SvmsKnownEvent[]) => {
      console.log('[SOCKET] update-svms-known-events:', events.length, 'events');
      if (Array.isArray(events) && events.length > 0) {
        setSvmsKnownEvents(events);
      }
    };
    socket.on('update-svms-known-events', onUpdateSvmsKnownEvents);

    const onUpdateMilesightKnownEvents = (events: MilesightKnownEvent[]) => {
      console.log('[SOCKET] update-milesight-known-events:', events.length, 'events');
      if (Array.isArray(events) && events.length > 0) {
        setMilesightKnownEvents(events);
      }
    };
    socket.on('update-milesight-known-events', onUpdateMilesightKnownEvents);

    const onUpdateSunellKnownEvents = (data: SunellKnownEvent[]) => {
      setSunellKnownEvents(data);
    };
    socket.on('update-sunell-known-events', onUpdateSunellKnownEvents);

    return () => {
      socket.off('external-server-connecting', onConnectingExternalServer);
      socket.off('external-server-connect', onConnectedExternalServer);
      socket.off('external-server-disconnect', onDisconnectedExternalServer);
      socket.off('external-server-err-connect', onErrorExternalServer);
      socket.off('receive-log', onReceiveLog);
      socket.off('receive-sunell-log', onReceiveSunellLog);
      socket.off('sunell-test', onSunellTest);
      socket.off('update-client', onUpdateClients);
      socket.off('log-dispatched', onLogDispatched);
      socket.off('receive-server-information', onReceiveServerInformation);
      socket.off('receive-devices-information', onReceiveDevicesInformation);
      socket.off('update-connections', onUpdateConnections);
      socket.off('server-connection-status', onServerConnectionStatus);
      socket.off('device-connection-status', onDeviceConnectionStatus);
      socket.off('update-mqtt-servers', onUpdateMqttServers);
      socket.off('update-cameras', onUpdateCameras);
      socket.off('receive-mqtt-log', onReceiveMqttLog);
      socket.off('debug-camera-snapshot', onDebugCameraSnapshot);
      socket.off('update-device-camera-links', onUpdateDeviceCameraLinks);
      socket.off('update-grid-layout', onUpdateGridLayout);
      socket.off('new-svms-log', onNewSvmsLog);
      socket.off('new-svms-servers', onNewSvmsServers);
      socket.off('new-svms-devices', onNewSvmsDevices);
      socket.off('update-mqtt-milesight-servers', onUpdateMqttMilesightServers);
      socket.off('update-mqtt-milesight-devices', onUpdateMqttMilesightDevices);
      socket.off('system-snapshot', applySystemSnapshot);
      socket.off('sync-new-system-data', onSyncNewSystemData);
      socket.off('logs-batch', onLogsBatch);
      socket.off('connect', requestFullSync);
      socket.off('update-svms-device-features', onUpdateSvmsDeviceFeatures);
      socket.off('update-svms-known-events', onUpdateSvmsKnownEvents);
      socket.off('update-milesight-known-events', onUpdateMilesightKnownEvents);
      socket.off('update-sunell-known-events', onUpdateSunellKnownEvents);
    };
  }, []);

  // selectedEventType state and ref are declared at the top of useSocketManager

  // ─── Display filter: computed từ toàn bộ logs[], không discard log nào ────────
  // Tất cả log đều được lưu vào logs[]. filteredLogs chỉ là view computed để render.
  // Khi user bỏ filter (selectedEventType = null), filteredLogs = toàn bộ lịch sử.
  const filteredLogs = useMemo(() => {
    if (selectedEventTypes.length === 0) return logs;
    return logs.filter(log => selectedEventTypes.some(type => isTypeMatched(log.log_type, type)));
  }, [logs, selectedEventTypes]);

  return {
    socket,
    isConnected,
    logs,
    filteredLogs,
    servers,
    devices,
    systemConfig,
    setSystemConfig,
    sendServers,
    receiveServers,
    handleAddExternalServer,
    handleRemoveConnection,
    eventTypes,
    selectedEventTypes,
    setSelectedEventTypes,
    totalLogCount,
    KEEP_TOTAL_LOG_COUNT: env.KEEP_TOTAL_LOG_COUNT,
    mqttServers,
    mqttLogs,
    cameraDevices,
    handleAddMqttServer,
    handleRemoveMqttServer,
    handleUpdateMqttServer,
    fetchCameras,
    deviceCameraLinks,
    handleLinkDeviceCamera,
    handleLinkMqttServerCamera,
    gridLayout,
    saveGridLayout,
    fetchGridLayout,
    svmsDeviceFeatures,
    svmsKnownEvents,
    milesightKnownEvents,
    sunellKnownEvents,
    // ─── New System Data ───
    newSvmsLogs,
    svmsServers,
    svmsDevices,
    mqttMilesightServers,
    mqttMilesightDevices,
  };
}
