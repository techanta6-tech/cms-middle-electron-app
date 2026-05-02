import { useState, useMemo } from 'react';
import type { ServerData, DeviceData, MqttServerConfig, MqttLogEntry, MqttDeviceConfig } from '../types';
import {
  ChevronRight, ChevronDown, Plus, Cpu, Radio, Camera,
  Server, Wifi, WifiOff, MonitorSmartphone, Info, X
} from 'lucide-react';
import { CameraForm } from './CameraForm';
import { AddExternalServer } from './AddExternalServer';

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
  fetchCameras: () => void;
  handleAddMqttServer: (config: MqttServerConfig) => void;
  handleAddExternalServer: (ip: string, port: string, mode: 'receive' | 'send') => void;
}

// ── Main Component ───────────────────────────────────────────────────────────
export function DevicesManager({
  servers, devices, mqttServers, mqttLogs, cameraDevices,
  fetchCameras, handleAddMqttServer, handleAddExternalServer
}: DevicesManagerProps) {
  const [selected, setSelected] = useState<SelectedItemType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    svms: true, mqtt: true, cameras: true
  });
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [addingForm, setAddingForm] = useState<'svms' | 'mqtt' | 'camera' | null>(null);

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

  return (
    <div className="DevicesManager flex-1 overflow-hidden flex flex-col h-full">
      {/* Add forms (modals) */}
      {addingForm === 'svms' && (
        <AddExternalServer
          onSave={(ip, port, mode) => { handleAddExternalServer(ip, port, mode); setAddingForm(null); }}
          onSaveMqtt={() => {}}
          initialIp="192.168.1." initialPort="5050" initialMode="receive"
          onClose={() => setAddingForm(null)}
        />
      )}
      {addingForm === 'mqtt' && (
        <AddExternalServer
          onSave={() => {}}
          onSaveMqtt={(cfg) => { handleAddMqttServer(cfg); setAddingForm(null); }}
          initialIp="" initialPort="" initialMode="receive"
          onClose={() => setAddingForm(null)}
        />
      )}

      <div className="flex-1 overflow-hidden grid gap-0" style={{ gridTemplateColumns: '3fr 7fr' }}>
        {/* ── LEFT: Tree ────────────────────────────────────────────────── */}
        <div className="overflow-y-auto custom-scrollbar border-r border-outline-variant/10 bg-surface-container-lowest p-3 flex flex-col gap-1">

          {/* SVMS Servers */}
          <GroupHeader icon={<Cpu className="w-3.5 h-3.5" />} label="SVMS Servers" color="text-secondary" count={svmsServers.length}
            expanded={!!expandedGroups.svms} onToggle={() => toggleGroup('svms')}
            onAdd={() => setAddingForm('svms')}
          />
          {expandedGroups.svms && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-secondary/10 pl-2">
              {svmsServers.length === 0 && <EmptyHint text="No SVMS servers" />}
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
          <GroupHeader icon={<Radio className="w-3.5 h-3.5" />} label="MQTT Servers" color="text-amber-400" count={mqttServers.length}
            expanded={!!expandedGroups.mqtt} onToggle={() => toggleGroup('mqtt')}
            onAdd={() => setAddingForm('mqtt')}
          />
          {expandedGroups.mqtt && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-amber-400/10 pl-2">
              {mqttServers.length === 0 && <EmptyHint text="No MQTT servers" />}
              {mqttServers.map(ms => {
                const expanded = !!expandedServers[`mqtt-${ms.id}`];
                const mqttDevs = mqttDevicesByServer[ms.id] || [];
                return (
                  <div key={ms.id}>
                    <TreeItem
                      label={`${ms.brokerHost}:${ms.brokerPort}`}
                      sublabel={ms.topic || ms.defaultTopic || ''}
                      hasChildren={mqttDevs.length > 0}
                      expanded={expanded}
                      onToggle={() => toggleServer(`mqtt-${ms.id}`)}
                      onClick={() => setSelected({ kind: 'mqtt-server', data: ms, mqttDevices: mqttDevs })}
                      isSelected={selected?.kind === 'mqtt-server' && (selected.data as MqttServerConfig).id === ms.id}
                      status={ms.status === 'connected' ? 'connected' : ms.status === 'error' ? 'disconnected' : ms.status}
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

          {/* Independent Cameras */}
          <GroupHeader icon={<Camera className="w-3.5 h-3.5" />} label="Independent Cameras" color="text-cyan-500" count={cameraDevices.length}
            expanded={!!expandedGroups.cameras} onToggle={() => toggleGroup('cameras')}
            onAdd={() => setAddingForm('camera')}
          />
          {expandedGroups.cameras && (
            <div className="flex flex-col gap-0.5 ml-2 border-l-2 border-cyan-500/10 pl-2">
              {cameraDevices.length === 0 && <EmptyHint text="No cameras" />}
              {cameraDevices.map(cam => (
                <TreeItem key={cam.id}
                  label={`Camera: ${cam.cameraIp}`}
                  sublabel={cam.id}
                  onClick={() => setSelected({ kind: 'camera', data: cam })}
                  isSelected={selected?.kind === 'camera' && (selected.data as MqttDeviceConfig).id === cam.id}
                  status={cam.status === 'connected' ? 'connected' : 'disconnected'}
                />
              ))}
              {/* Inline camera form */}
              {addingForm === 'camera' && (
                <CameraForm onCancel={() => setAddingForm(null)} onSuccess={() => { setAddingForm(null); fetchCameras(); }} />
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Detail ─────────────────────────────────────────────── */}
        <div className="overflow-y-auto custom-scrollbar bg-background p-6">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center opacity-25 gap-3">
              <Info className="w-10 h-10" />
              <span className="text-[11px] uppercase font-bold tracking-widest">Select a device or server to view details</span>
            </div>
          ) : (
            <DetailPanel item={selected} onClose={() => setSelected(null)} />
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

function TreeItem({ label, sublabel, icon, hasChildren, expanded, onToggle, onClick, isSelected, indent, status }: {
  label: string; sublabel?: string; icon?: React.ReactNode;
  hasChildren?: boolean; expanded?: boolean; onToggle?: () => void;
  onClick: () => void; isSelected?: boolean; indent?: boolean;
  status?: string;
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
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'connected' ? 'bg-secondary' : 'bg-tertiary animate-pulse'}`} />
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-bold truncate leading-tight">{label}</span>
        {sublabel && <span className="text-[9px] font-mono text-on-surface-variant/50 truncate leading-tight">{sublabel}</span>}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 text-[9px] text-on-surface-variant/40 uppercase tracking-widest font-bold">{text}</div>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({ item, onClose }: { item: SelectedItemType; onClose: () => void }) {
  const titleMap = {
    'svms-server': 'SVMS Server',
    'svms-device': 'SVMS Device',
    'mqtt-server': 'MQTT Server',
    'mqtt-device': 'MQTT Device',
    'camera': 'Camera Device',
  };

  const colorMap = {
    'svms-server': 'text-secondary border-secondary/30',
    'svms-device': 'text-secondary border-secondary/30',
    'mqtt-server': 'text-amber-400 border-amber-400/30',
    'mqtt-device': 'text-amber-400 border-amber-400/30',
    'camera': 'text-cyan-500 border-cyan-500/30',
  };

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${colorMap[item.kind]}`}>
            {titleMap[item.kind]}
          </span>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-surface-container-high rounded-md transition-colors cursor-pointer text-on-surface-variant">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {item.kind === 'svms-server' && <SvmsServerDetail srv={item.data} devices={item.devices} />}
      {item.kind === 'svms-device' && <SvmsDeviceDetail dev={item.data} srv={item.server} />}
      {item.kind === 'mqtt-server' && <MqttServerDetail srv={item.data} devices={item.mqttDevices} />}
      {item.kind === 'mqtt-device' && <MqttDeviceDetail dev={item.data} srv={item.server} />}
      {item.kind === 'camera' && <CameraDetail cam={item.data} />}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | number | undefined; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-outline-variant/5">
      <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest min-w-[120px] shrink-0 pt-0.5">{label}</span>
      <span className={`text-[12px] text-on-surface break-all ${mono ? 'font-mono' : 'font-medium'}`}>{value ?? '—'}</span>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const isOn = status === 'connected';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border ${isOn ? 'text-secondary bg-secondary/10 border-secondary/20' : 'text-tertiary bg-tertiary/10 border-tertiary/20'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isOn ? 'bg-secondary' : 'bg-tertiary animate-pulse'}`} />
      {status || 'unknown'}
    </span>
  );
}

function SvmsServerDetail({ srv, devices }: { srv: ServerData; devices?: DeviceData }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{srv.server_name || srv.id}</h3>
      <div className="mb-3"><StatusBadge status={srv.connectionStatus} /></div>
      <InfoRow label="Server ID" value={srv.id} mono />
      <InfoRow label="Serial" value={srv.serial} mono />
      <InfoRow label="Server IP" value={srv.svms_ipv4_ip || srv.server_ip} mono />
      <InfoRow label="Sender IP" value={srv.sender_ip} mono />
      <InfoRow label="Version" value={srv.version} />
      <InfoRow label="Location" value={srv.location} />
      <InfoRow label="Type" value={srv.type || 'direct'} />
      <InfoRow label="Device Count" value={devices?.devices?.length ?? 0} />
      <InfoRow label="Last Seen" value={srv.lastSeen} />
    </div>
  );
}

function SvmsDeviceDetail({ dev, srv }: { dev: any; srv: ServerData }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{dev.name}</h3>
      <div className="mb-3"><StatusBadge status={dev.connectionStatus} /></div>
      <InfoRow label="Device IP" value={dev.ip} mono />
      <InfoRow label="Device Type" value={dev.type} />
      <InfoRow label="Device Index" value={dev.index} />
      <InfoRow label="Port" value={dev.device_port} mono />
      <InfoRow label="Last Log" value={dev.lastLogReceived} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10">
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Parent Server</span>
        <InfoRow label="Server Name" value={srv.server_name || srv.id} />
        <InfoRow label="Server IP" value={srv.svms_ipv4_ip || srv.server_ip} mono />
      </div>
    </div>
  );
}

function MqttServerDetail({ srv, devices }: { srv: MqttServerConfig; devices: MqttDeviceInfo[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{srv.brokerHost}:{srv.brokerPort}</h3>
      <div className="mb-3"><StatusBadge status={srv.status} /></div>
      <InfoRow label="Server ID" value={srv.id} mono />
      <InfoRow label="Protocol" value={srv.protocol} />
      <InfoRow label="Topic" value={srv.topic || srv.defaultTopic} mono />
      <InfoRow label="Log Count" value={srv.logCount ?? 0} />
      <InfoRow label="Camera ID" value={srv.cameraId || '(none)'} mono />
      <InfoRow label="Devices Seen" value={devices.length} />
    </div>
  );
}

function MqttDeviceDetail({ dev, srv }: { dev: MqttDeviceInfo; srv: MqttServerConfig }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">{dev.deviceName}</h3>
      <InfoRow label="Dev EUI" value={dev.devEui} mono />
      <InfoRow label="Profile" value={dev.deviceProfileName} />
      <InfoRow label="Alarm Count" value={dev.alarmCount} />
      <InfoRow label="Last Seen" value={dev.lastSeen} />
      <div className="mt-4 pt-3 border-t border-outline-variant/10">
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Parent MQTT Server</span>
        <InfoRow label="Broker" value={`${srv.brokerHost}:${srv.brokerPort}`} mono />
        <InfoRow label="Topic" value={srv.topic || srv.defaultTopic} mono />
      </div>
    </div>
  );
}

function CameraDetail({ cam }: { cam: MqttDeviceConfig }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-black text-on-surface mb-2">Camera: {cam.cameraIp}</h3>
      <div className="mb-3"><StatusBadge status={cam.status} /></div>
      <InfoRow label="Camera ID" value={cam.id} mono />
      <InfoRow label="Camera IP" value={cam.cameraIp} mono />
      <InfoRow label="Camera Port" value={cam.cameraPort} mono />
      <InfoRow label="Type" value={cam.type} />
      <InfoRow label="Username" value={cam.cameraUser} />
      <InfoRow label="RTSP URL" value={cam.rtspUrl || '(none)'} mono />
      <InfoRow label="MQTT Server" value={cam.mqttServerId || '(standalone)'} mono />
      <InfoRow label="Handle" value={cam.handle ?? '(none)'} />
    </div>
  );
}
