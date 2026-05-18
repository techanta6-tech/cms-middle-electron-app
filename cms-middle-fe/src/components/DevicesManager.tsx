import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerData, DeviceData, MqttServerConfig, MQTT_Milesight_LogEntry, MqttDeviceConfig, DeviceCameraLink } from '../types';
import type { SvmsKnownEvent } from '../hooks/useSocketManager';
import {
  ChevronRight, ChevronDown, Plus, Cpu, Radio, Camera,
  Server, Wifi, WifiOff, MonitorSmartphone, Info, X, Trash2, Edit2
} from 'lucide-react';
import { CameraForm } from './CameraForm';
import { AddExternalServer } from './AddExternalServer';
import { socket } from '../socket';
import apiClient from '../api/apiClient';

const NOOP = () => { };

// ── Types ────────────────────────────────────────────────────────────────────
type SelectedItemType =
  | { kind: 'svms-server'; data: ServerData; devices?: DeviceData }
  | { kind: 'svms-device'; data: any; server: ServerData }
  | { kind: 'mqtt-server'; data: MqttServerConfig; mqttDevices: MQTT_Milesight_DeviceInfo[] }
  | { kind: 'mqtt-device'; data: MQTT_Milesight_DeviceInfo; server: MqttServerConfig }
  | { kind: 'camera'; data: MqttDeviceConfig };

interface MQTT_Milesight_DeviceInfo {
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
  mqttLogs: MQTT_Milesight_LogEntry[];
  cameraDevices: MqttDeviceConfig[];
  deviceCameraLinks: DeviceCameraLink[];
  onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void;
  onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void;
  fetchCameras: () => void;
  handleAddMqttServer: (config: MqttServerConfig) => void;
  handleAddExternalServer: (ip: string, port: string, mode: 'receive' | 'send') => void;
  svmsDeviceFeatures: { serverId: string; deviceIndex: string; features: Record<string, boolean> }[];
  svmsKnownEvents: SvmsKnownEvent[];
  milesightKnownEvents: any[];
  sunellKnownEvents: any[];
}

// ── Main Component ───────────────────────────────────────────────────────────
export function DevicesManager({
  servers, devices, mqttServers, mqttLogs, cameraDevices,
  deviceCameraLinks, onLinkDeviceCamera, onLinkMqttServerCamera,
  fetchCameras, handleAddMqttServer, handleAddExternalServer,
  svmsDeviceFeatures, svmsKnownEvents, milesightKnownEvents, sunellKnownEvents
}: DevicesManagerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SelectedItemType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    svms: true, mqtt: true, cameras: true, sunell: true
  });
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [addingForm, setAddingForm] = useState<'svms' | 'mqtt' | 'camera' | 'sunell_camera' | null>(null);
  const [editingMqtt, setEditingMqtt] = useState<MqttServerConfig | null>(null);
  const [editingCamera, setEditingCamera] = useState<any | null>(null);

  const toggleGroup = (key: string) =>
    setExpandedGroups(p => ({ ...p, [key]: !p[key] }));
  const toggleServer = (key: string) =>
    setExpandedServers(p => ({ ...p, [key]: !p[key] }));

  // Extract MQTT devices per server from logs
  const mqttDevicesByServer = useMemo(() => {
    const map: Record<string, MQTT_Milesight_DeviceInfo[]> = {};
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

  const handleSaveSvms = useCallback((ip: string, port: string, mode: 'receive' | 'send') => {
    handleAddExternalServer(ip, port, mode);
    setAddingForm(null);
  }, [handleAddExternalServer]);

  const handleSaveMqtt = useCallback((cfg: MqttServerConfig) => {
    handleAddMqttServer(cfg);
    setAddingForm(null);
  }, [handleAddMqttServer]);

  const handleCloseForm = useCallback(() => {
    setAddingForm(null);
  }, []);

  const handleSaveCameraSuccess = useCallback(() => {
    setAddingForm(null);
    fetchCameras();
  }, [fetchCameras]);

  return (
    <div className="DevicesManager flex-1 overflow-hidden flex flex-col h-full">
      {/* Add forms (modals) */}
      {addingForm === 'svms' && (
        <AddExternalServer
          onSave={handleSaveSvms}
          onSaveMqtt={NOOP}
          initialIp="192.168.1." initialPort="5050" initialMode="receive"
          onClose={handleCloseForm}
        />
      )}
      {addingForm === 'mqtt' && (
        <AddExternalServer
          onSave={NOOP}
          onSaveMqtt={handleSaveMqtt}
          initialIp="" initialPort="" initialMode="receive"
          initialConnectionType="mqtt"
          onClose={handleCloseForm}
        />
      )}
      {editingMqtt && (
        <AddExternalServer
          onSave={NOOP}
          onSaveMqtt={(cfg) => {
            handleSaveMqtt(cfg);
            setEditingMqtt(null);
          }}
          initialIp="" initialPort="" initialMode="receive"
          initialConnectionType="mqtt"
          mqttToEdit={editingMqtt}
          onClose={() => setEditingMqtt(null)}
        />
      )}
      {(addingForm === 'camera' || addingForm === 'sunell_camera') && (
        <CameraForm
          onCancel={handleCloseForm}
          onSuccess={handleSaveCameraSuccess}
          initialType={addingForm === 'sunell_camera' ? 'sunell' : 'other'}
        />
      )}
      {editingCamera && (
        <CameraForm
          onCancel={() => setEditingCamera(null)}
          onSuccess={() => {
            setEditingCamera(null);
            fetchCameras();
          }}
          initialType={editingCamera.type}
          cameraToEdit={editingCamera}
        />
      )}

      <div className="flex-1 overflow-hidden grid gap-0" style={{ gridTemplateColumns: '3fr 7fr' }}>
        {/* ── LEFT: Tree ────────────────────────────────────────────────── */}
        <div className="overflow-y-auto custom-scrollbar border-r border-outline-variant/10 bg-surface-container-lowest p-3 flex flex-col gap-1">

          {/* SVMS Servers */}
          <GroupHeader icon={<Cpu className="w-3.5 h-3.5" />} label={t('app.devices.svms_servers')} color="text-secondary" count={svmsServers.length}
            expanded={!!expandedGroups.svms} onToggle={() => toggleGroup('svms')}
          // onAdd={() => setAddingForm('svms')}
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
          <GroupHeader icon={<Radio className="w-3.5 h-3.5" />} label={t('app.devices.lora_server')} color="text-amber-400" count={mqttServers.length}
            expanded={!!expandedGroups.mqtt} onToggle={() => toggleGroup('mqtt')}
            onAdd={() => setAddingForm('mqtt')}
          />
          {expandedGroups.mqtt && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-amber-400/10 pl-2">
              {mqttServers.length === 0 && <EmptyHint text={t('app.devices.no_lora')} />}
              {mqttServers.map(ms => {
                const expanded = !!expandedServers[`mqtt-${ms.id}`];
                const mqttDevs = mqttDevicesByServer[ms.id] || [];
                return (
                  <div className='flex flex-col gap-1' key={ms.id}>
                    <TreeItem
                      label={ms.name || `${ms.brokerHost}:${ms.brokerPort}`}
                      sublabel={ms.name ? `${ms.protocol}://${ms.brokerHost}:${ms.brokerPort}` : (ms.topic || ms.defaultTopic || '')}
                      hasChildren={mqttDevs.length > 0}
                      expanded={expanded}
                      onToggle={() => toggleServer(`mqtt-${ms.id}`)}
                      onClick={() => setSelected({ kind: 'mqtt-server', data: ms, mqttDevices: mqttDevs })}
                      isSelected={selected?.kind === 'mqtt-server' && (selected.data as MqttServerConfig).id === ms.id}
                      status={ms.status === 'connected' ? 'connected' : ms.status === 'error' ? 'disconnected' : ms.status}
                      onEdit={() => setEditingMqtt(ms)}
                      onDelete={() => handleDeleteMqttServer(ms.id)}
                    />
                    {expanded && mqttDevs.map(d => (
                      <TreeItem key={d.devEui}
                        label={d.deviceName} sublabel={d.devEui} indent
                        icon={<MonitorSmartphone className="w-3 h-3 text-on-surface-variant/60" />}
                        onClick={() => setSelected({ kind: 'mqtt-device', data: d, server: ms })}
                        isSelected={selected?.kind === 'mqtt-device' && (selected.data as MQTT_Milesight_DeviceInfo).devEui === d.devEui}
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
                  onEdit={() => setEditingCamera(cam)}
                  onDelete={() => handleDeleteCamera(cam.id)}
                  draggable
                  dragData={cam.id}
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
                  onEdit={() => setEditingCamera(cam)}
                  onDelete={() => handleDeleteCamera(cam.id)}
                  draggable
                  dragData={cam.id}
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
            <DetailPanel
              item={selected}
              onClose={() => setSelected(null)}
              cameraDevices={cameraDevices}
              mqttServers={mqttServers}
              deviceCameraLinks={deviceCameraLinks}
              onLinkDeviceCamera={onLinkDeviceCamera}
              onLinkMqttServerCamera={onLinkMqttServerCamera}
              svmsDeviceFeatures={svmsDeviceFeatures}
              svmsKnownEvents={svmsKnownEvents}
              milesightKnownEvents={milesightKnownEvents}
              sunellKnownEvents={sunellKnownEvents}
              onEdit={(item) => {
                if (item.kind === 'mqtt-server') {
                  setEditingMqtt(item.data);
                } else if (item.kind === 'camera') {
                  setEditingCamera(item.data);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function GroupHeader({ icon, label, color, count, expanded, onToggle, onAdd }: {
  icon: React.ReactNode; label: string; color: string; count: number;
  expanded: boolean; onToggle: () => void; onAdd?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-2 mt-1 select-none">
      <button onClick={onToggle} className="flex items-center gap-2 flex-1 group cursor-pointer">
        <ChevronRight className={`w-3 h-3 text-on-surface-variant transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        <span className={`${color}`}>{icon}</span>
        <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{label}</span>
        <span className="text-[9px] font-mono text-on-surface-variant/50 bg-surface-container px-1.5 py-0.5 rounded">{count}</span>
      </button>
      {onAdd && (
        <button onClick={onAdd} className={`p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer ${color}`} title={`Add ${label}`}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function TreeItem({ label, sublabel, icon, hasChildren, expanded, onToggle, onClick, isSelected, indent, status, onDelete, onEdit, draggable, dragData }: {
  label: string; sublabel?: string; icon?: React.ReactNode;
  hasChildren?: boolean; expanded?: boolean; onToggle?: () => void;
  onClick: () => void; isSelected?: boolean; indent?: boolean;
  status?: string; onDelete?: () => void; onEdit?: () => void;
  draggable?: boolean; dragData?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all text-[11px] group
        ${indent ? 'ml-4' : ''}
        ${isSelected
          ? 'bg-primary/10 border border-primary/20 text-primary'
          : 'hover:bg-surface-container-high border border-transparent text-on-surface'}`}
      onClick={(e) => {
        e.stopPropagation();
        if (onToggle) {
          onToggle();
        } onClick();
      }}
      draggable={draggable}
      onDragStart={draggable && dragData ? (e) => {
        e.dataTransfer.setData('application/camera-id', dragData);
        e.dataTransfer.effectAllowed = 'link';
      } : undefined}
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
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span className="font-bold truncate leading-tight">{label}</span>
        {sublabel && <span className="text-[9px] font-mono text-on-surface-variant/50 truncate leading-tight">{sublabel}</span>}
      </div>
      {onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-primary/20 text-primary hover:text-primary/80 cursor-pointer"
          title="Sửa"
        >
          <Edit2 className="w-3 h-3" />
        </button>
      )}
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
function DetailPanel({ item, onClose, cameraDevices, mqttServers, deviceCameraLinks, onLinkDeviceCamera, onLinkMqttServerCamera, svmsDeviceFeatures, svmsKnownEvents, milesightKnownEvents, sunellKnownEvents, onEdit }: {
  item: SelectedItemType;
  onClose: () => void;
  cameraDevices: MqttDeviceConfig[];
  mqttServers: MqttServerConfig[];
  deviceCameraLinks: DeviceCameraLink[];
  onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void;
  onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void;
  svmsDeviceFeatures: { serverId: string; deviceIndex: string; features: Record<string, boolean> }[];
  svmsKnownEvents: SvmsKnownEvent[];
  milesightKnownEvents: any[];
  sunellKnownEvents: any[];
  onEdit?: (item: SelectedItemType) => void;
}) {
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
      {item.kind === 'svms-device' && <SvmsDeviceDetail dev={item.data} srv={item.server} svmsDeviceFeatures={svmsDeviceFeatures} svmsKnownEvents={svmsKnownEvents} />}
      {item.kind === 'mqtt-server' && latestMqttServer && <MqttServerDetail srv={latestMqttServer} devices={item.mqttDevices} allCameras={cameraDevices} onLinkMqttServerCamera={onLinkMqttServerCamera} onEdit={() => onEdit?.(item)} />}
      {item.kind === 'mqtt-device' && latestMqttDeviceServer && <MqttDeviceDetail dev={item.data} srv={latestMqttDeviceServer} allCameras={cameraDevices} deviceCameraLinks={deviceCameraLinks} onLinkDeviceCamera={onLinkDeviceCamera} milesightKnownEvents={milesightKnownEvents} />}
      {item.kind === 'camera' && latestCam && <CameraDetail cam={latestCam} sunellKnownEvents={sunellKnownEvents} onEdit={() => onEdit?.(item)} />}
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

function SvmsDeviceDetail({ dev, srv, svmsDeviceFeatures, svmsKnownEvents }: {
  dev: any;
  srv: ServerData;
  svmsDeviceFeatures: { serverId: string; deviceIndex: string; features: Record<string, boolean> }[];
  svmsKnownEvents: SvmsKnownEvent[];
}) {
  const { t, i18n } = useTranslation();
  const [showEventList, setShowEventList] = useState(true);

  // Build SVMS_EVENTS dynamically từ registry.
  // Label: thử i18n key "app.logtype.{type_với_underscore}", nếu không có → fallback đa ngôn ngữ.
  const SVMS_EVENTS = svmsKnownEvents.map(evt => {
    const i18nKey = `app.logtype.svms_${evt.event_type.replace(/\./g, '_')}`;
    const i18nLabel = t(i18nKey);
    const hasI18n = i18nLabel && i18nLabel !== i18nKey;
    const fallback = i18n.language.startsWith('vi') ? 'Thông báo từ SVMS' : 'SVMS Alert';
    const label = hasI18n ? i18nLabel : fallback;
    return { code: evt.event_type, label };
  });
  const OTHER_EVENTS_CODE = '__other_events__';

  const serverId = srv.id || srv.serial;
  const deviceIndex = String(dev.index);
  const featureEntry = svmsDeviceFeatures.find(
    e => e.serverId === serverId && e.deviceIndex === deviceIndex
  );
  const features = featureEntry?.features || {};

  // M\u1eb7c \u0111\u1ecbnh: \u0111\u1ecdc t\u1eeb default_enabled trong registry, kh\u00f4ng hardcode
  const getEnabled = (code: string) => {
    if (features[code] !== undefined) return !!features[code];
    if (code === '__other_events__') return true; // pseudo-event, lu\u00f4n m\u1eb7c \u0111\u1ecbnh b\u1eadt
    const registryEvt = svmsKnownEvents.find(e => e.event_type === code);
    return registryEvt?.default_enabled ?? false;
  };

  const handleToggle = (code: string, value: boolean) => {
    socket.emit('update-svms-device-features', {
      serverId,
      deviceIndex,
      features: { [code]: value }
    });
  };

  const otherEventsEnabled = getEnabled(OTHER_EVENTS_CODE);
  const enabledCount = SVMS_EVENTS.filter(e => getEnabled(e.code)).length + (otherEventsEnabled ? 1 : 0);
  const totalCount = SVMS_EVENTS.length + 1;

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

      <div className="mt-5 pt-4 border-t border-outline-variant/10">
        <button 
          onClick={() => setShowEventList(!showEventList)}
          className="flex items-center justify-between w-full mb-3 p-1 rounded-md transition-colors hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant">🎛 Event Filter</span>
            <span className="text-[8px] font-mono text-on-surface-variant/40 bg-surface-container px-1.5 py-0.5 rounded">
              {enabledCount}/{totalCount} {t('app.devices.radar_categories.enabled_count')}
            </span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-on-surface-variant/50 transition-transform duration-300 ${showEventList ? 'rotate-180' : ''}`} />
        </button>

        {showEventList && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex flex-col gap-1.5">
          {SVMS_EVENTS.map(evt => {
            const enabled = getEnabled(evt.code);
            return (
              <div key={evt.code} className="flex items-center justify-between gap-3 py-1.5 border-b border-outline-variant/5 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`w-1 h-1 rounded-full shrink-0 ${enabled ? 'bg-secondary' : 'bg-on-surface-variant/30'}`} />
                  <span className={`text-[11px] font-medium transition-colors duration-200 ${enabled ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
                    {evt.label}
                  </span>
                </div>
                <button
                  onClick={() => handleToggle(evt.code, !enabled)}
                  className={`flex items-center w-7 h-4 rounded-full transition-colors cursor-pointer shrink-0 border-0 px-0.5
                    ${enabled ? 'bg-secondary justify-end' : 'bg-surface-container-high justify-start opacity-50'}`}
                  title={enabled ? 'Đang bật — Click để tắt' : 'Đang tắt — Click để bật'}
                >
                  <span className="w-3.25 h-3.25 rounded-full bg-white shadow transition-all duration-200" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Other Events toggle */}
        <div className="mt-3 rounded-md border bg-surface-container/20 border-outline-variant/10 p-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              ✦ {t('app.devices.radar_categories.other_events') || 'Sự kiện khác'}
            </span>
            <span className="text-[9px] text-on-surface-variant/40 leading-relaxed">
              {t('app.devices.radar_categories.other_events_hint') || 'Nhận tất cả event không thuộc danh sách trên'}
            </span>
          </div>
          <button
            onClick={() => handleToggle(OTHER_EVENTS_CODE, !otherEventsEnabled)}
            className={`flex items-center w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 border-0 px-0.5
              ${otherEventsEnabled ? 'bg-secondary justify-end' : 'bg-surface-container-high justify-start opacity-50'}`}
            title={otherEventsEnabled ? 'Đang nhận sự kiện khác — Click để tắt' : 'Không nhận sự kiện khác — Click để bật'}
          >
            <span className="w-4 h-4 rounded-full bg-white shadow transition-all duration-200" />
          </button>
        </div>

        <p className="mt-3 text-[9px] text-on-surface-variant/40 leading-relaxed">
          {t('app.devices.radar_categories.hint')}
        </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MqttServerDetail({ srv, devices, allCameras, onLinkMqttServerCamera, onEdit }: { srv: MqttServerConfig; devices: MQTT_Milesight_DeviceInfo[]; allCameras: MqttDeviceConfig[]; onLinkMqttServerCamera: (serverId: string, cameraId: string | null) => void; onEdit?: () => void; }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-black text-on-surface">{srv.name || `${srv.brokerHost}:${srv.brokerPort}`}</h3>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-amber-400 border border-amber-400/20 hover:border-amber-400/50 bg-amber-400/5 hover:bg-amber-400/10 rounded-md transition-all cursor-pointer"
          >
            <Edit2 className="w-3.5 h-3.5" />
            {t('app.devices.edit') || 'Chỉnh sửa'}
          </button>
        )}
      </div>
      <div className="mb-3"><StatusBadge status={srv.status} /></div>
      <InfoRow label={t('app.monitor.server_id')} value={srv.id} mono />
      <InfoRow label={t('app.monitor.protocol')} value={srv.protocol} />
      <InfoRow label={t('app.monitor.topic')} value={srv.topic || srv.defaultTopic} mono />
      <InfoRow label={t('app.monitor.log_count')} value={srv.logCount ?? 0} />
      <InfoRow label={t('app.monitor.camera_id')} value={srv.cameraId || '(none)'} mono />
      <InfoRow label={t('app.monitor.devices_seen')} value={devices.length} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center gap-3">
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest shrink-0">{t('app.monitor.default_camera') || 'Bound Camera'}</span>
        <select
          value={srv.cameraId || ''}
          onChange={(e) => onLinkMqttServerCamera(srv.id, e.target.value || null)}
          className="flex-1 text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:outline-none focus:border-cyan-500/50 transition-colors"
        >
          <option value="">📷 {t('app.monitor.no_camera_disabled')}</option>
          {allCameras.map(cam => (
            <option key={cam.id} value={cam.id}>{(cam as any).name || `${cam.type.toUpperCase()} - ${cam.cameraIp}:${cam.cameraPort}`}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function MqttDeviceDetail({ dev, srv, allCameras, deviceCameraLinks, onLinkDeviceCamera, milesightKnownEvents }: { dev: MQTT_Milesight_DeviceInfo; srv: MqttServerConfig; allCameras: MqttDeviceConfig[]; deviceCameraLinks: DeviceCameraLink[]; onLinkDeviceCamera: (devEui: string, mqttServerId: string, cameraId: string | null) => void; milesightKnownEvents: any[]; }) {
  const { t, i18n } = useTranslation();
  const [dragOverCatId, setDragOverCatId] = useState<string | null>(null);
  const [showEventList, setShowEventList] = useState(true);

  const MILESIGHT_EVENTS = milesightKnownEvents.map(evt => {
    const i18nKey = `app.logtype.${evt.event_description || evt.event_type}`;
    const i18nLabel = t(i18nKey);
    const hasI18n = i18nLabel && i18nLabel !== i18nKey;
    const fallback = i18n.language.startsWith('vi') ? 'Thông báo MQTT' : 'MQTT Alert';
    const label = hasI18n ? i18nLabel : fallback;
    return { code: evt.event_type, label, defaultEnabled: evt.default_enabled };
  });

  const link = deviceCameraLinks.find(l => l.devEui === dev.devEui && l.mqttServerId === srv.id);

  const parentCamera = srv.cameraId ? allCameras.find(c => c.id === srv.cameraId) : null;
  const parentCameraName = parentCamera ? ((parentCamera as any).name || `${parentCamera.type.toUpperCase()} - ${parentCamera.cameraIp}:${parentCamera.cameraPort}`) : '';

  const features = (link as any)?.features || {};

  // Normalize feature: hỗ trợ cả boolean cũ và object { enabled, cameraId } mới
  const getFeature = (code: string): { enabled: boolean; cameraId: string | null } => {
    const raw = features[code];
    const registryEvt = MILESIGHT_EVENTS.find(e => e.code === code);
    const defaultEnabled = registryEvt?.defaultEnabled ?? false;

    if (raw === undefined || raw === null) return { enabled: defaultEnabled, cameraId: null };
    if (typeof raw === 'boolean') return { enabled: raw, cameraId: null };
    return { enabled: (raw as any).enabled ?? defaultEnabled, cameraId: (raw as any).cameraId || null };
  };

  const OTHER_EVENTS_CODE = '__other_events__';
  const otherEventsEnabled = getFeature(OTHER_EVENTS_CODE).enabled;

  const handleToggle = (code: string, value: boolean) => {
    socket.emit('update-device-features', {
      devEui: dev.devEui,
      mqttServerId: srv.id,
      features: { [code]: { enabled: value } }
    });
  };

  const handleEventCamera = (code: string, cameraId: string | null) => {
    socket.emit('update-device-features', {
      devEui: dev.devEui,
      mqttServerId: srv.id,
      features: { [code]: { cameraId } }
    });
  };

  const totalEnabled = MILESIGHT_EVENTS.filter(e => getFeature(e.code).enabled).length + (otherEventsEnabled ? 1 : 0);
  const totalEvents = MILESIGHT_EVENTS.length + 1; // +1 cho Sự kiện khác

  const activeCameraId = link?.cameraId === 'none' ? null : (link?.cameraId || srv.cameraId);
  const activeCamera = activeCameraId ? allCameras.find(c => c.id === activeCameraId) : null;
  const activeCameraName = activeCamera
    ? ((activeCamera as any).name || `${activeCamera.type.toUpperCase()} - ${activeCamera.cameraIp}:${activeCamera.cameraPort}`)
    : t('app.devices.radar_categories.unassigned');
  const isInherited = activeCameraId && activeCameraId === srv.cameraId && (!link || !link.cameraId);

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{dev.deviceName}</h3>
      <InfoRow label={t('app.monitor.dev_eui')} value={dev.devEui} mono />
      <InfoRow label={t('app.monitor.profile')} value={dev.deviceProfileName} />
      <InfoRow label={t('app.monitor.alarm_count')} value={dev.alarmCount} />
      <InfoRow label={t('app.monitor.last_seen')} value={formatDate(dev.lastSeen)} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10">
        <InfoRow label={t('app.monitor.mqtt_ip')} value={srv.name || `${srv.brokerHost}:${srv.brokerPort}`} mono />
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
              ? t('app.monitor.camera_default_linked', { name: parentCameraName })
              : t('app.monitor.camera_default_unlinked')}
          </option>
          <option value="none">{t('app.monitor.no_camera_no_snapshot')}</option>
          {allCameras.map(cam => (
            <option key={cam.id} value={cam.id}>{(cam as any).name || `${cam.type.toUpperCase()} - ${cam.cameraIp}:${cam.cameraPort}`}</option>
          ))}
        </select>
      </div>

      <div className="mt-5 pt-4 border-t border-outline-variant/10">
        {/* Section title */}
        <button
          onClick={() => setShowEventList(!showEventList)}
          className="flex items-center justify-between w-full mb-3 p-1 rounded-md transition-colors hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant">
              🎛 Event
            </span>
            <span className="text-[8px] font-mono text-on-surface-variant/40 bg-surface-container px-1.5 py-0.5 rounded">
              {totalEnabled}/{totalEvents} {t('app.devices.radar_categories.enabled_count')}
            </span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-on-surface-variant/50 transition-transform duration-300 ${showEventList ? 'rotate-180' : ''}`} />
        </button>

        {showEventList && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex flex-col gap-1.5">
          {MILESIGHT_EVENTS.map((evt) => {
            const feat = getFeature(evt.code);
            const enabled = feat.enabled;

            return (
              <div
                key={evt.code}
                className="flex flex-col gap-1.5 py-1.5 border-b border-outline-variant/5 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 grow">
                    <span className={`w-1 h-1 rounded-full shrink-0 ${enabled ? 'bg-cyan-400' : 'bg-on-surface-variant/30'}`} />
                    <span className={`text-[11px] font-medium leading-tight transition-colors duration-200 ${enabled ? 'text-on-surface' : 'text-on-surface-variant/40'} min-w-[18%]`}>
                      {evt.label}
                    </span>
                    {/* Per-event camera selector — chỉ hiện khi event đang bật */}
                    <div className="ml-3 flex items-center gap-2">
                      <select
                        disabled={!enabled}
                        value={feat.cameraId || ''}
                        onChange={(e) => handleEventCamera(evt.code, e.target.value || null)}
                        className={`
                          ${!enabled && 'opacity-[50%]'}
                          transition-opacity duration-200
                          flex-1 text-[10px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1 text-on-surface focus:outline-none focus:border-cyan-500/50 transition-colors`}
                      >
                        <option value="">{t('app.monitor.camera_default')}</option>
                        {allCameras.map(cam => (
                          <option key={cam.id} value={cam.id}>{(cam as any).name || `${cam.type.toUpperCase()} - ${cam.cameraIp}:${cam.cameraPort}`}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Enable toggle */}
                  <button
                    onClick={() => handleToggle(evt.code, !enabled)}
                    className={`flex items-center w-7 h-4 rounded-full transition-colors transition-opacity cursor-pointer shrink-0 border-0 px-0.5
                      ${enabled ? 'bg-cyan-400 justify-end' : 'bg-surface-container-high justify-start opacity-50'}`}
                    title={enabled ? 'Đang bật — Click để tắt' : 'Đang tắt — Click để bật'}
                  >
                    <span
                      className="w-3.25 h-3.25 rounded-full bg-white shadow transition-all duration-200"
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Other Events toggle */}
        <div className="mt-3 rounded-md border bg-surface-container/20 border-outline-variant/10 p-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              ✦ {t('app.devices.radar_categories.other_events') || 'Sự kiện khác'}
            </span>
            <span className="text-[9px] text-on-surface-variant/40 leading-relaxed">
              {t('app.devices.radar_categories.other_events_hint') || 'Nhận tất cả event không nằm trong danh sách trên'}
            </span>
          </div>
          <button
            onClick={() => handleToggle(OTHER_EVENTS_CODE, !otherEventsEnabled)}
            className={`flex items-center w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 border-0 px-0.5
              ${otherEventsEnabled ? 'bg-cyan-400 justify-end' : 'bg-surface-container-high justify-start opacity-50'}`}
            title={otherEventsEnabled ? 'Đang nhận sự kiện khác — Click để tắt' : 'Không nhận sự kiện khác — Click để bật'}
          >
            <span className="w-4 h-4 rounded-full bg-white shadow transition-all duration-200" />
          </button>
        </div>

        {/* Footer hint */}
        <p className="mt-3 text-[9px] text-on-surface-variant/40 leading-relaxed">
          {t('app.devices.radar_categories.hint')}
        </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Camera Detail ────────────────────────────────────────────────────────────

function CameraDetail({ cam, sunellKnownEvents, onEdit }: { cam: MqttDeviceConfig; sunellKnownEvents: any[]; onEdit?: () => void }) {
  const { t, i18n } = useTranslation();
  const [showEventList, setShowEventList] = useState(true);
  const features = (cam as any).features || {};

  const handleToggle = (code: string, value: boolean) => {
    socket.emit('update-camera-features', {
      id: cam.id,
      features: { [code]: value }
    });
  };

  const isSunell = cam.type === 'sunell';

  const SUNELL_EVENTS = sunellKnownEvents.map(evt => {
    const i18nKey = `app.logtype.${evt.event_description || evt.event_type}`;
    const i18nLabel = t(i18nKey);
    const hasI18n = i18nLabel && i18nLabel !== i18nKey;
    const fallback = i18n.language.startsWith('vi') ? 'Thông báo Sunell' : 'Sunell Alert';
    const label = hasI18n ? i18nLabel : fallback;
    return { code: evt.event_type, label, defaultEnabled: evt.default_enabled };
  });

  const getEnabled = (code: string) => {
    if (features[code] !== undefined) return !!features[code];
    const registryEvt = sunellKnownEvents.find(e => e.event_type === code);
    return registryEvt?.default_enabled ?? false;
  };

  const enabledCount = SUNELL_EVENTS.filter(e => getEnabled(e.code)).length;
  const totalCount = SUNELL_EVENTS.length;

  return (
    <div className="CameraDetail flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-black text-on-surface">
          {(cam as any).name || `Camera: ${cam.cameraIp}`}
        </h3>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-cyan-400 border border-cyan-400/20 hover:border-cyan-400/50 bg-cyan-400/5 hover:bg-cyan-400/10 rounded-md transition-all cursor-pointer"
          >
            <Edit2 className="w-3.5 h-3.5" />
            {t('app.devices.edit') || 'Chỉnh sửa'}
          </button>
        )}
      </div>
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
          <button
            onClick={() => setShowEventList(!showEventList)}
            className="flex items-center justify-between w-full mb-3 p-1 rounded-md transition-colors hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant">
                🎛 Event Filter — Sunell SDK
              </span>
              <span className="text-[8px] font-mono text-on-surface-variant/40 bg-surface-container px-1.5 py-0.5 rounded">
                {enabledCount}/{totalCount} {t('app.devices.radar_categories.enabled_count')}
              </span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-on-surface-variant/50 transition-transform duration-300 ${showEventList ? 'rotate-180' : ''}`} />
          </button>

          {showEventList && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex flex-col gap-1.5">
            {SUNELL_EVENTS.map(evt => {
              const enabled = getEnabled(evt.code);
              return (
                <div key={evt.code} className="flex items-center justify-between gap-3 py-1.5 border-b border-outline-variant/5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-1 h-1 rounded-full shrink-0 ${enabled ? 'bg-green-500' : 'bg-on-surface-variant/30'}`} />
                    <span className={`text-[11px] font-medium transition-colors duration-200 ${enabled ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
                      {evt.label}
                    </span>
                  </div>
                  <button
                    onClick={() => handleToggle(evt.code, !enabled)}
                    className={`flex items-center w-7 h-4 rounded-full transition-colors cursor-pointer shrink-0 border-0 px-0.5
                      ${enabled ? 'bg-green-500 justify-end' : 'bg-surface-container-high justify-start opacity-50'}`}
                    title={enabled ? 'Đang bật — Click để tắt' : 'Đang tắt — Click để bật'}
                  >
                    <span className="w-3.25 h-3.25 rounded-full bg-white shadow transition-all duration-200" />
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[9px] text-on-surface-variant/40 leading-relaxed">
            {t('app.devices.sunell_categories.hint')}
          </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
