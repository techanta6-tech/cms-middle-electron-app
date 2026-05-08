import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { socket, updateSocketUrlAsync, getBeHost, getBePort } from '../socket';
import type { LogData, SystemConnection, SystemConfig, ServerData, DeviceData, MqttServerConfig, MqttLogEntry, MqttDeviceConfig, DeviceCameraLink } from '../types';
import apiClient from '../api/apiClient';
import axios from 'axios';

const env = {
  MAX_LOGS_LIST: Number(import.meta.env.VITE_MAX_LOGS_LIST) || 5000,
  KEEP_TOTAL_LOG_COUNT: import.meta.env.VITE_KEEP_TOTAL_LOG_COUNT === 'true'
};

console.log('[DEBUG_ENV] VITE_MAX_LOGS_LIST:', import.meta.env.VITE_MAX_LOGS_LIST, '->', env.MAX_LOGS_LIST);

const DEFAULT_EVENT_TYPES = [
  // ─── VMS / SVMS ───
  // Chỉ dùng GROUP KEY ở đây. Alias (vd: 'ai.alarm.crosswire.all') đã được map trong LOG_TYPE_GROUPS.
  'crosswire',                       // SVMS: Vượt hàng rào (alias: ai.alarm.crosswire.all)
  'direction',                        // SVMS: Hướng di chuyển (alias: ai.alarm.direction.all)

  // ─── Sunell SDK (receive-sunell-log → cameras.service.js onAlarm callback) ───
  'lpr_event',                       // Sunell: phát hiện biển số (TargetDetectList Type=3)
  // 'face_event',                      // Sunell: phát hiện khuôn mặt (TargetDetectList Type=0)
  'motion_event',                    // Sunell: phát hiện chuyển động (main_type=1, sub_type=2)
  // ⚠️ system_event: BE emit `system_event_${mainType}_${subType}` — tự add runtime qua eventTypeBufferRef

  // ─── Sunell SDK — IVA sub_type mapping (main_type=6 hoặc 9, cameras.service.js IVA_SUBTYPE_MAP) ───
  // ⚠️ IVA sub_type không nằm trong map: BE emit `iva_event_${subType}` — tự add runtime
  'iva_trip_wire',                   // Sunell IVA: vượt hàng rào ảo (sub_type=21)
  'iva_perimeter_intrusion',         // Sunell IVA: xâm nhập vùng cấm (sub_type=24)
  // 'iva_double_trip_wire',            // Sunell IVA: hàng rào ảo kép (sub_type=25)
  // 'iva_retrograde',                  // Sunell IVA: đi ngược chiều (sub_type=31)
  // 'iva_smd',                         // Sunell IVA: phát hiện đối tượng di chuyển SMD (sub_type=22)
  // 'iva_occlusion',                   // Sunell IVA: phân tích che khuất (sub_type=23)
  // 'iva_loitering',                   // Sunell IVA: lảng vảng (sub_type=26)
  // 'iva_crowd_loitering',             // Sunell IVA: đám đông lảng vảng (sub_type=27)
  // 'iva_object_left',                 // Sunell IVA: bỏ quên đồ vật (sub_type=28)
  // 'iva_object_removed',              // Sunell IVA: mất cắp đồ vật (sub_type=29)
  // 'iva_abnormal_speed',              // Sunell IVA: đi quá tốc độ (sub_type=30)
  // 'iva_illegal_parking',             // Sunell IVA: đậu xe trái phép (sub_type=32)
  // 'iva_camera_shift',                // Sunell IVA: camera bị dời góc (sub_type=33)
  // 'iva_signal_bad',                  // Sunell IVA: lỗi tín hiệu video AI (sub_type=34)

  // ─── MQTT Radar/Sensor (receive-mqtt-log → mqtt.service.js, log_type = raw.type) ───
  // 'data',                            // MQTT: dữ liệu cảm biến (có object.events)
  // 'raw',                             // MQTT: payload thô (không có object.events)
  'mqtt_fall_alarm',                 // VS373: Té ngã
  'mqtt_out_bed_alarm',              // VS373: Rời khỏi giường
  'mqtt_dwell_alarm',                // VS373: Lưu trú quá lâu
  'mqtt_static_alarm',               // VS373: Bất động bất thường
  'mqtt_vacant_alarm',               // VS373: Phòng trống
  'mqtt_occupy_alarm',               // VS373: Có người
];

/**
 * ─── LOG_TYPE_GROUPS ─────────────────────────────────────────────────────────
 * Map từ "tên nhóm hiển thị trên Filter UI" → danh sách tất cả các giá trị
 * log_type thực tế có thể đến từ các nguồn khác nhau (SVMS, MQTT, Sunell...).
 *
 * ✅ CÁCH SỬ DỤNG:
 *
 * 1. THÊM LOẠI SỰ KIỆN MỚI HOÀN TOÀN:
 *    - Tạo một key mới trong object bên dưới.
 *    - Thêm key đó vào mảng DEFAULT_EVENT_TYPES ở trên.
 *    - Thêm key đó vào `app.logtype` trong file `i18n.ts` (cả vi và en).
 *    Ví dụ — thêm loại "Phát hiện cháy":
 *      'fire_alarm': ['fire_alarm', 'fire.alarm.all', 'FireDetected']
 *
 * 2. THÊM ALIAS MỚI CHO LOẠI SỰ KIỆN ĐÃ CÓ:
 *    - Chỉ cần bổ sung chuỗi mới vào mảng của group tương ứng.
 *    Ví dụ — SVMS version mới gửi 'ai.alarm.crosswire.v2':
 *      'crosswire': ['crosswire', 'ai.alarm.crosswire.all', 'ai.alarm.crosswire.v2']
 *
 * ⚠️ LƯU Ý:
 *    - log_type thực tế trong LogData KHÔNG bị ghi đè, giữ nguyên giá trị
 *      gốc từ thiết bị gửi về (ví dụ: 'ai.alarm.crosswire.all').
 *    - Key của group (ví dụ: 'crosswire') chỉ dùng để:
 *      a) Hiển thị tên đẹp trên Filter UI (qua i18n).
 *      b) Kiểm tra log có khớp với filter đang chọn không (qua isTypeMatched).
 *      c) Làm fallback để lấy tên hiển thị (qua getLogTypeDisplayName).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LOG_TYPE_GROUPS: Record<string, string[]> = {
  'motion_event': ['motion', 'motion_event', 'a_motion_has_been_detected', 'phát_hiện_chuyển_động_(motion)'],
  'lpr_event': ['lpr_event', 'phát_hiện_biển_số_(lpr)'],
  'face_event': ['face_event', 'phát_hiện_khuôn_mặt_(face)'],
  'iva_event': ['iva_event', 'phân_tích_ai_(ivs/iva)'],
  'mqtt_fall_alarm': ['Fall Alarm', 'fall_alarm', 'mqtt_fall_alarm'],
  'mqtt_out_bed_alarm': ['Out Bed Alarm', 'out_bed_alarm', 'mqtt_out_bed_alarm'],
  'mqtt_dwell_alarm': ['Dwell Alarm', 'dwell_alarm', 'Dwell time Alarm', 'mqtt_dwell_alarm'],
  'mqtt_static_alarm': ['Abnormal Static Alarm', 'static_alarm', 'mqtt_static_alarm'],
  'mqtt_vacant_alarm': ['Vacant Alarm', 'vacant_alarm', 'mqtt_vacant_alarm'],
  'mqtt_occupy_alarm': ['Occupy Alarm', 'occupy_alarm', 'mqtt_occupy_alarm'],
  // SVMS AI: giữ giá trị gốc từ thiết bị, alias được map vào đây
  'crosswire': ['crosswire', 'ai.alarm.crosswire.all'],
  'direction': ['direction', 'ai.alarm.direction.all'],
};

/**
 * Resolve raw log_type về group key nếu nó là alias trong LOG_TYPE_GROUPS.
 * Dùng khi add vào eventTypeBufferRef để tránh tạo mục filter riêng cho alias.
 * Ví dụ: 'ai.alarm.direction.all' → 'direction'
 */
const resolveToGroupKey = (logType: string): string => {
  for (const [groupKey, members] of Object.entries(LOG_TYPE_GROUPS)) {
    if (members.includes(logType)) return groupKey;
  }
  return logType;
};

/**
 * Kiểm tra log có thuộc filter đang chọn không (có hỗ trợ group alias).
 */
const isTypeMatched = (logType: string, filterType: string | null) => {
  if (!filterType) return true;
  const matched = logType === filterType || (LOG_TYPE_GROUPS[filterType]?.includes(logType) ?? false);
  console.log(`[FILTER] "${logType}" vs "${filterType}" → ${matched ? '✅ matched' : '❌ not matched'}`);
  return matched;
};

/**
 * Lấy tên hiển thị (đã dịch) cho một log_type bất kỳ.
 *
 * Thứ tự ưu tiên:
 *  1. Tra trực tiếp key trong i18n (ví dụ: 'crosswire', 'lpr_event').
 *  2. Tìm group chứa logType, lấy tên của group đó từ i18n
 *     (ví dụ: 'ai.alarm.crosswire.all' → group 'crosswire' → 'Hàng rào ảo').
 *  3. Fallback: trả về chính logType đó.
 *
 * @param logType - Giá trị log_type thực tế từ LogData (ví dụ: 'ai.alarm.crosswire.all')
 * @param t       - Hàm dịch từ useTranslation()
 * @returns Chuỗi tên hiển thị đã được dịch
 */
export const getLogTypeDisplayName = (logType: string, t: (key: string) => string): string => {
  // Bước 1: Thử tra trực tiếp (ví dụ: 'crosswire', 'lpr_event' đã có key i18n riêng)
  const directKey = `app.logtype.${logType}`;
  const directResult = t(directKey);
  if (directResult !== directKey) return directResult;

  // Bước 2: Tìm group chứa logType này, rồi dùng tên group để tra i18n
  for (const [groupKey, members] of Object.entries(LOG_TYPE_GROUPS)) {
    if (members.includes(logType)) {
      const groupI18nKey = `app.logtype.${groupKey}`;
      const groupResult = t(groupI18nKey);
      if (groupResult !== groupI18nKey) return groupResult;
    }
  }

  // Bước 3: Fallback — trả về chính logType
  return logType;
};

export function useSocketManager() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  useEffect(() => {
    setIsConnected(socket.connected);
  }, [socket.connected]);

  const [logs, setLogs] = useState<LogData[]>([]);
  const [totalLogCount, setTotalLogCount] = useState(0);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);

  // Use a ref to keep the latest selectedEventType available inside the mounting useEffect (no stale closures)
  const selectedEventTypeRef = useRef<string | null>(null);
  selectedEventTypeRef.current = selectedEventType;

  const [eventTypes, setEventTypes] = useState<string[]>(DEFAULT_EVENT_TYPES);
  const [mqttLogs, setMqttLogs] = useState<MqttLogEntry[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MqttDeviceConfig[]>([]);
  const [deviceCameraLinks, setDeviceCameraLinks] = useState<DeviceCameraLink[]>([]);
  const [gridLayout, setGridLayout] = useState<{ grids: any[]; gridCols: number }>({ grids: [], gridCols: 3 });

  // ─── Log Batching: buffer incoming logs and flush every 500ms ───────────────
  const logBufferRef = useRef<LogData[]>([]);
  const eventTypeBufferRef = useRef<Set<string>>(new Set());
  const mqttLogBufferRef = useRef<MqttLogEntry[]>([]);

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
      if (eventTypeBufferRef.current.size > 0) {
        const newTypes = Array.from(eventTypeBufferRef.current);
        eventTypeBufferRef.current.clear();
        setEventTypes(prev => Array.from(new Set([...prev, ...newTypes])));
      }
    }, 500);
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
    try {
      const { data } = await apiClient.patch('/api/v1/mqtt-device-camera-link', { devEui, mqttServerId, cameraId });
      setDeviceCameraLinks(data.links || []);
      console.log('[LINK_DEVICE_CAMERA] Updated:', { devEui, mqttServerId, cameraId });
    } catch (err) {
      console.error('[LINK_DEVICE_CAMERA] Failed:', err);
    }
  }, []);

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

  const handleAddExternalServer = async (ip: string, port: string, mode: 'receive' | 'send') => {
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
  };

  // ─── MQTT Server Handlers ───────────────────────────────────────────────────
  const handleAddMqttServer = async (config: MqttServerConfig) => {
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
  };

  const handleRemoveMqttServer = async (id: string) => {
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
  };

  const handleUpdateMqttServer = async (id: string, config: Partial<MqttServerConfig>) => {
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
  };

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

      const newLog: LogData = {
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
        snapshot: data.body?.snapshot || data.body?.picture || (data.body?.pictures && data.body?.pictures[0]) || undefined
      };

      if (data.ip && data.ip !== '127.0.0.1' && data.ip !== '::1') {
        updateReceiveServer(data, true);
      }


      // Push to buffer instead of direct setState — flushed every 500ms
      logBufferRef.current.push(newLog);
      // Resolve alias → group key để tránh tạo mục filter trùng (vd: 'ai.alarm.direction.all' → 'direction')
      eventTypeBufferRef.current.add(resolveToGroupKey(newLog.log_type));
    };

    const onReceiveSunellLog = (raw: any) => {
      const timeNumber = raw.timestamp ? new Date(raw.timestamp).getTime() / 1000 : Date.now() / 1000;

      const newLog: LogData = {
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
      logBufferRef.current.push(newLog);
      eventTypeBufferRef.current.add(resolveToGroupKey(newLog.log_type));
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

      // Store raw MqttLogEntry for device extraction (only data logs with payload)
      if (!isSystem && raw.payload) {
        const mqttLogEntry: MqttLogEntry = {
          time: raw.time || new Date().toISOString(),
          type: raw.type || 'data',
          topic: raw.topic || '',
          payload: raw.payload,
          snapshot: raw.snapshot || undefined,
          mqttServerId: raw.mqttServerId,
          brokerHost: raw.brokerHost,
          brokerPort: raw.brokerPort,
        };
        mqttLogBufferRef.current.push(mqttLogEntry);
      }

      // Use individual event (1 log = 1 event now)
      const deviceInfo = raw.payload?.deviceInfo;
      const event = raw.event;
      const eventDesc = event ? `${event.alarm_type}:${event.alarm_status}` : '';
      const safeRaw = { ...raw };
      if (safeRaw.snapshot) safeRaw.snapshot = '[BASE64_IMAGE_OMITTED_FROM_RAW]';

      const newLog: LogData = {
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


      logBufferRef.current.push(newLog);
      eventTypeBufferRef.current.add(resolveToGroupKey(newLog.log_type));
    };

    socket.on('external-server-connecting', onConnectingExternalServer);
    socket.on('external-server-connect', onConnectedExternalServer);
    socket.on('external-server-disconnect', onDisconnectedExternalServer);
    socket.on('external-server-err-connect', onErrorExternalServer);
    socket.on('receive-log', onReceiveLog);
    socket.on('receive-sunell-log', onReceiveSunellLog);

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

    // DEBUG: Camera snapshot pipeline logs
    const onDebugCameraSnapshot = (data: { time: string; message: string }) => {
      console.log(`%c[CAMERA-SNAPSHOT] ${data.message}`, 'color: #ff6b6b; font-weight: bold; background: #1a1a2e; padding: 2px 6px; border-radius: 3px');
    };
    socket.on('debug-camera-snapshot', onDebugCameraSnapshot);

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
    };
  }, []);

  // selectedEventType state and ref are declared at the top of useSocketManager

  // ─── Display filter: computed từ toàn bộ logs[], không discard log nào ────────
  // Tất cả log đều được lưu vào logs[]. filteredLogs chỉ là view computed để render.
  // Khi user bỏ filter (selectedEventType = null), filteredLogs = toàn bộ lịch sử.
  const filteredLogs = useMemo(() => {
    if (!selectedEventType) return logs;
    return logs.filter(log => isTypeMatched(log.log_type, selectedEventType));
  }, [logs, selectedEventType]);

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
    selectedEventType,
    setSelectedEventType,
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
    gridLayout,
    saveGridLayout,
    fetchGridLayout
  };
}
