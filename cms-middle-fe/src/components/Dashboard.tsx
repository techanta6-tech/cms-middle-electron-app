import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { EventTypeItem, LogData, ServerData, DeviceData } from '../types';
import { useTranslation } from 'react-i18next';
import { useSocketManager } from '../hooks/useSocketManager';
import { ConnectionsMonitor } from './ConnectionsMonitor';
import { LogPopup } from './LogPopup';
import { SlidersHorizontal, Terminal, Check, Cpu, MonitorSmartphone, Settings, Monitor, Network, PanelRightOpen, PanelRightClose, Languages, LogOut, ChevronDown, MapPinned, Car, Tv, Trash2 } from 'lucide-react';
import { ConfigSystem } from './ConfigSystem';
import apiClient from '../api/apiClient';
import { LogEntry } from './LogEntry';
import { AlertWall } from './AlertWall';
import { DevicesManager } from './DevicesManager';
import { authApi } from '../api/authApi';
import { EMap } from './EMap';
import { DeviceDraggablePanel } from './DeviceDraggablePanel';
import { TrafficManager } from './TrafficManager';
import { LiveWall } from './LiveWall';

function LogFilter({
  logs,
  servers,
  devices,
  mqttServers,
  mqttDevicesByServer,
  cameraDevices,
  eventTypes,
  selectedGroups,
  selectedDevices,
  selectedEventTypes,
  onToggleGroup,
  onToggleDevice,
  onToggleEventType,
  onToggleAllEventTypes,
  onToggleAllGroups,
  onToggleAllDevices,
  allDevicesSelected,
  allGroupsSelected,
  mqttGroups,
}: {
  logs: LogData[];
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  mqttServers?: any[];
  mqttDevicesByServer?: Record<string, any[]>;
  cameraDevices?: any[];
  eventTypes: EventTypeItem[];
  selectedGroups: Set<string>;
  selectedDevices: Set<string>;
  selectedEventTypes: string[];
  onToggleGroup: (id: string) => void;
  onToggleDevice: (ip: string) => void;
  onToggleEventType: (type: string | string[]) => void;
  onToggleAllEventTypes: (checked: boolean) => void;
  onToggleAllGroups: (ids: string[]) => void;
  onToggleAllDevices: (keys: string[]) => void;
  allDevicesSelected: boolean;
  allGroupsSelected: boolean;
  mqttGroups?: MqttGroup[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showEventTypes, setShowEventTypes] = useState(true);
  const [showServers, setShowServers] = useState(true);
  const [showDevices, setShowDevices] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  // Group eventTypes to create a unified checkbox list, combining members of the same event_group into a single checkbox item
  const filterItems = useMemo(() => {
    const groupMembers: Record<string, EventTypeItem[]> = {};
    const ungroupedItems: EventTypeItem[] = [];

    eventTypes.forEach(item => {
      // Find matching log to get event_group
      const foundLog = logs.find(log =>
        log.log_type === item.event_type ||
        log.log_type?.replace(/\./g, '_') === item.event_type
      );
      let group = foundLog?.event_group || null;

      if (!group) {
        // Fallback mapping
        const fallbackGroups: Record<string, string[]> = {
          motion: ['motion', 'motion_event', 'svms_motion']
        };
        const searchType = item.event_type.toLowerCase();
        for (const [groupName, members] of Object.entries(fallbackGroups)) {
          if (members.some(m => m.toLowerCase() === searchType || m.toLowerCase().replace(/\./g, '_') === searchType)) {
            group = groupName;
            break;
          }
        }
      }

      if (group) {
        if (!groupMembers[group]) {
          groupMembers[group] = [];
        }
        groupMembers[group].push(item);
      } else {
        ungroupedItems.push(item);
      }
    });

    const items: Array<
      | { type: 'group'; groupName: string; members: EventTypeItem[] }
      | { type: 'individual'; item: EventTypeItem }
    > = [];

    // Add grouped items
    Object.entries(groupMembers).forEach(([groupName, members]) => {
      items.push({ type: 'group', groupName, members });
    });

    // Add ungrouped items
    ungroupedItems.forEach(item => {
      items.push({ type: 'individual', item });
    });

    return items;
  }, [eventTypes, logs]);

  const isAllChecked = eventTypes.length > 0 && eventTypes.every(item => selectedEventTypes.includes(item.event_type));

  const renderIndividualEventTypeButton = (item: EventTypeItem) => {
    const { event_type: lt, log_source } = item;
    const checked = selectedEventTypes.includes(lt);

    let displayFilterType: string;
    if (log_source) {
      switch (log_source) {
        case 'svms': {
          const normalizedType = lt.replace(/\./g, '_');
          displayFilterType = t(`app.logtype.svms_${normalizedType}`);
          // fallback nếu key không tồn tại
          if (displayFilterType === `app.logtype.svms_${normalizedType}`) {
            displayFilterType = t(`app.logtype.${normalizedType}`, { defaultValue: lt });
          }
          break;
        }
        case 'mqtt': {
          const normalizedType = lt.replace(/\./g, '_');
          displayFilterType = t(`app.logtype.milesight_${normalizedType}`);
          if (displayFilterType === `app.logtype.milesight_${normalizedType}`) {
            displayFilterType = t(`app.logtype.${normalizedType}`, { defaultValue: lt });
          }
          break;
        }
        case 'sunell-camera': {
          const normalizedType = lt.replace(/\./g, '_');
          displayFilterType = t(`app.logtype.sunell_${normalizedType}`);
          if (displayFilterType === `app.logtype.sunell_${normalizedType}`) {
            displayFilterType = t(`app.logtype.${normalizedType}`, { defaultValue: lt });
          }
          break;
        }
        default:
          displayFilterType = t(`app.logtype.${lt.toLowerCase().replace(/ /g, '_').replace(/\./g, '_')}`, { defaultValue: lt });
      }
    } else {
      // Runtime-discovered event: fallback to direct key
      displayFilterType = t(`app.logtype.${lt.toLowerCase().replace(/ /g, '_').replace(/\./g, '_')}`, { defaultValue: lt });
    }

    return (
      <button
        key={`individual-${lt}`}
        onClick={() => onToggleEventType(lt)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-container transition-colors w-full text-left border-b border-outline-variant/10 last:border-b-0 pb-1 pt-1 last:pb-0.5"
      >
        <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-warning border-warning' : 'border-outline-variant'
          }`}>
          {checked && <Check className="w-2 h-2 text-white stroke-[3]" />}
        </div>
        <span className="text-[10px] font-semibold text-on-surface truncate">{displayFilterType}</span>
      </button>
    );
  };


  // Đóng khi click ra ngoài
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
      return devs.map(d => ({
        name: d.deviceNickname || d.deviceInfo?.deviceNickname || d.deviceName || d.deviceProfileName || d.devEui,
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
  }, [devices, cameraDevices, mqttDevicesByServer, mqttServers]);

  const groupedDevices = useMemo(() => {
    const groups: Record<string, typeof deviceList> = {};
    deviceList.forEach(dev => {
      let groupKey = dev.serverId || 'UNKNOWN';
      if (groupKey === 'SUNELL-LOCAL') {
        groupKey = `SUNELL-LOCAL_${dev.type || 'sunell'}`;
      }
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(dev);
    });
    return groups;
  }, [deviceList]);

  const getGroupLabel = useCallback((groupKey: string) => {
    if (groupKey === 'SUNELL-LOCAL_sunell') {
      return t('app.devices.sunell_cameras');
    }
    if (groupKey.startsWith('SUNELL-LOCAL_')) {
      return t('app.devices.cameras');
    }
    const mqGrp = (mqttGroups || []).find(g => g.id === groupKey);
    if (mqGrp) {
      return mqGrp.name;
    }
    if (groupKey.startsWith('mqtt-')) {
      const mqttId = groupKey.replace('mqtt-', '');
      const mqttSrv = (mqttServers || []).find(s => s.id === mqttId);
      return `MQTT Broker (${mqttSrv?.brokerHost || mqttId})`;
    }
    const srv = Object.values(servers).find(s => s.id === groupKey || s.serial === groupKey);
    return `SVMS Server (${srv?.server_name || groupKey})`;
  }, [mqttGroups, mqttServers, servers, t]);

  const groupList = useMemo(() => {
    return Object.keys(groupedDevices).map(groupKey => {
      let type = 'SVMS';
      if (groupKey.startsWith('SUNELL-LOCAL')) {
        type = 'SUNELL';
      } else if ((mqttGroups || []).some(g => g.id === groupKey) || groupKey.startsWith('mqtt-')) {
        type = 'MQTT';
      }
      return {
        id: groupKey,
        name: getGroupLabel(groupKey),
        type,
      };
    });
  }, [groupedDevices, getGroupLabel, mqttGroups]);

  const activeCount = selectedGroups.size + selectedDevices.size + selectedEventTypes.length;

  const isAllServersChecked = allGroupsSelected;

  const isAllDevicesChecked = allDevicesSelected;

  const handleGroupClick = (id: string) => {
    onToggleGroup(id);
    setTimeout(() => {
      const el = document.getElementById(`device-group-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  };

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
        <div className="absolute right-3 top-[95%] z-50 bg-surface-container-high border border-outline-variant/90 shadow-lg rounded-md w-[90%] max-w-[230px] overflow-hidden animate-in fade-in zoom-in-95 duration-150">

          {/* Devices */}
          <div className="px-2 pt-2 pb-0.5">
            <button
              onClick={() => setShowDevices(!showDevices)}
              className="flex items-center justify-between w-full mb-1 p-1 rounded-md transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <MonitorSmartphone className="w-3.5 h-3.5 text-tertiary" />
                <span className="text-[12px] font-black uppercase tracking-widest text-tertiary">{t('app.filter.devices')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-tertiary/50 transition-transform duration-300 ${showDevices ? 'rotate-180' : ''}`} />
            </button>
            {showDevices && (
              deviceList.length === 0 ? (
                <p className="text-[11px] text-on-surface-variant/40 py-0.5 pl-1">{t('app.filter.no_devices')}</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto custom-scrollbar pr-1 animate-in fade-in slide-in-from-top-1 duration-200 cursor-pointer">
                  <button
                    onClick={() => {
                      if (isAllDevicesChecked) {
                        onToggleAllDevices([]);
                      } else {
                        const allKeys = deviceList.map(dev => `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`);
                        onToggleAllDevices(allKeys);
                      }
                    }}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-container transition-colors w-full text-left border-b border-outline-variant/10 pb-1 pt-1 first:pt-0.5 shrink-0"
                  >
                    <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${isAllDevicesChecked ? 'bg-tertiary border-tertiary' : 'border-outline-variant'
                      }`}>
                      {isAllDevicesChecked && <Check className="w-2 h-2 text-white stroke-[3]" />}
                    </div>
                    <span className="text-[10px] font-semibold text-on-surface truncate">{t('app.filter.all')}</span>
                  </button>
                  {Object.entries(groupedDevices).map(([serverKey, devs]) => {
                    if (!devs || devs.length === 0) return null;
                    const groupLabel = getGroupLabel(serverKey);

                    return (
                      <div key={serverKey} id={`device-group-${serverKey}`} className="flex flex-col gap-[1px] border-b border-outline-variant/5 pb-1 mb-0.5 last:border-0 last:pb-0 last:mb-0">
                        <button
                          onClick={() => {
                            const groupDevKeys = devs.map((d: {serverId: string, ip: string, originalName?: string, name: string}) => `${d.serverId}_${d.ip}_${d.originalName || d.name}`);
                            const allChecked = groupDevKeys.every((k: string) => allDevicesSelected || selectedDevices.has(k));
                            if (allChecked) {
                              // deselect all in group
                              groupDevKeys.forEach((k: string) => selectedDevices.has(k) && onToggleDevice(k));
                            } else {
                              // select all in group that aren't already selected
                              groupDevKeys.forEach((k: string) => { if (!allDevicesSelected && !selectedDevices.has(k)) onToggleDevice(k); });
                            }
                          }}
                          className="text-[7px] font-black uppercase tracking-widest text-on-surface/90 border-l border-outline-variant/50 pl-1 py-0 mb-0.5 mt-0.5 hover:text-tertiary hover:border-tertiary/60 transition-colors w-full text-left"
                        >
                          {groupLabel}
                        </button>
                        {devs.map(dev => {
                          const uniqueKey = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
                          const checked = allDevicesSelected || selectedDevices.has(uniqueKey);
                          return (
                            <button
                              key={uniqueKey}
                              onClick={() => onToggleDevice(uniqueKey)}
                              className="flex items-center gap-1.5 px-1 py-0.5 rounded-sm hover:bg-surface-container transition-colors w-full text-left"
                            >
                              <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-tertiary border-tertiary' : 'border-outline-variant'
                                }`}>
                                {checked && <Check className="w-2 h-2 text-white stroke-[3]" />}
                              </div>
                              <span className="text-[10px] font-semibold text-on-surface truncate">{dev.name}</span>
                              <span className="text-[8px] font-mono text-on-surface/90 ml-auto shrink-0">{dev.type.charAt(0).toUpperCase() + dev.type.slice(1)}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>

          <div className="mx-2 my-0.5 border-t border-outline-variant/10" />

          <div className="px-2 pt-2 pb-2">
            <button
              onClick={() => setShowEventTypes(!showEventTypes)}
              className="flex items-center justify-between w-full mb-2 p-1 rounded-md transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-warning" />
                <span className="text-[12px] font-black uppercase tracking-widest text-warning">{t('app.filter.event_types')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-warning/50 transition-transform duration-300 ${showEventTypes ? 'rotate-180' : ''}`} />
            </button>
            {showEventTypes && (
              eventTypes.length === 0 ? (
                <p className="text-[11px] text-on-surface-variant/40 py-0.5 pl-1">{t('app.filter.no_event_types')}</p>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-200 cursor-pointer">
                  <button
                    onClick={() => onToggleAllEventTypes(!isAllChecked)}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-container transition-colors w-full text-left border-b border-outline-variant/10 pb-1 pt-1 first:pt-0.5 shrink-0"
                  >
                    <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${isAllChecked ? 'bg-warning border-warning' : 'border-outline-variant'
                      }`}>
                      {isAllChecked && <Check className="w-2 h-2 text-white stroke-[3]" />}
                    </div>
                    <span className="text-[10px] font-semibold text-on-surface truncate">{t('app.filter.all')}</span>
                  </button>
                  <div className="flex flex-col gap-1 pt-1">
                    {filterItems.map(filterItem => {
                      if (filterItem.type === 'group') {
                        const { groupName, members } = filterItem;
                        const checked = members.every(m => selectedEventTypes.includes(m.event_type));
                        const label = t(`app.logtype.${groupName}`, { defaultValue: groupName.toUpperCase() });

                        return (
                          <button
                            key={`group-${groupName}`}
                            onClick={() => {
                              const memberTypes = members.map(m => m.event_type);
                              onToggleEventType(memberTypes);
                            }}
                            className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-container transition-colors w-full text-left border-b border-outline-variant/10 last:border-b-0 pb-1 pt-1 last:pb-0.5"
                          >
                            <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-warning border-warning' : 'border-outline-variant'
                              }`}>
                              {checked && <Check className="w-2 h-2 text-white stroke-[3]" />}
                            </div>
                            <span className="text-[10px] font-bold text-on-surface truncate uppercase">{label}</span>
                          </button>
                        );
                      } else {
                        return renderIndividualEventTypeButton(filterItem.item);
                      }
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}




export function Dashboard() {
  const { t, i18n } = useTranslation();
  const {
    isConnected,
    logs,
    filteredLogs,
    servers,
    devices,
    systemConfig,
    setSystemConfig,

    receiveServers,
    handleAddExternalServer,
    handleRemoveConnection,
    socket,
    eventTypes,
    selectedEventTypes,
    setSelectedEventTypes,
    totalLogCount,
    KEEP_TOTAL_LOG_COUNT,
    handleAddMqttServer,
    mqttServers,
    mqttGroups,
    mqttDevices,
    mqttLogs,
    cameraDevices,
    fetchCameras,
    deviceCameraLinks,
    handleLinkDeviceCamera,
    handleLinkMqttServerCamera,
    gridLayout,
    eMapLayout,
    saveGridLayout,
    saveEMapLayout,
    svmsDeviceFeatures,
    svmsKnownEvents,
    milesightKnownEvents,
    sunellKnownEvents,
    // ─── New System Data ───
    newSvmsLogs,
    svmsServers: newSvmsServers,
    svmsDevices: newSvmsDevices,
    mqttMilesightServers,
    mqttMilesightDevices,
    handleAddMqttGroup,
    handleUpdateMqttGroup,
    handleAddMqttDevice,
    handleRemoveMqttGroup,
    handleRemoveMqttDevice,
    trafficHistory,
    trafficCatalog,
    blacklistPlates,
    setBlacklistPlates,
    blacklistMechanism,
    setBlacklistMechanism,
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

  const getGridDevices = useCallback((grid: any) => {
    if (!grid) return [];
    if (Array.isArray(grid.devices)) return grid.devices;
    if (grid.device) return [grid.device];
    return [];
  }, []);

  const gridHasDevice = useCallback((grid: any, device: any) => {
    return getGridDevices(grid).some((item: any) =>
      item.server_id === device.server_id &&
      item.device_ip === device.device_ip &&
      item.device_name === device.device_name
    );
  }, [getGridDevices]);

  const displayLogCount = KEEP_TOTAL_LOG_COUNT ? totalLogCount : logs.length;

  const [selectedLog, setSelectedLog] = useState<LogData | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [allDevicesSelected, setAllDevicesSelected] = useState<boolean>(true);
  const [allGroupsSelected, setAllGroupsSelected] = useState<boolean>(true);

  // MQTT devices come from BE snapshot; logs are only used for display/counting.
  const mqttDevicesByServer = useMemo(() => {
    const map: Record<string, { devEui: string; deviceName: string; deviceProfileName: string; alarmCount: number; lastSeen: string }[]> = {};
    (mqttDevices || []).forEach((device: any) => {
      const sid = device.groupId;
      const info = device.deviceInfo || device;
      if (!sid || !info.devEui) return;
      const alarmCount = logs.filter(log =>
        (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button') &&
        log.server_unique_id === sid &&
        log.device_info.id === info.devEui
      ).length;
      if (!map[sid]) map[sid] = [];
      map[sid].push({
        ...(device as any),
        devEui: info.devEui,
        deviceName: info.deviceName || 'Unknown',
        deviceProfileName: info.deviceProfileName || 'Unknown',
        alarmCount,
        lastSeen: device.lastSeen || '',
      });
    });
    return map;
  }, [logs, mqttDevices]);

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
      return devs.map(d => ({
        name: d.deviceNickname || d.deviceInfo?.deviceNickname || d.deviceName || d.deviceProfileName || d.devEui,
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
  }, [devices, cameraDevices, mqttDevicesByServer, mqttServers]);

  const getGroupLabel = useCallback((groupKey: string) => {
    if (groupKey === 'SUNELL-LOCAL_sunell') {
      return t('app.devices.sunell_cameras');
    }
    if (groupKey.startsWith('SUNELL-LOCAL_')) {
      return t('app.devices.cameras');
    }
    const mqGrp = (mqttGroups || []).find(g => g.id === groupKey);
    if (mqGrp) {
      return mqGrp.name;
    }
    if (groupKey.startsWith('mqtt-')) {
      const mqttId = groupKey.replace('mqtt-', '');
      const mqttSrv = (mqttServers || []).find(s => s.id === mqttId);
      return `MQTT Broker (${mqttSrv?.brokerHost || mqttId})`;
    }
    const srv = Object.values(servers).find(s => s.id === groupKey || s.serial === groupKey);
    return `SVMS Server (${srv?.server_name || groupKey})`;
  }, [mqttGroups, mqttServers, servers, t]);

  const groupedDevices = useMemo(() => {
    const groups: Record<string, typeof deviceList> = {};
    deviceList.forEach(dev => {
      let groupKey = dev.serverId || 'UNKNOWN';
      if (groupKey === 'SUNELL-LOCAL') {
        groupKey = `SUNELL-LOCAL_${dev.type || 'sunell'}`;
      }
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(dev);
    });
    return groups;
  }, [deviceList]);

  const groupList = useMemo(() => {
    return Object.keys(groupedDevices).map(groupKey => {
      let type = 'SVMS';
      if (groupKey.startsWith('SUNELL-LOCAL')) {
        type = 'SUNELL';
      } else if ((mqttGroups || []).some(g => g.id === groupKey) || groupKey.startsWith('mqtt-')) {
        type = 'MQTT';
      }
      return {
        id: groupKey,
        name: getGroupLabel(groupKey),
        type,
      };
    });
  }, [groupedDevices, getGroupLabel, mqttGroups]);

  const seenGroupsRef = useRef<Set<string>>(new Set());
  const seenDevicesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (groupList.length > 0) {
      const newGroups = groupList.filter(g => !seenGroupsRef.current.has(g.id));
      if (newGroups.length > 0) {
        setSelectedGroups(prev => {
          const next = new Set(prev);
          newGroups.forEach(g => {
            next.add(g.id);
            seenGroupsRef.current.add(g.id);
          });
          return next;
        });
      }
    }
  }, [groupList]);

  useEffect(() => {
    if (deviceList.length > 0) {
      const newDevices = deviceList.filter(dev => {
        const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
        return !seenDevicesRef.current.has(key);
      });
      if (newDevices.length > 0) {
        setSelectedDevices(prev => {
          const next = new Set(prev);
          newDevices.forEach(dev => {
            const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
            next.add(key);
            seenDevicesRef.current.add(key);
          });
          return next;
        });
      }
    }
  }, [deviceList]);
  const [rightTab, setRightTab] = useState<'logs' | 'devices'>('logs');
  const [mainTab, setMainTab] = useState<'alert' | 'emap' | 'connections' | 'devices' | 'traffic' | 'livewall'>('emap');
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
  const [isAlertWallFullscreen, setIsAlertWallFullscreen] = useState(false);

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

  const eMapKnownDevices = useMemo(() => {
    const svmsDevices = Object.values(devices).flatMap(server => {
      if (!server.server) return [];
      return (server.devices || []).map(dev => ({
        server_serial: server.server.serial,
        server_id: server.server.server_id,
        device_ip: dev.ip,
        device_name: dev.name,
        device_type: dev.type || 'vms',
      }));
    });

    const mqttKnownDevices = mqttGroups.flatMap(group => {
      const mqttDevs = mqttDevicesByServer[group.id] || [];
      return mqttDevs.map((dev: any) => ({
        server_serial: group.id,
        server_id: group.id,
        device_ip: dev.devEui,
        device_name: dev.deviceName,
        device_type: 'mqtt-sensor',
        mqtt_device_id: dev.id,
      }));
    });

    const sunellDevices = cameraDevices.filter(cam => cam.type === 'sunell').map(cam => ({
      server_serial: 'SUNELL',
      server_id: 'SUNELL-LOCAL',
      device_ip: cam.id,
      device_name: cam.name || cam.cameraIp,
      device_type: 'sunell',
    }));

    return [...svmsDevices, ...mqttKnownDevices, ...sunellDevices];
  }, [cameraDevices, devices, mqttDevicesByServer, mqttGroups]);

  const filteredEMapKnownDevices = useMemo(() => {
    const normalizeAddress = (value?: string) => String(value || '').split(':')[0];
    return eMapKnownDevices.filter(device => {
      const matched = deviceList.find(d =>
        d.serverId === device.server_id &&
        normalizeAddress(d.ip) === normalizeAddress(device.device_ip)
      );
      if (!matched) return false;

      const devKey = `${matched.serverId}_${matched.ip}_${matched.originalName || matched.name}`;
      const devGroupId = matched.serverId === 'SUNELL-LOCAL' ? `SUNELL-LOCAL_${matched.type || 'sunell'}` : matched.serverId;

      const matchGroup = allGroupsSelected || selectedGroups.has(devGroupId);
      const matchDevice = allDevicesSelected || selectedDevices.has(devKey);

      return matchGroup && matchDevice;
    });
  }, [eMapKnownDevices, deviceList, selectedGroups, selectedDevices, allGroupsSelected, allDevicesSelected]);

  const toggleGroup = useCallback((id: string) => {
    if (allGroupsSelected) {
      const newSelectedGroups = new Set<string>();
      groupList.forEach(grp => {
        if (grp.id !== id) {
          newSelectedGroups.add(grp.id);
        }
      });
      setSelectedGroups(newSelectedGroups);
      setAllGroupsSelected(false);

      if (allDevicesSelected) {
        const newSelectedDevices = new Set<string>();
        deviceList.forEach(dev => {
          const devGroupId = dev.serverId === 'SUNELL-LOCAL' ? `SUNELL-LOCAL_${dev.type || 'sunell'}` : dev.serverId;
          if (devGroupId !== id) {
            const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
            newSelectedDevices.add(key);
          }
        });
        setSelectedDevices(newSelectedDevices);
        setAllDevicesSelected(false);
      } else {
        setSelectedDevices(prevDevs => {
          const d = new Set(prevDevs);
          deviceList.forEach(dev => {
            const devGroupId = dev.serverId === 'SUNELL-LOCAL' ? `SUNELL-LOCAL_${dev.type || 'sunell'}` : dev.serverId;
            if (devGroupId === id) {
              const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
              d.delete(key);
            }
          });
          return d;
        });
      }
    } else {
      const isSelecting = !selectedGroups.has(id);

      setSelectedGroups(prev => {
        const s = new Set(prev);
        if (isSelecting) s.add(id); else s.delete(id);
        return s;
      });

      if (allDevicesSelected) {
        if (!isSelecting) {
          const newSelectedDevices = new Set<string>();
          deviceList.forEach(dev => {
            const devGroupId = dev.serverId === 'SUNELL-LOCAL' ? `SUNELL-LOCAL_${dev.type || 'sunell'}` : dev.serverId;
            if (devGroupId !== id) {
              const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
              newSelectedDevices.add(key);
            }
          });
          setSelectedDevices(newSelectedDevices);
          setAllDevicesSelected(false);
        }
      } else {
        setSelectedDevices(prevDevs => {
          const d = new Set(prevDevs);
          deviceList.forEach(dev => {
            const devGroupId = dev.serverId === 'SUNELL-LOCAL' ? `SUNELL-LOCAL_${dev.type || 'sunell'}` : dev.serverId;
            if (devGroupId === id) {
              const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
              if (isSelecting) d.add(key);
              else d.delete(key);
            }
          });
          return d;
        });
      }
    }
  }, [allGroupsSelected, allDevicesSelected, groupList, deviceList, selectedGroups]);

  const toggleDevice = (ip: string) => {
    if (allDevicesSelected) {
      const newSelected = new Set<string>();
      deviceList.forEach(dev => {
        const key = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
        if (key !== ip) {
          newSelected.add(key);
        }
      });
      setSelectedDevices(newSelected);
      setAllDevicesSelected(false);
    } else {
      setSelectedDevices(prev => {
        const s = new Set(prev);
        if (s.has(ip)) {
          s.delete(ip);
        } else {
          s.add(ip);
        }
        return s;
      });
    }
  };

  // Lọc logs theo server và device (event_type filter đã được xử lý bởi filteredLogs từ hook)
  const displayLogs = useMemo(() => {
    if ((!allGroupsSelected && selectedGroups.size === 0) || (!allDevicesSelected && selectedDevices.size === 0)) return [];
    return filteredLogs.filter(log => {
      // Chuẩn hóa serverId tùy theo log source để khớp với serverId dùng trong checkbox filter
      let logGroupId = log.server_unique_id;
      if (log.log_source === 'sunell-camera') {
        logGroupId = 'SUNELL-LOCAL_sunell';
      } else if (log.log_source === 'svms' && logGroupId) {
        const parts = logGroupId.split('-');
        logGroupId = parts[parts.length - 1] || logGroupId;
      }

      // Chuẩn hóa devKey tương ứng với serverId đã chuẩn hóa
      const devKey = `${logGroupId}_${log.device_info.id}_${log.device_info.name}`;

      let matchGroup = allGroupsSelected || selectedGroups.has(logGroupId);
      let matchDevice = allDevicesSelected || selectedDevices.has(devKey);

      // Nếu thiết bị được tích chọn đích danh trong bộ lọc, tự động cho qua Server kiểm tra
      if (selectedDevices.has(devKey)) {
        matchGroup = true;
      }

      // Nếu là camera log, kiểm tra xem có được liên kết với Radar hay Server đang được chọn hay không
      if (log.log_source === 'sunell-camera') {
        const isLinkedToSelectedRadar = allDevicesSelected || Array.from(selectedDevices).some(selectedKey => {
          return deviceCameraLinks.some(link => {
            if (link.cameraId !== log.device_info.id) return false;
            const groupId = link.groupId || link.mqttServerId || '';
            const devs = mqttDevicesByServer[groupId] || [];
            const dev = devs.find(d => d.devEui === link.devEui);
            if (!dev) return false;
            const devName = dev.deviceName || 'MQTT Device';
            const radarKey = `${groupId}_${dev.devEui}_${devName}`;
            return selectedKey === radarKey;
          });
        });

        const isLinkedToSelectedServer = allGroupsSelected || Array.from(selectedGroups).some(selectedGroupId => {
          return deviceCameraLinks.some(link => {
            return link.cameraId === log.device_info.id && (link.groupId || link.mqttServerId) === selectedGroupId;
          });
        });

        if (isLinkedToSelectedRadar) matchDevice = true;
        if (isLinkedToSelectedServer) matchGroup = true;
      }

      return matchGroup && matchDevice;
    });
  }, [filteredLogs, selectedGroups, selectedDevices, allGroupsSelected, allDevicesSelected, deviceCameraLinks, mqttServers, mqttDevicesByServer]);


  // ESC key logout removed as requested
  // Track window width for responsive layout
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Synchronize isAlertWallFullscreen with actual document fullscreen element
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsAlertWallFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);


  return (
    <div className="app-dashboard-root flex flex-col h-screen overflow-hidden bg-background text-on-surface font-sans selection:bg-primary/30 antialiased">
      <main className={`app-dashboard-main flex-1 overflow-hidden ${isNarrow ? 'flex flex-col' : ((mainTab === 'alert' || mainTab === 'emap' || mainTab === 'livewall') && !isAlertWallFullscreen) ? 'grid grid-cols-4 gap-0' : 'flex'}`}>
        {/* Main Section */}
        <div className={`app-dashboard-left-section overflow-hidden bg-background border-outline-variant/20 ${isNarrow ? 'flex-1 border-b' : ((mainTab === 'alert' || mainTab === 'emap' || mainTab === 'livewall') && !isAlertWallFullscreen) ? 'col-span-3 grid grid-rows-[1fr] h-full border-r' : 'flex-1 h-full'}`}>
          <div className="flex flex-col overflow-hidden h-full">
            {!isAlertWallFullscreen && (
              <div className={`appTabsBar flex items-center border-b border-outline-variant/10 shrink-0 ${isNarrow ? '' : 'px-6 gap-4'}`}>
                {/* Nút chuyển sang màn hình Bản đồ số (EMap) */}
                <button
                  className={`flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'emap' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('emap')}
                >
                  <MapPinned className={`w-5 h-5 ${mainTab === 'emap' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'emap' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.emap')}</h2>
                </button>
                {/* Nhóm nút Giám sát sự kiện và Live Wall*/}
                {/* <button
                  className={`flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'alert' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('alert')}
                >
                  <Monitor className={`w-5 h-5 ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.alert_wall')}</h2>
                </button> */}
                {/* <button
                  className={`flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'livewall' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('livewall')}
                >
                  <Tv className={`w-5 h-5 ${mainTab === 'livewall' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'livewall' ? 'text-primary' : 'text-on-surface'}`}>Live Wall</h2>
                </button> */}
                {/* Nút chuyển sang màn hình Quản lý giao thông (Traffic Manager) */}
                {/* <button
                  className={`flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'traffic' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('traffic')}
                >
                  <Car className={`w-5 h-5 ${mainTab === 'traffic' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'traffic' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.traffic', { defaultValue: 'Quản lý giao thông' })}</h2>
                </button> */}
                {/* Nút chuyển sang màn hình Quản lý Thiết bị (Devices Manager) */}
                <button
                  className={`flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'devices' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('devices')}
                >
                  <Cpu className={`w-5 h-5 ${mainTab === 'devices' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'devices' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.devices')}</h2>
                </button>
                {/* Nút chuyển sang màn hình Theo dõi Kết nối (Connections Monitor) */}
                {/* <button
                  className={`flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'connections' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('connections')}
                >
                  <Network className={`w-5 h-5 ${mainTab === 'connections' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'connections' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.connections_monitor')}</h2>
                </button> */}
              </div>
            )}
            {/* <button onClick={() => console.log(servers)}>CLick</button> */}
            {mainTab === 'alert' && (
              <AlertWall
                logs={displayLogs}
                cameras={Object.values(devices).flatMap(server => server || [])}
                deviceCameraLinks={deviceCameraLinks}
                onSelectLog={setSelectedLog}
                gridCols={gridCols}
                setGridCols={setGridCols}
                grids={grids}
                setGrids={setGrids}
                isFullscreen={isAlertWallFullscreen}
                setIsFullscreen={setIsAlertWallFullscreen}
              />
            )}
            {mainTab === 'livewall' && (
              <LiveWall
                cameraDevices={cameraDevices}
                isFullscreen={isAlertWallFullscreen}
                setIsFullscreen={setIsAlertWallFullscreen}
              />
            )}
            {mainTab === 'connections' && (
              <ConnectionsMonitor
                socket={socket}
                isConnected={isConnected}
                systemConfig={systemConfig}
                onSaveSystemConfig={(config) => { setSystemConfig(config) }}

                receiveServers={receiveServers}
                logs={logs}
                servers={servers}
                devices={devices}
                onSave={handleAddExternalServer}
                onSaveMqtt={handleAddMqttServer}
                onRemoveConnection={handleRemoveConnection}
                mqttServers={mqttServers}
                mqttDevices={mqttMilesightDevices}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                onLinkDeviceCamera={handleLinkDeviceCamera}
                onLinkMqttServerCamera={handleLinkMqttServerCamera}
              />
            )}
            {mainTab === 'emap' && (
              <EMap
                pins={eMapLayout.pins}
                tileProviderId={eMapLayout.tileProviderId}
                logs={displayLogs}
                knownDevices={filteredEMapKnownDevices}
                onSaveLayout={saveEMapLayout}
                mqttDevices={mqttDevices}
              />
            )}
            {mainTab === 'devices' && (
              <DevicesManager
                servers={servers}
                devices={devices}
                mqttServers={mqttServers}
                mqttGroups={mqttGroups}
                mqttDevices={mqttDevices}
                mqttLogs={mqttLogs}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                onLinkDeviceCamera={handleLinkDeviceCamera}
                onLinkMqttServerCamera={handleLinkMqttServerCamera}
                fetchCameras={fetchCameras}
                handleAddMqttServer={handleAddMqttServer}
                handleAddMqttGroup={handleAddMqttGroup}
                handleUpdateMqttGroup={handleUpdateMqttGroup}
                handleAddMqttDevice={handleAddMqttDevice}
                handleRemoveMqttGroup={handleRemoveMqttGroup}
                handleRemoveMqttDevice={handleRemoveMqttDevice}
                handleAddExternalServer={handleAddExternalServer}
                svmsDeviceFeatures={svmsDeviceFeatures}
                svmsKnownEvents={svmsKnownEvents}
                milesightKnownEvents={milesightKnownEvents}
                sunellKnownEvents={sunellKnownEvents}
              />
            )}
            {mainTab === 'traffic' && (
              <TrafficManager
                trafficHistory={trafficHistory}
                trafficCatalog={trafficCatalog}
                blacklistPlates={blacklistPlates}
                setBlacklistPlates={setBlacklistPlates}
                blacklistMechanism={blacklistMechanism}
                setBlacklistMechanism={setBlacklistMechanism}
                eMapLayout={eMapLayout}
                eMapKnownDevices={eMapKnownDevices}
              />
            )}
          </div>
        </div>

        {/* Right Section — visible on Alert Wall, E-Map and Live Wall tabs */}
        {(mainTab === 'alert' || mainTab === 'emap' || mainTab === 'livewall') && !isAlertWallFullscreen && isNarrow && (
          <button
            onClick={() => setRightPanelVisible(v => !v)}
            className="app-right-panel-toggle fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-white shadow-lg text-[11px] font-bold tracking-wide transition-all hover:bg-primary/90 active:scale-95"
          >
            {rightPanelVisible
              ? <><PanelRightClose className="w-4 h-4" /></>
              : <><PanelRightOpen className="w-4 h-4" /></>}
          </button>
        )}
        {(mainTab === 'alert' || mainTab === 'emap' || mainTab === 'livewall') && !isAlertWallFullscreen && (
          <aside
            className={`alert-wall-right-section bg-surface-container-lowest flex flex-col overflow-hidden shadow-2xl z-10 transition-transform duration-300 ${isNarrow
              ? `fixed bottom-0 left-0 right-0 h-1/4 border-t border-outline-variant/20 ${rightPanelVisible ? 'translate-y-0' : 'translate-y-full'}`
              : 'col-span-1 relative w-full'
              }`}
          >
            {mainTab !== 'livewall' && (
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
            )}

            {mainTab === 'livewall' ? (
              <div className="LiveWallSidebar device-draggable-container flex-1 overflow-y-auto custom-scrollbar p-3 bg-surface-container-low/10 flex flex-col gap-2 relative">
                <div className="flex items-center justify-between sticky top-0 py-1 z-10 backdrop-blur-md mb-2 rounded-md px-1">
                  <span className="text-[9px] uppercase tracking-widest text-on-surface-variant opacity-70 font-bold">{t('app.alert_wall.drag_to_assign', 'Kéo camera vào grid')}</span>
                </div>

                {/* Sunell Cameras */}
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-secondary/80">Sunell Cameras</span>
                  <div className="flex-1 h-px bg-secondary/10" />
                </div>
                {cameraDevices.filter((cam: any) => cam.type === 'sunell').map((cam: any) => (
                  <div
                    key={cam.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/json', JSON.stringify({
                        id: cam.id,
                        device_ip: cam.id,
                        device_name: cam.name || cam.cameraIp,
                        device_type: 'sunell'
                      }));
                    }}
                    className="p-3 bg-surface-container hover:bg-surface-container-high border border-outline-variant/10 rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-secondary transition-colors truncate">{cam.name || cam.cameraIp}</span>
                        <span className="text-[9px] text-on-surface-variant/70 font-mono truncate">{cam.cameraIp}</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 bg-surface-container-highest rounded text-on-surface-variant uppercase font-medium shrink-0">sunell</span>
                    </div>
                  </div>
                ))}
                {cameraDevices.filter((cam: any) => cam.type === 'sunell').length === 0 && (
                  <div className="p-3 text-[10px] opacity-40 text-center italic">Không có camera Sunell</div>
                )}

                {/* Other Cameras */}
                <div className="flex items-center gap-2 mt-4 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">Other Cameras</span>
                  <div className="flex-1 h-px bg-primary/10" />
                </div>
                {cameraDevices.filter((cam: any) => cam.type !== 'sunell').map((cam: any) => (
                  <div
                    key={cam.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/json', JSON.stringify({
                        id: cam.id,
                        device_ip: cam.id,
                        device_name: cam.name || cam.cameraIp,
                        device_type: 'camera'
                      }));
                    }}
                    className="p-3 bg-surface-container hover:bg-surface-container-high border border-outline-variant/10 rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-primary transition-colors truncate">{cam.name || cam.cameraIp}</span>
                        <span className="text-[9px] text-on-surface-variant/70 font-mono truncate">{cam.cameraIp}</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 bg-surface-container-highest rounded text-on-surface-variant uppercase font-medium shrink-0">{cam.type || 'vms'}</span>
                    </div>
                  </div>
                ))}
                {cameraDevices.filter((cam: any) => cam.type !== 'sunell').length === 0 && (
                  <div className="p-3 text-[10px] opacity-40 text-center italic">Không có camera khác</div>
                )}
              </div>
            ) : rightTab === 'logs' ? (
              <>
                <div className="relative p-3 flex items-center justify-between border-b border-outline-variant/10 shrink-0 bg-surface-container-lowest">
                  <span className="text-[10px] font-bold tracking-widest text-on-surface-variant uppercase">{t('app.filter.filter_logs')}</span>
                  <LogFilter
                    logs={logs}
                    servers={servers}
                    devices={devices}
                    mqttServers={mqttServers}
                    mqttDevicesByServer={mqttDevicesByServer}
                    cameraDevices={cameraDevices}
                    eventTypes={eventTypes}
                    selectedGroups={selectedGroups}
                    selectedDevices={selectedDevices}
                    selectedEventTypes={selectedEventTypes}
                    onToggleGroup={toggleGroup}
                    onToggleDevice={toggleDevice}
                    onToggleEventType={(typeOrTypes) => {
                      setSelectedEventTypes(prev => {
                        const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
                        const allExist = types.every(t => prev.includes(t));
                        if (allExist) {
                          return prev.filter(t => !types.includes(t));
                        } else {
                          const next = new Set([...prev, ...types]);
                          return Array.from(next);
                        }
                      });
                    }}
                    onToggleAllEventTypes={(checked) => {
                      if (checked) {
                        setSelectedEventTypes(eventTypes.map(item => item.event_type));
                      } else {
                        setSelectedEventTypes([]);
                      }
                    }}
                    onToggleAllGroups={(ids) => {
                      if (ids.length === 0) {
                        setAllGroupsSelected(false);
                        setSelectedGroups(new Set());
                        if (allDevicesSelected) {
                          setAllDevicesSelected(false);
                          setSelectedDevices(new Set());
                        }
                      } else {
                        setAllGroupsSelected(true);
                      }
                    }}
                    onToggleAllDevices={(keys) => {
                      if (keys.length === 0) {
                        setAllDevicesSelected(false);
                        setSelectedDevices(new Set());
                      } else {
                        setAllDevicesSelected(true);
                      }
                    }}
                    allDevicesSelected={allDevicesSelected}
                    allGroupsSelected={allGroupsSelected}
                    mqttGroups={mqttGroups}
                  />
                </div>

                <div className="app-logs-container flex-1 overflow-y-auto custom-scrollbar p-0 bg-surface-container-low/10">
                  {displayLogs.length > 0 ? (
                    <div className="flex flex-col">
                      {[...displayLogs].reverse().slice(0, visibleAlerts).map((log, idx) => (
                        <div key={log.id || idx} className="border-b border-outline-variant/5">
                          <LogEntry log={log} onClick={() => setSelectedLog(log)} mqttServers={mqttServers} />
                        </div>
                      ))}
                      {visibleAlerts < displayLogs.length && (
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
            ) : mainTab === 'emap' ? (
              <DeviceDraggablePanel
                devices={devices}
                mqttGroups={mqttGroups}
                mqttDevicesByServer={mqttDevicesByServer}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                title={t('app.emap.drag_to_pin')}
              />
            ) : (
              <div className="device-draggable-container flex-1 overflow-y-auto custom-scrollbar p-3 bg-surface-container-low/10 flex flex-col gap-2 relative">
                <div className="flex items-center justify-between sticky top-0 py-1 z-10 backdrop-blur-md mb-2 rounded-md px-1">
                  <span className="text-[9px] uppercase tracking-widest text-on-surface-variant opacity-70 font-bold">{t('app.alert_wall.drag_to_assign')}</span>
                  <button
                    onClick={() => {
                      console.log(devices);
                      const svmsDevices = Object.values(devices).flatMap(server => {
                        if (!server.server) return [];
                        return (server.devices || []).map(dev => ({
                          server_serial: server.server.serial,
                          server_id: server.server.server_id,
                          device_ip: dev.ip,
                          device_name: dev.name,
                          device_type: dev.type || 'vms'
                        }));
                      });

                      const mqttDevices = mqttGroups.flatMap(ms => {
                        const mqttDevs = mqttDevicesByServer[ms.id] || [];
                        return mqttDevs.map(dev => ({
                          server_serial: ms.id,
                          server_id: ms.id,
                          device_ip: dev.devEui,
                          device_name: dev.deviceName,
                          device_type: 'mqtt-sensor',
                          mqtt_device_id: (dev as any).id
                        }));
                      });

                      const sunellDevices = cameraDevices.filter(cam => cam.type === 'sunell').map(cam => ({
                        server_serial: 'SUNELL',
                        server_id: 'SUNELL-LOCAL',
                        device_ip: cam.id,
                        device_name: cam.name || cam.cameraIp,
                        device_type: 'sunell'
                      }));

                      const allDevices = [...svmsDevices, ...mqttDevices, ...sunellDevices];
                      console.log('allDevices', allDevices);

                      // Calculate required columns to fit all devices
                      let newGridCols = gridCols;
                      const requiredCols = Math.ceil(Math.sqrt(allDevices.length));
                      if (requiredCols > newGridCols) {
                        newGridCols = requiredCols;
                      }

                      const maxGrids = Math.pow(newGridCols, 2);
                      const newGrids = [...grids];

                      for (const dev of allDevices) {
                        const isAssigned = newGrids.some(g => gridHasDevice(g, dev));
                        if (isAssigned) continue;

                        let emptyGridID = -1;
                        for (let i = 0; i < maxGrids; i++) {
                          if (!newGrids[i]) {
                            emptyGridID = i;
                            break;
                          }
                        }
                        console.log('emptyGridID', emptyGridID);
                        if (emptyGridID === -1) break;

                        newGrids[emptyGridID] = {
                          gridID: emptyGridID,
                          device: dev,
                          devices: [dev]
                        };
                      }
                      console.log('newGrids', newGrids, 'newGridCols', newGridCols);
                      saveGridLayout(newGrids, newGridCols);
                    }}
                    className="text-[9px] font-bold uppercase tracking-widest bg-primary/20 hover:bg-primary/30 text-primary px-3 py-1.5 rounded transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    {t('app.alert_wall.auto_config')}
                  </button>
                </div>

                {/* Server & Group Section */}
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/80">Server & Group</span>
                  <div className="flex-1 h-px bg-outline-variant/10"></div>
                </div>

                {Object.values(devices).flatMap(server => {
                  if (!server.server || !server.devices?.length) return [];
                  const groupDevices = server.devices.map(dev => ({
                    server_serial: server.server.serial,
                    server_id: server.server.server_id,
                    device_ip: dev.ip,
                    device_name: dev.name,
                    device_type: dev.type || 'vms'
                  }));
                  const assignedGrids = grids.filter((g: any) => groupDevices.some(dev => gridHasDevice(g, dev)));
                  return (
                    <div
                      key={`svms-group-${server.server.server_id}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                          server_serial: server.server.serial,
                          server_id: server.server.server_id,
                          device_ip: server.server.server_id,
                          device_name: server.server.server_name || server.server.server_id,
                          device_type: 'svms-server',
                          devices: groupDevices,
                        }));
                      }}
                      className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-primary/5 border-primary/20' : 'bg-surface-container border-outline-variant/10'}`}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-primary transition-colors truncate">
                        {server.server.server_name || server.server.server_id}
                      </span>
                      <span className="text-[9px] text-on-surface-variant/70 font-mono">{groupDevices.length} devices</span>
                    </div>
                  );
                })}

                {mqttGroups.map(group => {
                  const groupDevices = (mqttDevicesByServer[group.id] || []).map((dev: any) => ({
                    server_serial: group.id,
                    server_id: group.id,
                    device_ip: dev.devEui,
                    device_name: dev.deviceName,
                    device_type: 'mqtt-sensor',
                    mqtt_device_id: dev.id
                  }));
                  if (groupDevices.length === 0) return null;
                  const assignedGrids = grids.filter((g: any) => groupDevices.some(dev => gridHasDevice(g, dev)));
                  return (
                    <div
                      key={`mqtt-group-${group.id}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                          server_serial: group.id,
                          server_id: group.id,
                          device_ip: group.id,
                          device_name: group.name,
                          device_type: 'mqtt-group',
                          devices: groupDevices,
                        }));
                      }}
                      className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-surface-container border-outline-variant/10'}`}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-amber-400 transition-colors truncate">
                        {group.name}
                      </span>
                      <span className="text-[9px] text-on-surface-variant/70 font-mono">{groupDevices.length} devices</span>
                    </div>
                  );
                })}

                {/* SVMS Camera Devices Section */}
                {/* <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">{t('app.alert_wall.svms_camera_devices')}</span>
                  <div className="flex-1 h-px bg-primary/10"></div>
                </div>

                {Object.values(devices).flatMap(server => {
                  if (!server.server) return [];
                  return (server.devices || []).map(dev => {
                    const dragDevice = {
                      server_serial: server.server.serial,
                      server_id: server.server.server_id,
                      device_ip: dev.ip,
                      device_name: dev.name,
                      device_type: dev.type || 'vms'
                    };
                    const assignedGrids = grids.filter(g => gridHasDevice(g, dragDevice));
                    const assignedText = assignedGrids.map(g => g.gridID + 1).join(', ');
                    return (
                      <div
                        key={`${server.server.server_id}-${dev.ip}-${dev.name}`}
                        draggable
                        title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify({
                            ...dragDevice
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
                )} */}

                {/* MQTT Sensor Devices Section */}
                <div className="flex items-center gap-2 mt-1 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400/80">
                    {t('app.alert_wall.lora_devices')}
                  </span>
                </div>

                {mqttGroups.map(ms => {
                  const mqttDevs = mqttDevicesByServer[ms.id] || [];
                  if (mqttDevs.length === 0) return null;
                  return (
                    <div key={ms.id} className="flex flex-col gap-1 mb-2">
                      <div className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/50 px-1">
                        {ms.name}
                      </div>
                      {mqttDevs.map(dev => {
                        const dragDevice = {
                          server_serial: ms.id,
                          server_id: ms.id,
                          device_ip: dev.devEui,
                          device_name: dev.deviceName,
                          device_type: 'mqtt-sensor',
                          mqtt_device_id: (dev as any).id
                        };
                        const assignedGrids = grids.filter((g: any) => gridHasDevice(g, dragDevice));
                        const assignedText = assignedGrids.map((g: any) => g.gridID + 1).join(', ');
                        const link = deviceCameraLinks.find(l => l.mqttDeviceId === (dev as any).id || (l.devEui === dev.devEui && l.groupId === ms.id));
                        return (
                          <div
                            key={`${ms.id}-${dev.devEui}`}
                            draggable
                            title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/json', JSON.stringify({
                                ...dragDevice
                              }));
                            }}
                            className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-surface-container border-outline-variant/10'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col">
                                <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-amber-400 transition-colors truncate">{dev.deviceName}</span>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {link && (() => {
                                  const linkedCam = cameraDevices.find(c => c.id === link.cameraId);
                                  const camLabel = linkedCam?.name || linkedCam?.cameraIp || (link.cameraId ? link.cameraId.slice(-6) : 'Default');
                                  return <span className="text-[8px] px-1 py-0.5 rounded uppercase font-bold bg-cyan-500/20 text-cyan-500">📷 {camLabel}</span>;
                                })()}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {!mqttGroups.some(ms => (mqttDevicesByServer[ms.id] || []).length > 0) && (
                  <div className="p-4 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/10 rounded">
                    <span className="text-[9px] uppercase font-bold tracking-widest">{t('app.alert_wall.no_mqtt_devices')}</span>
                  </div>
                )}

                {/* Sunell Cameras Section */}
                {/* <div className="flex items-center gap-2 mt-4 mb-1 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-secondary/80">Sunell Camera</span>
                  <div className="flex-1 h-px bg-secondary/10"></div>
                </div>
                {cameraDevices.filter(cam => cam.type === 'sunell').map(cam => {
                  const dragDevice = {
                    server_serial: 'SUNELL',
                    server_id: 'SUNELL-LOCAL',
                    device_ip: cam.id,
                    device_name: cam.name || cam.cameraIp,
                    device_type: 'sunell'
                  };
                  const assignedGrids = grids.filter((g: any) => gridHasDevice(g, dragDevice));
                  const assignedText = assignedGrids.map((g: any) => g.gridID + 1).join(', ');
                  return (
                    <div
                      key={cam.id}
                      draggable
                      title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                          ...dragDevice
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
                )} */}
              </div>
            )}
          </aside>
        )}
      </main>

      {/* ── Footer Bar ──────────────────────────────────────────────────── */}
      {!isAlertWallFullscreen && (
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
          {/* <div className="flex items-center gap-1.5">
            <span className="text-on-surface-variant/60 uppercase tracking-widest font-bold text-[8px]">{t('app.footer.save_logs')}</span>
            <div
              onClick={toggleLogSaving}
              className={`relative w-6 h-3.5 rounded-full cursor-pointer transition-colors duration-200 ${isLogSaving ? 'bg-secondary' : 'bg-outline-variant/30'}`}
            >
              <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform duration-200 ${isLogSaving ? 'translate-x-2.5' : 'translate-x-0'}`} />
            </div>
            <span className={`font-bold text-[8px] uppercase tracking-widest ${isLogSaving ? 'text-secondary' : 'text-on-surface-variant/40'}`}>{isLogSaving ? t('app.footer.on') : t('app.footer.off')}</span>
          </div>

          <div className="w-px h-3 bg-outline-variant/15" /> */}

          {/* View System Data - hidden */}
          {/* <div className="ViewSystemData flex items-center gap-1.5">...</div> */}

          {/* Clear History Button */}
          <button
            onClick={async () => {
              if (!window.confirm('Xóa toàn bộ lịch sử event? Hành động này không thể hoàn tác.')) return;
              try {
                await apiClient.delete('/api/v1/logs/all');
                socket.emit('clear-logs');
              } catch (err) {
                console.error('[CLEAR_LOGS] Failed:', err);
                alert('Xóa lịch sử thất bại!');
              }
            }}
            className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[8px] font-bold uppercase tracking-widest rounded border border-red-500/20 transition-all cursor-pointer"
            title="Xóa toàn bộ lịch sử event"
          >
            <Trash2 className="w-3 h-3" />
            Xóa lịch sử
          </button>


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
                <div className="absolute bottom-full right-0 mb-1 z-50 bg-surface-container-high border border-outline-variant/20 rounded shadow-lg min-w-[150px] animate-in fade-in slide-in-from-bottom-2 duration-150">
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
      )}

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
          mqttServers={mqttServers}
          servers={servers}
        />
      )}
    </div>
  );
}




