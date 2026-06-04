/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapContainer, Marker, TileLayer, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { Terminal, CameraOff, Image as ImageIcon, Search, Camera, Calendar, Info, Eye, Play, Settings, ChevronDown, Cctv, LandPlot } from 'lucide-react';
// import { EMap } from './EMap';
import { LogFilter } from './Dashboard';
import { DeviceDraggablePanel } from './DeviceDraggablePanel';
import type { LogData, ServerData, DeviceData, EventTypeItem } from '../types';
import type { EMapPin } from './EMap';
import type { GridDevice } from './AlertWall';
import 'leaflet/dist/leaflet.css';

const LeafletMapContainer = MapContainer as any;
const LeafletTileLayer = TileLayer as any;
const LeafletMarker = Marker as any;
const LeafletPolygon = Polygon as any;

type LatLngTuple = [number, number];
type AreaPinKind = 'group' | 'device';

type AreaNodeMapData = {
  color?: string;
  polygon?: {
    points: LatLngTuple[];
    color: string;
    fillOpacity: number;
    lineOpacity: number;
  };
  pin?: {
    point: LatLngTuple;
    color: string;
  };
};

type AreaNode = {
  id: string;
  name: string;
  type: 'group' | 'svms-device' | 'sunell-camera' | 'mqtt-sensor';
  parentId: string | null;
  ip?: string;
  devEui?: string;
  areaMap?: AreaNodeMapData;
};

const HCM_CENTER: LatLngTuple = [10.7769, 106.7009];
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const DEFAULT_GROUP_AREA_COLOR = '#c084fc';
const PRIMARY_PIN_COLOR = '#c084fc';
const ALERT_PIN_COLOR = '#ef4444';
const AREA_BORDER_WEIGHT = 1.5;

function normalizeHexColor(hex: string) {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized;
}

function mixHexColor(hex: string, target: number, amount: number) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return hex;

  const channels = [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16));
  const mixed = channels.map(channel => Math.round(channel + (target - channel) * amount));
  return `#${mixed.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function getAreaBorderColor(color: string) {
  return mixHexColor(color, 0, 0.28);
}

function getAreaFillColor(color: string) {
  return mixHexColor(color, 255, 0.18);
}

function makeAreaPointIcon(color: string, isAlert = false, kind: AreaPinKind = 'device') {
  const iconMarkup = renderToStaticMarkup(
    kind === 'group'
      ? <LandPlot size={13} strokeWidth={2.6} />
      : <Cctv size={13} strokeWidth={2.6} />
  );

  return L.divIcon({
    className: '',
    html: `<div class="new-dashboard-area-pin ${isAlert ? 'new-dashboard-area-pin-alert' : ''}" style="background:${isAlert ? ALERT_PIN_COLOR : color};"><span class="new-dashboard-area-pin-icon">${iconMarkup}</span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function normalizeAddress(value?: string) {
  return String(value || '').split(':')[0].toLowerCase();
}

function getPolygonCenter(points: LatLngTuple[]): LatLngTuple {
  if (points.length === 0) return HCM_CENTER;
  const sum = points.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]] as LatLngTuple,
    [0, 0] as LatLngTuple
  );
  return [sum[0] / points.length, sum[1] / points.length];
}

interface NewDashboardProps {
  logs: LogData[];
  displayLogs: LogData[];
  visibleAlerts: number;
  setVisibleAlerts: React.Dispatch<React.SetStateAction<number>>;
  selectedLog: LogData | null;
  setSelectedLog: (log: LogData | null) => void;

  // LogFilter/filtering props
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  mqttServers?: any[];
  mqttGroups: any[];
  mqttDevicesByServer?: Record<string, any[]>;
  cameraDevices?: any[];
  deviceCameraLinks: any[];
  eventTypes: EventTypeItem[];

  excludedServers: Set<string>;
  setExcludedServers: React.Dispatch<React.SetStateAction<Set<string>>>;
  excludedDevices: Set<string>;
  setExcludedDevices: React.Dispatch<React.SetStateAction<Set<string>>>;
  excludedEventTypes: Set<string>;
  setExcludedEventTypes: React.Dispatch<React.SetStateAction<Set<string>>>;

  toggleServer: (id: string) => void;
  toggleDevice: (ip: string) => void;

  // EMap props
  pins: EMapPin[];
  tileProviderId: string;
  knownDevices: GridDevice[];
  onSaveLayout: (pins: EMapPin[], tileProviderId?: string) => void;
  areaLayout?: { nodes: AreaNode[]; updatedAt?: string | null };
}

export const NewDashboard = React.memo(function NewDashboard({
  logs,
  displayLogs,
  visibleAlerts,
  setVisibleAlerts,
  selectedLog,
  setSelectedLog,
  servers,
  devices,
  mqttServers,
  mqttGroups,
  mqttDevicesByServer,
  cameraDevices,
  deviceCameraLinks,
  eventTypes,
  excludedServers,
  setExcludedServers,
  excludedDevices,
  setExcludedDevices,
  excludedEventTypes,
  setExcludedEventTypes,
  toggleServer,
  toggleDevice,
  pins,
  tileProviderId,
  knownDevices,
  onSaveLayout,
  areaLayout,
}: NewDashboardProps) {
  const { t } = useTranslation();
  void pins;
  void tileProviderId;
  void knownDevices;
  void onSaveLayout;
  void displayLogs;
  const [isLeftPanelVisible] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'events' | 'notifications'>('events');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; log: LogData } | null>(null);
  const [areaClusterLevel, setAreaClusterLevel] = useState(0);
  const [isAreaClusterMenuOpen, setIsAreaClusterMenuOpen] = useState(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [alertAreaNodeIds, setAlertAreaNodeIds] = useState<Set<string>>(new Set());
  const alertTimersRef = useRef<Record<string, number>>({});
  const processedAreaLogCountRef = useRef(0);
  const hasInitializedAreaLogRef = useRef(false);

  // Area data comes from BE area-layout; localStorage is no longer the source for New Dashboard map.
  const areaNodes = React.useMemo(() => areaLayout?.nodes || [], [areaLayout]);

  const getCameraGroupName = React.useCallback((deviceIpOrId: string, deviceName: string) => {
    const ip = String(deviceIpOrId || '').toLowerCase();
    const name = String(deviceName || '').toLowerCase();
    const node = areaNodes.find(n =>
      (n.ip && String(n.ip).toLowerCase() === ip) ||
      (n.devEui && String(n.devEui).toLowerCase() === ip) ||
      (n.name && String(n.name).toLowerCase() === name)
    );
    if (node && node.parentId) {
      const parent = areaNodes.find(n => n.id === node.parentId && n.type === 'group');
      if (parent) {
        return parent.name;
      }
    }
    return deviceName; // fallback if not in group
  }, [areaNodes]);

  const areaNodeById = useMemo(() => {
    const map = new Map<string, AreaNode>();
    areaNodes.forEach(node => map.set(node.id, node));
    return map;
  }, [areaNodes]);

  const getAreaNodeLevel = React.useCallback((node: AreaNode): number => {
    let level = 1;
    let parentId = node.parentId;
    const visited = new Set<string>([node.id]);

    while (parentId) {
      const parent = areaNodeById.get(parentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      level += 1;
      parentId = parent.parentId;
    }

    return level;
  }, [areaNodeById]);

  const isLogForAreaNode = React.useCallback((log: LogData, node: AreaNode) => {
    if (node.type === 'mqtt-sensor') {
      return (
        (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button') &&
        (
          normalizeAddress((log as any).mqtt_device_id) === normalizeAddress(node.id) ||
          normalizeAddress((log as any).mqtt_device_id) === normalizeAddress(node.devEui) ||
          normalizeAddress(log.device_info?.id) === normalizeAddress(node.devEui)
        )
      );
    }

    if (node.type === 'sunell-camera') {
      return log.log_source === 'sunell-camera' && normalizeAddress(log.device_info?.id) === normalizeAddress(node.ip);
    }

    if (node.type === 'svms-device') {
      const rawDeviceName = String(log.raw?.device_name || '').toLowerCase();
      const rawDeviceIp = normalizeAddress(log.raw?.device_ip);
      return log.log_source === 'svms' && (
        (rawDeviceIp && rawDeviceIp === normalizeAddress(node.ip)) ||
        (rawDeviceName && rawDeviceName === String(node.name || '').toLowerCase()) ||
        (
          normalizeAddress(log.device_info?.id) === normalizeAddress(node.ip) &&
          String(log.device_info?.name || '').toLowerCase() === String(node.name || '').toLowerCase()
        )
      );
    }

    return false;
  }, []);

  const areaPolygons = useMemo(() => (
    areaNodes
      .filter(node => node.type === 'group' && node.areaMap?.polygon?.points?.length)
      .map(node => ({
        id: node.id,
        level: getAreaNodeLevel(node),
        point: getPolygonCenter(node.areaMap?.polygon?.points || []),
        points: node.areaMap?.polygon?.points || [],
        color: node.areaMap?.polygon?.color || node.areaMap?.color || DEFAULT_GROUP_AREA_COLOR,
        fillOpacity: node.areaMap?.polygon?.fillOpacity ?? 0.16,
        lineOpacity: node.areaMap?.polygon?.lineOpacity ?? 0.5,
      }))
  ), [areaNodes, getAreaNodeLevel]);

  const areaDevicePins = useMemo(() => (
    areaNodes
      .filter(node => node.type !== 'group' && node.areaMap?.pin?.point)
      .map(node => ({
        id: node.id,
        level: getAreaNodeLevel(node),
        point: node.areaMap?.pin?.point as LatLngTuple,
        color: PRIMARY_PIN_COLOR,
      }))
  ), [areaNodes, getAreaNodeLevel]);

  const isDescendantOfGroup = React.useCallback((node: AreaNode, groupId: string) => {
    let parentId = node.parentId;
    const visited = new Set<string>([node.id]);

    while (parentId) {
      if (parentId === groupId) return true;
      const parent = areaNodeById.get(parentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      parentId = parent.parentId;
    }

    return false;
  }, [areaNodeById]);

  useEffect(() => {
    if (!hasInitializedAreaLogRef.current) {
      processedAreaLogCountRef.current = logs.length;
      hasInitializedAreaLogRef.current = true;
      return;
    }

    if (logs.length < processedAreaLogCountRef.current) {
      processedAreaLogCountRef.current = 0;
    }

    const newLogs = logs.slice(processedAreaLogCountRef.current);
    processedAreaLogCountRef.current = logs.length;
    if (newLogs.length === 0) return;

    const deviceNodesWithPins = areaNodes.filter(node => node.type !== 'group' && node.areaMap?.pin?.point);
    const alertedNodeIds = new Set<string>();

    newLogs.forEach(log => {
      deviceNodesWithPins.forEach(node => {
        if (isLogForAreaNode(log, node)) {
          alertedNodeIds.add(node.id);
        }
      });
    });

    if (alertedNodeIds.size === 0) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlertAreaNodeIds(prev => new Set([...prev, ...alertedNodeIds]));
    alertedNodeIds.forEach(nodeId => {
      if (alertTimersRef.current[nodeId]) {
        window.clearTimeout(alertTimersRef.current[nodeId]);
      }
      alertTimersRef.current[nodeId] = window.setTimeout(() => {
        setAlertAreaNodeIds(prev => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
        delete alertTimersRef.current[nodeId];
      }, 3000);
    });
  }, [areaNodes, isLogForAreaNode, logs]);

  useEffect(() => {
    const timers = alertTimersRef.current;
    return () => {
      Object.values(timers).forEach(timer => window.clearTimeout(timer));
    };
  }, []);

  const areaClusterLevels = useMemo(() => {
    const levels = new Set<number>();
    areaPolygons.forEach(polygon => levels.add(polygon.level));
    areaDevicePins.forEach(pin => levels.add(pin.level));
    const sortedLevels = Array.from(levels).sort((a, b) => a - b);
    const deepestLevel = sortedLevels[sortedLevels.length - 1];
    return sortedLevels.filter(level => level !== deepestLevel);
  }, [areaDevicePins, areaPolygons]);

  useEffect(() => {
    if (areaClusterLevel !== 0 && !areaClusterLevels.includes(areaClusterLevel)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAreaClusterLevel(0);
    }
  }, [areaClusterLevel, areaClusterLevels]);

  const visibleAreaPolygons = useMemo(() => (
    areaClusterLevel === 0
      ? []
      : areaPolygons.filter(polygon => polygon.level === areaClusterLevel)
  ), [areaClusterLevel, areaPolygons]);

  const visibleAreaPins = useMemo(() => {
    if (areaClusterLevel === 0) {
      return areaDevicePins.map(pin => ({
        ...pin,
        kind: 'device' as AreaPinKind,
        isAlert: alertAreaNodeIds.has(pin.id),
      }));
    }

    const groupPins = areaPolygons
      .filter(polygon => polygon.level === areaClusterLevel)
      .map(polygon => ({
        id: `group-${polygon.id}`,
        point: polygon.point,
        color: polygon.color,
        kind: 'group' as AreaPinKind,
        isAlert: areaNodes.some(node =>
          node.type !== 'group' &&
          node.areaMap?.pin?.point &&
          alertAreaNodeIds.has(node.id) &&
          isDescendantOfGroup(node, polygon.id)
        ),
      }));

    const devicePinsAtLevel = areaDevicePins
      .filter(pin => pin.level === areaClusterLevel)
      .map(pin => ({
        id: pin.id,
        point: pin.point,
        color: pin.color,
        kind: 'device' as AreaPinKind,
        isAlert: alertAreaNodeIds.has(pin.id),
      }));

    return [...groupPins, ...devicePinsAtLevel];
  }, [alertAreaNodeIds, areaClusterLevel, areaDevicePins, areaNodes, areaPolygons, isDescendantOfGroup]);

  const getLogDisplayDetails = React.useCallback((log: LogData) => {
    let displayType = '';
    let displayDesc = '';
    const source = String(log.log_source || '');

    switch (source) {
      case 'svms': {
        const normalizedType = log.log_type.replace(/\./g, '_');
        displayType = t(`app.logtype.svms_${normalizedType}`);
        displayDesc = t(`app.logtype.svms_${normalizedType}_description`);
        break;
      }
      case 'milesight-radar': {
        const normalizedType = log.log_type.replace(/\./g, '_');
        const descKey = log.log_description?.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
        displayType = t(`app.logtype.${normalizedType.startsWith('milesight_') ? normalizedType : `milesight_${normalizedType}`}`);
        displayDesc = descKey ? t(`app.logtype.${descKey}`, { defaultValue: log.log_description }) : t(`app.logtype.milesight_${normalizedType}_description`);
        break;
      }
      case 'milesight-button': {
        const normalizedType = log.log_type.replace(/\./g, '_');
        const descKey = log.log_description?.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
        displayType = t(`app.logtype.${normalizedType.startsWith('milesight_') ? normalizedType : `milesight_${normalizedType}`}`);
        displayDesc = descKey ? t(`app.logtype.${descKey}`, { defaultValue: log.log_description }) : undefined;
        break;
      }
      case 'sunell-camera': {
        const normalizedType = log.log_type.replace(/\./g, '_');
        displayType = t(`app.logtype.sunell_${normalizedType}`);
        displayDesc = t(`app.logtype.sunell_${normalizedType}_description`);
        break;
      }
      default:
        displayType = t(`app.logtype.${(log.log_type || log.raw?.body?.log_type || '').toLowerCase().replace(/ /g, '_').replace(/\./g, '_')}`);
        if (log.log_description) {
          const descKey = log.log_description.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
          displayDesc = t(`app.logtype.${descKey}`, { defaultValue: log.log_description });
        }
    }

    return {
      displayType: displayType || log.log_type || 'Sự kiện',
      displayDesc: displayDesc || log.log_description || 'Không có mô tả',
    };
  }, [t]);

  // Helper lists for LogFilter
  const serverList = React.useMemo(() => {
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

  const deviceList = React.useMemo(() => {
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

    const indepCams = (cameraDevices || []).map(cam => ({
      name: cam.name || cam.cameraIp,
      ip: cam.id,
      type: cam.type || 'sunell',
      index: 0,
      serverId: 'SUNELL-LOCAL',
      originalName: undefined
    })).filter(d => {
      const uniqueKey = `${d.serverId}_${d.ip}_${d.name}`;
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });

    const mqttDevs = Object.entries(mqttDevicesByServer || {}).flatMap(([serverId, devs]) => {
      return devs.map(d => ({
        name: d.deviceName || d.deviceProfileName || d.devEui,
        ip: d.devEui,
        type: 'radar',
        index: 0,
        serverId: serverId,
        originalName: d.deviceName || 'MQTT Device'
      }));
    }).filter(d => {
      const uniqueKey = `${d.serverId}_${d.ip}_${d.originalName}`;
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });

    return [...svmsDevs, ...indepCams, ...mqttDevs];
  }, [devices, cameraDevices, mqttDevicesByServer]);

  const filteredDisplayLogs = useMemo(() => {
    if (!searchQuery) return displayLogs;
    const query = searchQuery.toLowerCase();
    return displayLogs.filter(log => {
      const desc = String(log.log_description || '').toLowerCase();
      const devName = String(log.device_info?.name || '').toLowerCase();
      const ip = String(log.device_info?.id || '').toLowerCase();
      const source = String(log.log_source || '').toLowerCase();
      return desc.includes(query) || devName.includes(query) || ip.includes(query) || source.includes(query);
    });
  }, [displayLogs, searchQuery]);

  return (
    <div className="NewDashboard flex-1 w-full h-full grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 min-h-0 bg-background overflow-hidden">
      {/* Left sidebar: Log List + Image Area */}
      <div
        ref={leftPanelRef}
        className={`flex flex-col gap-4 min-h-0 h-full transition-all duration-300 ${isLeftPanelVisible
            ? 'lg:col-span-1 opacity-100'
            : 'w-0 opacity-0 pointer-events-none lg:col-span-0'
          }`}
      >
        {/* Log List Area */}
        <div className="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col shadow-xl min-h-[300px] relative">
          {/* Tab Header with exactly two tabs */}
          <div className="flex items-center justify-between bg-surface-container-high/50 px-4 py-2.5 border-b border-outline-variant/20 shrink-0">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('events')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${activeTab === 'events'
                    ? 'bg-error text-on-error shadow'
                    : 'bg-surface-container-low text-on-surface/60 hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                title="Lịch sử sự kiện"
              >
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>Lịch sử sự kiện</span>
              </button>

              <button
                onClick={() => setActiveTab('notifications')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${activeTab === 'notifications'
                    ? 'bg-error text-on-error shadow'
                    : 'bg-surface-container-low text-on-surface/60 hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                title="Cài đặt thông báo"
              >
                <Settings className="w-3.5 h-3.5 shrink-0" />
                <span>Cài đặt thông báo</span>
              </button>
            </div>
          </div>

          {/* Filter Sub-header */}
          {activeTab === 'events' && (
            <div className="relative p-3 flex items-center justify-between border-b border-outline-variant/10 shrink-0 bg-surface-container-lowest">
              {/* Quick search input */}
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Tìm sự kiện..."
                  className="w-full bg-background border border-outline-variant/30 rounded-lg pl-8 pr-3 py-1 text-xs text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:border-primary/50"
                />
              </div>
              <LogFilter
                logs={logs}
                servers={servers}
                devices={devices}
                mqttServers={mqttServers}
                mqttDevicesByServer={mqttDevicesByServer}
                cameraDevices={cameraDevices}
                eventTypes={eventTypes}
                selectedServers={new Set(serverList.map(srv => srv.id).filter(id => !excludedServers.has(id)))}
                selectedDevices={new Set(deviceList.map(dev => `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`).filter(key => !excludedDevices.has(key)))}
                selectedEventTypes={eventTypes.map(item => item.event_type).filter(type => !excludedEventTypes.has(type))}
                onToggleServer={toggleServer}
                onToggleDevice={toggleDevice}
                onToggleEventType={(typeOrTypes) => {
                  setExcludedEventTypes(prev => {
                    const next = new Set(prev);
                    const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
                    const allExcluded = types.every(t => prev.has(t));
                    if (allExcluded) {
                      types.forEach(t => next.delete(t));
                    } else {
                      types.forEach(t => next.add(t));
                    }
                    return next;
                  });
                }}
                onToggleAllEventTypes={(checked) => {
                  if (checked) {
                    setExcludedEventTypes(new Set());
                  } else {
                    setExcludedEventTypes(new Set(eventTypes.map(item => item.event_type)));
                  }
                }}
                onToggleAllServers={(ids) => {
                  if (ids.length === 0) {
                    setExcludedServers(new Set(serverList.map(srv => srv.id)));
                    const allDeviceKeys = deviceList.map(dev => `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`);
                    setExcludedDevices(new Set(allDeviceKeys));
                  } else {
                    setExcludedServers(new Set());
                    setExcludedDevices(new Set());
                  }
                }}
                onToggleAllDevices={(keys) => {
                  if (keys.length === 0) {
                    const allDeviceKeys = deviceList.map(dev => `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`);
                    setExcludedDevices(new Set(allDeviceKeys));
                    setExcludedServers(new Set(serverList.map(srv => srv.id)));
                  } else {
                    setExcludedDevices(new Set());
                    setExcludedServers(new Set());
                  }
                }}
              />
            </div>
          )}

          {/* Logs List Container */}
          {activeTab === 'events' ? (
            <div className="traffic-mini-scrollbar flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-surface-container-low/10">
              {filteredDisplayLogs.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {[...filteredDisplayLogs].reverse().slice(0, visibleAlerts).map((log, idx) => {
                    const { displayType, displayDesc } = getLogDisplayDetails(log);
                    const deviceName = log.device_info?.name || 'Unknown';
                    const deviceId = log.device_info?.id || '';
                    const cameraName = getCameraGroupName(deviceId, deviceName);
                    const snapshotSrc = log.snapshot
                      ? (log.snapshot.startsWith('data:image') ? log.snapshot : `data:image/jpeg;base64,${log.snapshot}`)
                      : null;

                    const isSelected = selectedLog?.id === log.id;

                    return (
                      <div
                        key={log.id || idx}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            log
                          });
                        }}
                        className={`traffic-card p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${isSelected
                            ? 'bg-primary/10 border-primary shadow font-bold'
                            : 'bg-surface-container border-outline-variant/10 hover:border-outline-variant/30 hover:bg-surface-container-high'
                          }`}
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          {/* Image Cutout */}
                          <div className="w-28 h-16 shrink-0 rounded-lg overflow-hidden border bg-black flex items-center justify-center border-outline-variant/20">
                            {snapshotSrc ? (
                              <img src={snapshotSrc} className="w-full h-full object-cover" alt="Event snapshot" />
                            ) : (
                              <CameraOff className="w-6 h-6 text-on-surface/25" />
                            )}
                          </div>

                          {/* Text info */}
                          <div className="min-w-0 flex flex-col gap-1">
                            <div className="text-[14px] font-bold tracking-wide text-on-surface truncate pr-2 uppercase">
                              {displayDesc || displayType}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-[10px] text-on-surface-variant">
                              <span className="min-w-0 flex items-center gap-1">
                                <Camera className="w-3.5 h-3.5 shrink-0 text-primary" />
                                <span className="truncate">{cameraName}</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 shrink-0 text-secondary" />
                                <span>{new Date(log.receive_time).toLocaleTimeString()} {new Date(log.receive_time).toLocaleDateString()}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Regular purple see more button inside the scrollable content list at the end */}
                  {visibleAlerts < filteredDisplayLogs.length && (
                    <div className="flex justify-center mt-2 py-1">
                      <button
                        onClick={() => setVisibleAlerts(prev => prev + 10)}
                        className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary text-white hover:brightness-110 active:scale-95 transition-all text-[8px] font-black uppercase tracking-wider shadow-lg shadow-primary/30 border border-primary/40 cursor-pointer"
                      >
                        <ChevronDown className="w-3 h-3 text-white shrink-0" />
                        <span>{t('app.alert_wall.see_more_alerts', 'Xem thêm thông báo')}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-10 flex flex-col items-center justify-center opacity-20 gap-2 h-full text-center">
                  <Terminal className="w-8 h-8" />
                  <span className="text-[10px] uppercase font-bold tracking-widest">
                    {t('app.alert_wall.logs_queue_empty', 'Không có sự kiện nào')}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              <DeviceDraggablePanel
                devices={devices}
                mqttGroups={mqttGroups}
                mqttDevicesByServer={mqttDevicesByServer}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                title="Cài đặt thông báo"
              />
            </div>
          )}
        </div>

        {/* Image Preview Area */}
        <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col shadow-xl h-[220px] shrink-0">
          <div className="p-3 border-b border-outline-variant/10 bg-surface-container-lowest flex items-center justify-between shrink-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-primary" />
              Hình ảnh sự kiện
            </span>
            {selectedLog && (
              <button
                onClick={() => setSelectedLog(null)}
                className="text-[9px] uppercase tracking-widest font-bold text-on-surface-variant hover:text-error transition-colors"
              >
                Đóng
              </button>
            )}
          </div>
          <div className="flex-1 bg-black/40 rounded-b-xl overflow-hidden relative flex items-center justify-center p-4">
            {selectedLog ? (
              selectedLog.snapshot ? (
                <img
                  src={selectedLog.snapshot.startsWith('data:image') ? selectedLog.snapshot : `data:image/jpeg;base64,${selectedLog.snapshot}`}
                  className="w-full h-full object-contain"
                  alt="Selected snapshot"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-on-surface/30">
                  <CameraOff className="w-12 h-12" />
                  <span className="text-xs uppercase tracking-widest font-black text-center">Sự kiện không có hình ảnh snapshot</span>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-on-surface/20">
                <CameraOff className="w-12 h-12" />
                <span className="text-xs uppercase tracking-widest font-black">Chưa chọn sự kiện để xem ảnh</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right side: E-Map Area */}
      <div className={`bg-surface-container-low border border-outline-variant/20 rounded-2xl overflow-hidden shadow-xl relative min-h-[520px] lg:min-h-0 transition-all duration-300 ${isLeftPanelVisible ? 'lg:col-span-2' : 'lg:col-span-3'
        }`}>
        {/* Toggle button */}
        {/* <button
          onClick={() => setIsLeftPanelVisible(v => !v)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-[1001] flex items-center justify-center w-5 h-10 bg-surface-container-high/90 backdrop-blur border border-l-0 border-outline-variant/30 rounded-r-xl shadow-lg hover:bg-surface-container-highest transition-colors cursor-pointer"
          title={isLeftPanelVisible ? 'Ẩn danh sách và ảnh' : 'Hiện danh sách và ảnh'}
        >
          {isLeftPanelVisible ? (
            <ChevronLeft className="w-3.5 h-3.5 text-on-surface/70" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-on-surface/70" />
          )}
        </button> */}

        {/* Old EMap layout/log-alert flow is intentionally disabled here.
        <EMap
          pins={pins}
          tileProviderId={tileProviderId}
          logs={displayLogs}
          knownDevices={knownDevices}
          onSaveLayout={onSaveLayout}
        />
        */}
        <div className="absolute right-3 top-3 z-[1000]">
          <button
            type="button"
            onClick={() => setIsAreaClusterMenuOpen(prev => !prev)}
            className="flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-high/95 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-on-surface shadow-xl backdrop-blur transition-colors hover:bg-surface-container-highest"
          >
            <Settings className="w-3.5 h-3.5 text-primary" />
            {areaClusterLevel === 0 ? 'Không gom' : `Level ${areaClusterLevel}`}
            <ChevronDown className={`w-3.5 h-3.5 text-on-surface-variant transition-transform ${isAreaClusterMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {isAreaClusterMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 rounded-xl border border-outline-variant/30 bg-surface-container-high/95 p-2 shadow-2xl backdrop-blur">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-bold text-on-surface hover:bg-surface-container-highest">
                <input
                  type="radio"
                  checked={areaClusterLevel === 0}
                  onChange={() => {
                    setAreaClusterLevel(0);
                    setIsAreaClusterMenuOpen(false);
                  }}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Không gom
              </label>
              {areaClusterLevels.map(level => (
                <label
                  key={level}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-bold text-on-surface hover:bg-surface-container-highest"
                >
                  <input
                    type="radio"
                    checked={areaClusterLevel === level}
                    onChange={() => {
                      setAreaClusterLevel(level);
                      setIsAreaClusterMenuOpen(false);
                    }}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Gom level {level}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="h-full w-full overflow-hidden">
          <style>{`
            .new-dashboard-area-pin {
              width: 22px;
              height: 22px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 999px;
              border: 3px solid rgba(255,255,255,0.92);
              box-shadow: 0 10px 24px rgba(0,0,0,0.35);
              color: #fff;
              transition: transform 120ms ease;
            }
            .new-dashboard-area-pin-icon {
              display: flex;
              align-items: center;
              justify-content: center;
              line-height: 0;
            }
            .new-dashboard-area-pin:hover {
              transform: scale(1.25);
            }
            .new-dashboard-area-pin-alert {
              animation: new-dashboard-area-pin-pulse 0.9s ease-in-out infinite;
            }
            @keyframes new-dashboard-area-pin-pulse {
              0%, 100% { transform: scale(1.10); }
              50% { transform: scale(1.15); }
            }
          `}</style>
          <LeafletMapContainer center={HCM_CENTER} zoom={12} minZoom={3} className="h-full w-full z-0">
            <LeafletTileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
            {visibleAreaPolygons.map(polygon => (
              polygon.points.length >= 3 ? (
                <LeafletPolygon
                  key={polygon.id}
                  positions={polygon.points}
                  interactive={false}
                  pathOptions={{
                    color: getAreaBorderColor(polygon.color),
                    weight: AREA_BORDER_WEIGHT,
                    opacity: Math.max(polygon.lineOpacity, 0.85),
                    fillColor: getAreaFillColor(polygon.color),
                    fillOpacity: polygon.fillOpacity,
                  }}
                />
              ) : null
            ))}
            {visibleAreaPins.map(pin => (
              <LeafletMarker
                key={pin.id}
                position={pin.point}
                icon={makeAreaPointIcon(pin.color, pin.isAlert, pin.kind)}
                interactive
              />
            ))}
          </LeafletMapContainer>
        </div>
      </div>

      {/* Floating Log Context Menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-[9999] pointer-events-auto"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="absolute bg-surface-container-high border border-outline-variant/30 rounded-2xl py-1.5 shadow-2xl min-w-[200px] animate-in fade-in zoom-in-95 duration-100 pointer-events-auto p-1"
          >
            <button
              onClick={() => {
                setSelectedLog(contextMenu.log);
                setContextMenu(null);
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-black text-primary hover:bg-primary/10 rounded-xl transition-all flex items-center gap-2"
            >
              <Info className="w-4 h-4 text-primary" />
              Thông tin chi tiết
            </button>

            <button
              onClick={() => {
                // Future liveview action placeholder
                setContextMenu(null);
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-black text-secondary hover:bg-secondary/10 rounded-xl transition-all flex items-center gap-2"
            >
              <Eye className="w-4 h-4 text-secondary" />
              Liveview (Chưa làm action)
            </button>

            <button
              onClick={() => {
                // Future playback action placeholder
                setContextMenu(null);
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-black text-tertiary hover:bg-tertiary/10 rounded-xl transition-all flex items-center gap-2"
            >
              <Play className="w-4 h-4 text-tertiary" />
              Playback (Chưa làm action)
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
