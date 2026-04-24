import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { ConnectionsMonitor } from './components/ConnectionsMonitor';
import { LogPopup } from './components/LogPopup';
import { useSocketManager } from './hooks/useSocketManager';
import { SlidersHorizontal, Terminal, Check, Cpu, MonitorSmartphone, Camera, CameraOff, Plus, Minus, X, Settings, Monitor, Network, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { LogEntry } from './components/LogEntry';
import { CameraFeed } from './components/CameraFeed';
import type { LogData, ServerData, DeviceData } from './types';
import LoginPage from './components/LoginPage';
import { authApi } from './api/authApi';
import { AlertWall } from './components/AlertWall';

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
  eventTypes: string[];
  selectedServers: Set<string>;
  selectedDevices: Set<string>;
  selectedEventType: string | null;
  onToggleServer: (id: string) => void;
  onToggleDevice: (ip: string) => void;
  onSelectEventType: (type: string | null) => void;
}) {
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

  const serverList = Object.values(servers);
  const deviceList = useMemo(() => {
    const seen = new Set<string>();
    return Object.values(devices).flatMap(serverData =>
      (serverData.devices || []).map(d => ({
        ...d,
        serverId: serverData.server.server_id
      }))
    ).filter(d => {
      const uniqueKey = `${d.serverId}_${d.ip}_${d.name}`;
      if (!d.ip || seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });
  }, [devices]);

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
              <span className="text-[9px] font-black uppercase tracking-widest text-secondary">Servers</span>
            </div>
            {serverList.length === 0 ? (
              <p className="text-[10px] text-on-surface-variant/40 py-1 pl-1">Chưa có server nào</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {serverList.map(srv => {
                  const id = srv.id || srv.serial;
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
                      <span className="text-[11px] font-semibold text-on-surface shrink-0">{srv.server_name || id}</span>
                      <span className="text-[9px] font-mono text-on-surface-variant/50 ml-auto truncate">{srv.svms_ipv4_ip || srv.server_ip} - {srv.id}</span>
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
              <span className="text-[9px] font-black uppercase tracking-widest text-tertiary">Devices</span>
            </div>
            {deviceList.length === 0 ? (
              <p className="text-[10px] text-on-surface-variant/40 py-1 pl-1">Chưa có device nào</p>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto custom-scrollbar">
                {deviceList.map(dev => {
                  const uniqueKey = `${dev.serverId}_${dev.ip}_${dev.name}`;
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
              <span className="text-[9px] font-black uppercase tracking-widest text-warning">Event Types</span>
            </div>
            {eventTypes.length === 0 ? (
              <p className="text-[10px] text-on-surface-variant/40 py-1 pl-1">Chưa có event type nào</p>
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
                  <span className="text-[11px] font-semibold text-on-surface truncate">Tất cả (All)</span>
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
                      <span className="text-[11px] font-semibold text-on-surface truncate">{type}</span>
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
    KEEP_TOTAL_LOG_COUNT
  } = useSocketManager();

  const displayLogCount = KEEP_TOTAL_LOG_COUNT ? totalLogCount : logs.length;

  const [selectedLog, setSelectedLog] = useState<LogData | null>(null);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [rightTab, setRightTab] = useState<'logs' | 'devices'>('logs');
  const [mainTab, setMainTab] = useState<'alert' | 'connections'>('alert');
  const [visibleAlerts, setVisibleAlerts] = useState<number>(30);
  const [gridCols, setGridCols] = useState<number>(3);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isNarrow = windowWidth < 800;
  const [grids, setGrids] = useState<{
    gridID: number,
    device: {
      server_serial: string,
      server_id: string,
      device_ip: string,
      device_name: string,
      device_type: string
    }
  }[]>([]);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      setAppVersion(window.electronAPI.getAppVersion());
    }
  }, []);

  const toggleServer = (id: string) =>
    setSelectedServers(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleDevice = (ip: string) =>
    setSelectedDevices(prev => { const s = new Set(prev); s.has(ip) ? s.delete(ip) : s.add(ip); return s; });

  // Lọc logs theo server, device và event_type đang được chọn
  const filteredLogs = useMemo(() => {
    if (selectedServers.size === 0 && selectedDevices.size === 0 && !selectedEventType) return logs;
    return logs.filter(log => {
      const logServerId = log.server?.server_id || log.server?.serial || '';
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


  // Logout on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[DASHBOARD] Escape pressed, logging out...');
        authApi.logout();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Track window width for responsive layout
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="app-dashboard-root flex flex-col h-screen overflow-hidden bg-background text-on-surface font-sans selection:bg-primary/30 antialiased">
      <main className={`app-dashboard-main flex-1 overflow-hidden ${isNarrow ? 'flex flex-col' : 'grid grid-cols-4 gap-0'}`}>
        {/* Main Section */}
        <div className={`app-dashboard-left-section overflow-hidden bg-background border-outline-variant/20 ${isNarrow ? 'flex-1 border-b' : 'col-span-3 grid grid-rows-[1fr] h-full border-r'}`}>
          <div className="flex flex-col overflow-hidden h-full">
            <div className={`flex items-center border-b border-outline-variant/10 shrink-0 ${isNarrow ? '' : 'px-6 gap-4'}`}>
              <button
                className={`flex items-center gap-2 px-3 py-4 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'alert' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                onClick={() => setMainTab('alert')}
              >
                <Monitor className={`w-5 h-5 ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`} />
                <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`}>Alert Wall</h2>
              </button>
              <button
                className={`flex items-center gap-2 px-3 py-4 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'connections' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                onClick={() => setMainTab('connections')}
              >
                <Network className={`w-5 h-5 ${mainTab === 'connections' ? 'text-primary' : 'text-on-surface'}`} />
                <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'connections' ? 'text-primary' : 'text-on-surface'}`}>Connections Monitor</h2>
              </button>
            </div>
            {/* <button onClick={() => console.log(servers)}>CLick</button> */}
            {mainTab === 'alert' ? (
              <AlertWall
                logs={logs}
                cameras={Object.values(devices).flatMap(server => server || [])}
                onSelectLog={setSelectedLog}
                gridCols={gridCols}
                setGridCols={setGridCols}
                grids={grids}
                setGrids={setGrids}
              />
            ) : (
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
                onRemoveConnection={handleRemoveConnection}
              />
            )}
          </div>
        </div>

        {/* Right Section — fixed bottom drawer on narrow screens */}
        {isNarrow && (
          <button
            onClick={() => setRightPanelVisible(v => !v)}
            className="app-right-panel-toggle fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-white shadow-lg text-[11px] font-bold tracking-wide transition-all hover:bg-primary/90 active:scale-95"
          >
            {rightPanelVisible
              ? <><PanelRightClose className="w-4 h-4" /></>
              : <><PanelRightOpen className="w-4 h-4" /></>}
          </button>
        )}
        <aside
          className={`app-dashboard-right-section bg-surface-container-lowest flex flex-col overflow-hidden shadow-2xl z-10 transition-transform duration-300 ${isNarrow
            ? `fixed bottom-0 left-0 right-0 h-1/4 border-t border-outline-variant/20 ${rightPanelVisible ? 'translate-y-0' : 'translate-y-full'}`
            : 'col-span-1 relative w-full'
            }`}
        >
          <div className="flex items-center border-b border-outline-variant/10 shrink-0">
            <button
              onClick={() => setRightTab('logs')}
              className={`h-full flex-3 py-3 text-[10px] tracking-widest font-bold uppercase transition-colors flex items-center justify-center gap-2 ${rightTab === 'logs' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-on-surface-variant hover:bg-surface-container-low/50 border-b-2 border-transparent'}`}
            >
              <Terminal className="w-3.5 h-3.5" />Logs ({displayLogCount})
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
                <span className="text-[10px] font-bold tracking-widest text-on-surface-variant uppercase">Filter Logs</span>
                <LogFilter
                  servers={servers}
                  devices={devices}
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
                    {filteredLogs.slice(0, visibleAlerts).map((log, idx) => (
                      <div key={log.id || idx} className="border-b border-outline-variant/5">
                        <LogEntry log={log} onClick={() => setSelectedLog(log)} />
                      </div>
                    ))}
                    {visibleAlerts < filteredLogs.length && (
                      <button
                        onClick={() => setVisibleAlerts(prev => prev + 10)}
                        className='p-2 text-[12px] uppercase font-bold tracking-widest text-on-surface-variant hover:bg-surface-container-low/50 hover:text-white 
                      transition-all duration-200
                      border-b-2 border-transparent cursor-pointer'>See more alerts</button>
                    )}
                  </div>
                ) : (
                  <div className="p-10 flex flex-col items-center justify-center opacity-20 gap-2 h-full text-center">
                    <Terminal className="w-8 h-8" />
                    <span className="text-[10px] uppercase font-bold tracking-widest">Logs queue empty</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 bg-surface-container-low/10 flex flex-col gap-2 relative">
              <div className="flex items-center justify-between sticky top-0 py-1 z-10 backdrop-blur-md mb-2 rounded-md px-1">
                <span className="text-[9px] uppercase tracking-widest text-on-surface-variant opacity-70 font-bold">Drag to assign</span>
                <button
                  onClick={() => {
                    console.log(devices)
                    setGrids(prevGrids => {
                      const newGrids = [...prevGrids];
                      const maxGrids = Math.pow(gridCols, 2);
                      const allDevices = Object.values(devices).flatMap(server =>
                        (server.devices || []).map(dev => ({
                          ...dev,
                          server_serial: server.server.serial,
                          server_id: server.server.server_id
                        }))
                      );
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
                  Auto Config
                </button>
              </div>
              {Object.values(devices).flatMap(server => server.devices?.map(dev => {
                const assignedGrids = grids.filter(g => g.device.server_id === server.server.server_id && g.device.device_ip === dev.ip && g.device.device_name === dev.name);
                const assignedText = assignedGrids.map(g => g.gridID + 1).join(', ');
                return (
                  <div
                    key={`${server.server.server_id}-${dev.ip}-${dev.name}`}
                    draggable
                    title={assignedGrids.length > 0 ? `Đang hiển thị trên ô: ${assignedText}` : undefined}
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
                )
              }))}
              {!Object.values(devices).some(s => s.devices?.length > 0) && (
                <div className="p-10 flex flex-col items-center justify-center opacity-30 gap-2 h-full text-center">
                  <MonitorSmartphone className="w-8 h-8" />
                  <span className="text-[10px] uppercase font-bold tracking-widest">No Devices Found</span>
                </div>
              )}
            </div>
          )}
        </aside>
      </main>

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
