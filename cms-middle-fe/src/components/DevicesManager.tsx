import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerData, DeviceData, MqttServerConfig, MqttLogEntry, MqttDeviceConfig, DeviceCameraLink } from '../types';
import {
  ChevronRight, ChevronDown, Plus, Cpu, Radio, Camera,
  Server, Wifi, WifiOff, MonitorSmartphone, Info, X, Trash2
} from 'lucide-react';
import { CameraForm } from './CameraForm';
import { AddExternalServer } from './AddExternalServer';
import { socket } from '../socket';
import apiClient from '../api/apiClient';

// ── Types ────────────────────────────────────────────────────────────────────
type SelectedItemType =
  | { kind: 'svms-server'; data: ServerData; devices?: DeviceData }
  | { kind: 'svms-device'; data: any; server: ServerData }
  | { kind: 'mqtt-server'; data: MqttServerConfig; mqttDevices: MqttDeviceInfo[] }
  | { kind: 'mqtt-device'; data: MqttDeviceInfo; server: MqttServerConfig }
  | { kind: 'camera'; data: MqttDeviceConfig };

interface MqttDeviceInfo {
  devEui: string;
  deviceName: string;
  deviceProfileName: string;
  alarmCount: number;
  lastSeen: string;
}

interface DevicesManagerProps {
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  mqttServers: MqttServerConfig[];
  mqttLogs: MqttLogEntry[];
  cameraDevices: MqttDeviceConfig[];
  deviceCameraLinks: DeviceCameraLink[];
  onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void;
  onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void;
  fetchCameras: () => void;
  handleAddMqttServer: (config: MqttServerConfig) => void;
  handleAddExternalServer: (ip: string, port: string, mode: 'receive' | 'send') => void;
}

// ── Main Component ───────────────────────────────────────────────────────────
export function DevicesManager({
  servers, devices, mqttServers, mqttLogs, cameraDevices,
  deviceCameraLinks, onLinkDeviceCamera, onLinkMqttServerCamera,
  fetchCameras, handleAddMqttServer, handleAddExternalServer
}: DevicesManagerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SelectedItemType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    svms: true, mqtt: true, cameras: true, sunell: true
  });
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [addingForm, setAddingForm] = useState<'svms' | 'mqtt' | 'camera' | 'sunell_camera' | null>(null);

  const toggleGroup = (key: string) =>
    setExpandedGroups(p => ({ ...p, [key]: !p[key] }));
  const toggleServer = (key: string) =>
    setExpandedServers(p => ({ ...p, [key]: !p[key] }));

  // Extract MQTT devices per server from logs
  const mqttDevicesByServer = useMemo(() => {
    const map: Record<string, MqttDeviceInfo[]> = {};
    (mqttLogs || []).forEach(log => {
      const sid = log.mqttServerId;
      const di = log.payload?.deviceInfo;
      if (!sid || !di?.devEui) return;
      if (!map[sid]) map[sid] = [];
      const existing = map[sid].find(d => d.devEui === di.devEui);
      const evtCount = log.payload?.object?.events?.length || 0;
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

  const svmsServers = Object.values(servers).filter(s => s.type !== 'mqtt');
  const otherCameras = cameraDevices.filter(cam => cam.type !== 'sunell');
  const sunellCameras = cameraDevices.filter(cam => cam.type === 'sunell');

  const handleDeleteCamera = async (camId: string) => {
    if (!confirm(t('app.devices.confirm_delete_camera') || 'Xóa camera này?')) return;
    try {
      await apiClient.delete(`/api/v1/cameras/${camId}`);
      if (selected?.kind === 'camera' && (selected.data as MqttDeviceConfig).id === camId) {
        setSelected(null);
      }
      fetchCameras();
    } catch (err: any) {
      console.error('Delete camera error:', err);
      alert('Không thể xóa camera: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteMqttServer = async (serverId: string) => {
    if (!confirm(t('app.devices.confirm_delete_mqtt') || 'Xóa MQTT server này?')) return;
    try {
      await apiClient.delete(`/api/v1/mqtt-servers/${serverId}`);
      if (selected?.kind === 'mqtt-server' && (selected.data as MqttServerConfig).id === serverId) {
        setSelected(null);
      }
      // Refresh MQTT servers list via socket
      socket.emit('get-mqtt-servers');
    } catch (err: any) {
      console.error('Delete MQTT server error:', err);
      alert('Không thể xóa MQTT server: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="DevicesManager flex-1 overflow-hidden flex flex-col h-full">
      {/* Add forms (modals) */}
      {addingForm === 'svms' && (
        <AddExternalServer
          onSave={(ip, port, mode) => { handleAddExternalServer(ip, port, mode); setAddingForm(null); }}
          onSaveMqtt={() => { }}
          initialIp="192.168.1." initialPort="5050" initialMode="receive"
          onClose={() => setAddingForm(null)}
        />
      )}
      {addingForm === 'mqtt' && (
        <AddExternalServer
          onSave={() => { }}
          onSaveMqtt={(cfg) => { handleAddMqttServer(cfg); setAddingForm(null); }}
          initialIp="" initialPort="" initialMode="receive"
          initialConnectionType="mqtt"
          onClose={() => setAddingForm(null)}
        />
      )}
      {(addingForm === 'camera' || addingForm === 'sunell_camera') && (
        <CameraForm
          onCancel={() => setAddingForm(null)}
          onSuccess={() => { setAddingForm(null); fetchCameras(); }}
          initialType={addingForm === 'sunell_camera' ? 'sunell' : 'other'}
        />
      )}

      <div className="flex-1 overflow-hidden grid gap-0" style={{ gridTemplateColumns: '3fr 7fr' }}>
        {/* ── LEFT: Tree ────────────────────────────────────────────────── */}
        <div className="overflow-y-auto custom-scrollbar border-r border-outline-variant/10 bg-surface-container-lowest p-3 flex flex-col gap-1">

          {/* SVMS Servers */}
          <GroupHeader icon={<Cpu className="w-3.5 h-3.5" />} label={t('app.devices.svms_servers')} color="text-secondary" count={svmsServers.length}
            expanded={!!expandedGroups.svms} onToggle={() => toggleGroup('svms')}
            onAdd={() => setAddingForm('svms')}
          />
          {expandedGroups.svms && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-secondary/10 pl-2">
              {svmsServers.length === 0 && <EmptyHint text={t('app.devices.no_svms')} />}
              {svmsServers.map(srv => {
                const sId = srv.id || srv.serial;
                const matchDev = devices[sId] || devices[srv.id] || devices[srv.serial];
                const expanded = !!expandedServers[`svms-${sId}`];
                return (
                  <div key={sId}>
                    <TreeItem
                      label={srv.server_name || sId}
                      sublabel={srv.svms_ipv4_ip || srv.server_ip}
                      hasChildren={!!matchDev?.devices?.length}
                      expanded={expanded}
                      onToggle={() => toggleServer(`svms-${sId}`)}
                      onClick={() => setSelected({ kind: 'svms-server', data: srv, devices: matchDev })}
                      isSelected={selected?.kind === 'svms-server' && (selected.data as ServerData).id === srv.id}
                      status={srv.connectionStatus}
                    />
                    {expanded && matchDev?.devices?.map((dev, i) => (
                      <TreeItem key={i}
                        label={dev.name} sublabel={dev.ip} indent
                        icon={<Camera className="w-3 h-3 text-on-surface-variant/60" />}
                        onClick={() => setSelected({ kind: 'svms-device', data: dev, server: srv })}
                        isSelected={selected?.kind === 'svms-device' && (selected.data as any).ip === dev.ip && (selected.data as any).name === dev.name}
                        status={dev.connectionStatus}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* MQTT Servers */}
          <GroupHeader icon={<Radio className="w-3.5 h-3.5" />} label={t('app.devices.mqtt_servers')} color="text-amber-400" count={mqttServers.length}
            expanded={!!expandedGroups.mqtt} onToggle={() => toggleGroup('mqtt')}
            onAdd={() => setAddingForm('mqtt')}
          />
          {expandedGroups.mqtt && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-amber-400/10 pl-2">
              {mqttServers.length === 0 && <EmptyHint text={t('app.devices.no_mqtt')} />}
              {mqttServers.map(ms => {
                const expanded = !!expandedServers[`mqtt-${ms.id}`];
                const mqttDevs = mqttDevicesByServer[ms.id] || [];
                return (
                  <div key={ms.id}>
                    <TreeItem
                      label={ms.name || `${ms.brokerHost}:${ms.brokerPort}`}
                      sublabel={ms.name ? `${ms.protocol}://${ms.brokerHost}:${ms.brokerPort}` : (ms.topic || ms.defaultTopic || '')}
                      hasChildren={mqttDevs.length > 0}
                      expanded={expanded}
                      onToggle={() => toggleServer(`mqtt-${ms.id}`)}
                      onClick={() => setSelected({ kind: 'mqtt-server', data: ms, mqttDevices: mqttDevs })}
                      isSelected={selected?.kind === 'mqtt-server' && (selected.data as MqttServerConfig).id === ms.id}
                      status={ms.status === 'connected' ? 'connected' : ms.status === 'error' ? 'disconnected' : ms.status}
                      onDelete={() => handleDeleteMqttServer(ms.id)}
                    />
                    {expanded && mqttDevs.map(d => (
                      <TreeItem key={d.devEui}
                        label={d.deviceName} sublabel={d.devEui} indent
                        icon={<MonitorSmartphone className="w-3 h-3 text-on-surface-variant/60" />}
                        onClick={() => setSelected({ kind: 'mqtt-device', data: d, server: ms })}
                        isSelected={selected?.kind === 'mqtt-device' && (selected.data as MqttDeviceInfo).devEui === d.devEui}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sunell Cameras */}
          <GroupHeader icon={<Camera className="w-3.5 h-3.5" />} label={t('app.devices.sunell_cameras')} color="text-green-500" count={sunellCameras.length}
            expanded={!!expandedGroups.sunell} onToggle={() => toggleGroup('sunell')}
            onAdd={() => setAddingForm('sunell_camera')}
          />
          {expandedGroups.sunell && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-green-500/10 pl-2">
              {sunellCameras.length === 0 && <EmptyHint text={t('app.devices.no_sunell_cameras')} />}
              {sunellCameras.map(cam => (
                <TreeItem key={cam.id}
                  label={(cam as any).name || `Camera Sunell: ${cam.cameraIp}`}
                  sublabel={`${cam.cameraIp}:${cam.cameraPort}`}
                  onClick={() => setSelected({ kind: 'camera', data: cam })}
                  isSelected={selected?.kind === 'camera' && (selected.data as MqttDeviceConfig).id === cam.id}
                  status={cam.status || 'error'}
                  onDelete={() => handleDeleteCamera(cam.id)}
                />
              ))}
            </div>
          )}

          {/* Independent Cameras */}
          <GroupHeader icon={<Camera className="w-3.5 h-3.5" />} label={t('app.devices.cameras')} color="text-cyan-500" count={otherCameras.length}
            expanded={!!expandedGroups.cameras} onToggle={() => toggleGroup('cameras')}
            onAdd={() => setAddingForm('camera')}
          />
          {expandedGroups.cameras && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-cyan-500/10 pl-2">
              {otherCameras.length === 0 && <EmptyHint text={t('app.devices.no_cameras')} />}
              {otherCameras.map(cam => (
                <TreeItem key={cam.id}
                  label={(cam as any).name || `Camera: ${cam.cameraIp}`}
                  sublabel={`${cam.cameraIp}:${cam.cameraPort}`}
                  onClick={() => setSelected({ kind: 'camera', data: cam })}
                  isSelected={selected?.kind === 'camera' && (selected.data as MqttDeviceConfig).id === cam.id}
                  status={cam.status || 'error'}
                  onDelete={() => handleDeleteCamera(cam.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT: Detail ─────────────────────────────────────────────── */}
        <div className="overflow-y-auto custom-scrollbar bg-background p-6">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center opacity-25 gap-3">
              <Info className="w-10 h-10" />
              <span className="text-[11px] uppercase font-bold tracking-widest">{t('app.devices.select_device')}</span>
            </div>
          ) : (
            <DetailPanel item={selected} onClose={() => setSelected(null)} cameraDevices={cameraDevices} mqttServers={mqttServers} deviceCameraLinks={deviceCameraLinks} onLinkDeviceCamera={onLinkDeviceCamera} onLinkMqttServerCamera={onLinkMqttServerCamera} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function GroupHeader({ icon, label, color, count, expanded, onToggle, onAdd }: {
  icon: React.ReactNode; label: string; color: string; count: number;
  expanded: boolean; onToggle: () => void; onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-2 mt-1 select-none">
      <button onClick={onToggle} className="flex items-center gap-2 flex-1 group cursor-pointer">
        <ChevronRight className={`w-3 h-3 text-on-surface-variant transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        <span className={`${color}`}>{icon}</span>
        <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{label}</span>
        <span className="text-[9px] font-mono text-on-surface-variant/50 bg-surface-container px-1.5 py-0.5 rounded">{count}</span>
      </button>
      <button onClick={onAdd} className={`p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer ${color}`} title={`Add ${label}`}>
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function TreeItem({ label, sublabel, icon, hasChildren, expanded, onToggle, onClick, isSelected, indent, status, onDelete }: {
  label: string; sublabel?: string; icon?: React.ReactNode;
  hasChildren?: boolean; expanded?: boolean; onToggle?: () => void;
  onClick: () => void; isSelected?: boolean; indent?: boolean;
  status?: string; onDelete?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all text-[11px] group
        ${indent ? 'ml-4' : ''}
        ${isSelected
          ? 'bg-primary/10 border border-primary/20 text-primary'
          : 'hover:bg-surface-container-high border border-transparent text-on-surface'}`}
      onClick={onClick}
    >
      {hasChildren && onToggle ? (
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="shrink-0 cursor-pointer p-0.5">
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
        </button>
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : (
        <span className="w-4" />
      )}
      {status && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'connected' ? 'bg-secondary' :
          status === 'connecting' ? 'bg-amber-400 animate-pulse' :
            status === 'error' ? 'bg-red-500' :
              status === 'ready' ? 'bg-cyan-400' :
                'bg-tertiary animate-pulse'
          }`} />
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-bold truncate leading-tight">{label}</span>
        {sublabel && <span className="text-[9px] font-mono text-on-surface-variant/50 truncate leading-tight">{sublabel}</span>}
      </div>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 cursor-pointer"
          title="Xóa"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 text-[9px] text-on-surface-variant/40 uppercase tracking-widest font-bold">{text}</div>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({ item, onClose, cameraDevices, mqttServers, deviceCameraLinks, onLinkDeviceCamera, onLinkMqttServerCamera }: { item: SelectedItemType; onClose: () => void; cameraDevices: MqttDeviceConfig[]; mqttServers: MqttServerConfig[]; deviceCameraLinks: DeviceCameraLink[]; onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void; onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void; }) {
  const { t } = useTranslation();

  const isSunell = item.kind === 'camera' && item.data.type === 'sunell';

  const titleMap = {
    'svms-server': t('app.devices.svms_server'),
    'svms-device': t('app.devices.svms_device'),
    'mqtt-server': t('app.devices.mqtt_server'),
    'mqtt-device': t('app.devices.mqtt_device'),
    'camera': isSunell ? t('app.devices.sunell_cameras') : t('app.devices.camera_device'),
  };

  const colorMap = {
    'svms-server': 'text-secondary border-secondary/30',
    'svms-device': 'text-secondary border-secondary/30',
    'mqtt-server': 'text-amber-400 border-amber-400/30',
    'mqtt-device': 'text-amber-400 border-amber-400/30',
    'camera': isSunell ? 'text-green-500 border-green-500/30' : 'text-cyan-500 border-cyan-500/30',
  };

  // Lấy dữ liệu mới nhất từ props để tránh lỗi stale-state khi React useState không tự cập nhật
  const latestCam = item.kind === 'camera'
    ? cameraDevices.find(c => c.id === item.data.id) || item.data
    : null;

  const latestMqttServer = item.kind === 'mqtt-server'
    ? mqttServers.find(s => s.id === item.data.id) || item.data
    : null;

  const latestMqttDeviceServer = item.kind === 'mqtt-device'
    ? mqttServers.find(s => s.id === item.server.id) || item.server
    : null;

  return (
    <div className="animate-in fade-in duration-300">
      {/* Content */}
      {item.kind === 'svms-server' && <SvmsServerDetail srv={item.data} devices={item.devices} />}
      {item.kind === 'svms-device' && <SvmsDeviceDetail dev={item.data} srv={item.server} />}
      {item.kind === 'mqtt-server' && latestMqttServer && <MqttServerDetail srv={latestMqttServer} devices={item.mqttDevices} allCameras={cameraDevices} onLinkMqttServerCamera={onLinkMqttServerCamera} />}
      {item.kind === 'mqtt-device' && latestMqttDeviceServer && <MqttDeviceDetail dev={item.data} srv={latestMqttDeviceServer} allCameras={cameraDevices} deviceCameraLinks={deviceCameraLinks} onLinkDeviceCamera={onLinkDeviceCamera} />}
      {item.kind === 'camera' && latestCam && <CameraDetail cam={latestCam} />}
    </div>
  );
}

const formatDate = (dateStr: string | undefined) => {
  if (!dateStr) return '---';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

function InfoRow({ label, value, mono }: { label: string; value: string | number | undefined; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-outline-variant/5">
      <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest min-w-[120px] shrink-0 pt-0.5">{label}</span>
      <span className={`text-[12px] text-on-surface break-all ${mono ? 'font-mono' : 'font-medium'}`}>{value ?? '—'}</span>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const statusConfig: Record<string, { dot: string; badge: string; label: string }> = {
    connected: { dot: 'bg-secondary', badge: 'text-secondary bg-secondary/10 border-secondary/20', label: 'CONNECTED' },
    connecting: { dot: 'bg-amber-400 animate-pulse', badge: 'text-amber-400 bg-amber-400/10 border-amber-400/20', label: 'CONNECTING' },
    error: { dot: 'bg-red-500', badge: 'text-red-500 bg-red-500/10 border-red-500/20', label: 'ERROR' },
    ready: { dot: 'bg-cyan-400', badge: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20', label: 'READY' },
    disconnected: { dot: 'bg-tertiary animate-pulse', badge: 'text-tertiary bg-tertiary/10 border-tertiary/20', label: 'DISCONNECTED' },
  };
  const cfg = statusConfig[status || ''] || statusConfig.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function SvmsServerDetail({ srv, devices }: { srv: ServerData; devices?: DeviceData }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{srv.server_name || srv.id}</h3>
      <div className="mb-3"><StatusBadge status={srv.connectionStatus} /></div>
      <InfoRow label={t('app.monitor.server_id')} value={srv.id} mono />
      <InfoRow label={t('app.monitor.serial')} value={srv.serial} mono />
      <InfoRow label={t('app.monitor.server_ip')} value={srv.svms_ipv4_ip || srv.server_ip} mono />
      <InfoRow label={t('app.monitor.sender_ip')} value={srv.sender_ip} mono />
      <InfoRow label={t('app.monitor.version')} value={srv.version} />
      <InfoRow label={t('app.monitor.location')} value={srv.location} />
      <InfoRow label={t('app.monitor.type')} value={srv.type || 'direct'} />
      <InfoRow label={t('app.monitor.device_count')} value={devices?.devices?.length ?? 0} />
      <InfoRow label={t('app.monitor.last_seen')} value={formatDate(srv.lastSeen)} />
    </div>
  );
}

function SvmsDeviceDetail({ dev, srv }: { dev: any; srv: ServerData }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{dev.name}</h3>
      <div className="mb-3"><StatusBadge status={dev.connectionStatus} /></div>
      <InfoRow label={t('app.monitor.device_ip')} value={dev.ip} mono />
      <InfoRow label={t('app.monitor.device_type')} value={dev.type} />
      <InfoRow label={t('app.monitor.device_index')} value={dev.index} />
      <InfoRow label={t('app.monitor.port')} value={dev.device_port} mono />
      <InfoRow label={t('app.monitor.last_log')} value={dev.lastLogReceived} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10">
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">{t('app.monitor.parent_server')}</span>
        <InfoRow label={t('app.monitor.server_name')} value={srv.server_name || srv.id} />
        <InfoRow label={t('app.monitor.server_ip')} value={srv.svms_ipv4_ip || srv.server_ip} mono />
      </div>
    </div>
  );
}

function MqttServerDetail({ srv, devices, allCameras, onLinkMqttServerCamera }: { srv: MqttServerConfig; devices: MqttDeviceInfo[]; allCameras: MqttDeviceConfig[]; onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void; }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{srv.name || `${srv.brokerHost}:${srv.brokerPort}`}</h3>
      <div className="mb-3"><StatusBadge status={srv.status} /></div>
      <InfoRow label={t('app.monitor.server_id')} value={srv.id} mono />
      <InfoRow label={t('app.monitor.protocol')} value={srv.protocol} />
      <InfoRow label={t('app.monitor.topic')} value={srv.topic || srv.defaultTopic} mono />
      <InfoRow label={t('app.monitor.log_count')} value={srv.logCount ?? 0} />
      <InfoRow label={t('app.monitor.camera_id')} value={srv.cameraId || '(none)'} mono />
      <InfoRow label={t('app.monitor.devices_seen')} value={devices.length} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center gap-3">
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest shrink-0">📷 {t('app.monitor.bound_camera') || 'Bound Camera'}</span>
        <select
          value={srv.cameraId || ''}
          onChange={(e) => onLinkMqttServerCamera(srv.id, e.target.value || null)}
          className="flex-1 text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:outline-none focus:border-cyan-500/50 transition-colors"
        >
          <option value="">{t('app.monitor.no_camera_disabled')}</option>
          {allCameras.map(cam => (
            <option key={cam.id} value={cam.id}>{(cam as any).name || `${cam.type.toUpperCase()} - ${cam.cameraIp}:${cam.cameraPort}`}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const RADAR_CATEGORIES = [
  {
    id: 'fall_bed',
    label: 'Phát hiện Té ngã & Giường ngủ',
    colorClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/5 border-cyan-500/10',
    indicatorColor: 'bg-cyan-400',
    subEvents: [
      { code: 'fall', label: 'Phát hiện té ngã (Fall Alarm)' },
      { code: 'out_of_bed', label: 'Rời khỏi giường (Out of Bed Alarm)' },
      { code: 'lying', label: 'Trạng thái đang nằm (Lying State)' },
    ],
  },
  {
    id: 'presence',
    label: 'Hiện diện & Lưu trú',
    colorClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/5 border-cyan-500/10',
    indicatorColor: 'bg-cyan-400',
    subEvents: [
      { code: 'occupied', label: 'Phát hiện có người (Occupied)' },
      { code: 'vacant', label: 'Trạng thái phòng trống (Vacant)' },
      { code: 'dwell', label: 'Ở lại quá lâu (Dwell / Stay Alarm)' },
    ],
  },
  {
    id: 'respiration',
    label: 'Hô hấp & Vận động',
    colorClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/5 border-cyan-500/10',
    indicatorColor: 'bg-cyan-400',
    subEvents: [
      { code: 'bradynea', label: 'Thở chậm bất thường (Bradynea Alarm)' },
      { code: 'tachypnea', label: 'Thở nhanh bất thường (Tachypnea Alarm)' },
      { code: 'motionless', label: 'Bất động bất thường (Abnormal Static Alarm)' },
    ],
  },
];

function MqttDeviceDetail({ dev, srv, allCameras, deviceCameraLinks, onLinkDeviceCamera }: { dev: MqttDeviceInfo; srv: MqttServerConfig; allCameras: MqttDeviceConfig[]; deviceCameraLinks: DeviceCameraLink[]; onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void; }) {
  const { t } = useTranslation();
  const link = deviceCameraLinks.find(l => l.devEui === dev.devEui && l.mqttServerId === srv.id);

  const parentCamera = srv.cameraId ? allCameras.find(c => c.id === srv.cameraId) : null;
  const parentCameraName = parentCamera ? ((parentCamera as any).name || `${parentCamera.type.toUpperCase()} - ${parentCamera.cameraIp}:${parentCamera.cameraPort}`) : '';

  const features = (link as any)?.features || {};

  const handleToggle = (code: string, value: boolean) => {
    socket.emit('update-device-features', {
      devEui: dev.devEui,
      mqttServerId: srv.id,
      features: { [code]: value }
    });
  };

  const totalEnabled = RADAR_CATEGORIES.reduce((acc, cat) => {
    return acc + cat.subEvents.filter(sub => features[sub.code] ?? true).length;
  }, 0);
  const totalEvents = RADAR_CATEGORIES.reduce((acc, cat) => acc + cat.subEvents.length, 0);

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{dev.deviceName}</h3>
      <InfoRow label={t('app.monitor.dev_eui')} value={dev.devEui} mono />
      <InfoRow label={t('app.monitor.profile')} value={dev.deviceProfileName} />
      <InfoRow label={t('app.monitor.alarm_count')} value={dev.alarmCount} />
      <InfoRow label={t('app.monitor.last_seen')} value={formatDate(dev.lastSeen)} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10">
        <InfoRow label={t('app.monitor.parent_mqtt')} value={srv.name || `${srv.brokerHost}:${srv.brokerPort}`} mono />
        <InfoRow label={t('app.monitor.topic')} value={srv.topic || srv.defaultTopic} mono />
      </div>
      <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center gap-3">
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest shrink-0">📷 {t('app.monitor.bound_camera') || 'Bound Camera'}</span>
        <select
          value={link?.cameraId || ''}
          onChange={(e) => onLinkDeviceCamera(dev.devEui, srv.id, e.target.value || null)}
          className="flex-1 text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:outline-none focus:border-cyan-500/50 transition-colors"
        >
          <option value="">
            {parentCameraName
              ? `-- Kế thừa từ Server (${parentCameraName}) --`
              : '-- Kế thừa từ Server (Chưa liên kết Camera) --'}
          </option>
          <option value="none">-- Không có Camera (Không chụp ảnh) --</option>
          {allCameras.map(cam => (
            <option key={cam.id} value={cam.id}>{(cam as any).name || `${cam.type.toUpperCase()} - ${cam.cameraIp}:${cam.cameraPort}`}</option>
          ))}
        </select>
      </div>

      <div className="mt-5 pt-4 border-t border-outline-variant/10">
        {/* Section title */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant">
            🎛 Event Filter — MQTT Radar
          </span>
          <span className="text-[8px] font-mono text-on-surface-variant/40 bg-surface-container px-1.5 py-0.5 rounded">
            {totalEnabled}/{totalEvents} bật
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {RADAR_CATEGORIES.map((cat) => (
            <div key={cat.id} className={`rounded-md border p-3 ${cat.bgClass}`}>
              {/* Category Header */}
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-outline-variant/5">
                <span className={`w-1.5 h-1.5 rounded-full ${cat.indicatorColor}`} />
                <span className={`text-[11px] font-bold uppercase tracking-wider ${cat.colorClass}`}>
                  {cat.label}
                </span>
              </div>

              {/* Individual sub-events list */}
              <div className="flex flex-col gap-2">
                {cat.subEvents.map((sub) => {
                  const enabled = features[sub.code] ?? true;

                  return (
                    <div
                      key={sub.code}
                      className="flex items-center justify-between gap-3 py-1 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-1 h-1 rounded-full shrink-0 ${enabled ? cat.indicatorColor : 'bg-on-surface-variant/30'}`} />
                        <span className={`text-[11px] font-medium leading-tight transition-colors duration-200 ${enabled ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
                          {sub.label}
                        </span>
                      </div>

                      {/* Enable toggle */}
                      <button
                        onClick={() => handleToggle(sub.code, !enabled)}
                        className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 border-0 p-0
                          ${enabled ? cat.indicatorColor : 'bg-surface-container-high'}`}
                        title={enabled ? 'Đang bật — Click để tắt' : 'Đang tắt — Click để bật'}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200
                            ${enabled ? 'left-[22px]' : 'left-0.5'}`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <p className="mt-3 text-[9px] text-on-surface-variant/40 leading-relaxed">
          💡 Click vào nút gạt bên phải của từng dòng để bật/tắt sự kiện báo động đó một cách độc lập.
        </p>
      </div>
    </div>
  );
}

// ── Sunell Sub-event definitions ─────────────────────────────────────────────
const SUNELL_SUBEVENTS: Record<string, { code: string; label: string }[]> = {
  enableMotion: [
    { code: '1/2', label: 'Phát hiện chuyển động (Motion detection)' },
    { code: '1/9', label: 'Phát hiện thân nhiệt PIR' },
  ],
  enableLPR: [
    { code: '6/37', label: 'Nhận diện biển số xe (LPR)' },
    { code: 'detect/lpr', label: 'Luồng AI nhận diện biển số (Stream)' },
  ],
  enableFace: [
    { code: 'detect/face', label: 'Phát hiện khuôn mặt qua luồng AI (Stream)' },
    { code: 'detect/person', label: 'Phát hiện người (Person detection)' },
  ],
  enableIVA: [
    { code: '6/21', label: 'Vượt hàng rào ảo (Trip Wire)' },
    { code: '6/22', label: 'Phát hiện đối tượng di chuyển (SMD)' },
    { code: '6/23', label: 'Camera bị che khuất (Occlusion)' },
    { code: '6/24', label: 'Xâm nhập vùng cấm (Perimeter Intrusion)' },
    { code: '6/25', label: 'Hàng rào ảo kép (Double Trip Wire)' },
    { code: '6/26', label: 'Lảng vảng (Loitering)' },
    { code: '6/27', label: 'Đám đông lảng vảng (Multi-person Loitering)' },
    { code: '6/28', label: 'Bỏ quên đồ vật (Object Left)' },
    { code: '6/29', label: 'Mất cắp đồ vật (Object Removed)' },
    { code: '6/30', label: 'Quá tốc độ (Abnormal Speed)' },
    { code: '6/31', label: 'Đi ngược chiều (Retrograde)' },
    { code: '6/32', label: 'Đậu xe trái phép (Illegal Parking)' },
    { code: '6/33', label: 'Camera bị dời góc (Camera Shift)' },
    { code: '6/34', label: 'Tín hiệu video bất thường (Video Signal Bad)' },
    { code: '9/50', label: 'CĐ thông minh - Không xác định (SMD Unknown)' },
    { code: '9/51', label: 'CĐ thông minh - Người (SMD Human)' },
    { code: '9/52', label: 'CĐ thông minh - Xe (SMD Vehicle)' },
    { code: '9/53', label: 'CĐ thông minh - Xe thô sơ (SMD Non-motor)' },
  ],
  enableSystem: [
    { code: '1/1', label: 'Báo động I/O' },
    { code: '1/3', label: 'Camera bị che khuất (Camera Blocking)' },
    { code: '1/4', label: 'Mất tín hiệu hình ảnh (Video Loss)' },
    { code: '1/5', label: 'Rớt mạng (Network Disconnection)' },
    { code: '1/10', label: 'Báo động cổng I/O NVR' },
    { code: '4/2', label: 'Lỗi đọc/ghi ổ cứng' },
    { code: '4/4', label: 'Ổ cứng đầy' },
    { code: '4/5', label: 'Không có ổ cứng' },
    { code: '5/2', label: 'Sai user/pass luồng dữ liệu' },
    { code: '5/4', label: 'Đạt giới hạn số lượng kết nối luồng' },
    { code: '7/0', label: 'Cảnh báo ngưỡng nhiệt độ (Thermal)' },
    { code: '7/1', label: 'Báo động vượt ngưỡng nhiệt độ (Thermal)' },
    { code: '7/4', label: 'Cảnh báo chênh lệch nhiệt (Thermal)' },
    { code: '7/5', label: 'Báo động chênh lệch nhiệt (Thermal)' },
    { code: '7/16', label: 'Phát hiện điểm cháy (Thermal)' },
    { code: '7/17', label: 'Phát hiện hút thuốc (Smoking)' },
    { code: '7/18', label: 'Phát hiện khói lửa (Smoke/Flame)' },
  ],
};

function CameraDetail({ cam }: { cam: MqttDeviceConfig }) {
  const { t } = useTranslation();
  const features = (cam as any).features || {};
  const [expandedSub, setExpandedSub] = useState<Record<string, boolean>>({});

  const handleToggle = (feature: 'enableMotion' | 'enableLPR' | 'enableFace' | 'enableIVA' | 'enableSystem', value: boolean) => {
    socket.emit('update-camera-features', {
      id: cam.id,
      features: { [feature]: value }
    });
  };

  const toggleSub = (key: string) =>
    setExpandedSub(p => ({ ...p, [key]: !p[key] }));

  const isSunell = cam.type === 'sunell';

  const featureList: {
    key: 'enableMotion' | 'enableLPR' | 'enableFace' | 'enableIVA' | 'enableSystem';
    label: string;
    color: string;
  }[] = [
      { key: 'enableMotion', label: 'Motion / Chuyển động', color: 'text-amber-400' },
      { key: 'enableLPR', label: 'LPR / Biển số xe', color: 'text-blue-400' },
      { key: 'enableFace', label: 'Face / Khuôn mặt', color: 'text-pink-400' },
      { key: 'enableIVA', label: 'IVA / Hành vi thông minh', color: 'text-purple-400' },
      { key: 'enableSystem', label: 'System / Hệ thống', color: 'text-red-400' },
    ];

  return (
    <div className="CameraDetail flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">
        {(cam as any).name || `Camera: ${cam.cameraIp}`}
      </h3>
      <div className="mb-3"><StatusBadge status={cam.status} /></div>
      <InfoRow label={t('app.monitor.camera_id')} value={cam.id} mono />
      <InfoRow label={t('app.monitor.camera_ip')} value={cam.cameraIp} mono />
      <InfoRow label={t('app.monitor.camera_port')} value={cam.cameraPort} mono />
      <InfoRow label={t('app.monitor.type')} value={cam.type} />
      <InfoRow label={t('app.monitor.username')} value={cam.cameraUser} />
      <InfoRow label={t('app.monitor.rtsp_url')} value={cam.rtspUrl || '(none)'} mono />
      <InfoRow label={t('app.monitor.handle')} value={cam.handle ?? '(none)'} />

      {isSunell && (
        <div className="mt-5 pt-4 border-t border-outline-variant/10">
          {/* Section title */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant">
              🎛 Event Filter — Sunell SDK
            </span>
            <span className="text-[8px] font-mono text-on-surface-variant/40 bg-surface-container px-1.5 py-0.5 rounded">
              {featureList.filter(f => features[f.key] ?? true).length}/{featureList.length} bật
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {featureList.map(({ key, label, color }) => {
              const enabled = features[key] ?? true;
              const subEvents = SUNELL_SUBEVENTS[key] || [];
              const subExpanded = !!expandedSub[key];

              return (
                <div
                  key={key}
                  className={`rounded-md border transition-all duration-200 overflow-hidden
                    ${enabled
                      ? 'border-outline-variant/20 bg-surface-container/40'
                      : 'border-outline-variant/10 bg-surface-container/10 opacity-60'
                    }`}
                >
                  {/* Category row */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleSub(key)}
                      className="shrink-0 p-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer"
                      title={subExpanded ? 'Thu gọn' : 'Xem sub-events'}
                    >
                      <ChevronRight
                        className={`w-3 h-3 text-on-surface-variant transition-transform duration-200 ${subExpanded ? 'rotate-90' : ''}`}
                      />
                    </button>

                    {/* Label */}
                    <button
                      onClick={() => toggleSub(key)}
                      className="flex-1 text-left cursor-pointer"
                    >
                      <span className={`text-[12px] font-semibold ${enabled ? color : 'text-on-surface-variant'}`}>
                        {label}
                      </span>
                      <span className="ml-2 text-[9px] font-mono text-on-surface-variant/40">
                        {subEvents.length} sub-events
                      </span>
                    </button>

                    {/* Enable toggle */}
                    <button
                      onClick={() => handleToggle(key, !enabled)}
                      className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0
                        ${enabled ? 'bg-primary' : 'bg-surface-container-high'}`}
                      title={enabled ? 'Đang bật — Click để tắt' : 'Đang tắt — Click để bật'}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200
                          ${enabled ? 'left-[22px]' : 'left-0.5'}`}
                      />
                    </button>
                  </div>

                  {/* Sub-event list */}
                  {subExpanded && subEvents.length > 0 && (
                    <div className={`border-t border-outline-variant/10 px-3 py-2 flex flex-col gap-0 ${!enabled ? 'opacity-50' : ''}`}>
                      {subEvents.map(sub => (
                        <div
                          key={sub.code}
                          className="flex items-start gap-2 py-1.5 border-b border-outline-variant/5 last:border-0"
                        >
                          <span className={`w-1 h-1 rounded-full shrink-0 mt-1.5 ${enabled ? color.replace('text-', 'bg-') : 'bg-on-surface-variant/30'}`} />
                          <span className="text-[11px] text-on-surface-variant leading-tight">
                            {sub.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <p className="mt-3 text-[9px] text-on-surface-variant/40 leading-relaxed">
            💡 Tắt category sẽ bỏ qua toàn bộ sub-events thuộc nhóm đó. Click ▶ để xem danh sách sub-event.
          </p>
        </div>
      )}
    </div>
  );
}
