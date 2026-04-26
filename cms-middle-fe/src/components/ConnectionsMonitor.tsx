import { useState, useMemo, useEffect } from 'react';
import type { LogData, SystemConnection, SystemConfig, ServerData, DeviceData } from '../types';
import { Plus, Inbox, Activity, Terminal, Cpu, Globe, Send, Wifi, WifiOff, Loader2, ChevronDown, RefreshCw, Trash2, Settings, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { AddExternalServer } from './AddExternalServer';
import { ConfigSystem } from './ConfigSystem';
import apiClient from '../api/apiClient';
import { socket } from '../socket';
import axios from 'axios';

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

export function ConnectionsMonitor({
  isConnected, logs, sendServers, receiveServers, onSave, systemConfig, onSaveSystemConfig, onRemoveConnection, servers, devices
}: {
  socket: any,
  isConnected: boolean,
  logs: LogData[],
  sendServers: SystemConnection[],
  receiveServers: SystemConnection[],
  systemConfig: SystemConfig;
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  onSave: (ip: string, port: string, mode: 'receive' | 'send') => void,
  onSaveSystemConfig: (config: SystemConfig) => void,
  onRemoveConnection: (ip: string, port: string, mode: 'receive' | 'send') => void,
}) {
  const [isNetworkFormOpen, setIsNetworkFormOpen] = useState(false);
  const [isConfigSystemOpen, setIsConfigSystemOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');

  const [isLogSaving, setIsLogSaving] = useState(() => {
    const saved = localStorage.getItem('SAVE_LOG_FILES');
    return saved !== 'false';
  });

  const toggleLogSaving = async () => {
    const newState = !isLogSaving;
    setIsLogSaving(newState);
    localStorage.setItem('SAVE_LOG_FILES', String(newState));

    try {
      const res = await apiClient.post('/api/v1/config/log-saving', { enabled: newState });
      if (newState && res.data && res.data.path) {
        alert(`Recording incoming data to "${res.data.path}"`);
      }
    } catch (e) {
      console.error('Failed to toggle log saving', e);
    }
  };

  useEffect(() => {
    apiClient.post('/api/v1/config/log-saving', { enabled: isLogSaving }).catch(console.error);
  }, []);

  // Group log stats strictly by server_id + server_serial + device_name + device_ip
  const deviceLogStats = useMemo(() => {
    const stats: Record<string, { serverId: string; serverSerial: string; deviceName: string; deviceIp: string; logCount: number }> = {};
    (logs || []).forEach(log => {
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
  }, [logs]);

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
        orphans.push({
          name: stat.deviceName || 'UNKNOWN',
          ip: stat.deviceIp || 'UNKNOWN',
          logCount: stat.logCount
        });
      }
    });
    return orphans;
  }, [deviceLogStats, servers, devices]);



  const [initState, setInitState] = useState<'receive' | 'send'>('receive')
  const openNetworkForm = (type: 'input' | 'output') => {
    setInitState(type === 'input' ? 'receive' : 'send');
    setIsNetworkFormOpen(true);
  }
  return (
    <div className="ConnectionsMonitor flex flex-col h-full bg-background relative">
      {/* Settings / Config Modals */}
      {isNetworkFormOpen && (
        <AddExternalServer
          onSave={onSave}
          initialIp='192.168.1.'
          initialPort='5050'
          initialMode={initState}
          onClose={() => setIsNetworkFormOpen(false)}
        />
      )}
      {isConfigSystemOpen && (
        <ConfigSystem
          initialConfig={systemConfig}
          onSave={onSaveSystemConfig}
          onClose={() => setIsConfigSystemOpen(false)}
        />
      )}

      {/* Main Connections Monitor Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="mx-auto flex flex-col gap-6 animate-in fade-in duration-500">

          {/* Quick System Info Overview */}
          <div className="flex items-center justify-between border-b border-outline-variant/10 pb-4 shrink-0">
            <div className="flex items-center gap-6">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                  System Binding Host
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-black text-primary font-mono tracking-tight leading-none">{systemConfig.be.ip}:{systemConfig.be.port}</span>
                  <button
                    onClick={() => setIsConfigSystemOpen(true)}
                    className="p-1 text-on-surface-variant hover:text-primary transition-colors bg-surface-container hover:bg-primary/10 rounded-sm"
                    title="Cấu hình hệ thống"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="w-px h-8 bg-outline-variant/10"></div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                  System Connection Status
                </span>
                <div className="flex items-center gap-2">
                  <div
                    onClick={() => { if (!isConnected) { socket.connect() } }}
                    className={`w-2 h-2 rounded-full ${isConnected ? 'bg-secondary ring-4 ring-secondary/20' : 'bg-tertiary ring-4 ring-tertiary/20 cursor-pointer'} ${!isConnected ? 'animate-pulse' : ''}`}></div>
                  <div className={`text-[13px] font-black font-mono tracking-tight ${isConnected ? 'text-secondary' : 'text-tertiary'}`}>
                    {isConnected ? 'STABLE' : 'UNCONNECTED'}
                  </div>
                </div>
              </div>
              <div className="w-px h-8 bg-outline-variant/10"></div>

              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                  Save Log Files
                </span>
                <div className="flex items-center gap-2 h-full">
                  <div
                    onClick={toggleLogSaving}
                    className={`relative w-9 h-5 rounded-full cursor-pointer transition-colors duration-300 ${isLogSaving ? 'bg-primary' : 'bg-outline-variant/30'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${isLogSaving ? 'translate-x-4' : 'translate-x-0'}`}></div>
                  </div>
                  <span className={`text-[11px] font-bold tracking-widest uppercase transition-colors ${isLogSaving ? 'text-primary' : 'text-on-surface-variant/50'}`}>
                    {isLogSaving ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
              <div className="w-px h-8 bg-outline-variant/10"></div>
              
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                  MQTT Fall Logs
                </span>
                <div className="flex items-center gap-2 h-full">
                  <button 
                    onClick={() => {
                        apiClient.get('/api/v1/mqtt-logs').then(res => {
                           console.log("=== THÔNG TIN LOG TỪ MQTT ===", res.data);
                           alert("Đã in ra console trình duyệt (F12) và console của Backend!");
                        }).catch(e => {
                           console.error("Lỗi lấy MQTT logs", e);
                           alert("Lỗi khi lấy MQTT logs, kiểm tra server.");
                        });
                    }}
                    className="px-3 py-1 bg-primary text-on-primary text-[10px] font-bold uppercase tracking-widest rounded shadow-sm hover:opacity-80 transition-opacity"
                  >
                    XEM DATA TRẢ VỀ
                  </button>
                </div>
              </div>
              <div className="w-px h-8 bg-outline-variant/10"></div>

            </div>

          </div>
        </div>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Tab Headers */}
          <div className="flex items-center gap-2 border-b border-outline-variant/10 shrink-0">
            <button
              onClick={() => setActiveTab('input')}
              className={`flex-1 py-3 px-6 font-bold uppercase tracking-[0.1em] text-[12px] flex items-center justify-center gap-2 border-b-[3px] transition-all ${activeTab === 'input' ? 'border-secondary text-secondary bg-secondary/5' : 'border-transparent text-on-surface-variant hover:bg-surface-container/50'}`}
            >
              <Terminal className="w-4 h-4" />
              <div className="flex flex-col text-left">
                <span>Input Connections</span>
                {Object.keys(servers).length > 0 && (
                  <span className="text-[9px] text-secondary/70 tracking-normal font-mono leading-none">{Object.keys(servers).length} servers emitting</span>
                )}
              </div>
            </button>
            <button
              onClick={() => setActiveTab('output')}
              className={`flex-1 py-3 px-6 font-bold uppercase tracking-[0.1em] text-[12px] flex items-center justify-center gap-2 border-b-[3px] transition-all ${activeTab === 'output' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-on-surface-variant hover:bg-surface-container/50'}`}
            >
              <Globe className="w-4 h-4" />
              <div className="flex flex-col text-left">
                <span>Output Targets</span>
                {sendServers.length > 0 && (
                  <span className="text-[9px] text-primary/70 tracking-normal font-mono leading-none">{sendServers.length} endpoints receiving</span>
                )}
              </div>
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-container/20 border border-outline-variant/30 rounded-lg p-5">
            {activeTab === 'input' && (
              <div className="flex flex-col gap-4">
                {Object.keys(servers).length === 0 && orphanDevices.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center opacity-40 gap-3 border border-dashed border-outline-variant/20 rounded-md bg-surface-container-lowest/50">
                    <Inbox className="w-8 h-8 text-on-surface-variant" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">No input connections</span>
                  </div>
                ) : (
                  <>
                    {Object.values(servers).map((srv, idx) => {
                      const serverId = srv.id || srv.serial || srv.server_ip || srv.svms_ipv4_ip || '';
                      const matchedDevices = devices[serverId] || devices[srv.id] || devices[srv.serial];
                      return (
                        <ServerInputCard
                          key={idx}
                          srv={srv}
                          matchedDevices={matchedDevices}
                          deviceLogStats={deviceLogStats}
                        />
                      );
                    })}
                    <UnknownDevicesCard orphanDevices={orphanDevices} />
                  </>
                )}
                <button
                  onClick={() => openNetworkForm('input')}
                  className="mt-2 w-full py-4 border border-dashed border-secondary/30 text-secondary hover:bg-secondary/10 bg-secondary/5 rounded-md flex justify-center items-center gap-2 text-[10px] uppercase font-bold tracking-widest transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Add Input Connection
                </button>
              </div>
            )}

            {activeTab === 'output' && (
              <div className="flex flex-col gap-4">
                {sendServers.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center opacity-40 gap-3 border border-dashed border-outline-variant/20 rounded-md bg-surface-container-lowest/50">
                    <Send className="w-8 h-8 text-on-surface-variant" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">No output targets configured</span>
                  </div>
                ) : (
                  <>
                    {sendServers.map((s, idx) => (
                      <SendTargetCard key={idx} conn={s} />
                    ))}
                  </>
                )}
                <button
                  onClick={() => openNetworkForm('output')}
                  className="mt-2 w-full py-4 border border-dashed border-primary/30 text-primary hover:bg-primary/10 bg-primary/5 rounded-md flex justify-center items-center gap-2 text-[10px] uppercase font-bold tracking-widest transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Add Output Connection
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnknownDevicesCard({ orphanDevices }: { orphanDevices: { name: string; ip: string; logCount: number }[] }) {
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
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">UNREGISTERED ORPHAN LOGS</span>
              </InfoTooltip>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1 px-3 py-1 bg-surface-container/50 rounded border border-outline-variant/10">
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">UNKNOWN DEVICES</span>
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

function DeviceItemRow({
  name,
  ip,
  type,
  logCount,
  isOrphan = false,
  connectionStatus
}: {
  name: string;
  ip: string;
  type?: string;
  logCount: number;
  isOrphan?: boolean;
  connectionStatus?: 'connected' | 'disconnected';
}) {
  const isConnected = connectionStatus === 'connected';
  const isDisconnected = connectionStatus === 'disconnected';

  return (
    <div className={`device-item-row flex items-center gap-4 px-3 py-2 bg-surface-container-lowest/40 rounded border transition-colors ${isDisconnected
      ? 'border-tertiary/20 bg-tertiary/5'
      : 'border-outline-variant/5 hover:border-outline-variant/20'
      }`}>
      {/* Connection status dot */}
      {connectionStatus && (
        <InfoTooltip content={isConnected ? 'Đang kết nối' : 'Mất kết nối'} side="bottom">
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
        <InfoTooltip content="Tổng Logs nhận được">
          <span className={`text-[10px] font-black font-mono px-2 py-1 rounded min-w-[70px] text-center transition-all ${logCount > 0 ? 'text-secondary bg-secondary/15 ring-1 ring-secondary/20' : 'text-on-surface-variant/40 bg-surface-container border border-outline-variant/10'}`}>
            {logCount} logs
          </span>
        </InfoTooltip>
      </div>
    </div>
  );
}

function SendTargetCard({ conn }: { conn: SystemConnection }) {
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
            Target Endpoint
          </span>
          <div className="flex items-end gap-1">
            <span className="text-[16px] font-black text-on-surface font-mono tracking-tight leading-none">{conn.ip}</span>
            <span className="text-[12px] font-mono font-medium text-on-surface-variant/60 mb-0.5">:{conn.port}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[9px] font-bold text-on-surface-variant/70 uppercase tracking-widest">Logs Sent</span>
          <span className="text-[12px] font-black font-mono text-on-surface flex items-center justify-end gap-1.5 min-w-[50px] bg-surface-container-low px-2 py-0.5 rounded border border-outline-variant/10">
            <Send className="w-3 h-3 text-on-surface-variant/50" />
            <span>{conn.sentCount || 0}</span>
          </span>
        </div>

        <div className="flex flex-col items-end gap-1.5 border-l border-outline-variant/10 pl-5 relative h-full justify-center">
          <span className="text-[9px] font-bold text-on-surface-variant/70 uppercase tracking-widest">Status</span>

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
                    REMOVE CONNECTION
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

function ServerInputCard({ srv, matchedDevices, deviceLogStats }: { srv: any, matchedDevices: any, deviceLogStats: Record<string, any> }) {
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
                  {isDisconnected ? 'OFFLINE' : 'ONLINE'}
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
            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">DEVICES</span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-black font-mono text-on-surface leading-none">{deviceCount}</span>
              {disconnectedDeviceCount > 0 && (
                <InfoTooltip content={`${disconnectedDeviceCount} thiết bị mất kết nối`}>
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
                return (
                  <DeviceItemRow
                    key={dIdx}
                    name={device.name}
                    ip={device.ip}
                    type={device.type}
                    logCount={logCount}
                    connectionStatus={device.connectionStatus}
                  />
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-3 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest flex items-center justify-center gap-2 bg-surface-container-lowest/30 rounded-sm border border-dashed border-outline-variant/10">
              <Activity className="w-3 h-3 opacity-50" />
              No devices mapped from this server
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
