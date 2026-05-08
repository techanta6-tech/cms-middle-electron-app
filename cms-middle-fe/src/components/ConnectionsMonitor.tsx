import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogData, SystemConnection, SystemConfig, ServerData, DeviceData, MqttServerConfig, MqttLogEntry, MqttDeviceConfig, DeviceCameraLink } from '../types';
import { Plus, Inbox, Activity, Terminal, Cpu, Globe, Send, Wifi, WifiOff, Loader2, ChevronDown, RefreshCw, Trash2, Settings, ArrowDownLeft, ArrowUpRight, Radio, Camera, Search, Filter, Bell, BellRing } from 'lucide-react';
import { AddExternalServer } from './AddExternalServer';
import { ConfigSystem } from './ConfigSystem';
import apiClient from '../api/apiClient';
import { socket } from '../socket';
import axios from 'axios';

const EMPTY_LOGS: LogData[] = [];

/** Throttle interval riêng cho tab Giám sát sự kiện (ms) */
const MONITOR_THROTTLE_MS = 30000;

/**
 * Hook throttle: chỉ cập nhật giá trị mới mỗi MONITOR_THROTTLE_MS.
 * Tab Giám sát sự kiện dùng hook này để giảm tần suất re-render
 * xuống 1 lần/giây thay vì theo flush 500ms của useSocketManager.
 */
function useThrottledValue<T>(value: T, delayMs: number = MONITOR_THROTTLE_MS): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdated = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdated.current;

    if (elapsed >= delayMs) {
      // Đủ thời gian → cập nhật ngay
      setThrottled(value);
      lastUpdated.current = now;
    } else {
      // Chưa đủ → schedule cập nhật khi hết interval
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setThrottled(value);
        lastUpdated.current = Date.now();
      }, delayMs - elapsed);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delayMs]);

  return throttled;
}

function InfoTooltip({ children, content, side = "top" }: { children: React.ReactNode, content: string, side?: "top" | "bottom" }) {
  const isBottom = side === "bottom";
  return (
    <div className="relative w-fit group/tooltip flex items-center cursor-help">
      {children}
      <div className={`absolute left-1/2 -translate-x-1/2 ${isBottom ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} w-max max-w-[200px] text-center z-50 pointer-events-none opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 bg-on-surface text-gray-700 text-[10px] px-2 py-1.5 rounded shadow-lg font-medium leading-tight`}>
        {content}
        <div className={`absolute left-1/2 -translate-x-1/2 ${isBottom ? 'bottom-full border-b-[4px] border-b-on-surface' : 'top-full border-t-[4px] border-t-on-surface'} border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent`}></div>
      </div>
    </div>
  );
}

// ─── Reusable DeviceLogPanel: filtered + searchable log list ───────────────
function DeviceLogPanel({ logs }: { logs: LogData[] }) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('__all__');
  const [displayLimit, setDisplayLimit] = useState(30);

  // Extract unique log_type values
  const logTypes = useMemo(() => {
    const types = new Set<string>();
    logs.forEach(l => { if (l.log_type) types.add(l.log_type); });
    return Array.from(types).sort();
  }, [logs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    let result = logs;
    if (typeFilter !== '__all__') {
      result = result.filter(l => l.log_type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        (l.description || '').toLowerCase().includes(q) ||
        (l.log_type || '').toLowerCase().includes(q) ||
        (l.device_name || '').toLowerCase().includes(q)
      );
    }
    // Sort by time descending (newest first)
    return result.sort((a, b) => b.time - a.time);
  }, [logs, typeFilter, searchQuery]);

  const displayedLogs = filteredLogs.slice(0, displayLimit);
  const hasMore = filteredLogs.length > displayLimit;

  const logTypeBadgeColor = (type: string) => {
    const t = type?.toUpperCase() || '';
    if (t.includes('ALARM') || t.includes('ALERT')) return 'text-tertiary';
    if (t.includes('EVENT') || t.includes('MOTION')) return 'text-amber-400';
    if (t.includes('FACE') || t.includes('RECOGNIZE')) return 'text-primary';
    return 'text-on-surface-variant';
  };

  return (
    <div className="device-log-panel mt-1 bg-surface-container-lowest/60 border border-outline-variant/10 rounded-md overflow-hidden">
      {/* Filters row */}
      <div className="flex items-center gap-2 p-1.5 border-b border-outline-variant/10 bg-surface-container/30">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('app.monitor.search_logs')}
            className="w-full text-[9px] font-mono bg-surface-container border border-outline-variant/15 rounded pl-6 pr-2 py-1 text-on-surface placeholder:text-on-surface-variant/30 focus:border-secondary/40 focus:outline-none transition-colors"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant/40" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-[9px] font-mono bg-surface-container border border-outline-variant/15 rounded pl-6 pr-6 py-1 text-on-surface appearance-none cursor-pointer focus:border-secondary/40 focus:outline-none transition-colors"
          >
            <option value="__all__">{t('app.monitor.all_types')}</option>
            {logTypes.map(lt => {
              const translatedType = t(`app.logtype.${lt.toLowerCase().replace(/ /g, '_').replace(/\./g, '_')}`, { defaultValue: lt });
              return (
                <option key={lt} value={lt}>{translatedType}</option>
              );
            })}
          </select>
        </div>
        <span className="text-[9px] font-mono font-bold text-on-surface-variant/50 shrink-0">
          {filteredLogs.length} / {logs.length}
        </span>
      </div>

      {/* Log entries */}
      <div className="max-h-[180px] overflow-y-auto custom-scrollbar">
        {displayedLogs.length === 0 ? (
          <div className="py-4 flex flex-col items-center justify-center gap-1.5 opacity-40">
            <Search className="w-3.5 h-3.5" />
            <span className="text-[8.5px] font-bold uppercase tracking-widest">{t('app.monitor.no_logs_found')}</span>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/5">
            {displayedLogs.map((log, i) => {
              let displayDesc = log.description;
              if (displayDesc) {
                const descKey = displayDesc.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
                displayDesc = t(`app.logtype.${descKey}`, {
                  defaultValue: t(`app.mqtt_alarm_type.${descKey}`, { defaultValue: displayDesc })
                });
              }

              if (log.source === 'mqtt') {
                let evt = log.raw?.event;
                if (!evt && log.raw?.payload?.object?.events?.length > 0) {
                  evt = log.raw.payload.object.events[0];
                }
                if (evt) {
                  const typeVal = evt.alarm_type !== undefined ? evt.alarm_type : evt.type;
                  if (typeVal !== undefined) {
                    const lowerVal = String(typeVal).toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
                    displayDesc = t(`app.mqtt_alarm_type.${lowerVal}`, {
                      defaultValue: t(`app.logtype.${lowerVal}`, { defaultValue: String(typeVal) })
                    });
                  }
                }
              }

              const displayType = t(`app.logtype.${(log.log_type || log.raw?.body?.log_type || 'LOG').toLowerCase().replace(/ /g, '_').replace(/\./g, '_')}`, {
                defaultValue: log.log_type || 'LOG'
              });

              return (
                <div key={log.id || i} className="flex items-baseline gap-2 px-2 py-1 hover:bg-surface-container/30 transition-colors">
                  <span className="text-[8.5px] font-mono text-on-surface-variant/50 shrink-0 min-w-[50px]">
                    {new Date(log.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`min-w-[150px] text-[7.5px] font-bold uppercase tracking-wider shrink-0 min-w-[45px] text-left ${logTypeBadgeColor(log.log_type)}`}>
                    {displayType}
                  </span>
                  <span className="text-[9px] text-on-surface-variant leading-tight flex-1 break-words">
                    {displayDesc || '—'}
                  </span>
                  <span className="text-[7.5px] font-mono text-on-surface-variant/30 shrink-0">
                    {log.server?.server_id || ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Show more */}
      {hasMore && (
        <button
          onClick={() => setDisplayLimit(prev => prev + 30)}
          className="w-full py-1.5 text-[8.5px] font-bold uppercase tracking-widest text-secondary hover:bg-secondary/5 border-t border-outline-variant/10 transition-colors"
        >
          {t('app.monitor.show_more')} ({filteredLogs.length - displayLimit} {t('app.monitor.recent_logs')})
        </button>
      )}
    </div>
  );
}

export function ConnectionsMonitor({
  logs, sendServers, servers, devices, mqttServers, mqttLogs, cameraDevices, deviceCameraLinks, onLinkDeviceCamera, onLinkMqttServerCamera
}: {
  socket: any,
  isConnected: boolean,
  logs: LogData[],
  sendServers: SystemConnection[],
  receiveServers: SystemConnection[],
  systemConfig: SystemConfig;
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  mqttServers: MqttServerConfig[];
  mqttLogs: MqttLogEntry[];
  cameraDevices: MqttDeviceConfig[];
  deviceCameraLinks: DeviceCameraLink[];
  onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void;
  onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void;
  onSave: (ip: string, port: string, mode: 'receive' | 'send') => void,
  onSaveMqtt: (config: MqttServerConfig) => void,
  onSaveSystemConfig: (config: SystemConfig) => void,
  onRemoveConnection: (ip: string, port: string, mode: 'receive' | 'send') => void,
}) {
  // ─── Throttle logs riêng cho tab này: 1 lần/giây thay vì 500ms ──────────
  const throttledLogs = useThrottledValue(logs, MONITOR_THROTTLE_MS);

  // ─── Pre-filter logs by category to minimize cascading re-renders ────────
  const svmsLogs = useMemo(() =>
    (throttledLogs || []).filter(l => l.source !== 'mqtt' && l.source !== 'sunell-camera'),
    [throttledLogs]
  );

  const sunellLogs = useMemo(() =>
    (throttledLogs || []).filter(l => l.source === 'sunell-camera'),
    [throttledLogs]
  );

  // Pre-group SVMS logs by server_id → each ServerInputCard gets its own small slice
  const svmsLogsByServer = useMemo(() => {
    const map: Record<string, LogData[]> = {};
    svmsLogs.forEach(l => {
      const sId = l.server?.server_id || '';
      if (!map[sId]) map[sId] = [];
      map[sId].push(l);
    });
    return map;
  }, [svmsLogs]);

  // Group log stats strictly by server_id + server_serial + device_name + device_ip
  const deviceLogStats = useMemo(() => {
    const stats: Record<string, { serverId: string; serverSerial: string; deviceName: string; deviceIp: string; logCount: number }> = {};
    svmsLogs.forEach(log => {
      const sId = log.server?.server_id || '';
      const sSerial = log.server?.serial || '';
      const dName = log.device_name || '';
      const dIp = log.device_ip || '';

      const key = `${sId}_${sSerial}_${dName}_${dIp}`;

      if (!stats[key]) {
        stats[key] = {
          serverId: sId,
          serverSerial: sSerial,
          deviceName: dName,
          deviceIp: dIp,
          logCount: 0
        };
      }
      stats[key].logCount += 1;
    });
    return stats;
  }, [svmsLogs]);

  // Find logs that don't match any configured server/device
  const orphanDevices = useMemo(() => {
    const knownKeys = new Set<string>();
    Object.values(servers).forEach(srv => {
      const sId = srv.id || '';
      const sSerial = srv.serial || '';
      const serverIdForDevices = srv.id || srv.serial || srv.server_ip || srv.svms_ipv4_ip || '';
      const matchedDevices = devices[serverIdForDevices] || devices[srv.id] || devices[srv.serial];

      if (matchedDevices && matchedDevices.devices) {
        matchedDevices.devices.forEach((d: any) => {
          const dName = d.name || '';
          const dIp = d.ip || '';
          knownKeys.add(`${sId}_${sSerial}_${dName}_${dIp}`);
        });
      }
    });

    const orphans: { name: string, ip: string, logCount: number }[] = [];
    Object.keys(deviceLogStats).forEach(key => {
      if (!knownKeys.has(key)) {
        const stat = deviceLogStats[key];
        const isCamera = cameraDevices.some(cam => cam.cameraIp === stat.deviceIp || cam.id === stat.deviceName);
        if (isCamera) return;

        orphans.push({
          name: stat.deviceName || 'UNKNOWN',
          ip: stat.deviceIp || 'UNKNOWN',
          logCount: stat.logCount
        });
      }
    });
    return orphans;
  }, [deviceLogStats, servers, devices]);

  // Extract unique MQTT devices per server from mqttLogs
  const mqttDevicesByServer = useMemo(() => {
    const map: Record<string, { devEui: string; applicationId: string; deviceName: string; deviceProfileName: string; alarmCount: number; lastSeen: string }[]> = {};
    (mqttLogs || []).forEach(log => {
      const serverId = log.mqttServerId;
      const di = log.payload?.deviceInfo;
      if (!serverId || !di?.devEui) return;
      if (!map[serverId]) map[serverId] = [];
      const existing = map[serverId].find(d => d.devEui === di.devEui);
      const eventCount = log.payload?.object?.events?.length || 0;
      if (existing) {
        existing.alarmCount += eventCount;
        existing.lastSeen = log.time;
        if (!existing.applicationId && di.applicationId) existing.applicationId = di.applicationId;
      } else {
        map[serverId].push({
          devEui: di.devEui,
          applicationId: di.applicationId || '',
          deviceName: di.deviceName || 'Unknown',
          deviceProfileName: di.deviceProfileName || 'Unknown',
          alarmCount: eventCount,
          lastSeen: log.time,
        });
      }
    });
    return map;
  }, [mqttLogs]);

  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');
  const { t } = useTranslation();

  return (
    <div className="ConnectionsMonitor flex flex-col h-full bg-background relative">
      <div className="flex-1 overflow-hidden p-6 h-full flex flex-col gap-4 min-h-0">

        {/* Tab Headers */}
        <div className="flex items-center gap-2 border-b border-outline-variant/10 shrink-0">
          <button
            onClick={() => setActiveTab('input')}
            className={`flex-1 py-3 px-6 font-bold uppercase tracking-[0.1em] text-[12px] flex items-center justify-center gap-2 border-b-[3px] transition-all ${activeTab === 'input' ? 'border-secondary text-secondary bg-secondary/5' : 'border-transparent text-on-surface-variant hover:bg-surface-container/50'}`}
          >
            <Terminal className="w-4 h-4" />
            <div className="flex flex-col text-left">
              <span>{t('app.monitor.input_connections')}</span>
              {Object.keys(servers).length + mqttServers.length > 0 && (
                <span className="text-[9px] text-secondary/70 tracking-normal font-mono leading-none">{Object.keys(servers).length + mqttServers.length} {t('app.monitor.sources_emitting')}</span>
              )}
            </div>
          </button>
          {/* <button
            onClick={() => setActiveTab('output')}
            className={`flex-1 py-3 px-6 font-bold uppercase tracking-[0.1em] text-[12px] flex items-center justify-center gap-2 border-b-[3px] transition-all ${activeTab === 'output' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-on-surface-variant hover:bg-surface-container/50'}`}
          >
            <Globe className="w-4 h-4" />
            <div className="flex flex-col text-left">
              <span>{t('app.monitor.output_targets')}</span>
              {sendServers.length > 0 && (
                <span className="text-[9px] text-primary/70 tracking-normal font-mono leading-none">{sendServers.length} {t('app.monitor.endpoints_receiving')}</span>
              )}
            </div>
          </button> */}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-container/20 border border-outline-variant/30 rounded-lg p-5">
          {activeTab === 'input' && (
            <div className="flex flex-col gap-4">
              {Object.keys(servers).length === 0 && orphanDevices.length === 0 && mqttServers.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center opacity-40 gap-3 border border-dashed border-outline-variant/20 rounded-md bg-surface-container-lowest/50">
                  <Inbox className="w-8 h-8 text-on-surface-variant" />
                  <span className="text-[10px] uppercase tracking-widest font-bold">{t('app.monitor.no_input')}</span>
                </div>
              ) : (
                <>
                  {/* SVMS Servers */}
                  {Object.values(servers).filter(srv => srv.type !== 'mqtt' && !srv.id?.toString().startsWith('mqtt-')).map((srv, idx) => {
                    const serverId = srv.id || srv.serial || srv.server_ip || srv.svms_ipv4_ip || '';
                    const matchedDevices = devices[serverId] || devices[srv.id] || devices[srv.serial];
                    return (
                      <ServerInputCard
                        key={srv.id || idx}
                        srv={srv}
                        matchedDevices={matchedDevices}
                        deviceLogStats={deviceLogStats}
                        serverLogs={svmsLogsByServer[srv.id || ''] || EMPTY_LOGS}
                      />
                    );
                  })}

                  {/* MQTT Servers */}
                  {mqttServers.map((ms) => (
                    <MqttServerCard
                      key={ms.id}
                      server={ms}
                      devices={mqttDevicesByServer[ms.id] || []}
                      allCameras={cameraDevices}
                      deviceCameraLinks={deviceCameraLinks}
                      onLinkDeviceCamera={onLinkDeviceCamera}
                      onLinkMqttServerCamera={onLinkMqttServerCamera}
                      logs={logs}
                    />
                  ))}

                  {/* Camera Devices */}
                  <CameraDevicesCard cameras={cameraDevices} sunellLogs={sunellLogs} />

                  <UnknownDevicesCard orphanDevices={orphanDevices} />
                </>
              )}
            </div>
          )}

          {activeTab === 'output' && (
            <div className="flex flex-col gap-4">
              {sendServers.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center opacity-40 gap-3 border border-dashed border-outline-variant/20 rounded-md bg-surface-container-lowest/50">
                  <Send className="w-8 h-8 text-on-surface-variant" />
                  <span className="text-[10px] uppercase tracking-widest font-bold">{t('app.monitor.no_output')}</span>
                </div>
              ) : (
                <>
                  {sendServers.map((s, idx) => (
                    <SendTargetCard key={idx} conn={s} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function UnknownDevicesCard({ orphanDevices }: { orphanDevices: { name: string; ip: string; logCount: number }[] }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!orphanDevices || orphanDevices.length === 0) return null;

  return (
    <div className="unknown-devices-card bg-surface-container border border-outline-variant/10 px-4 py-3 pb-4 rounded-md border-l-[3px] border-l-tertiary/50 shadow-sm transition-all  group">
      {/* Server Header */}
      <div
        className="flex items-center justify-between border-b border-outline-variant/5 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-tertiary/10 rounded-lg shrink-0">
            <Globe className="w-4 h-4 text-tertiary" />
          </div>
          <div className="flex flex-col gap-0.5">
            <InfoTooltip content="Các logs không có cấu hình Server/Device tương ứng">
              <span className="text-[14px] font-black text-on-surface tracking-wide leading-none group-hover:text-primary transition-colors">Unmapped / External Devices</span>
            </InfoTooltip>
            <div className="flex items-center gap-3 pt-1">
              <InfoTooltip content="Trạng thái">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.unregistered_orphan')}</span>
              </InfoTooltip>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.unknown_devices')}</span>
            <span className="text-[14px] font-black font-mono text-tertiary leading-none">{orphanDevices.length}</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
        <div className={`min-h-0 ${isExpanded ? 'overflow-visible' : 'overflow-hidden'}`}>
          <div className="grid gap-2 pl-1 border-l-2 border-outline-variant/10 ml-2">
            {orphanDevices.map((device, dIdx) => (
              <DeviceItemRow
                key={dIdx}
                name={device.name}
                ip={device.ip}
                logCount={device.logCount}
                isOrphan={true}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const CameraDevicesCard = memo(function CameraDevicesCard({ cameras, sunellLogs }: { cameras: MqttDeviceConfig[]; sunellLogs: LogData[] }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  // Count logs per camera (already pre-filtered to sunell-camera only)
  const cameraLogStats = useMemo(() => {
    const stats: Record<string, number> = {};
    sunellLogs.forEach(log => {
      const camId = log.cameraIp || '';
      stats[camId] = (stats[camId] || 0) + 1;
    });
    return stats;
  }, [sunellLogs]);

  const totalLogs = useMemo(() => Object.values(cameraLogStats).reduce((sum, n) => sum + n, 0), [cameraLogStats]);

  if (!cameras || cameras.length === 0) return null;

  const connectedCount = cameras.filter(c => c.status === 'connected').length;
  const errorCount = cameras.filter(c => c.status === 'error').length;

  return (
    <div className="camera-devices-card bg-surface-container border border-outline-variant/10 px-4 py-3 pb-4 rounded-md border-l-[3px] border-l-cyan-500/50 shadow-sm transition-all group">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-outline-variant/5 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-cyan-500/10 rounded-lg shrink-0">
            <Camera className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <InfoTooltip content="Các camera kết nối độc lập như Sunell và RTSP">
                  <span className="text-[14px] font-black text-on-surface tracking-wide leading-none group-hover:text-cyan-500 transition-colors">Camera Devices</span>
                </InfoTooltip>
                <div className='flex gap-1 items-center'>
                  <InfoTooltip content="Phân loại thiết bị">
                    <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Sunell & Other Cameras</span>
                  </InfoTooltip>
                  <span className="w-1 h-1 rounded-full bg-outline-variant/30"></span>
                  <InfoTooltip content="Tổng logs nhận được từ cameras">
                    <span className="text-[10px] font-mono font-medium text-on-surface-variant">{totalLogs} logs</span>
                  </InfoTooltip>
                </div>
              </div>
              {/* Status Badge */}
              <InfoTooltip content={`${connectedCount} camera đang hoạt động`}>
                <span className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${connectedCount > 0
                  ? 'text-secondary bg-secondary/10 border-secondary/20'
                  : 'text-tertiary bg-tertiary/10 border-tertiary/20'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${connectedCount > 0 ? 'bg-secondary' : 'bg-tertiary animate-pulse'}`}></span>
                  {connectedCount > 0 ? `${connectedCount} ${t('app.monitor.online')}` : t('app.monitor.offline')}
                </span>
              </InfoTooltip>
              {errorCount > 0 && (
                <InfoTooltip content={`${errorCount} camera lỗi`}>
                  <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm border text-red-500 bg-red-500/10 border-red-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    {errorCount} ERROR
                  </span>
                </InfoTooltip>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.total_logs')}</span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-black font-mono text-secondary leading-none">{totalLogs}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.devices')}</span>
            <span className="text-[14px] font-black font-mono text-on-surface leading-none">{cameras.length}</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Camera list with per-camera log counts */}
      <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
        <div className={`min-h-0 ${isExpanded ? 'overflow-visible' : 'overflow-hidden'}`}>
          <div className="grid gap-2 border-l-2 border-outline-variant/10 pl-2 ml-1">
            {cameras.map((cam) => {
              const logCount = cameraLogStats[cam.id] || 0;
              const isConnected = cam.status === 'connected';
              const isError = cam.status === 'error';

              // Filter pre-filtered sunell logs for this specific camera
              const cameraLogs = sunellLogs.filter(l => l.cameraIp === cam.id);

              return (
                <CameraItemWithLogs
                  key={cam.id}
                  cam={cam}
                  logCount={logCount}
                  isConnected={isConnected}
                  isError={isError}
                  cameraLogs={cameraLogs}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.sunellLogs.length === next.sunellLogs.length &&
  prev.cameras === next.cameras
);

const CameraItemWithLogs = memo(function CameraItemWithLogs({ cam, logCount, isConnected, isError, cameraLogs }: {
  cam: MqttDeviceConfig;
  logCount: number;
  isConnected: boolean;
  isError: boolean;
  cameraLogs: LogData[];
}) {
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const hasLogs = cameraLogs.length > 0;

  return (
    <div className="camera-item-wrapper">
      <div
        className={`flex items-center gap-4 px-3 py-2 bg-surface-container-lowest/40 rounded border transition-colors ${isError
          ? 'border-red-500/20 bg-red-500/5'
          : !isConnected
            ? 'border-tertiary/20 bg-tertiary/5'
            : isLogExpanded
              ? 'border-cyan-500/30 bg-cyan-500/5'
              : 'border-outline-variant/5 hover:border-outline-variant/20'
          } ${hasLogs ? 'cursor-pointer' : ''}`}
        onClick={() => { if (hasLogs) setIsLogExpanded(prev => !prev); }}
      >
        {/* Connection status dot */}
        <InfoTooltip content={isConnected ? 'Đã kết nối' : isError ? 'Lỗi kết nối' : 'Mất kết nối'} side="bottom">
          <div className={`w-2 h-2 rounded-full shrink-0 ring-2 ${isConnected
            ? 'bg-secondary ring-secondary/20'
            : isError
              ? 'bg-red-500 ring-red-500/20 animate-pulse'
              : 'bg-tertiary ring-tertiary/20 animate-pulse'
            }`}></div>
        </InfoTooltip>
        <InfoTooltip content="Loại camera" side="bottom">
          <span className="text-[9.5px] font-mono font-medium min-w-[70px] text-center px-1.5 py-0.5 rounded shadow-sm text-cyan-500 bg-cyan-500/10 border border-cyan-500/20 uppercase">
            {cam.type}
          </span>
        </InfoTooltip>
        <div className="flex flex-col flex-1 min-w-0">
          <InfoTooltip content="Tên Camera" side="bottom">
            <span className={`text-[11px] font-bold tracking-wide truncate max-w-[200px] block ${!isConnected ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
              }`}>{cam.name || cam.id}</span>
            <span className={`text-[11px] font-bold tracking-wide truncate max-w-[200px] block ${!isConnected ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
              }`}>{cam.name || cam.id}</span>
          </InfoTooltip>
          <InfoTooltip content="Địa chỉ IP Camera" side="bottom">
            <span className="text-[10px] font-mono text-on-surface-variant/70 truncate">{cam.cameraIp}:{cam.cameraPort}</span>
          </InfoTooltip>
        </div>
        <div className="flex items-center gap-2">
          <InfoTooltip content="Tổng Logs nhận được">
            <span className={`text-[10px] font-black font-mono px-2 py-1 rounded min-w-[70px] text-center transition-all ${logCount > 0 ? 'text-secondary bg-secondary/15 ring-1 ring-secondary/20' : 'text-on-surface-variant/40 bg-surface-container border border-outline-variant/10'}`}>
              {logCount} logs
            </span>
          </InfoTooltip>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isLogExpanded ? 'rotate-180' : ''} ${hasLogs ? 'text-on-surface-variant/40' : 'text-on-surface-variant/10'}`} />
        </div>
      </div>
      {/* Expandable Log Panel */}
      <div className={`grid transition-all duration-300 ease-in-out ${isLogExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className={`min-h-0 ${isLogExpanded ? 'overflow-visible' : 'overflow-hidden'}`}>
          <DeviceLogPanel logs={cameraLogs} />
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.cameraLogs.length === next.cameraLogs.length &&
  prev.logCount === next.logCount &&
  prev.isConnected === next.isConnected &&
  prev.isError === next.isError &&
  prev.cam === next.cam
);

const DeviceItemRow = memo(function DeviceItemRow({
  name,
  ip,
  type,
  logCount,
  isOrphan = false,
  connectionStatus,
  filteredLogs,
  children
}: {
  name: string;
  ip: string;
  type?: string;
  logCount: number;
  isOrphan?: boolean;
  connectionStatus?: 'connected' | 'disconnected';
  filteredLogs?: LogData[];
  children?: React.ReactNode;
}) {
  const isConnected = connectionStatus === 'connected';
  const isDisconnected = connectionStatus === 'disconnected';
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const hasLogs = filteredLogs && filteredLogs.length > 0;

  return (
    <div className="device-item-row-wrapper flex flex-col gap-1.5">
      <div
        className={`device-item-row flex items-center gap-4 px-3 py-2 bg-surface-container-lowest/40 rounded border transition-colors cursor-pointer ${isDisconnected
          ? 'border-tertiary/20 bg-tertiary/5'
          : isLogExpanded
            ? 'border-secondary/30 bg-secondary/5'
            : 'border-outline-variant/5 hover:border-outline-variant/20'
          } ${hasLogs ? 'cursor-pointer' : ''}`}
        onClick={() => { if (hasLogs) setIsLogExpanded(prev => !prev); }}
      >
        {/* Connection status dot */}
        {connectionStatus && (
          <InfoTooltip content={isConnected ? 'Đã kết nối' : 'Mất kết nối'} side="bottom">
            <div className={`w-2 h-2 rounded-full shrink-0 ring-2 ${isConnected
              ? 'bg-secondary ring-secondary/20'
              : 'bg-tertiary ring-tertiary/20 animate-pulse'
              }`}></div>
          </InfoTooltip>
        )}
        <InfoTooltip content="Phân loại thiết bị" side="bottom">
          <span className={`text-[9.5px] font-mono font-medium min-w-[70px] text-center px-1.5 py-0.5 rounded shadow-sm ${isOrphan ? "text-tertiary bg-tertiary/10 border border-tertiary/20" : "text-secondary bg-secondary/10 border border-secondary/20"}`}>
            {isOrphan ? "UNKNOWN" : (type ? type.toUpperCase() : "UNKNOWN")}
          </span>
        </InfoTooltip>
        <InfoTooltip content="Tên Thiết bị" side="bottom">
          <span className={`text-[11px] font-bold tracking-wide flex-1 truncate max-w-[200px] block ${isDisconnected ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
            }`}>{name}</span>
        </InfoTooltip>
        <div className="flex w-full items-center justify-between gap-4">
          <InfoTooltip content="IP Thiết bị" side="bottom">
            <span className="text-[10px] font-mono font-medium text-on-surface-variant/70 min-w-[100px] bg-surface-container-low px-1.5 py-0.5 rounded border border-outline-variant/5">{ip}</span>
          </InfoTooltip>
          <div className="flex items-center gap-2">
            <InfoTooltip content="Tổng Logs nhận được">
              <span className={`text-[10px] font-black font-mono px-2 py-1 rounded min-w-[70px] text-center transition-all ${logCount > 0 ? 'text-secondary bg-secondary/15 ring-1 ring-secondary/20' : 'text-on-surface-variant/40 bg-surface-container border border-outline-variant/10'}`}>
                {logCount} logs
              </span>
            </InfoTooltip>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isLogExpanded ? 'rotate-180' : ''} ${hasLogs ? 'text-on-surface-variant/40' : 'text-on-surface-variant/10'}`} />
          </div>
        </div>
      </div>
      {children}
      {/* Expandable Log Panel */}
      <div className={`grid transition-all duration-300 ease-in-out ${isLogExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className={`min-h-0 ${isLogExpanded ? 'overflow-visible' : 'overflow-hidden'}`}>
          <DeviceLogPanel logs={filteredLogs || []} />
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.logCount === next.logCount &&
  prev.name === next.name &&
  prev.ip === next.ip &&
  prev.connectionStatus === next.connectionStatus &&
  prev.children === next.children &&
  (prev.filteredLogs?.length || 0) === (next.filteredLogs?.length || 0)
);

function SendTargetCard({ conn }: { conn: SystemConnection }) {
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const status = conn.status || 'connecting';

  const handleRemoveConnection = async () => {
    console.log('[DEBUG] remove-connection for:', conn.ip);
    setIsMenuOpen(false);
    try {
      await apiClient.post('/api/v1/remove-connection', {
        ip: conn.ip,
        port: conn.port,
      });
    } catch (e) {
      console.error('[DEBUG] Failed to remove connection', e);
    }
  };

  const handleReconnect = async () => {
    console.log('[DEBUG] reconnect for:', conn.ip);
    // Gọi API -> BE sẽ bắn socket event -> useSocketManager cập nhật sendServers -> conn.status tự thay đổi
    await apiClient.post('/api/v1/reconnect-connection', {
      ip: conn.ip,
      port: conn.port,
    });
  };

  const statusConfig = {
    connecting: {
      dot: 'bg-amber-400 ring-amber-400/20',
      badge: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
      label: 'CONNECTING',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      border: 'border-l-amber-400/60',
    },
    connected: {
      dot: 'bg-primary ring-primary/20',
      badge: 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/20 cursor-pointer',
      label: 'CONNECTED',
      icon: <Wifi className="w-3 h-3" />,
      border: 'border-l-primary/60',
    },
    disconnected: {
      dot: 'bg-tertiary ring-tertiary/20',
      badge: 'text-tertiary bg-tertiary/10 border-tertiary/30 hover:bg-tertiary/20 cursor-pointer',
      label: 'DISCONNECTED',
      icon: <WifiOff className="w-3 h-3" />,
      border: 'border-l-tertiary/60',
    },
  } as const;

  const cfg = statusConfig[status] ?? statusConfig.disconnected;

  return (
    <div className={`send-target-card bg-surface-container border border-outline-variant/10 px-5 py-4 rounded-md flex items-center justify-between border-l-[3px] ${cfg.border} transition-all hover:bg-surface-container-high/40 shadow-sm group`}>
      <div className="flex items-start gap-4">
        <div className={`mt-2 flex-shrink-0 w-2 h-2 rounded-full ring-[3px] ${cfg.dot} ${status === 'connecting' ? 'animate-pulse' : ''}`}></div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-widest flex items-center gap-1.5">
            {t('app.monitor.target_endpoint')}
          </span>
          <div className="flex items-end gap-1">
            <span className="text-[16px] font-black text-on-surface font-mono tracking-tight leading-none">{conn.ip}</span>
            <span className="text-[12px] font-mono font-medium text-on-surface-variant/60 mb-0.5">:{conn.port}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[9px] font-bold text-on-surface-variant/70 uppercase tracking-widest">{t('app.monitor.logs_sent')}</span>
          <span className="text-[12px] font-black font-mono text-on-surface flex items-center justify-end gap-1.5 min-w-[50px] bg-surface-container-low px-2 py-0.5 rounded border border-outline-variant/10">
            <Send className="w-3 h-3 text-on-surface-variant/50" />
            <span>{conn.sentCount || 0}</span>
          </span>
        </div>

        <div className="flex flex-col items-end gap-1.5 border-l border-outline-variant/10 pl-5 relative h-full justify-center">
          <span className="text-[9px] font-bold text-on-surface-variant/70 uppercase tracking-widest">{t('app.monitor.status')}</span>

          {status === 'connected' ? (
            <div className="relative">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={`text-[10px] uppercase font-bold px-2 py-1 rounded font-mono border flex items-center gap-1.5 transition-colors shadow-sm ${cfg.badge}`}
              >
                {cfg.icon}
                {cfg.label}
                <ChevronDown className={`w-3 h-3 transition-transform opacity-60 ${isMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 bg-surface-container-high border border-outline-variant shadow-lg rounded min-w-[160px]  animate-in fade-in zoom-in duration-150">
                  <button
                    onClick={handleRemoveConnection}
                    className="w-full text-left px-3 py-2.5 text-[10px] font-bold text-tertiary hover:bg-tertiary/10 flex items-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('app.monitor.remove_conn')}
                  </button>
                </div>
              )}
            </div>
          ) : status === 'disconnected' ? (
            <InfoTooltip content="Kết nối lại" side="top">
              <button
                onClick={handleReconnect}
                className={`text-[10px] uppercase font-bold px-2 py-1 rounded font-mono border flex items-center gap-1.5 transition-colors shadow-sm ${cfg.badge}`}
              >
                <RefreshCw className="w-3 h-3" />
                {cfg.label}
              </button>
            </InfoTooltip>
          ) : (
            <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded font-mono border flex items-center gap-1.5 shadow-sm ${cfg.badge}`}>
              {cfg.icon}
              {cfg.label}
            </span>
          )}
        </div>
      </div>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsMenuOpen(false)}
        ></div>
      )}
    </div>
  );
}

const ServerInputCard = memo(function ServerInputCard({ srv, matchedDevices, deviceLogStats, serverLogs }: { srv: any, matchedDevices: any, deviceLogStats: Record<string, any>, serverLogs: LogData[] }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const connStatus = srv.connectionStatus || 'connected';
  const isDisconnected = connStatus === 'disconnected';
  const serverType = srv.type; // 'direct' | 'forwarded' | undefined

  // Count connected / disconnected devices
  const deviceCount = matchedDevices?.devices?.length || 0;
  const disconnectedDeviceCount = matchedDevices?.devices?.filter((d: any) => d.connectionStatus === 'disconnected').length || 0;

  const borderColor = isDisconnected ? 'border-l-tertiary/60' : 'border-l-secondary/60';
  const iconBg = isDisconnected ? 'bg-tertiary/10' : 'bg-secondary/10';
  const iconColor = isDisconnected ? 'text-tertiary' : 'text-secondary';

  return (
    <div className={`server-item-card bg-surface-container border border-outline-variant/10 px-4 py-3 pb-4 rounded-md border-l-[3px] ${borderColor} shadow-sm transition-all hover:bg-surface-container-high/40 group`}>
      {/* Server Header */}
      <div
        className="flex items-center justify-between border-b border-outline-variant/5 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 ${iconBg} rounded-lg shrink-0 relative`}>
            <Cpu className={`w-4 h-4 ${iconColor}`} />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <InfoTooltip content="Tên Server">
                  <span className={`text-[14px] font-black tracking-wide leading-none group-hover:text-primary transition-colors ${isDisconnected ? 'text-on-surface/60' : 'text-on-surface'
                    }`}>{srv.server_name || srv.id}</span>
                </InfoTooltip>
                <div className='flex gap-1'>
                  <InfoTooltip content="Mã định danh Server (Server ID)">
                    <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">{srv.id || srv.serial}</span>
                  </InfoTooltip>
                  <span className="w-1 h-1 rounded-full bg-outline-variant/30"></span>
                  <InfoTooltip content="Địa chỉ IP gốc của Server">
                    <span className="text-[10px] font-mono font-medium text-on-surface-variant">IP: {srv.svms_ipv4_ip || srv.server_ip || srv.sender_ip}</span>
                  </InfoTooltip>
                </div>
              </div>
              {/* Connection Status Badge */}
              <InfoTooltip content={isDisconnected ? 'Server mất kết nối' : 'Server đang hoạt động'}>
                <span className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${isDisconnected
                  ? 'text-tertiary bg-tertiary/10 border-tertiary/20'
                  : 'text-secondary bg-secondary/10 border-secondary/20'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isDisconnected
                    ? 'bg-tertiary animate-pulse'
                    : 'bg-secondary'
                    }`}></span>
                  {isDisconnected ? t('app.monitor.offline') : t('app.monitor.online')}
                </span>
              </InfoTooltip>
              {/* Server Type Badge */}
              {serverType && (
                <InfoTooltip content={serverType === 'direct' ? 'Kết nối trực tiếp' : 'Kết nối qua trung gian'}>
                  <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${serverType === 'direct'
                    ? 'text-primary bg-primary/10 border-primary/20'
                    : 'text-on-surface-variant bg-surface-container-high border-outline-variant/20'
                    }`}>
                    {serverType === 'direct' ? <ArrowDownLeft className="w-2.5 h-2.5" /> : <ArrowUpRight className="w-2.5 h-2.5" />}
                    {serverType === 'direct' ? 'SVMS' : 'CMS FORWARDED'}
                  </span>
                </InfoTooltip>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.total_logs')}</span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-black font-mono text-secondary leading-none">{serverLogs.length}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.devices')}</span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-black font-mono text-on-surface leading-none">{deviceCount}</span>
              {disconnectedDeviceCount > 0 && (
                <InfoTooltip content={t('app.monitor.disconnected_devices_tooltip', { count: disconnectedDeviceCount })}>
                  <span className="text-[9px] font-black font-mono text-tertiary bg-tertiary/10 px-1 rounded">
                    {disconnectedDeviceCount} offline
                  </span>
                </InfoTooltip>
              )}
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Devices list with per-device log counts */}
      <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
        <div className={`min-h-0 ${isExpanded ? 'overflow-visible' : 'overflow-hidden'}`}>
          {matchedDevices && matchedDevices.devices.length > 0 ? (
            <div className="grid gap-2 border-l-2 border-outline-variant/10 pl-2 ml-1">
              {matchedDevices.devices.map((device: any, dIdx: number) => {
                const sId = srv.id || '';
                const sSerial = srv.serial || '';
                const dName = device.name || '';
                const dIp = device.ip || '';
                const key = `${sId}_${sSerial}_${dName}_${dIp}`;

                const dStats = deviceLogStats[key];
                const logCount = dStats?.logCount || 0;

                // Filter pre-grouped server logs for this specific device
                const deviceLogs = serverLogs.filter(l => {
                  const lsId = l.server?.server_id || '';
                  const lsSerial = l.server?.serial || '';
                  const ldName = l.device_name || '';
                  const ldIp = l.device_ip || '';
                  return `${lsId}_${lsSerial}_${ldName}_${ldIp}` === key;
                });

                return (
                  <DeviceItemRow
                    key={dIdx}
                    name={device.name}
                    ip={device.ip}
                    type={device.type}
                    logCount={logCount}
                    connectionStatus={device.connectionStatus}
                    filteredLogs={deviceLogs}
                  />
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-3 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest flex items-center justify-center gap-2 bg-surface-container-lowest/30 rounded-sm border border-dashed border-outline-variant/10">
              <Activity className="w-3 h-3 opacity-50" />
              {t('app.monitor.no_devices_mapped')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.serverLogs.length === next.serverLogs.length &&
  prev.srv === next.srv &&
  prev.matchedDevices === next.matchedDevices
);

function MqttServerCard({ server, devices, allCameras, deviceCameraLinks, onLinkDeviceCamera, onLinkMqttServerCamera, logs }: {
  server: MqttServerConfig;
  devices: { devEui: string; applicationId: string; deviceName: string; deviceProfileName: string; alarmCount: number; lastSeen: string }[];
  allCameras: MqttDeviceConfig[];
  deviceCameraLinks: DeviceCameraLink[];
  onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void;
  onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void;
  logs: LogData[];
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isControllingBuzzer, setIsControllingBuzzer] = useState<string | null>(null);

  const handleControlBuzzer = async (devEui: string, applicationId: string, enable: boolean) => {
    if (!applicationId) {
      alert("Thiếu Application ID để gửi lệnh. Vui lòng đợi thiết bị gửi dữ liệu để cập nhật ID.");
      return;
    }
    const actionKey = `${devEui}-${enable}`;
    setIsControllingBuzzer(actionKey);
    try {
      await apiClient.post(`/api/v1/mqtt-servers/${server.id}/buzzer`, {
        applicationId,
        devEui,
        enable
      });
      console.log(`[Buzzer] ${enable ? 'ON' : 'OFF'} sent for ${devEui}`);
    } catch (err: any) {
      console.error('Failed to control buzzer:', err);
      alert(`Lỗi điều khiển còi: ${err?.response?.data?.message || err.message}`);
    } finally {
      setIsControllingBuzzer(null);
    }
  };

  const status = server.status || 'disconnected';
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  const statusConfig = {
    connected: { dot: 'bg-secondary ring-secondary/20', badge: 'text-secondary bg-secondary/10 border-secondary/20', label: 'ONLINE', border: 'border-l-secondary/60' },
    connecting: { dot: 'bg-amber-400 ring-amber-400/20', badge: 'text-amber-400 bg-amber-400/10 border-amber-400/20', label: 'CONNECTING', border: 'border-l-amber-400/60' },
    disconnected: { dot: 'bg-tertiary ring-tertiary/20', badge: 'text-tertiary bg-tertiary/10 border-tertiary/20', label: 'OFFLINE', border: 'border-l-tertiary/60' },
    error: { dot: 'bg-red-500 ring-red-500/20', badge: 'text-red-500 bg-red-500/10 border-red-500/20', label: 'ERROR', border: 'border-l-red-500/60' },
  } as const;

  const cfg = statusConfig[status] || statusConfig.disconnected;
  const serverLogsCount = useMemo(() => logs.filter(l => l.mqttServerId === server.id).length, [logs, server.id]);

  return (
    <div className={`mqtt-server-card bg-surface-container border border-outline-variant/10 px-4 py-3 pb-4 rounded-md border-l-[3px] ${cfg.border} shadow-sm transition-all hover:bg-surface-container-high/40 group`}>
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-outline-variant/5 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 ${isConnected ? 'bg-secondary/10' : 'bg-tertiary/10'} rounded-lg shrink-0`}>
            <Radio className={`w-4 h-4 ${isConnected ? 'text-secondary' : 'text-tertiary'}`} />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <InfoTooltip content="MQTT Broker">
                  <span className={`text-[14px] font-black tracking-wide leading-none group-hover:text-primary transition-colors ${status === 'disconnected' ? 'text-on-surface/60' : 'text-on-surface'}`}>
                    {server.name || `${server.brokerHost}:${server.brokerPort}`}
                  </span>
                </InfoTooltip>
                <div className='flex gap-1 items-center'>
                  {server.name && (
                    <>
                      <InfoTooltip content="MQTT Broker Address">
                        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">{server.protocol}://{server.brokerHost}:{server.brokerPort}</span>
                      </InfoTooltip>
                      <span className="w-1 h-1 rounded-full bg-outline-variant/30"></span>
                    </>
                  )}
                  <InfoTooltip content="Topic đang subscribe">
                    <span className="text-[10px] font-mono font-medium text-on-surface-variant truncate max-w-[300px] block">{server.topic || server.defaultTopic || '(no topic)'}</span>
                  </InfoTooltip>
                </div>
              </div>
              {/* Status Badge */}
              <InfoTooltip content={`Trạng thái: ${cfg.label}`}>
                <span className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${cfg.badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${isConnecting ? 'animate-pulse' : ''}`}></span>
                  {cfg.label}
                </span>
              </InfoTooltip>
              {/* Type Badge */}
              <InfoTooltip content="Kết nối MQTT">
                <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border text-cyan-500 bg-cyan-500/10 border-cyan-500/20">
                  <Radio className="w-2.5 h-2.5" />
                  MQTT
                </span>
              </InfoTooltip>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.total_logs')}</span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-black font-mono text-secondary leading-none">{serverLogsCount}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.devices')}</span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-black font-mono text-on-surface leading-none">{devices.length}</span>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Expandable body */}
      <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
        <div className={`min-h-0 ${isExpanded ? 'overflow-visible' : 'overflow-hidden'}`}>



          {devices.length > 0 && (
            <div className="mb-3">
              <div className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <Radio className="w-3 h-3" /> {t('app.monitor.mqtt_sensors')}
              </div>
              <div className="grid gap-1.5 border-l-2 border-outline-variant/10 pl-2 ml-1">
                {devices.map((device) => {
                  const link = deviceCameraLinks.find(l => l.devEui === device.devEui && l.mqttServerId === server.id);
                  const deviceLogs = (logs || []).filter(l => {
                    const matchRadar = l.mqttServerId === server.id && l.server?.serial === device.devEui;
                    const matchCamera = link?.cameraId && l.source === 'sunell-camera' && l.cameraIp === link.cameraId;
                    return !!(matchRadar || matchCamera);
                  });
                  return (
                    <DeviceItemRow
                      key={device.devEui}
                      name={device.deviceName}
                      ip={device.devEui}
                      type={device.deviceProfileName}
                      logCount={deviceLogs.length}
                      connectionStatus="connected"
                      filteredLogs={deviceLogs}
                    >
                      {/* Device-level camera linking */}
                      <div className="flex items-center gap-2 pl-1 bg-surface-container-low/50 border border-outline-variant/10 rounded px-2.5 py-1.5 mt-0.5">
                        <span className="text-[8px] font-bold text-on-surface-variant/60 uppercase tracking-widest shrink-0">📷 Camera</span>
                        <select
                          value={link?.cameraId || ''}
                          onChange={(e) => onLinkDeviceCamera(device.devEui, server.id, e.target.value || null)}
                          disabled={true}
                          className="flex-1 text-[10px] font-mono bg-surface-container border border-outline-variant/20 rounded px-1.5 py-1 text-on-surface-variant/60 cursor-not-allowed select-none"
                        >
                          <option value="">
                            {(() => {
                              const parentCam = server.cameraId ? allCameras.find(c => c.id === server.cameraId) : null;
                              if (!parentCam) {
                                return t('app.monitor.camera_default_unlinked');
                              }
                              const camName = parentCam.name || `${parentCam.type ? parentCam.type.toUpperCase() : 'CAMERA'} - ${parentCam.cameraIp}:${parentCam.cameraPort}`;
                              return t('app.monitor.camera_default_linked', { name: camName });
                            })()}
                          </option>
                          <option value="none">{t('app.monitor.no_camera_no_snapshot')}</option>
                          {allCameras.map(cam => (
                            <option key={cam.id} value={cam.id}>{cam.name || `${cam.type.toUpperCase()} - ${cam.cameraIp}:${cam.cameraPort}`}</option>
                          ))}
                        </select>
                      </div>
                    </DeviceItemRow>
                  );
                })}
              </div>
            </div>
          )}

          {devices.length === 0 && (
            <div className="px-3 py-3 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest flex items-center justify-center gap-2 bg-surface-container-lowest/30 rounded-sm border border-dashed border-outline-variant/10">
              <Activity className="w-3 h-3 opacity-50" />
              {t('app.monitor.waiting_events')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CameraDevicesList({ cameras }: { cameras: MqttDeviceConfig[] }) {
  const [isAddingDevice, setIsAddingDevice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addDeviceForm, setAddDeviceForm] = useState({
    type: 'sunell' as 'sunell' | 'other',
    cameraIp: '192.168.1.207',
    cameraPort: '30001',
    cameraUser: 'admin',
    cameraPass: 'admin1234',
    rtspUrl: 'rtsp://admin:admin1234@192.168.1.207:555/snl/live/1/1',
  });

  const handleSubmitDevice = async () => {
    setIsSubmitting(true);
    try {
      const res = await apiClient.post('/api/v1/cameras', {
        type: addDeviceForm.type,
        cameraIp: addDeviceForm.cameraIp,
        cameraPort: parseInt(addDeviceForm.cameraPort) || 30001,
        cameraUser: addDeviceForm.cameraUser,
        cameraPass: addDeviceForm.cameraPass,
        rtspUrl: addDeviceForm.rtspUrl,
      });
      console.log('[Camera-Device] Added:', res.data);
      setIsAddingDevice(false);
    } catch (err: any) {
      console.error('[Camera-Device] Add failed:', err);
      alert(`Lỗi thêm thiết bị: ${err?.response?.data?.error || err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    try {
      await apiClient.delete(`/api/v1/cameras/${deviceId}`);
      console.log('[Camera-Device] Deleted:', deviceId);
    } catch (err: any) {
      console.error('[Camera-Device] Delete failed:', err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {cameras.map((cam) => (
        <div key={cam.id} className="flex flex-col gap-1.5 px-3 py-2 bg-surface-container-lowest/40 rounded border border-outline-variant/5 hover:border-outline-variant/20 transition-colors">
          <div className="flex items-center gap-3">
            <InfoTooltip content={cam.status === 'connected' ? 'Connected' : cam.status} side="bottom">
              <div className={`w-2 h-2 rounded-full shrink-0 ring-2 ${cam.status === 'connected' ? 'bg-secondary ring-secondary/20' : cam.status === 'error' ? 'bg-red-500 ring-red-500/20' : 'bg-amber-400 ring-amber-400/20 animate-pulse'}`}></div>
            </InfoTooltip>
            <span className="text-[9.5px] font-mono font-medium min-w-[50px] text-center px-1.5 py-0.5 rounded shadow-sm text-cyan-500 bg-cyan-500/10 border border-cyan-500/20 uppercase">
              {cam.type}
            </span>
            <div className="flex-1 flex flex-col min-w-0">
              <span className="text-[11px] font-bold tracking-wide text-on-surface-variant truncate">{cam.name || cam.id}</span>
              <span className="text-[10px] font-mono text-on-surface-variant/70 truncate">{cam.cameraIp}:{cam.cameraPort}</span>
            </div>
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${cam.status === 'connected' ? 'text-secondary bg-secondary/10 border-secondary/20' : cam.status === 'error' ? 'text-red-500 bg-red-500/10 border-red-500/20' : 'text-amber-400 bg-amber-400/10 border-amber-400/20'}`}>{cam.status}</span>
            <button
              onClick={() => handleDeleteDevice(cam.id)}
              className="p-1 text-on-surface-variant/40 hover:text-tertiary transition-colors"
              title="Xóa thiết bị"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {/* Editable RTSP URL */}
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-[8px] font-bold text-on-surface-variant/60 uppercase tracking-widest shrink-0">RTSP</span>
            <input
              defaultValue={cam.rtspUrl || ''}
              className="text-[10px] font-mono bg-surface-container/60 border border-outline-variant/15 rounded px-1.5 py-0.5 text-on-surface-variant flex-1 focus:border-cyan-500/40 focus:outline-none transition-colors"
              placeholder="rtsp://..."
              onBlur={async (e) => {
                const newUrl = e.target.value;
                if (newUrl !== (cam.rtspUrl || '')) {
                  try {
                    await apiClient.patch(`/api/v1/cameras/${cam.id}`, { rtspUrl: newUrl });
                  } catch (err) { console.error('RTSP update failed:', err); }
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
          </div>
        </div>
      ))}

      {/* Add Device Form */}
      {isAddingDevice && (
        <div className="mt-2 p-3 bg-surface-container-lowest/60 border border-cyan-500/20 rounded-md">
          <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest mb-3">Thêm Camera Device</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Type</label>
              <select
                value={addDeviceForm.type}
                onChange={e => setAddDeviceForm(f => ({ ...f, type: e.target.value as 'sunell' | 'other' }))}
                className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface"
              >
                <option value="sunell">Sunell (SDK + RTSP)</option>
                <option value="other">Other (RTSP Only)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Camera IP</label>
              <input
                value={addDeviceForm.cameraIp}
                onChange={e => setAddDeviceForm(f => ({ ...f, cameraIp: e.target.value }))}
                className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface"
                placeholder="192.168.1.xxx"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Camera Port</label>
              <input
                value={addDeviceForm.cameraPort}
                onChange={e => setAddDeviceForm(f => ({ ...f, cameraPort: e.target.value }))}
                className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface"
                placeholder={addDeviceForm.type === 'sunell' ? "30001" : "554"}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Username</label>
              <input
                value={addDeviceForm.cameraUser}
                onChange={e => setAddDeviceForm(f => ({ ...f, cameraUser: e.target.value }))}
                className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface"
                placeholder="admin"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Password</label>
              <input
                value={addDeviceForm.cameraPass}
                onChange={e => setAddDeviceForm(f => ({ ...f, cameraPass: e.target.value }))}
                className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface"
                placeholder="admin1234"
                type="password"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">RTSP URL</label>
              <input
                value={addDeviceForm.rtspUrl}
                onChange={e => setAddDeviceForm(f => ({ ...f, rtspUrl: e.target.value }))}
                className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface w-full"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleSubmitDevice}
              disabled={isSubmitting || !addDeviceForm.cameraIp}
              className="px-4 py-1.5 bg-cyan-500 text-white text-[10px] font-bold uppercase tracking-widest rounded shadow-sm hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              {isSubmitting ? 'Đang lưu...' : 'Lưu Camera'}
            </button>
            <button
              onClick={() => setIsAddingDevice(false)}
              className="px-4 py-1.5 text-on-surface-variant text-[10px] font-bold uppercase tracking-widest rounded border border-outline-variant/20 hover:bg-surface-container transition-colors"
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {/* Add Device Button */}
      {!isAddingDevice && (
        <button
          onClick={(e) => { e.stopPropagation(); setIsAddingDevice(true); }}
          className="mt-2 w-full py-2.5 border border-dashed border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10 bg-cyan-500/5 rounded-md flex justify-center items-center gap-2 text-[9px] uppercase font-bold tracking-widest transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Thêm Camera Mới
        </button>
      )}
    </div>
  );
}
