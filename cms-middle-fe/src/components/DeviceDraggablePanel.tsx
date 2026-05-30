import React, { useState, useMemo } from 'react';
import { 
  Folder, 
  ChevronRight, 
  ChevronDown, 
  Camera, 
  Radio, 
  Search, 
  X, 
  Layers, 
  Terminal
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Props = {
  devices: Record<string, any>;
  mqttGroups: any[];
  mqttDevicesByServer: Record<string, any[]>;
  cameraDevices: any[];
  deviceCameraLinks: any[];
  grids?: any[];
  gridHasDevice?: (grid: any, device: any) => boolean;
  title?: string;
  onAutoConfig?: () => void;
};

export function DeviceDraggablePanel({
  devices,
  mqttGroups,
  mqttDevicesByServer,
  cameraDevices,
  deviceCameraLinks,
  grids = [],
  gridHasDevice = () => false,
  title,
  onAutoConfig,
}: Props) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set(['root-svms', 'root-mqtt', 'root-sunell']));

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const s = new Set(prev);
      if (s.has(nodeId)) s.delete(nodeId); else s.add(nodeId);
      return s;
    });
  };

  const getAssignedText = (dragDevice: any) => {
    const assignedGrids = grids.filter((g: any) => gridHasDevice(g, dragDevice));
    return {
      assignedGrids,
      assignedText: assignedGrids.map((g: any) => g.gridID + 1).join(', '),
    };
  };

  // 1. Process SVMS Tree Data
  const svmsTree = useMemo(() => {
    return Object.values(devices)
      .filter((server: any) => server.server && server.devices?.length > 0)
      .map((server: any) => {
        const serverId = server.server.server_id;
        const serverSerial = server.server.serial;
        const serverName = server.server.server_name || serverId;
        
        const children = server.devices.map((dev: any) => {
          const dragDevice = {
            server_serial: serverSerial,
            server_id: serverId,
            device_ip: dev.ip,
            device_name: dev.name,
            device_type: dev.type || 'vms',
          };
          const { assignedGrids, assignedText } = getAssignedText(dragDevice);
          return {
            id: `${serverId}::${dev.ip}::${dev.name}`,
            name: dev.name,
            ip: dev.ip,
            type: dev.type || 'vms',
            dragDevice,
            assignedGrids,
            assignedText,
          };
        });

        // Pack entire group for group dragging
        const groupDevices = children.map((c: any) => c.dragDevice);
        const groupDragDevice = {
          server_serial: serverSerial,
          server_id: serverId,
          device_ip: serverId,
          device_name: serverName,
          device_type: 'svms-server',
          devices: groupDevices,
        };

        const groupAssignedGrids = grids.filter((g: any) => groupDevices.some((d: any) => gridHasDevice(g, d)));

        return {
          id: `svms-server-${serverId}`,
          name: serverName,
          serial: serverSerial,
          serverId,
          children,
          dragDevice: groupDragDevice,
          assignedGrids: groupAssignedGrids,
        };
      });
  }, [devices, grids, gridHasDevice]);

  // 2. Process MQTT Tree Data
  const mqttTree = useMemo(() => {
    return mqttGroups.map((group: any) => {
      const rawDevices = mqttDevicesByServer[group.id] || [];
      const children = rawDevices.map((dev: any) => {
        const devName = dev.deviceName || dev.deviceProfileName || dev.devEui;
        const dragDevice = {
          server_serial: group.id,
          server_id: group.id,
          device_ip: dev.devEui,
          device_name: devName,
          device_type: 'mqtt-sensor',
          mqtt_device_id: dev.id,
        };
        const { assignedGrids, assignedText } = getAssignedText(dragDevice);
        const hasCameraLink = deviceCameraLinks.some((l: any) => l.mqttDeviceId === dev.id || (l.devEui === dev.devEui && l.groupId === group.id));
        return {
          id: `mqtt-dev-${group.id}-${dev.devEui}`,
          name: devName,
          devEui: dev.devEui,
          type: 'mqtt-sensor',
          dragDevice,
          assignedGrids,
          assignedText,
          hasCameraLink,
        };
      });

      const groupDevices = children.map((c: any) => c.dragDevice);
      const groupDragDevice = {
        server_serial: group.id,
        server_id: group.id,
        device_ip: group.id,
        device_name: group.name,
        device_type: 'mqtt-group',
        devices: groupDevices,
      };

      const groupAssignedGrids = grids.filter((g: any) => groupDevices.some((d: any) => gridHasDevice(g, d)));

      return {
        id: `mqtt-group-${group.id}`,
        name: group.name,
        children,
        dragDevice: groupDragDevice,
        assignedGrids: groupAssignedGrids,
      };
    }).filter(g => g.children.length > 0);
  }, [mqttGroups, mqttDevicesByServer, grids, gridHasDevice, deviceCameraLinks]);

  // 3. Process Sunell Tree Data
  const sunellTree = useMemo(() => {
    const sunellDevices = cameraDevices.filter((c: any) => c.type === 'sunell');
    if (sunellDevices.length === 0) return null;

    const children = sunellDevices.map((cam: any) => {
      const dragDevice = {
        server_serial: 'SUNELL',
        server_id: 'SUNELL-LOCAL',
        device_ip: cam.id,
        device_name: cam.name || cam.cameraIp,
        device_type: 'sunell',
      };
      const { assignedGrids, assignedText } = getAssignedText(dragDevice);
      return {
        id: `sunell-dev-${cam.id}`,
        name: cam.name || cam.cameraIp,
        ip: cam.cameraIp,
        port: cam.cameraPort,
        type: 'sunell',
        dragDevice,
        assignedGrids,
        assignedText,
      };
    });

    const groupDevices = children.map((c: any) => c.dragDevice);
    const groupDragDevice = {
      server_serial: 'SUNELL',
      server_id: 'SUNELL-LOCAL',
      device_ip: 'SUNELL-LOCAL',
      device_name: 'Sunell Cameras',
      device_type: 'sunell-group',
      devices: groupDevices,
    };

    const groupAssignedGrids = grids.filter((g: any) => groupDevices.some((d: any) => gridHasDevice(g, d)));

    return {
      id: 'root-sunell-group',
      name: 'Sunell Cameras',
      children,
      dragDevice: groupDragDevice,
      assignedGrids: groupAssignedGrids,
    };
  }, [cameraDevices, grids, gridHasDevice]);

  // Search Filter Helper
  const matchesSearch = (text: string) => {
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  return (
    <div className="DeviceDraggablePanel flex flex-col flex-1 h-full min-h-0 bg-surface-container-low/10 overflow-hidden select-none">
      {/* Header title */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-primary shrink-0 animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-primary">
            {title || t('app.alert_wall.drag_to_assign')}
          </span>
        </div>
        {onAutoConfig && (
          <button
            onClick={onAutoConfig}
            className="text-[9px] font-bold uppercase tracking-widest bg-primary/20 hover:bg-primary/30 text-primary px-2.5 py-1 rounded transition-all active:scale-95 cursor-pointer shadow-sm shrink-0"
          >
            {t('app.alert_wall.auto_config')}
          </button>
        )}
      </div>

      {/* Quick Search Box */}
      <div className="p-2 border-b border-outline-variant/10 shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm thiết bị, camera..."
            className="w-full bg-background border border-outline-variant/30 rounded-xl pl-8 pr-3 py-1.5 text-[11px] text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Hierarchical Tree Drag & Drop panel */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-3 min-h-0">
        
        {/* ==================== 1. SVMS SECTION ==================== */}
        {svmsTree.length > 0 && (
          <div className="flex flex-col gap-1">
            <div 
              onClick={() => toggleNode('root-svms')}
              className="flex items-center justify-between p-1.5 hover:bg-surface-container rounded-lg cursor-pointer text-[10px] font-black uppercase text-on-surface-variant/90 tracking-wider transition-colors select-none"
            >
              <div className="flex items-center gap-1.5">
                {expandedNodes.has('root-svms') ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span>VMS SERVERS</span>
              </div>
              <span className="text-[9px] font-mono opacity-65 bg-surface-container px-1.5 py-0.5 rounded">{svmsTree.length} server</span>
            </div>

            {expandedNodes.has('root-svms') && (
              <div className="flex flex-col gap-2 pl-2 mt-1 border-l border-outline-variant/10 ml-2 animate-in slide-in-from-top-1 duration-150">
                {svmsTree.map((server: any) => {
                  const filteredChildren = server.children.filter((c: any) => !searchQuery || matchesSearch(c.name) || matchesSearch(c.ip));
                  const serverMatches = !searchQuery || matchesSearch(server.name) || filteredChildren.length > 0;
                  
                  if (!serverMatches) return null;
                  const isExpanded = expandedNodes.has(server.id) || !!searchQuery;
                  const isAssigned = server.assignedGrids.length > 0;

                  return (
                    <div key={server.id} className="flex flex-col gap-1">
                      {/* Server Folder (Draggable Group) */}
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify(server.dragDevice));
                        }}
                        onClick={() => toggleNode(server.id)}
                        className={`group flex items-center justify-between p-2 rounded-xl cursor-grab active:cursor-grabbing select-none border transition-all duration-200 ${
                          isAssigned 
                            ? 'bg-primary/5 border-primary/20 hover:bg-primary/10' 
                            : 'bg-surface-container/50 border-outline-variant/10 hover:bg-surface-container'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant/60" /> : <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant/60" />}
                          <Folder className="w-4 h-4 text-warning shrink-0" />
                          <span className="text-[11px] font-bold text-white group-hover:text-primary transition-colors truncate">
                            {server.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 pl-2">
                          {isAssigned && (
                            <span className="text-[8px] bg-primary text-on-primary font-bold px-1.5 py-0.5 rounded uppercase">
                              G{server.assignedGrids.map((g: any) => g.gridID + 1).join(',')}
                            </span>
                          )}
                          <span className="text-[9px] font-mono text-on-surface-variant/70">
                            {filteredChildren.length} cam
                          </span>
                        </div>
                      </div>

                      {/* Server Devices */}
                      {isExpanded && (
                        <div className="flex flex-col gap-1.5 pl-5 mt-1 border-l border-outline-variant/10 ml-2 animate-in slide-in-from-top-1 duration-150">
                          {filteredChildren.length === 0 ? (
                            <span className="text-[10px] italic text-on-surface-variant/40">Trống</span>
                          ) : (
                            filteredChildren.map((dev: any) => {
                              const devAssigned = dev.assignedGrids.length > 0;
                              return (
                                <div
                                  key={dev.id}
                                  draggable
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    e.dataTransfer.setData('application/json', JSON.stringify(dev.dragDevice));
                                  }}
                                  className={`group flex items-center justify-between p-2 rounded-lg cursor-grab active:cursor-grabbing border transition-all duration-200 ${
                                    devAssigned 
                                      ? 'bg-primary/5 border-primary/20 hover:bg-primary/10' 
                                      : 'bg-surface-container/30 border-transparent hover:bg-surface-container/70'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <Camera className="w-3.5 h-3.5 text-primary shrink-0" />
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <span className="text-xs font-semibold text-white truncate group-hover:text-primary transition-colors">
                                        {dev.name}
                                      </span>
                                      <span className="text-[9px] text-on-surface-variant/70 font-mono mt-0.5">
                                        IP: {dev.ip}
                                      </span>
                                    </div>
                                  </div>
                                  {devAssigned && (
                                    <span className="text-[8px] bg-primary text-on-primary font-bold px-1.5 py-0.5 rounded uppercase shrink-0">
                                      G{dev.assignedText}
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== 2. MQTT SECTION ==================== */}
        {mqttTree.length > 0 && (
          <div className="flex flex-col gap-1">
            <div 
              onClick={() => toggleNode('root-mqtt')}
              className="flex items-center justify-between p-1.5 hover:bg-surface-container rounded-lg cursor-pointer text-[10px] font-black uppercase text-on-surface-variant/90 tracking-wider transition-colors select-none"
            >
              <div className="flex items-center gap-1.5">
                {expandedNodes.has('root-mqtt') ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span>MQTT BROKERS & GROUPS</span>
              </div>
              <span className="text-[9px] font-mono opacity-65 bg-surface-container px-1.5 py-0.5 rounded">{mqttTree.length} group</span>
            </div>

            {expandedNodes.has('root-mqtt') && (
              <div className="flex flex-col gap-2 pl-2 mt-1 border-l border-outline-variant/10 ml-2 animate-in slide-in-from-top-1 duration-150">
                {mqttTree.map((group: any) => {
                  const filteredChildren = group.children.filter((c: any) => !searchQuery || matchesSearch(c.name) || matchesSearch(c.devEui));
                  const groupMatches = !searchQuery || matchesSearch(group.name) || filteredChildren.length > 0;

                  if (!groupMatches) return null;
                  const isExpanded = expandedNodes.has(group.id) || !!searchQuery;
                  const isAssigned = group.assignedGrids.length > 0;

                  return (
                    <div key={group.id} className="flex flex-col gap-1">
                      {/* Group Folder (Draggable Group) */}
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify(group.dragDevice));
                        }}
                        onClick={() => toggleNode(group.id)}
                        className={`group flex items-center justify-between p-2 rounded-xl cursor-grab active:cursor-grabbing select-none border transition-all duration-200 ${
                          isAssigned 
                            ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10' 
                            : 'bg-surface-container/50 border-outline-variant/10 hover:bg-surface-container'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant/60" /> : <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant/60" />}
                          <Folder className="w-4 h-4 text-warning shrink-0" />
                          <span className="text-[11px] font-bold text-white group-hover:text-amber-400 transition-colors truncate">
                            {group.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 pl-2">
                          {isAssigned && (
                            <span className="text-[8px] bg-amber-500 text-on-surface font-bold px-1.5 py-0.5 rounded uppercase">
                              G{group.assignedGrids.map((g: any) => g.gridID + 1).join(',')}
                            </span>
                          )}
                          <span className="text-[9px] font-mono text-on-surface-variant/70">
                            {filteredChildren.length} sensor
                          </span>
                        </div>
                      </div>

                      {/* Group Devices */}
                      {isExpanded && (
                        <div className="flex flex-col gap-1.5 pl-5 mt-1 border-l border-outline-variant/10 ml-2 animate-in slide-in-from-top-1 duration-150">
                          {filteredChildren.length === 0 ? (
                            <span className="text-[10px] italic text-on-surface-variant/40">Trống</span>
                          ) : (
                            filteredChildren.map((dev: any) => {
                              const devAssigned = dev.assignedGrids.length > 0;
                              return (
                                <div
                                  key={dev.id}
                                  draggable
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    e.dataTransfer.setData('application/json', JSON.stringify(dev.dragDevice));
                                  }}
                                  className={`group flex items-center justify-between p-2 rounded-lg cursor-grab active:cursor-grabbing border transition-all duration-200 ${
                                    devAssigned 
                                      ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10' 
                                      : 'bg-surface-container/30 border-transparent hover:bg-surface-container/70'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <Radio className="w-3.5 h-3.5 text-tertiary shrink-0" />
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <span className="text-xs font-semibold text-white truncate group-hover:text-amber-400 transition-colors">
                                        {dev.name}
                                      </span>
                                      <span className="text-[9px] text-on-surface-variant/70 font-mono mt-0.5">
                                        EUI: {dev.devEui}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {dev.hasCameraLink && (
                                      <span className="text-[7.5px] font-extrabold uppercase px-1 py-0.5 bg-cyan-500/15 border border-cyan-500/20 text-cyan-400 rounded shrink-0">CAM</span>
                                    )}
                                    {devAssigned && (
                                      <span className="text-[8px] bg-amber-500 text-on-surface font-bold px-1.5 py-0.5 rounded uppercase shrink-0">
                                        G{dev.assignedText}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== 3. SUNELL SECTION ==================== */}
        {sunellTree && (
          <div className="flex flex-col gap-1">
            <div 
              onClick={() => toggleNode(sunellTree.id)}
              className="flex items-center justify-between p-1.5 hover:bg-surface-container rounded-lg cursor-pointer text-[10px] font-black uppercase text-on-surface-variant/90 tracking-wider transition-colors select-none"
            >
              <div className="flex items-center gap-1.5">
                {expandedNodes.has(sunellTree.id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span>SUNELL CAMERAS</span>
              </div>
              <span className="text-[9px] font-mono opacity-65 bg-surface-container px-1.5 py-0.5 rounded">{sunellTree.children.length} camera</span>
            </div>

            {expandedNodes.has(sunellTree.id) && (
              <div className="flex flex-col gap-2 pl-2 mt-1 border-l border-outline-variant/10 ml-2 animate-in slide-in-from-top-1 duration-150">
                {/* Sunell Group Folder (Draggable Group) */}
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify(sunellTree.dragDevice));
                  }}
                  className={`group flex items-center justify-between p-2 rounded-xl cursor-grab active:cursor-grabbing border transition-all duration-200 ${
                    sunellTree.assignedGrids.length > 0 
                      ? 'bg-secondary/5 border-secondary/20 hover:bg-secondary/10' 
                      : 'bg-surface-container/50 border-outline-variant/10 hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Folder className="w-4 h-4 text-warning shrink-0" />
                    <span className="text-[11px] font-bold text-white group-hover:text-secondary transition-colors truncate">
                      {sunellTree.name}
                    </span>
                  </div>
                  {sunellTree.assignedGrids.length > 0 && (
                    <span className="text-[8px] bg-secondary text-on-surface font-bold px-1.5 py-0.5 rounded uppercase shrink-0">
                      G{sunellTree.assignedGrids.map((g: any) => g.gridID + 1).join(',')}
                    </span>
                  )}
                </div>

                {/* Sunell Cameras List */}
                <div className="flex flex-col gap-1.5 pl-5 mt-1 border-l border-outline-variant/10 ml-2 animate-in slide-in-from-top-1 duration-150">
                  {sunellTree.children
                    .filter((c: any) => !searchQuery || matchesSearch(c.name) || matchesSearch(c.ip))
                    .map((cam: any) => {
                      const devAssigned = cam.assignedGrids.length > 0;
                      return (
                        <div
                          key={cam.id}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData('application/json', JSON.stringify(cam.dragDevice));
                          }}
                          className={`group flex items-center justify-between p-2 rounded-lg cursor-grab active:cursor-grabbing border transition-all duration-200 ${
                            devAssigned 
                              ? 'bg-secondary/5 border-secondary/20 hover:bg-secondary/10' 
                              : 'bg-surface-container/30 border-transparent hover:bg-surface-container/70'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Camera className="w-3.5 h-3.5 text-secondary shrink-0" />
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-xs font-semibold text-white truncate group-hover:text-secondary transition-colors">
                                {cam.name}
                              </span>
                              <span className="text-[9px] text-on-surface-variant/70 font-mono mt-0.5">
                                IP: {cam.ip}:{cam.port}
                              </span>
                            </div>
                          </div>
                          {devAssigned && (
                            <span className="text-[8px] bg-secondary text-on-surface font-bold px-1.5 py-0.5 rounded uppercase shrink-0">
                              G{cam.assignedText}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Telemetry fallback if all lists are empty */}
        {svmsTree.length === 0 && mqttTree.length === 0 && !sunellTree && (
          <div className="p-8 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/20 rounded-2xl">
            <Terminal className="w-8 h-8 text-on-surface-variant/60" />
            <span className="text-xs uppercase font-extrabold tracking-widest">{t('app.alert_wall.no_svms_devices')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
