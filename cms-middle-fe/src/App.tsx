import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { useTranslation } from 'react-i18next';
import { ConnectionsMonitor } from './components/ConnectionsMonitor';
import { LogPopup } from './components/LogPopup';
import { useSocketManager } from './hooks/useSocketManager';
import { SlidersHorizontal, Terminal, Check, Cpu, MonitorSmartphone, Settings, Monitor, Network, PanelRightOpen, PanelRightClose, Languages, LogOut } from 'lucide-react';
import { ConfigSystem } from './components/ConfigSystem';
import apiClient from './api/apiClient';
import { LogEntry } from './components/LogEntry';

import type { LogData, ServerData, DeviceData } from './types';
import LoginPage from './components/LoginPage';
import { authApi } from './api/authApi';
import { AlertWall } from './components/AlertWall';

import { DevicesManager } from './components/DevicesManager';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  if (!authApi.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// ── LogFilter Dropdown Component ─────────────────────────────────────────────
function LogFilter({
  servers,
  devices,
  mqttServers,
  mqttDevicesByServer,
  cameraDevices,
  eventTypes,
  selectedServers,
  selectedDevices,
  selectedEventType,
  onToggleServer,
  onToggleDevice,
  onSelectEventType,
}: {
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  mqttServers?: any[];
  mqttDevicesByServer?: Record<string, any[]>;
  cameraDevices?: any[];
  eventTypes: string[];
  selectedServers: Set<string>;
  selectedDevices: Set<string>;
  selectedEventType: string | null;
  onToggleServer: (id: string) => void;
  onToggleDevice: (ip: string) => void;
  onSelectEventType: (type: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Đóng khi click ra ngoài
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const serverList = useMemo(() => {
    const svms = Object.values(servers)
      .filter(srv => srv.type !== 'mqtt' && !srv.id?.toString().startsWith('mqtt-'))
      .map(srv => ({
        id: srv.id || srv.serial,
        name: srv.server_name || srv.id || srv.serial,
        ip: srv.svms_ipv4_ip || srv.server_ip,
        type: 'SVMS',
      }));
    const mqtt = (mqttServers || []).map(m => ({
      id: m.id,
      name: m.brokerHost || m.id,
      ip: `${m.brokerHost}:${m.brokerPort}`,
      type: 'MQTT',
    }));
    return [...svms, ...mqtt];
  }, [servers, mqttServers]);

  const deviceList = useMemo(() => {
    const seen = new Set<string>();
    const svmsDevs = Object.values(devices).flatMap(serverData =>
      (serverData.devices || []).map(d => ({
        ...d,
        ip: d.ip || d.device_ip || 'unknown-ip',
        serverId: serverData.server.server_id,
        originalName: undefined
      }))
    ).filter(d => {
      const uniqueKey = `${d.serverId}_${d.ip}_${d.name}`;
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });

    const indepCams = (cameraDevices || []).map(cam => {
      const d = {
        name: cam.name || cam.cameraIp,
        ip: cam.id,
        type: cam.type || 'sunell',
        index: 0,
        serverId: 'SUNELL-LOCAL',
        originalName: undefined
      };
      return d;
    }).filter(d => {
      const uniqueKey = `${d.serverId}_${d.ip}_${d.name}`;
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });

    const mqttDevs = Object.entries(mqttDevicesByServer || {}).flatMap(([serverId, devs]) => {
      const mqttSrv = (mqttServers || []).find(s => s.id === serverId);
      const brokerHost = mqttSrv?.brokerHost || '';
      return devs.map(d => ({
        name: d.deviceName || d.deviceProfileName || d.devEui,
        ip: brokerHost,
        type: 'radar',
        index: 0,
        serverId: `mqtt-${serverId}`,
        originalName: d.deviceName || 'MQTT Device'
      }));
    }).filter(d => {
      const uniqueKey = `${d.serverId}_${d.ip}_${d.originalName}`;
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });

    return [...svmsDevs, ...indepCams, ...mqttDevs];
  }, [devices, cameraDevices, mqttDevicesByServer, mqttServers]);

  const activeCount = selectedServers.size + selectedDevices.size + (selectedEventType ? 1 : 0);

  return (
    <div ref={ref} className="app-log-filter flex items-center p-1 cursor-pointer transition-all duration-200 group">
      {/* <button className='absolute bottom-3 right-3' onClick={() => console.log(deviceList)}>TEST HERE CLICK ME</button> */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`app-log-filter-btn flex items-center gap-1.5 px-2 py-1 rounded-md transition-all duration-200 group border ${activeCount > 0
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-transparent hover:border-outline-variant/30 text-on-surface-variant hover:text-primary'
          }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
        {activeCount > 0 && (
          <span className="text-[9px] font-black font-mono bg-primary text-white rounded-full w-4 h-4 flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-3 top-[95%] z-50 bg-surface-container-high border border-outline-variant/90 shadow-2xl rounded-lg w-[90%] max-w-64 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Servers */}
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-center gap-1.5 mb-2">
              <Cpu className="w-3 h-3 text-secondary" />
              <span className="text-[9px] font-black uppercase tracking-widest text-secondary">{t('app.filter.servers')}</span>
            </div>
            {serverList.length === 0 ? (
              <p className="text-[10px] text-on-surface-variant/40 py-1 pl-1">{t('app.filter.no_servers')}</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {serverList.map(srv => {
                  const id = srv.id;
                  const checked = selectedServers.has(id);
                  return (
                    <button
                      key={id}
                      onClick={() => onToggleServer(id)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-container transition-colors w-full text-left"
                    >
                      <div className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-secondary border-secondary' : 'border-outline-variant'
                        }`}>
                        {checked && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                      </div>
                      <span className="text-[11px] font-semibold text-on-surface shrink-0">{srv.name}</span>
                      <span className="text-[9px] font-mono text-on-surface-variant/50 ml-auto truncate">{srv.type} - {srv.ip}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mx-3 my-1 border-t border-outline-variant/10" />

          {/* Devices */}
          <div className="px-3 pb-3 pt-1">
            <div className="flex items-center gap-1.5 mb-2">
              <MonitorSmartphone className="w-3 h-3 text-tertiary" />
              <span className="text-[9px] font-black uppercase tracking-widest text-tertiary">{t('app.filter.devices')}</span>
            </div>
            {deviceList.length === 0 ? (
              <p className="text-[10px] text-on-surface-variant/40 py-1 pl-1">{t('app.filter.no_devices')}</p>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto custom-scrollbar">
                {deviceList.map(dev => {
                  const uniqueKey = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
                  const checked = selectedDevices.has(uniqueKey);
                  return (
                    <button
                      key={uniqueKey}
                      onClick={() => onToggleDevice(uniqueKey)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-container transition-colors w-full text-left"
                    >
                      <div className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-tertiary border-tertiary' : 'border-outline-variant'
                        }`}>
                        {checked && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                      </div>
                      <span className="text-[11px] font-semibold text-on-surface truncate">{dev.name}</span>
                      <span className="text-[9px] font-mono text-on-surface-variant/50 ml-auto shrink-0">{dev.type.charAt(0).toUpperCase() + dev.type.slice(1)} - {dev.serverId}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mx-3 my-1 border-t border-outline-variant/10" />

          {/* Event Types */}
          <div className="px-3 pb-3 pt-1">
            <div className="flex items-center gap-1.5 mb-2">
              <Terminal className="w-3 h-3 text-warning" />
              <span className="text-[9px] font-black uppercase tracking-widest text-warning">{t('app.filter.event_types')}</span>
            </div>
            {eventTypes.length === 0 ? (
              <p className="text-[10px] text-on-surface-variant/40 py-1 pl-1">{t('app.filter.no_event_types')}</p>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto custom-scrollbar">
                <button
                  onClick={() => onSelectEventType(null)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-container transition-colors w-full text-left"
                >
                  <div className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center shrink-0 transition-colors ${!selectedEventType ? 'bg-warning border-warning' : 'border-outline-variant'
                    }`}>
                    {!selectedEventType && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                  </div>
                  <span className="text-[11px] font-semibold text-on-surface truncate">{t('app.filter.all')}</span>
                </button>
                {eventTypes.map(type => {
                  const checked = selectedEventType === type;
                  return (
                    <button
                      key={type}
                      onClick={() => onSelectEventType(type)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-container transition-colors w-full text-left"
                    >
                      <div className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-warning border-warning' : 'border-outline-variant'
                        }`}>
                        {checked && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                      </div>
                      <span className="text-[11px] font-semibold text-on-surface truncate">{t(`app.logtype.${type.toLowerCase().replace(/\./g, '')}`, { defaultValue: type })}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}




function Dashboard() {
  const { t, i18n } = useTranslation();
  const {
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
    socket,
    eventTypes,
    selectedEventType,
    setSelectedEventType,
    totalLogCount,
    KEEP_TOTAL_LOG_COUNT,
    handleAddMqttServer,
    mqttServers,
    mqttLogs,
    cameraDevices,
    fetchCameras,
    deviceCameraLinks,
    handleLinkDeviceCamera,
    gridLayout,
    saveGridLayout
  } = useSocketManager();

  // Grid state synced from BE
  const grids = gridLayout.grids;
  const gridCols = gridLayout.gridCols;
  const setGrids = useCallback((updater: any) => {
    const newGrids = typeof updater === 'function' ? updater(gridLayout.grids) : updater;
    saveGridLayout(newGrids, gridLayout.gridCols);
  }, [gridLayout, saveGridLayout]);
  const setGridCols = useCallback((updater: any) => {
    const newCols = typeof updater === 'function' ? updater(gridLayout.gridCols) : updater;
    saveGridLayout(gridLayout.grids, newCols);
  }, [gridLayout, saveGridLayout]);

  const displayLogCount = KEEP_TOTAL_LOG_COUNT ? totalLogCount : logs.length;

  const [selectedLog, setSelectedLog] = useState<LogData | null>(null);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [rightTab, setRightTab] = useState<'logs' | 'devices'>('logs');
  const [mainTab, setMainTab] = useState<'alert' | 'connections' | 'devices'>('alert');
  const [visibleAlerts, setVisibleAlerts] = useState<number>(30);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isNarrow = windowWidth < 800;
  const [isConfigSystemOpen, setIsConfigSystemOpen] = useState(false);
  const [isLogSaving, setIsLogSaving] = useState(() => {
    const saved = localStorage.getItem('SAVE_LOG_FILES');
    return saved !== 'false';
  });
  const [langOpen, setLangOpen] = useState(false);

  const toggleLogSaving = async () => {
    const newState = !isLogSaving;
    setIsLogSaving(newState);
    localStorage.setItem('SAVE_LOG_FILES', String(newState));
    try {
      await apiClient.post('/api/v1/config/log-saving', { enabled: newState });
    } catch (e) {
      console.error('Failed to toggle log saving', e);
    }
  };
  // Extract MQTT devices per server from logs (for sidebar)
  const mqttDevicesByServer = useMemo(() => {
    const map: Record<string, { devEui: string; deviceName: string; deviceProfileName: string; alarmCount: number; lastSeen: string }[]> = {};
    (mqttLogs || []).forEach(log => {
      const sid = log.mqttServerId;
      const di = (log as any).payload?.deviceInfo;
      if (!sid || !di?.devEui) return;
      if (!map[sid]) map[sid] = [];
      const existing = map[sid].find(d => d.devEui === di.devEui);
      const evtCount = (log as any).payload?.object?.events?.length || 0;
      if (existing) {
        existing.alarmCount += evtCount;
        existing.lastSeen = log.time;
      } else {
        map[sid].push({
          devEui: di.devEui,
          deviceName: di.deviceName || 'Unknown',
          deviceProfileName: di.deviceProfileName || 'Unknown',
          alarmCount: evtCount,
          lastSeen: log.time,
        });
      }
    });
    return map;
  }, [mqttLogs]);

  const toggleServer = useCallback((id: string) => {
    const isSelecting = !selectedServers.has(id);
    
    setSelectedServers(prev => {
      const s = new Set(prev);
      if (isSelecting) s.add(id); else s.delete(id);
      return s;
    });

    setSelectedDevices(prevDevs => {
      const d = new Set(prevDevs);
      
      if (devices[id]) {
        devices[id].devices?.forEach(dev => {
          const devKey = `${devices[id].server.server_id}_${dev.ip}_${dev.name}`;
          if (isSelecting) d.add(devKey);
          else d.delete(devKey);
        });
      }
      
      if (mqttDevicesByServer[id]) {
        const mqttSrv = mqttServers?.find(m => m.id === id);
        const brokerHost = mqttSrv?.brokerHost || '';
        mqttDevicesByServer[id].forEach(dev => {
          const devName = dev.deviceName || 'MQTT Device';
          const devKey = `mqtt-${id}_${brokerHost}_${devName}`;
          if (isSelecting) d.add(devKey);
          else d.delete(devKey);
        });
      }
      
      return d;
    });
  }, [selectedServers, devices, mqttDevicesByServer, mqttServers]);

  const toggleDevice = (ip: string) =>
    setSelectedDevices(prev => {
      const s = new Set(prev);
      if (s.has(ip)) {
        s.delete(ip);
      } else {
        s.add(ip);
      }
      return s;
    });

  // Lọc logs theo server, device và event_type đang được chọn
  const filteredLogs = useMemo(() => {
    if (selectedServers.size === 0 && selectedDevices.size === 0 && !selectedEventType) return logs;
    return logs.filter(log => {
      const logServerId = log.mqttServerId || log.server?.server_id || log.server?.serial || '';
      const serverMatch = selectedServers.size > 0 && selectedServers.has(logServerId);
      const devKey = `${log.server?.server_id}_${log.device_ip}_${log.device_name}`;
      const deviceMatch = selectedDevices.size > 0 && selectedDevices.has(devKey);

      const matchOrigin = (selectedServers.size === 0 && selectedDevices.size === 0)
        ? true
        : (serverMatch || deviceMatch);

      const matchEventType = !selectedEventType || log.log_type === selectedEventType;

      return matchOrigin && matchEventType;
    });
  }, [logs, selectedServers, selectedDevices, selectedEventType]);


  // ESC key logout removed as requested
  // Track window width for responsive layout
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="app-dashboard-root flex flex-col h-screen overflow-hidden bg-background text-on-surface font-sans selection:bg-primary/30 antialiased">
      <main className={`app-dashboard-main flex-1 overflow-hidden ${isNarrow ? 'flex flex-col' : mainTab === 'alert' ? 'grid grid-cols-4 gap-0' : 'flex'}`}>
        {/* Main Section */}
        <div className={`app-dashboard-left-section overflow-hidden bg-background border-outline-variant/20 ${isNarrow ? 'flex-1 border-b' : mainTab === 'alert' ? 'col-span-3 grid grid-rows-[1fr] h-full border-r' : 'flex-1 h-full'}`}>
          <div className="flex flex-col overflow-hidden h-full">
            <div className={`flex items-center border-b border-outline-variant/10 shrink-0 ${isNarrow ? '' : 'px-6 gap-4'}`}>
              <button
                className={`flex items-center gap-2 px-3 py-4 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'alert' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                onClick={() => setMainTab('alert')}
              >
                <Monitor className={`w-5 h-5 ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`} />
                <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.alert_wall')}</h2>
              </button>
              <button
                className={`flex items-center gap-2 px-3 py-4 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'devices' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                onClick={() => setMainTab('devices')}
              >
                <Cpu className={`w-5 h-5 ${mainTab === 'devices' ? 'text-primary' : 'text-on-surface'}`} />
                <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'devices' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.devices')}</h2>
              </button>
              <button
                className={`flex items-center gap-2 px-3 py-4 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'connections' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                onClick={() => setMainTab('connections')}
              >
                <Network className={`w-5 h-5 ${mainTab === 'connections' ? 'text-primary' : 'text-on-surface'}`} />
                <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'connections' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.connections_monitor')}</h2>
              </button>
            </div>
            {/* <button onClick={() => console.log(servers)}>CLick</button> */}
            {mainTab === 'alert' && (
              <AlertWall
                logs={logs}
                cameras={Object.values(devices).flatMap(server => server || [])}
                deviceCameraLinks={deviceCameraLinks}
                onSelectLog={setSelectedLog}
                gridCols={gridCols}
                setGridCols={setGridCols}
                grids={grids}
                setGrids={setGrids}
              />
            )}
            {mainTab === 'connections' && (
              <ConnectionsMonitor
                socket={socket}
                isConnected={isConnected}
                systemConfig={systemConfig}
                onSaveSystemConfig={(config) => { setSystemConfig(config) }}
                sendServers={sendServers}
                receiveServers={receiveServers}
                logs={logs}
                servers={servers}
                devices={devices}
                onSave={handleAddExternalServer}
                onSaveMqtt={handleAddMqttServer}
                onRemoveConnection={handleRemoveConnection}
                mqttServers={mqttServers}
                mqttLogs={mqttLogs}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                onLinkDeviceCamera={handleLinkDeviceCamera}
              />
            )}
            {mainTab === 'devices' && (
              <DevicesManager
                servers={servers}
                devices={devices}
                mqttServers={mqttServers}
                mqttLogs={mqttLogs}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                onLinkDeviceCamera={handleLinkDeviceCamera}
                fetchCameras={fetchCameras}
                handleAddMqttServer={handleAddMqttServer}
                handleAddExternalServer={handleAddExternalServer}
              />
            )}
          </div>
        </div>

        {/* Right Section — only visible on Alert Wall tab */}
        {mainTab === 'alert' && isNarrow && (
          <button
            onClick={() => setRightPanelVisible(v => !v)}
            className="app-right-panel-toggle fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-white shadow-lg text-[11px] font-bold tracking-wide transition-all hover:bg-primary/90 active:scale-95"
          >
            {rightPanelVisible
              ? <><PanelRightClose className="w-4 h-4" /></>
              : <><PanelRightOpen className="w-4 h-4" /></>}
          </button>
        )}
        {mainTab === 'alert' && (
          <aside
            className={`alert-wall-right-section bg-surface-container-lowest flex flex-col overflow-hidden shadow-2xl z-10 transition-transform duration-300 ${isNarrow
              ? `fixed bottom-0 left-0 right-0 h-1/4 border-t border-outline-variant/20 ${rightPanelVisible ? 'translate-y-0' : 'translate-y-full'}`
              : 'col-span-1 relative w-full'
              }`}
          >
            <div className="flex items-center border-b border-outline-variant/10 shrink-0">
              <button
                onClick={() => setRightTab('logs')}
                className={`h-full flex-3 py-3 text-[10px] tracking-widest font-bold uppercase transition-colors flex items-center justify-center gap-2 ${rightTab === 'logs' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-on-surface-variant hover:bg-surface-container-low/50 border-b-2 border-transparent'}`}
              >
                <Terminal className="w-3.5 h-3.5" />{t('app.alert_wall.logs')} ({displayLogCount})
              </button>
              <button
                onClick={() => setRightTab('devices')}
                className={`h-full flex-1 py-3 text-[10px] tracking-widest font-bold uppercase transition-colors flex items-center justify-center gap-2 ${rightTab === 'devices' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-on-surface-variant hover:bg-surface-container-low/50 border-b-2 border-transparent'}`}
              >
                <MonitorSmartphone className="w-3.5 h-3.5" />
              </button>
            </div>

            {rightTab === 'logs' ? (
              <>
                <div className="relative p-3 flex items-center justify-between border-b border-outline-variant/10 shrink-0 bg-surface-container-lowest">
                  <span className="text-[10px] font-bold tracking-widest text-on-surface-variant uppercase">{t('app.filter.filter_logs')}</span>
                  <LogFilter
                    servers={servers}
                    devices={devices}
                    mqttServers={mqttServers}
                    mqttDevicesByServer={mqttDevicesByServer}
                    cameraDevices={cameraDevices}
                    eventTypes={eventTypes}
                    selectedServers={selectedServers}
                    selectedDevices={selectedDevices}
                    selectedEventType={selectedEventType}
                    onToggleServer={toggleServer}
                    onToggleDevice={toggleDevice}
                    onSelectEventType={setSelectedEventType}
                  />
                </div>

                <div className="app-logs-container flex-1 overflow-y-auto custom-scrollbar p-0 bg-surface-container-low/10">
                  {filteredLogs.length > 0 ? (
                    <div className="flex flex-col">
                      {[...filteredLogs].reverse().slice(0, visibleAlerts).map((log, idx) => (
                        <div key={log.id || idx} className="border-b border-outline-variant/5">
                          <LogEntry log={log} onClick={() => setSelectedLog(log)} />
                        </div>
                      ))}
                      {visibleAlerts < filteredLogs.length && (
                        <button
                          onClick={() => setVisibleAlerts(prev => prev + 10)}
                          className='p-2 text-[12px] uppercase font-bold tracking-widest text-on-surface-variant hover:bg-surface-container-low/50 hover:text-white 
                      transition-all duration-200
                      border-b-2 border-transparent cursor-pointer'>{t('app.alert_wall.see_more_alerts')}</button>
                      )}
                    </div>
                  ) : (
                    <div className="p-10 flex flex-col items-center justify-center opacity-20 gap-2 h-full text-center">
                      <Terminal className="w-8 h-8" />
                      <span className="text-[10px] uppercase font-bold tracking-widest">{t('app.alert_wall.logs_queue_empty')}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="device-draggable-container flex-1 overflow-y-auto custom-scrollbar p-3 bg-surface-container-low/10 flex flex-col gap-2 relative">
                <div className="flex items-center justify-between sticky top-0 py-1 z-10 backdrop-blur-md mb-2 rounded-md px-1">
                  <span className="text-[9px] uppercase tracking-widest text-on-surface-variant opacity-70 font-bold">{t('app.alert_wall.drag_to_assign')}</span>
                  <button
                    onClick={() => {
                      console.log(devices)
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      setGrids((prevGrids: any[]) => {
                        const newGrids = [...prevGrids];
                        const maxGrids = Math.pow(gridCols, 2);
                        const allDevices = Object.values(devices).flatMap(server => {
                          if (!server.server) return [];
                          return (server.devices || []).map(dev => ({
                            ...dev,
                            server_serial: server.server.serial,
                            server_id: server.server.server_id
                          }));
                        });
                        console.log('allDevices', allDevices)
                        for (const dev of allDevices) {
                          const isAssigned = newGrids.some(g => g && g.device.server_id === dev.server_id && g.device.device_ip === dev.ip && g.device.device_name === dev.name);
                          if (isAssigned) continue;

                          let emptyGridID = -1;
                          for (let i = 0; i < maxGrids; i++) {
                            if (!newGrids[i]) {
                              emptyGridID = i;
                              break;
                            }
                          }
                          console.log('emptyGridID', emptyGridID)
                          if (emptyGridID === -1) break;

                          newGrids[emptyGridID] = {
                            gridID: emptyGridID,
                            device: {
                              server_serial: dev.server_serial,
                              server_id: dev.server_id,
                              device_ip: dev.ip,
                              device_name: dev.name,
                              device_type: dev.type || 'vms'
                            }
                          };
                        }
                        console.log('newGrids', newGrids)
                        return newGrids;
                      });
                    }}
                    className="text-[9px] font-bold uppercase tracking-widest bg-primary/20 hover:bg-primary/30 text-primary px-3 py-1.5 rounded transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    {t('app.alert_wall.auto_config')}
                  </button>
                </div>

                {/* SVMS Camera Devices Section */}
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">{t('app.alert_wall.svms_camera_devices')}</span>
                  <div className="flex-1 h-px bg-primary/10"></div>
                </div>

                {Object.values(devices).flatMap(server => {
                  if (!server.server) return [];
                  return (server.devices || []).map(dev => {
                    const assignedGrids = grids.filter(g => g && g.device && g.device.server_id === server.server.server_id && g.device.device_ip === dev.ip && g.device.device_name === dev.name);
                    const assignedText = assignedGrids.map(g => g.gridID + 1).join(', ');
                    return (
                      <div
                        key={`${server.server.server_id}-${dev.ip}-${dev.name}`}
                        draggable
                        title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify({
                            server_serial: server.server.serial,
                            server_id: server.server.server_id,
                            device_ip: dev.ip,
                            device_name: dev.name,
                            device_type: dev.type || 'vms'
                          }));
                        }}
                        className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-primary/5 border-primary/20' : 'bg-surface-container border-outline-variant/10'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-primary transition-colors truncate">{dev.name}</span>
                            <div className="flex gap-0.5 overflow-hidden">
                              <span className="text-[9px] text-on-surface-variant/70 font-mono">
                                {server.server.server_id} - {dev.ip}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[9px] px-1.5 py-0.5 bg-surface-container-highest rounded text-on-surface-variant uppercase font-medium">{dev.type || 'vms'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })}

                {!Object.values(devices).some(s => s.devices?.length > 0) && (
                  <div className="p-4 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/10 rounded">
                    <span className="text-[9px] uppercase font-bold tracking-widest">{t('app.alert_wall.no_svms_devices')}</span>
                  </div>
                )}

                {/* MQTT Sensor Devices Section */}
                <div className="flex items-center gap-2 mt-4 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400/80">{t('app.alert_wall.mqtt_sensor_devices')}</span>
                  <div className="flex-1 h-px bg-amber-400/10"></div>
                </div>

                {mqttServers.map(ms => {
                  const mqttDevs = mqttDevicesByServer[ms.id] || [];
                  if (mqttDevs.length === 0) return null;
                  return (
                    <div key={ms.id} className="flex flex-col gap-1 mb-2">
                      <div className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/50 px-1">
                        {ms.brokerHost}:{ms.brokerPort}
                      </div>
                      {mqttDevs.map(dev => {
                        const assignedGrids = grids.filter((g: any) => g && g.device.device_ip === dev.devEui && g.device.server_id === `mqtt-${ms.id}`);
                        const assignedText = assignedGrids.map((g: any) => g.gridID + 1).join(', ');
                        const link = deviceCameraLinks.find(l => l.devEui === dev.devEui && l.mqttServerId === ms.id);
                        return (
                          <div
                            key={`${ms.id}-${dev.devEui}`}
                            draggable
                            title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/json', JSON.stringify({
                                server_serial: ms.id,
                                server_id: `mqtt-${ms.id}`,
                                device_ip: dev.devEui,
                                device_name: dev.deviceName,
                                device_type: 'mqtt-sensor'
                              }));
                            }}
                            className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-surface-container border-outline-variant/10'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col">
                                <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-amber-400 transition-colors truncate">{dev.deviceName}</span>
                                <div className="flex gap-0.5 overflow-hidden">
                                  <span className="text-[9px] text-on-surface-variant/70 font-mono">
                                    {dev.devEui}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {link && <span className="text-[8px] px-1 py-0.5 rounded uppercase font-bold bg-cyan-500/20 text-cyan-500">📷 {link.cameraId.slice(-6)}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {!mqttServers.some(ms => (mqttDevicesByServer[ms.id] || []).length > 0) && (
                  <div className="p-4 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/10 rounded">
                    <span className="text-[9px] uppercase font-bold tracking-widest">{t('app.alert_wall.no_mqtt_devices')}</span>
                  </div>
                )}

                {/* Sunell Cameras Section */}
                <div className="flex items-center gap-2 mt-4 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-secondary/80">Sunell Camera</span>
                  <div className="flex-1 h-px bg-secondary/10"></div>
                </div>
                {cameraDevices.filter(cam => cam.type === 'sunell').map(cam => {
                  const assignedGrids = grids.filter((g: any) => g && g.device && g.device.server_id === 'SUNELL-LOCAL' && g.device.device_ip === cam.id);
                  const assignedText = assignedGrids.map((g: any) => g.gridID + 1).join(', ');
                  return (
                    <div
                      key={cam.id}
                      draggable
                      title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                          server_serial: 'SUNELL',
                          server_id: 'SUNELL-LOCAL',
                          device_ip: cam.id,
                          device_name: cam.name || cam.cameraIp,
                          device_type: 'sunell'
                        }));
                      }}
                      className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-secondary/5 border-secondary/20' : 'bg-surface-container border-outline-variant/10'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-secondary transition-colors truncate">{cam.name || cam.cameraIp}</span>
                          <div className="flex gap-0.5 overflow-hidden">
                            <span className="text-[9px] text-on-surface-variant/70 font-mono">
                              {cam.cameraIp}:{cam.cameraPort}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-[9px] px-1.5 py-0.5 bg-surface-container-highest rounded text-on-surface-variant uppercase font-medium">sunell</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {cameraDevices.filter(cam => cam.type === 'sunell').length === 0 && (
                  <div className="p-4 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/10 rounded">
                    <span className="text-[9px] uppercase font-bold tracking-widest">{t('app.devices.no_sunell_cameras')}</span>                
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </main>

      {/* ── Footer Bar ──────────────────────────────────────────────────── */}
      <footer className="app-footer shrink-0 h-6 bg-surface-container border-t border-outline-variant/10 flex items-center px-3 gap-4 text-[9px] font-mono select-none z-20">
        {/* Logout Button */}
        <button
          onClick={() => authApi.logout()}
          className="flex items-center gap-1.5 text-on-surface-variant/60 hover:text-red-500 transition-colors cursor-pointer mr-2"
          title="Logout"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>

        {/* System binding host */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-secondary' : 'bg-red-500 animate-pulse'}`} />
          <span className="text-on-surface-variant/60 uppercase tracking-widest font-bold text-[8px]">Host</span>
          <span className="text-on-surface font-bold">{systemConfig.be.ip}:{systemConfig.be.port}</span>
          <button
            onClick={() => setIsConfigSystemOpen(true)}
            className={`p-0.5 rounded transition-colors cursor-pointer ${isConnected ? 'text-secondary hover:bg-secondary/10' : 'text-red-500 hover:bg-red-500/10'}`}
            title="System Config"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>

        <div className="w-px h-3 bg-outline-variant/15" />

        {/* Save logs toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-on-surface-variant/60 uppercase tracking-widest font-bold text-[8px]">{t('app.footer.save_logs')}</span>
          <div
            onClick={toggleLogSaving}
            className={`relative w-6 h-3.5 rounded-full cursor-pointer transition-colors duration-200 ${isLogSaving ? 'bg-secondary' : 'bg-outline-variant/30'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform duration-200 ${isLogSaving ? 'translate-x-2.5' : 'translate-x-0'}`} />
          </div>
          <span className={`font-bold text-[8px] uppercase tracking-widest ${isLogSaving ? 'text-secondary' : 'text-on-surface-variant/40'}`}>{isLogSaving ? t('app.footer.on') : t('app.footer.off')}</span>
        </div>

        <div className="w-px h-3 bg-outline-variant/15" />

        {/* MQTT Data Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={async () => {
              console.log("=== THÔNG TIN CHUNG TỪ PROVIDER (useSocketManager) ===");
              console.log("1. MQTT Servers:", mqttServers);
              console.log("2. MQTT Logs (Realtime):", mqttLogs);
              console.log("3. Camera Devices:", cameraDevices);
              console.log("4. SVMS Servers:", servers);
              console.log("5. SVMS/System Logs:", logs);
              console.log("6. SVMS Devices:", devices);
              console.log("7. Send Connections:", sendServers);
              console.log("8. Receive Connections:", receiveServers);
              console.log("9. System Config:", systemConfig);
              console.log("10. Socket Connected:", isConnected);
              console.log("11. Event Types:", eventTypes);
              console.log("12. Total Log Count:", totalLogCount);

              // === Lấy data từ BE ===
              let backendState = null;
              try {
                const res = await apiClient.get('/api/v1/debug/state');
                backendState = res.data;
                console.log("13. Backend In-Memory State:", backendState);
              } catch (err) {
                console.warn("[DEBUG] Không lấy được BE state:", err);
              }

              // === Lưu data ra file .txt để phân tích ===
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const debugData = {
                _export_time: new Date().toISOString(),
                _summary: {
                  totalMqttLogs: mqttLogs.length,
                  totalMqttServers: mqttServers.length,
                  totalCameraDevices: cameraDevices.length,
                  totalSvmsServers: Object.keys(servers).length,
                  totalSvmsLogs: logs.length,
                  totalSvmsDevices: Object.keys(devices).length,
                  totalSendConnections: sendServers.length,
                  totalReceiveConnections: receiveServers.length,
                  socketConnected: isConnected,
                  totalLogCount,
                },
                // --- FE State ---
                frontend: {
                  mqttServers,
                  mqttLogs,
                  cameraDevices,
                  svmsServers: servers,
                  svmsLogs: logs,
                  svmsDevices: devices,
                  sendConnections: sendServers,
                  receiveConnections: receiveServers,
                  systemConfig,
                  eventTypes,
                },
                // --- BE State (in-memory) ---
                backend: backendState,
              };
              const jsonStr = JSON.stringify(debugData, null, 2);
              const blob = new Blob([jsonStr], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `cms-debug-data_${timestamp}.txt`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);

              alert(`Đã xuất file: cms-debug-data_${timestamp}.txt\n\nTổng MQTT Logs: ${mqttLogs.length}\nTổng MQTT Servers: ${mqttServers.length}\nTổng Camera Devices: ${cameraDevices.length}\nBackend state: ${backendState ? '✅' : '❌'}`);
            }}
            className="px-2 py-0.5 bg-primary text-on-primary text-[8px] font-bold uppercase tracking-widest rounded shadow-sm hover:opacity-80 transition-opacity"
          >
            {t('app.footer.view_system_data')}
          </button>
        </div>

        <div className="flex-1" />

        {/* Language dropdown (UI placeholder) */}
        <div className="relative">
          <button
            onClick={() => setLangOpen(v => !v)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer text-on-surface-variant/70 hover:text-on-surface"
          >
            <Languages className="w-3 h-3" />
            <span className="text-[8px] font-bold uppercase tracking-widest">{i18n.language.toUpperCase()}</span>
          </button>
          {langOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
              <div className="absolute bottom-full right-0 mb-1 z-50 bg-surface-container-high border border-outline-variant/20 rounded shadow-lg min-w-[100px] animate-in fade-in slide-in-from-bottom-2 duration-150">
                {['en', 'vi'].map(lang => (
                  <button
                    key={lang}
                    onClick={() => { i18n.changeLanguage(lang); setLangOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${i18n.language === lang ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:bg-surface-container'
                      }`}
                  >
                    {lang === 'en' ? '🇺🇸 English' : '🇻🇳 Tiếng Việt'}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </footer>

      {/* Config System Modal */}
      {isConfigSystemOpen && (
        <ConfigSystem
          initialConfig={systemConfig}
          onSave={(config) => { setSystemConfig(config); setIsConfigSystemOpen(false); }}
          onClose={() => setIsConfigSystemOpen(false)}
        />
      )}

      {selectedLog && (
        <LogPopup
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
