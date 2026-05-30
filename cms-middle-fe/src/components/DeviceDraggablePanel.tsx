import { Terminal } from 'lucide-react';
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
}: Props) {
  const { t } = useTranslation();

  const getAssignedText = (dragDevice: any) => {
    const assignedGrids = grids.filter((g: any) => gridHasDevice(g, dragDevice));
    return {
      assignedGrids,
      assignedText: assignedGrids.map((g: any) => g.gridID + 1).join(', '),
    };
  };

  return (
    <div className="device-draggable-container flex-1 overflow-y-auto custom-scrollbar p-3 bg-surface-container-low/10 flex flex-col gap-2 relative">
      <div className="flex items-center justify-between sticky top-0 py-1 z-10 backdrop-blur-md mb-2 rounded-md px-1">
        <span className="text-[9px] uppercase tracking-widest text-on-surface-variant opacity-70 font-bold">
          {title || t('app.alert_wall.drag_to_assign')}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/80">Server & Group</span>
        <div className="flex-1 h-px bg-outline-variant/10" />
      </div>

      {Object.values(devices).flatMap((server: any) => {
        if (!server.server || !server.devices?.length) return [];
        const groupDevices = server.devices.map((dev: any) => ({
          server_serial: server.server.serial,
          server_id: server.server.server_id,
          device_ip: dev.ip,
          device_name: dev.name,
          device_type: dev.type || 'vms',
        }));
        const assignedGrids = grids.filter((g: any) => groupDevices.some((dev: any) => gridHasDevice(g, dev)));
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

      {mqttGroups.map((group: any) => {
        const groupDevices = (mqttDevicesByServer[group.id] || []).map((dev: any) => ({
          server_serial: group.id,
          server_id: group.id,
          device_ip: dev.devEui,
          device_name: dev.deviceName,
          device_type: 'mqtt-sensor',
          mqtt_device_id: dev.id,
        }));
        if (groupDevices.length === 0) return null;
        const assignedGrids = grids.filter((g: any) => groupDevices.some((dev: any) => gridHasDevice(g, dev)));
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

      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">{t('app.alert_wall.svms_camera_devices')}</span>
        <div className="flex-1 h-px bg-primary/10" />
      </div>

      {Object.values(devices).flatMap((server: any) => {
        if (!server.server) return [];
        return (server.devices || []).map((dev: any) => {
          const dragDevice = {
            server_serial: server.server.serial,
            server_id: server.server.server_id,
            device_ip: dev.ip,
            device_name: dev.name,
            device_type: dev.type || 'vms',
          };
          const { assignedGrids, assignedText } = getAssignedText(dragDevice);
          return (
            <div
              key={`${server.server.server_id}-${dev.ip}-${dev.name}`}
              draggable
              title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
              onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(dragDevice))}
              className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-primary/5 border-primary/20' : 'bg-surface-container border-outline-variant/10'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-primary transition-colors truncate">{dev.name}</span>
                  <span className="text-[9px] text-on-surface-variant/70 font-mono truncate">{server.server.server_id} - {dev.ip}</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 bg-surface-container-highest rounded text-on-surface-variant uppercase font-medium shrink-0">{dev.type || 'vms'}</span>
              </div>
            </div>
          );
        });
      })}

      {!Object.values(devices).some((s: any) => s.devices?.length > 0) && (
        <div className="p-4 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/10 rounded">
          <Terminal className="w-4 h-4" />
          <span className="text-[9px] uppercase font-bold tracking-widest">{t('app.alert_wall.no_svms_devices')}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mt-1 mb-1 px-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-amber-400/80">{t('app.alert_wall.lora_devices')}</span>
      </div>

      {mqttGroups.map((ms: any) => {
        const mqttDevs = mqttDevicesByServer[ms.id] || [];
        if (mqttDevs.length === 0) return null;
        return (
          <div key={ms.id} className="flex flex-col gap-1 mb-2">
            <div className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/50 px-1">{ms.name}</div>
            {mqttDevs.map((dev: any) => {
              const dragDevice = {
                server_serial: ms.id,
                server_id: ms.id,
                device_ip: dev.devEui,
                device_name: dev.deviceName,
                device_type: 'mqtt-sensor',
                mqtt_device_id: dev.id,
              };
              const { assignedGrids, assignedText } = getAssignedText(dragDevice);
              const link = deviceCameraLinks.find((l: any) => l.mqttDeviceId === dev.id || (l.devEui === dev.devEui && l.groupId === ms.id));
              return (
                <div
                  key={`${ms.id}-${dev.devEui}`}
                  draggable
                  title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
                  onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(dragDevice))}
                  className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-surface-container border-outline-variant/10'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-amber-400 transition-colors truncate">{dev.deviceName}</span>
                    {link && <span className="text-[8px] px-1 py-0.5 rounded uppercase font-bold bg-cyan-500/20 text-cyan-500 shrink-0">CAMERA</span>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {!mqttGroups.some((ms: any) => (mqttDevicesByServer[ms.id] || []).length > 0) && (
        <div className="p-4 flex flex-col items-center justify-center opacity-30 gap-2 text-center border border-dashed border-outline-variant/10 rounded">
          <span className="text-[9px] uppercase font-bold tracking-widest">{t('app.alert_wall.no_mqtt_devices')}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 mb-1 px-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-secondary/80">Sunell Camera</span>
        <div className="flex-1 h-px bg-secondary/10" />
      </div>

      {cameraDevices.filter((cam: any) => cam.type === 'sunell').map((cam: any) => {
        const dragDevice = {
          server_serial: 'SUNELL',
          server_id: 'SUNELL-LOCAL',
          device_ip: cam.id,
          device_name: cam.name || cam.cameraIp,
          device_type: 'sunell',
        };
        const { assignedGrids, assignedText } = getAssignedText(dragDevice);
        return (
          <div
            key={cam.id}
            draggable
            title={assignedGrids.length > 0 ? `${t('app.alert_wall.assigned_to_grid')}${assignedText}` : undefined}
            onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(dragDevice))}
            className={`p-3 hover:bg-surface-container-high border rounded-sm cursor-grab active:cursor-grabbing flex flex-col gap-1 shadow-sm transition-all text-on-surface group ${assignedGrids.length > 0 ? 'bg-secondary/5 border-secondary/20' : 'bg-surface-container border-outline-variant/10'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-widest group-hover:text-secondary transition-colors truncate">{cam.name || cam.cameraIp}</span>
                <span className="text-[9px] text-on-surface-variant/70 font-mono truncate">{cam.cameraIp}:{cam.cameraPort}</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 bg-surface-container-highest rounded text-on-surface-variant uppercase font-medium shrink-0">sunell</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
