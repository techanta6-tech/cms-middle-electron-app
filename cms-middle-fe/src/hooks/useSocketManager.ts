import { useEffect, useState, useCallback, useRef } from 'react';
import { socket, updateSocketUrlAsync } from '../socket';
import type { LogData, SystemConnection, SystemConfig, ServerData, DeviceData, MqttServerConfig, MqttLogEntry } from '../types';
import apiClient from '../api/apiClient';
import axios from 'axios';

const env = {
  MAX_LOGS_LIST: Number(import.meta.env.VITE_MAX_LOGS_LIST) || 5000,
  KEEP_TOTAL_LOG_COUNT: import.meta.env.VITE_KEEP_TOTAL_LOG_COUNT === 'true'
};

console.log('[DEBUG_ENV] VITE_MAX_LOGS_LIST:', import.meta.env.VITE_MAX_LOGS_LIST, '->', env.MAX_LOGS_LIST);

export function useSocketManager() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  useEffect(() => {
    setIsConnected(socket.connected);
  }, [socket.connected]);

  const [logs, setLogs] = useState<LogData[]>([]);
  const [totalLogCount, setTotalLogCount] = useState(0);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [mqttLogs, setMqttLogs] = useState<MqttLogEntry[]>([]);

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
      ip: localStorage.getItem('BE_HOST') || import.meta.env.VITE_BE_HOST || 'localhost',
      port: localStorage.getItem('BE_PORT') || import.meta.env.VITE_BE_PORT || '5050'
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

      const newLog: LogData = {
        id: crypto.randomUUID(),
        time: Math.floor(timeNumber),
        device_index: data.body?.device_index || 0,
        device_ip: data.body?.device_ip || '127.0.0.1',
        device_type: data.body?.device_type || 'camera',
        device_name: data.body?.device_name || 'Channel',
        log_type: data.body?.log_type || 'event.info',
        description: data.body?.description || 'Event received',
        snapshot: data.body?.snapshot,
        server: serverData,
        ip: data.ip,
        raw: raw,
        cameraIp: data.body?.device_ip || 'SYSTEM'
      };

      if (data.ip && data.ip !== '127.0.0.1' && data.ip !== '::1') {
        updateReceiveServer(data, true);
      }

      // Push to buffer instead of direct setState — flushed every 500ms
      logBufferRef.current.push(newLog);
      eventTypeBufferRef.current.add(newLog.log_type);
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
          mqttServerId: raw.mqttServerId,
          brokerHost: raw.brokerHost,
          brokerPort: raw.brokerPort,
        };
        mqttLogBufferRef.current.push(mqttLogEntry);
      }

      // Also push to generic LogData for the log table
      const deviceInfo = raw.payload?.deviceInfo;
      const events = raw.payload?.object?.events;
      const eventDesc = events?.map((e: any) => `${e.alarm_type}:${e.alarm_status}`).join(', ') || '';
      const newLog: LogData = {
        id: crypto.randomUUID(),
        time: Math.floor(new Date(raw.time || Date.now()).getTime() / 1000),
        device_index: 0,
        device_ip: raw.brokerHost || '',
        device_type: 'mqtt',
        device_name: deviceInfo?.deviceName || 'MQTT Device',
        log_type: raw.type || 'data',
        description: eventDesc || `MQTT - ${raw.type || 'data'}`,
        server: { server_id: `mqtt-${raw.mqttServerId}`, serial: deviceInfo?.devEui || '' },
        ip: raw.brokerHost || '',
        raw: raw,
        source: 'mqtt',
        mqttServerId: raw.mqttServerId,
      };

      logBufferRef.current.push(newLog);
      eventTypeBufferRef.current.add(newLog.log_type);
    };

    socket.on('external-server-connecting', onConnectingExternalServer);
    socket.on('external-server-connect', onConnectedExternalServer);
    socket.on('external-server-disconnect', onDisconnectedExternalServer);
    socket.on('external-server-err-connect', onErrorExternalServer);
    socket.on('receive-log', onReceiveLog);
    socket.on('update-client', onUpdateClients);
    socket.on('log-dispatched', onLogDispatched);
    socket.on('receive-server-information', onReceiveServerInformation);
    socket.on('receive-devices-information', onReceiveDevicesInformation);
    socket.on('update-connections', onUpdateConnections);
    socket.on('server-connection-status', onServerConnectionStatus);
    socket.on('device-connection-status', onDeviceConnectionStatus);
    socket.on('update-mqtt-servers', onUpdateMqttServers);
    socket.on('receive-mqtt-log', onReceiveMqttLog);

    return () => {
      socket.off('external-server-connecting', onConnectingExternalServer);
      socket.off('external-server-connect', onConnectedExternalServer);
      socket.off('external-server-disconnect', onDisconnectedExternalServer);
      socket.off('external-server-err-connect', onErrorExternalServer);
      socket.off('receive-log', onReceiveLog);
      socket.off('update-client', onUpdateClients);
      socket.off('log-dispatched', onLogDispatched);
      socket.off('receive-server-information', onReceiveServerInformation);
      socket.off('receive-devices-information', onReceiveDevicesInformation);
      socket.off('update-connections', onUpdateConnections);
      socket.off('server-connection-status', onServerConnectionStatus);
      socket.off('device-connection-status', onDeviceConnectionStatus);
      socket.off('update-mqtt-servers', onUpdateMqttServers);
      socket.off('receive-mqtt-log', onReceiveMqttLog);
    };
  }, []);

  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);

  return {
    socket,
    isConnected,
    logs,
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
    handleAddMqttServer,
    handleRemoveMqttServer,
    handleUpdateMqttServer,
  };
}
