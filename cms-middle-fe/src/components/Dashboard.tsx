import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { EventTypeItem, LogData, ServerData, DeviceData } from '../types';
import { useTranslation } from 'react-i18next';
import { useSocketManager } from '../hooks/useSocketManager';
import { EventStatistic } from './EventStatistic';
import { LogPopup } from './LogPopup';
import { SlidersHorizontal, Terminal, Check, Cpu, MonitorSmartphone, Settings, Monitor, Network, PanelRightOpen, PanelRightClose, Languages, LogOut, ChevronDown, MapPinned, Car, Tv, Layers } from 'lucide-react';
import { ConfigSystem } from './ConfigSystem';
import apiClient from '../api/apiClient';
import { LogEntry } from './LogEntry';
import { AlertWall } from './AlertWall';
import { DevicesManagement } from './DevicesManagement';
import { authApi } from '../api/authApi';
import { EMap } from './EMap';
import { DeviceDraggablePanel } from './DeviceDraggablePanel';
import { TrafficManagement } from './TrafficManagement';
import { LiveWall } from './LiveWall';
import { AreaManagement } from './AreaManagement';
import { NewDashboard } from './NewDashboard';

export function LogFilter({
  logs,
  servers,
  devices,
  mqttServers,
  mqttDevicesByServer,
  cameraDevices,
  eventTypes,
  selectedServers,
  selectedDevices,
  selectedEventTypes,
  onToggleServer,
  onToggleDevice,
  onToggleEventType,
  onToggleAllEventTypes,
  onToggleAllServers,
  onToggleAllDevices,
}: {
  logs: LogData[];
  servers: Record<string, ServerData>;
  devices: Record<string, DeviceData>;
  mqttServers?: any[];
  mqttDevicesByServer?: Record<string, any[]>;
  cameraDevices?: any[];
  eventTypes: EventTypeItem[];
  selectedServers: Set<string>;
  selectedDevices: Set<string>;
  selectedEventTypes: string[];
  onToggleServer: (id: string) => void;
  onToggleDevice: (ip: string) => void;
  onToggleEventType: (type: string | string[]) => void;
  onToggleAllEventTypes: (checked: boolean) => void;
  onToggleAllServers: (ids: string[]) => void;
  onToggleAllDevices: (keys: string[]) => void;
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
      (serverData.devices || []).map(d => {
        const rawIp = d.ip || d.device_ip || 'unknown-ip';
        const cleanIp = typeof rawIp === 'string' ? rawIp.split(':')[0] : String(rawIp);
        return {
          ...d,
          ip: cleanIp,
          serverId: serverData.server.server_id,
          originalName: undefined
        };
      })
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

  const activeCount = selectedServers.size + selectedDevices.size + selectedEventTypes.length;

  const isAllServersChecked = serverList.length > 0 && serverList.every(srv => selectedServers.has(srv.id));

  const isAllDevicesChecked = deviceList.length > 0 && deviceList.every(dev => {
    const uniqueKey = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
    return selectedDevices.has(uniqueKey);
  });

  const handleServerClick = (id: string) => {
    onToggleServer(id);
    setTimeout(() => {
      const el = document.getElementById(`device-group-${id}`) ||
        document.getElementById(`device-group-mqtt-${id}`) ||
        document.getElementById(`device-group-mqtt-mqtt-${id}`);
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
          {/* Servers */}
          <div className="px-2 pt-2 pb-0.5">
            <button
              onClick={() => setShowServers(!showServers)}
              className="flex items-center justify-between w-full mb-1 p-1 rounded-md transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-secondary" />
                <span className="text-[12px] font-black uppercase tracking-widest text-secondary">{t('app.filter.servers')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-secondary/50 transition-transform duration-300 ${showServers ? 'rotate-180' : ''}`} />
            </button>
            {showServers && (
              serverList.length === 0 ? (
                <p className="text-[11px] text-on-surface-variant/40 py-0.5 pl-1">{t('app.filter.no_servers')}</p>
              ) : (
                <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-200 cursor-pointer">
                  <button
                    onClick={() => {
                      if (isAllServersChecked) {
                        onToggleAllServers([]);
                      } else {
                        onToggleAllServers(serverList.map(srv => srv.id));
                      }
                    }}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-container transition-colors w-full text-left border-b border-outline-variant/10 pb-1 pt-1 first:pt-0.5 shrink-0"
                  >
                    <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${isAllServersChecked ? 'bg-secondary border-secondary' : 'border-outline-variant'
                      }`}>
                      {isAllServersChecked && <Check className="w-2 h-2 text-white stroke-[3]" />}
                    </div>
                    <span className="text-[10px] font-semibold text-on-surface truncate">{t('app.filter.all')}</span>
                  </button>
                  {serverList.map(srv => {
                    const id = srv.id;
                    const checked = selectedServers.has(id);
                    return (
                      <button
                        key={id}
                        onClick={() => handleServerClick(id)}
                        className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-container transition-colors w-full text-left border-b border-outline-variant/10 last:border-b-0 pb-1 pt-1 first:pt-0.5 last:pb-0.5"
                      >
                        <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-secondary border-secondary' : 'border-outline-variant'
                          }`}>
                          {checked && <Check className="w-2 h-2 text-white stroke-[3]" />}
                        </div>
                        <span className="text-[10px] font-semibold text-on-surface shrink-0">{srv.name}</span>
                        <span className="text-[8px] font-mono text-on-surface-variant/75 ml-auto truncate">{srv.type} - {srv.ip}</span>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>

          <div className="mx-2 my-1 border-t border-outline-variant/10" />

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
                    let groupLabel = serverKey;
                    if (serverKey === 'SUNELL-LOCAL_sunell') {
                      groupLabel = t('app.devices.sunell_cameras');
                    } else if (serverKey.startsWith('SUNELL-LOCAL_')) {
                      groupLabel = t('app.devices.cameras');
                    } else if (serverKey.startsWith('mqtt-')) {
                      const mqttId = serverKey.replace('mqtt-', '');
                      const mqttSrv = (mqttServers || []).find(s => s.id === mqttId);
                      groupLabel = `MQTT RADAR (${mqttSrv?.brokerHost || mqttId})`;
                    } else {
                      const srv = Object.values(servers).find(s => s.id === serverKey || s.serial === serverKey);
                      groupLabel = `SVMS SERVER (${srv?.server_name || serverKey})`;
                    }

                    return (
                      <div key={serverKey} id={`device-group-${serverKey}`} className="flex flex-col gap-[1px] border-b border-outline-variant/5 pb-1 mb-0.5 last:border-0 last:pb-0 last:mb-0">
                        <div className="text-[7px] font-black uppercase tracking-widest text-on-surface/90 border-l border-outline-variant/50 pl-1 py-0 mb-0.5 mt-0.5">
                          {groupLabel}
                        </div>
                        {devs.map(dev => {
                          const uniqueKey = `${dev.serverId}_${dev.ip}_${dev.originalName || dev.name}`;
                          const checked = selectedDevices.has(uniqueKey);
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
    areaLayout,
    saveGridLayout,
    saveEMapLayout,
    saveAreaLayout,
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
  const [excludedServers, setExcludedServers] = useState<Set<string>>(new Set());
  const [excludedDevices, setExcludedDevices] = useState<Set<string>>(new Set());
  const [excludedEventTypes, setExcludedEventTypes] = useState<Set<string>>(new Set());

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

  // Compute serverList and deviceList inside Dashboard to enable default-check-all on load
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
  }, [devices, cameraDevices, mqttDevicesByServer, mqttServers]);


  const [rightTab, setRightTab] = useState<'logs' | 'devices'>('logs');
  const [mainTab, setMainTab] = useState<'alert' | 'emap' | 'event_statistic' | 'devices_management' | 'traffic_management' | 'livewall' | 'area_management' | 'newDashboard'>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'new_dashboard' || tabParam === 'newDashboard') return 'newDashboard';
    if (tabParam === 'alertwall' || tabParam === 'alert') return 'alert';
    if (tabParam === 'traffic' || tabParam === 'traffic_management') return 'traffic_management';
    if (tabParam === 'emap') return 'emap';
    if (tabParam === 'connections' || tabParam === 'event_statistic') return 'event_statistic';
    if (tabParam === 'devices' || tabParam === 'devices_management') return 'devices_management';
    if (tabParam === 'livewall') return 'livewall';
    if (tabParam === 'area' || tabParam === 'area_management') return 'area_management';
    return 'emap';
  });
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

  const toggleServer = useCallback((id: string) => {
    const isCurrentlyExcluded = excludedServers.has(id);
    const willExclude = !isCurrentlyExcluded;

    setExcludedServers(prev => {
      const next = new Set(prev);
      if (willExclude) next.add(id); else next.delete(id);
      return next;
    });

    setExcludedDevices(prevDevs => {
      const nextDevs = new Set(prevDevs);
      const syncDevices = (devsList: any[], getKey: (dev: any) => string) => {
        devsList.forEach(dev => {
          const devKey = getKey(dev);
          if (willExclude) nextDevs.add(devKey); else nextDevs.delete(devKey);
        });
      };

      if (devices[id]) {
        syncDevices(devices[id].devices || [], dev => {
          const rawIp = dev.ip || '';
          const cleanIp = typeof rawIp === 'string' ? rawIp.split(':')[0] : String(rawIp);
          return `${devices[id].server.server_id}_${cleanIp}_${dev.name}`;
        });
      }

      if (mqttDevicesByServer[id]) {
        syncDevices(mqttDevicesByServer[id], dev => {
          const devName = dev.deviceName || 'MQTT Device';
          return `${id}_${dev.devEui}_${devName}`;
        });
      }

      return nextDevs;
    });
  }, [excludedServers, devices, mqttDevicesByServer]);

  const toggleDevice = useCallback((ip: string) => {
    setExcludedDevices(prevDevs => {
      const nextDevs = new Set(prevDevs);
      const isCurrentlyExcluded = nextDevs.has(ip);
      const willExclude = !isCurrentlyExcluded;

      if (willExclude) {
        nextDevs.add(ip);
      } else {
        nextDevs.delete(ip);
      }

      // Sync with parent Server checkbox state
      const serverId = ip.split('_')[0];
      if (serverId) {
        let allDeviceKeys: string[] = [];
        if (devices[serverId]) {
          const serverData = devices[serverId];
          const allDevices = serverData?.devices || [];
          allDeviceKeys = allDevices.map(dev => {
            const rawIp = dev.ip || '';
            const cleanIp = typeof rawIp === 'string' ? rawIp.split(':')[0] : String(rawIp);
            return `${serverData.server.server_id}_${cleanIp}_${dev.name}`;
          });
        } else if (mqttDevicesByServer[serverId]) {
          const mqttDevs = mqttDevicesByServer[serverId] || [];
          allDeviceKeys = mqttDevs.map(dev => {
            const devName = dev.deviceName || 'MQTT Device';
            return `${serverId}_${dev.devEui}_${devName}`;
          });
        }

        if (allDeviceKeys.length > 0) {
          // If any device of this server is excluded, the server checkbox gets unticked (added to exclusion)
          // If all devices of this server are ticked (none excluded), the server checkbox gets ticked (removed from exclusion)
          const anyDeviceExcluded = allDeviceKeys.some(k => nextDevs.has(k));
          setExcludedServers(prevServers => {
            const nextServers = new Set(prevServers);
            if (anyDeviceExcluded) {
              nextServers.add(serverId);
            } else {
              nextServers.delete(serverId);
            }
            return nextServers;
          });
        }
      }

      return nextDevs;
    });
  }, [devices, mqttDevicesByServer]);

  const displayLogs = useMemo(() => {
    return logs.filter(log => {
      // 1. Event Type filter (Exclusion)
      if (log.log_type && excludedEventTypes.has(log.log_type)) {
        return false;
      }

      // 2. Server filter (Exclusion)
      let logServerId = log.server_unique_id;
      if (log.log_source === 'sunell-camera') {
        logServerId = 'SUNELL-LOCAL';
      } else if (log.log_source === 'svms' && logServerId) {
        const parts = logServerId.split('-');
        logServerId = parts[parts.length - 1] || logServerId;
      }

      let isServerExcluded = excludedServers.has(logServerId);

      // 3. Device filter (Exclusion)
      let logDeviceIp = log.device_info.id;
      if (log.log_source === 'svms') {
        const rawLdIp = log.raw?.device_ip || log.device_info.id || '';
        logDeviceIp = typeof rawLdIp === 'string' ? rawLdIp.split(':')[0] : String(rawLdIp);
      }
      const devKey = `${logServerId}_${logDeviceIp}_${log.device_info.name}`;
      let isDeviceExcluded = excludedDevices.has(devKey);

      // Special check: If a device is NOT excluded, we override server exclusion (meaning the server log is shown)
      if (!isDeviceExcluded) {
        isServerExcluded = false;
      }

      // Linkage for Independent/Sunell Camera logs:
      if (log.log_source === 'sunell-camera') {
        const isLinkedToActiveRadar = deviceCameraLinks.some(link => {
          if (link.cameraId !== log.device_info.id) return false;
          const groupId = link.groupId || link.mqttServerId || '';
          const devs = mqttDevicesByServer[groupId] || [];
          const dev = devs.find(d => d.devEui === link.devEui);
          if (!dev) return false;
          const devName = dev.deviceName || 'MQTT Device';
          const radarKey = `${groupId}_${dev.devEui}_${devName}`;
          // Active means not excluded
          return !excludedDevices.has(radarKey);
        });

        const isLinkedToActiveServer = deviceCameraLinks.some(link => {
          return link.cameraId === log.device_info.id && 
            !excludedServers.has(link.groupId || link.mqttServerId || '');
        });

        if (isLinkedToActiveRadar) isDeviceExcluded = false;
        if (isLinkedToActiveServer) isServerExcluded = false;
      }

      return !isServerExcluded && !isDeviceExcluded;
    });
  }, [logs, excludedServers, excludedDevices, excludedEventTypes, deviceCameraLinks, mqttDevicesByServer]);


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
    <div className="Dashboard flex flex-col h-screen overflow-hidden bg-background text-on-surface font-sans selection:bg-primary/30 antialiased">
      <main className={`app-dashboard-main flex-1 overflow-hidden ${isNarrow ? 'flex flex-col' : ((mainTab === 'alert' || mainTab === 'emap' || mainTab === 'livewall') && !isAlertWallFullscreen) ? 'grid grid-cols-4 gap-0' : 'flex'}`}>
        {/* Main Section */}
        <div className={`app-dashboard-left-section overflow-hidden bg-background border-outline-variant/20 ${isNarrow ? 'flex-1 border-b' : ((mainTab === 'alert' || mainTab === 'emap' || mainTab === 'livewall') && !isAlertWallFullscreen) ? 'col-span-3 grid grid-rows-[1fr] h-full border-r' : 'flex-1 h-full'}`}>
          <div className="flex flex-col overflow-hidden h-full">
            {!isAlertWallFullscreen && (
              <div className={`appTabsBar flex items-center border-b border-outline-variant/10 shrink-0 ${isNarrow ? '' : 'px-6 gap-2'}`}>
                {/* Nút chuyển sang màn hình Bản đồ số (EMap) */}
                <button
                  className={`emap flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'emap' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('emap')}
                >
                  <MapPinned className={`w-5 h-5 ${mainTab === 'emap' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'emap' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.emap')}</h2>
                </button>
                {/* Nút chuyển sang màn hình New Dashboard */}
                <button
                  className={`newDashboard flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'newDashboard' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('newDashboard')}
                >
                  <Tv className={`w-5 h-5 ${mainTab === 'newDashboard' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'newDashboard' ? 'text-primary' : 'text-on-surface'}`}>New Dashboard</h2>
                </button>
                {/* Nhóm nút Giám sát sự kiện và Live Wall*/}
                <button
                  className={`alert flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'alert' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('alert')}
                >
                  <Monitor className={`w-5 h-5 ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'alert' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.alert_wall')}</h2>
                </button>
                {/* Nút chuyển sang màn hình Xem trực tiếp (Live Wall) */}
                {/* <button
                  className={`livewall flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'livewall' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('livewall')}
                >
                  <Tv className={`w-5 h-5 ${mainTab === 'livewall' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'livewall' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.livewall')}</h2>
                </button> */}
                {/* Nút chuyển sang màn hình Quản lý giao thông (Traffic Management) */}
                <button
                  className={`traffic_management flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'traffic_management' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('traffic_management')}
                >
                  <Car className={`w-5 h-5 ${mainTab === 'traffic_management' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'traffic_management' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.traffic_management')}</h2>
                </button>
                {/* Nút chuyển sang màn hình Quản lý Thiết bị (Devices Management) */}
                <button
                  className={`devices_management flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'devices_management' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('devices_management')}
                >
                  <Cpu className={`w-5 h-5 ${mainTab === 'devices_management' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'devices_management' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.devices_management')}</h2>
                </button>
                {/* Nút chuyển sang màn hình Quản lý Khu vực (Area Management) */}
                <button
                  className={`area_management flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'area_management' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('area_management')}
                >
                  <Layers className={`w-5 h-5 ${mainTab === 'area_management' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'area_management' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.area_management', 'Quản lý khu vực')}</h2>
                </button>
                {/* Nút chuyển sang màn hình Giám sát sự kiện (Event Statistic) */}
                <button
                  className={`event_statistic flex items-center gap-2 px-3 py-3 border-b-2 transition-all ${isNarrow ? 'flex-1 justify-center' : ''} ${mainTab === 'event_statistic' ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100 hover:bg-surface-container/50'}`}
                  onClick={() => setMainTab('event_statistic')}
                >
                  <Network className={`w-5 h-5 ${mainTab === 'event_statistic' ? 'text-primary' : 'text-on-surface'}`} />
                  <h2 className={`text-[10px] font-bold tracking-[0.2em] uppercase ${mainTab === 'event_statistic' ? 'text-primary' : 'text-on-surface'}`}>{t('app.sidebar.event_statistic')}</h2>
                </button>
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
            {mainTab === 'event_statistic' && (
              <EventStatistic
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
                knownDevices={eMapKnownDevices}
                onSaveLayout={saveEMapLayout}
              />
            )}
            {mainTab === 'devices_management' && (
              <DevicesManagement
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
            {mainTab === 'traffic_management' && (
              <TrafficManagement
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
            {mainTab === 'area_management' && (
              <AreaManagement
                servers={servers}
                devices={devices}
                mqttServers={mqttServers}
                mqttGroups={mqttGroups}
                mqttDevicesByServer={mqttDevicesByServer}
                cameraDevices={cameraDevices}
                fetchCameras={fetchCameras}
                handleAddMqttServer={handleAddMqttServer}
                areaLayout={areaLayout}
                saveAreaLayout={saveAreaLayout}
              />
            )}
            {mainTab === 'newDashboard' && (
              <NewDashboard
                logs={logs}
                displayLogs={displayLogs}
                visibleAlerts={visibleAlerts}
                setVisibleAlerts={setVisibleAlerts}
                selectedLog={selectedLog}
                setSelectedLog={setSelectedLog}
                servers={servers}
                devices={devices}
                mqttServers={mqttServers}
                mqttGroups={mqttGroups}
                mqttDevicesByServer={mqttDevicesByServer}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                eventTypes={eventTypes}
                excludedServers={excludedServers}
                setExcludedServers={setExcludedServers}
                excludedDevices={excludedDevices}
                setExcludedDevices={setExcludedDevices}
                excludedEventTypes={excludedEventTypes}
                setExcludedEventTypes={setExcludedEventTypes}
                toggleServer={toggleServer}
                toggleDevice={toggleDevice}
                pins={eMapLayout.pins}
                tileProviderId={eMapLayout.tileProviderId}
                knownDevices={eMapKnownDevices}
                onSaveLayout={saveEMapLayout}
                areaLayout={areaLayout}
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
              <DeviceDraggablePanel
                devices={devices}
                mqttGroups={mqttGroups}
                mqttDevicesByServer={mqttDevicesByServer}
                cameraDevices={cameraDevices}
                deviceCameraLinks={deviceCameraLinks}
                grids={grids}
                gridHasDevice={gridHasDevice}
                title={t('app.alert_wall.drag_to_assign')}
                onAutoConfig={() => {
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
                    if (emptyGridID === -1) break;

                    newGrids[emptyGridID] = {
                      gridID: emptyGridID,
                      device: dev,
                      devices: [dev]
                    };
                  }
                  saveGridLayout(newGrids, newGridCols);
                }}
              />
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

          {/* View System Data */}
          <div className="ViewSystemData flex items-center gap-1.5">
            <button
              onClick={async () => {
                console.log("=== FRONTEND STATE (NEW ARCH) ===");
                console.log("1. Canonical Logs (FE view source):", logs);
                console.log("2. Snapshot Logs (LogData):", newSvmsLogs);
                console.log("3. SVMS Servers (map):", servers);
                console.log("4. SVMS Devices (map):", devices);
                console.log("5. SVMS Servers (snapshot raw):", newSvmsServers);
                console.log("6. SVMS Devices (snapshot raw):", newSvmsDevices);
                console.log("7. MQTT Servers (canonical):", mqttServers);
                console.log("8. MQTT Servers (snapshot):", mqttMilesightServers);
                console.log("9. MQTT Devices (snapshot):", mqttMilesightDevices);
                console.log("10. Camera Devices:", cameraDevices);

                console.log("12. Connections RECEIVE:", receiveServers);
                console.log("13. Event Types (FE filter):", eventTypes);
                console.log("14. Total Log Count:", totalLogCount);
                console.log("15. Socket Connected:", isConnected);
                console.log("16. System Config:", systemConfig);

                let backendState = null;
                try {
                  const res = await apiClient.get('/api/v1/debug/state');
                  backendState = res.data;
                  console.log("17. Backend In-Memory State:", backendState);
                } catch (err) {
                  console.warn('[DEBUG] Unable to fetch BE state:', err);
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const debugData = {
                  _export_time: new Date().toISOString(),
                  _summary: {
                    totalAllLogs: logs.length,
                    totalSnapshotLogs: newSvmsLogs.length,
                    totalMqttLogsFromAllLogs: mqttLogs.length,
                    totalMqttServersCanonical: mqttServers.length,
                    totalMqttDevicesSnapshot: mqttMilesightDevices.length,
                    totalCameraDevices: cameraDevices.length,
                    totalSvmsServersMap: Object.keys(servers).length,
                    totalSvmsDevicesMap: Object.keys(devices).length,

                    totalReceiveConnections: receiveServers.length,
                    socketConnected: isConnected,
                    totalLogCount,
                    snapshot_svmsServers: newSvmsServers.length,
                    snapshot_svmsDevices: newSvmsDevices.length,
                    snapshot_mqttServers: mqttMilesightServers.length,
                  },
                  frontend: {
                    allLogs: logs,
                    snapshotLogs: newSvmsLogs,
                    mqttServersCanonical: mqttServers,
                    mqttServersSnapshot: mqttMilesightServers,
                    mqttDevicesSnapshot: mqttMilesightDevices,
                    mqttLogsFromAllLogs: mqttLogs,
                    cameraDevices,
                    svmsServersMap: servers,
                    svmsDevicesMap: devices,
                    svmsServersSnapshot: newSvmsServers,
                    svmsDevicesSnapshot: newSvmsDevices,

                    receiveConnections: receiveServers,
                    systemConfig,
                    eventTypes,
                  },
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

                alert(`Da xuat file: cms-debug-data_${timestamp}.txt\n\nTotal Logs: ${logs.length}\nMQTT Servers: ${mqttServers.length}\nMQTT Devices: ${mqttMilesightDevices.length}\nCamera Devices: ${cameraDevices.length}\nBackend state: ${backendState ? 'OK' : 'UNAVAILABLE'}`);
              }} className="px-2 py-0.5 bg-primary text-on-primary text-[8px] font-bold uppercase tracking-widest rounded shadow-sm hover:opacity-80 transition-opacity"
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




