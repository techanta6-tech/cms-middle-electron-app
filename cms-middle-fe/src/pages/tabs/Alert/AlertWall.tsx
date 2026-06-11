import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceData, LogData, DeviceCameraLink } from '../../../types';
import { CameraOff, X, Settings, Camera, ZoomIn, ZoomOut, Maximize, Minimize } from 'lucide-react';
import { CameraFeed } from './components/CameraFeed';

export type GridDevice = {
  server_serial: string;
  server_id: string;
  device_ip: string;
  device_name: string;
  device_type: string;
  mqtt_device_id?: string;
};

export type GridItem = {
  gridID: number;
  device?: GridDevice;
  devices?: GridDevice[];
};

const normalizeGridDevices = (item?: GridItem): GridDevice[] => {
  if (!item) return [];
  if (Array.isArray(item.devices)) return item.devices.filter(Boolean);
  if (item.device) return [item.device];
  return [];
};

const normalizeAddress = (value?: string) => String(value || '').split(':')[0];

export function AlertWall({
  logs,
  cameras,
  deviceCameraLinks,
  onSelectLog,
  gridCols,
  setGridCols,
  grids,
  setGrids,
  isFullscreen,
  setIsFullscreen
}: {
  logs: LogData[];
  cameras: DeviceData[];
  deviceCameraLinks: DeviceCameraLink[];
  onSelectLog: (log: LogData) => void;
  gridCols: number;
  setGridCols: React.Dispatch<React.SetStateAction<number>>;
  grids: GridItem[];
  setGrids: React.Dispatch<React.SetStateAction<GridItem[]>>;
  isFullscreen?: boolean;
  setIsFullscreen?: (val: boolean) => void;
}) {
  const { t } = useTranslation();
  const [showGridSettings, setShowGridSettings] = useState(false);
  const colsBreakPoints = [5, 5];

  const cameraList = cameras.flatMap(server =>
    (server.devices || []).map(dev => ({
      ...dev,
      server_serial: server.server.serial,
      server_id: server.server.server_id,
    }))
  ).filter(dev => dev.type === 'camera');

  const getLatestMqttLog = (device: GridDevice) => {
    const groupId = device.server_id || device.server_serial;
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const log = logs[i];
      if (
        (log.log_source === 'milesight-radar' || String(log.log_source) === 'milesight-button') &&
        ((device.mqtt_device_id && (log as any).mqtt_device_id === device.mqtt_device_id) || log.device_info?.id === device.device_ip) &&
        log.server_unique_id === groupId
      ) {
        return log;
      }
    }
    return undefined;
  };

  const getLatestCameraLog = (camera: any) => {
    if (!camera) return undefined;
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const log = logs[i];
      if (camera.type === 'sunell') {
        if (log.log_source === 'sunell-camera' && log.device_info?.id === camera.ip) return log;
      } else if (log.log_source === 'svms') {
        const rawDeviceName = log.raw?.device_name;
        const rawServerSerial = log.raw?.server?.serial;
        const rawDeviceIp = log.raw?.device_ip;
        if (
          rawDeviceName === camera.name &&
          (rawServerSerial === camera.server_serial || rawServerSerial === camera.server_id) &&
          normalizeAddress(rawDeviceIp) === normalizeAddress(camera.ip)
        ) return log;
      } else if (
        normalizeAddress(log.device_info?.id) === normalizeAddress(camera.ip) &&
        log.device_info?.name === camera.name &&
        (log.server_unique_id === camera.server_id || log.server_unique_id === camera.server_serial)
      ) {
        return log;
      }
    }
    return undefined;
  };

  const getCameraForDevice = (device: GridDevice) => {
    if (device.device_type === 'sunell') {
      return {
        ip: device.device_ip,
        name: device.device_name,
        server_id: device.server_id,
        server_serial: device.server_serial,
        type: 'sunell',
      };
    }
    return cameraList.find(dev =>
      normalizeAddress(dev.ip) === normalizeAddress(device.device_ip) &&
      dev.name === device.device_name &&
      dev.server_id === device.server_id &&
      dev.server_serial === device.server_serial
    );
  };

  const getLatestLogForDevice = (device: GridDevice) => {
    if (device.device_type === 'mqtt-sensor') return getLatestMqttLog(device);
    return getLatestCameraLog(getCameraForDevice(device));
  };

  const getLogTime = (log?: LogData) => {
    if (!log) return 0;
    if (typeof log.receive_time === 'number') return log.receive_time;
    const parsed = new Date(log.receive_time).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const getHoverLabelFontSize = () => {
    const baseSize = 12;
    const minSize = baseSize * 0.75;
    if (gridCols <= 3) return baseSize;
    if (gridCols >= 10) return minSize;
    const progress = (gridCols - 3) / 7;
    return baseSize - ((baseSize - minSize) * progress);
  };

  const sortDevicesByLatestLog = (devices: GridDevice[]) => (
    [...devices].sort((a, b) => getLogTime(getLatestLogForDevice(b)) - getLogTime(getLatestLogForDevice(a)))
  );

  const hasMqttCameraLink = (device: GridDevice) => {
    const groupId = device.server_id || device.server_serial;
    return deviceCameraLinks.some(link =>
      ((device.mqtt_device_id && link.mqttDeviceId === device.mqtt_device_id) ||
        (link.devEui === device.device_ip && (link.groupId || link.mqttServerId) === groupId)) &&
      !!link.cameraId
    );
  };

  const renderDevice = (device: GridDevice, index: number) => {
    if (device.device_type === 'mqtt-sensor') {
      const log = getLatestMqttLog(device);
      if (log?.snapshot) {
        return <CameraFeed key={`${device.server_id}-${device.device_ip}-${index}`} cam={log} onClick={() => onSelectLog(log)} />;
      }
      const waiting = hasMqttCameraLink(device) && !log;
      return (
        <div
          key={`${device.server_id}-${device.device_ip}-${index}`}
          className={`no-camera w-full h-full flex flex-col items-center justify-center gap-[10%] text-center px-2 py-2 bg-black ${log ? 'cursor-pointer hover:bg-surface-container-highest/50' : ''}`}
          onClick={() => log && onSelectLog(log)}
        >
          <Camera className={`opacity-30 ${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
          <span className={`opacity-30 text-[9px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
            {waiting ? t('app.alert_wall.waiting_data') : device.device_name}
          </span>
        </div>
      );
    }

    const camera = getCameraForDevice(device);
    const log = getLatestCameraLog(camera);
    if (log?.snapshot) {
      return <CameraFeed key={`${device.server_id}-${device.device_ip}-${index}`} cam={log} onClick={() => onSelectLog(log)} />;
    }
    return (
      <div
        key={`${device.server_id}-${device.device_ip}-${index}`}
        className={`no-camera w-full h-full flex flex-col items-center justify-center gap-[10%] text-center px-2 py-2 bg-black ${log ? 'cursor-pointer hover:bg-surface-container-highest/50' : ''}`}
        onClick={() => log && onSelectLog(log)}
      >
        <Camera className={`opacity-30 ${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
        <span className={`opacity-30 text-[10px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
          {log ? t('app.alert_wall.has_event', 'Co su kien') : t('app.alert_wall.waiting_data')}
        </span>
      </div>
    );
  };

  const parseDroppedDevices = (raw: string): GridDevice[] => {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.devices)) return parsed.devices.filter(Boolean);
    return [{
      server_serial: parsed.server_serial,
      server_id: parsed.server_id,
      device_ip: parsed.device_ip,
      device_name: parsed.device_name,
      device_type: parsed.device_type,
      mqtt_device_id: parsed.mqtt_device_id,
    }];
  };

  return (
    <div className="AlertWall flex-1 p-1 overflow-y-auto custom-scrollbar bg-surface-container-low/20">
      <div
        className="relative h-full w-full grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridCols}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: Math.pow(gridCols, 2) }).map((_, idx) => {
          const gridItem = grids[idx];
          const gridDevices = normalizeGridDevices(gridItem);
          const hasDevice = gridDevices.length > 0;
          const sortedGridDevices = sortDevicesByLatestLog(gridDevices);
          const visibleDevice = sortedGridDevices[0];

          return (
            <div
              key={idx}
              draggable={hasDevice}
              onDragStart={(e) => {
                if (!hasDevice) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData('application/json', JSON.stringify({
                  ...gridDevices[0],
                  devices: gridDevices,
                  sourceFieldIndex: idx,
                }));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');
                const data = e.dataTransfer.getData('application/json');
                if (!data) return;
                try {
                  const droppedDevices = parseDroppedDevices(data);
                  const parsed = JSON.parse(data);
                  setGrids(prev => {
                    const clone = [...prev];
                    const sourceIndex = parsed.sourceFieldIndex;
                    const nextItem = { gridID: idx, devices: droppedDevices, device: droppedDevices[0] };
                    if (sourceIndex !== undefined && sourceIndex !== idx) {
                      const targetItem = clone[idx];
                      clone[idx] = nextItem;
                      if (targetItem) clone[sourceIndex] = { ...targetItem, gridID: sourceIndex };
                      else delete clone[sourceIndex];
                    } else if (sourceIndex === undefined) {
                      clone[idx] = nextItem;
                    }
                    return clone;
                  });
                } catch {
                  // ignore invalid drag payload
                }
              }}
              className={`relative group camera-feed-item h-full w-full bg-surface-container-low/50 border border-outline-variant/10 rounded-xs overflow-hidden transition-all ${hasDevice ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {hasDevice ? (
                <>
                  {renderDevice(visibleDevice, 0)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setGrids(prev => { const clone = [...prev]; delete clone[idx]; return clone; });
                    }}
                    className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-10 w-10 h-10 bg-gradient-to-bl from-surface-container-high/90 from-[50%] to-transparent to-[50%] hover:from-primary/90 transition-all duration-300 cursor-pointer text-on-surface hover:text-white group flex items-start justify-end p-[6px]"
                  >
                    <div className="w-3 h-3 flex items-center justify-center"><X className="w-full h-full" /></div>
                  </button>
                  <div
                    className="leading-5 opacity-0 group-hover:opacity-100 absolute bottom-0 left-0 z-10 w-full bg-surface-container-high/40 backdrop-blur-md shadow-[0_-5px_15px_rgba(0,0,0,0.2)] border-t border-outline-variant/10 transition-all duration-300 pointer-events-none px-3 py-1"
                    style={{ fontSize: `${getHoverLabelFontSize()}px` }}
                  >
                    {gridDevices.length > 1
                      ? `${visibleDevice.server_id} - ${visibleDevice.device_name} (+${gridDevices.length - 1})`
                      : `${visibleDevice.server_id} - ${visibleDevice.device_name}`}
                  </div>
                </>
              ) : (
                <div className="no-camera w-full h-full flex flex-col items-center justify-center opacity-30 gap-[10%] text-center px-4 py-2">
                  <CameraOff className={`${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                  <span className={`text-[11px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                    {t('app.alert_wall.no_incoming')}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        <div className="gridSettingsButton absolute bottom-4 right-4 opacity-25 hover:opacity-100 transition-all duration-300 z-10 flex flex-col gap-2">
          {!showGridSettings ? (
            <button
              onClick={() => setShowGridSettings(true)}
              className="p-2.5 bg-surface-container-high/90 hover:bg-primary/90 text-on-surface hover:text-white border border-outline-variant/30 rounded-full shadow-lg transition-all duration-300 group backdrop-blur-md cursor-pointer"
              title={t('app.alert_wall.grid_settings')}
            >
              <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
            </button>
          ) : (
            <div className="flex flex-col bg-surface-container-high/50 backdrop-blur-xl p-1 rounded-full border border-outline-variant/30 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 zoom-in-95 fade-in">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => gridCols > 1 && setGridCols(gridCols - 1)}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={t('app.alert_wall.dec_grid')}
                >
                  <ZoomIn className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
                <button
                  onClick={() => gridCols < 6 && setGridCols(gridCols + 1)}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={t('app.alert_wall.inc_grid')}
                >
                  <ZoomOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
                <button
                  onClick={() => {
                    const nextVal = !isFullscreen;
                    if (nextVal) {
                      document.documentElement.requestFullscreen().catch(err => console.error('Error entering fullscreen:', err));
                    } else if (document.fullscreenElement) {
                      document.exitFullscreen().catch(err => console.error('Error exiting fullscreen:', err));
                    }
                    setIsFullscreen?.(nextVal);
                  }}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={isFullscreen ? t('app.alert_wall.exit_fullscreen', 'Thoat toan man hinh') : t('app.alert_wall.enter_fullscreen', 'Toan man hinh')}
                >
                  {isFullscreen ? <Minimize className="w-4 h-4 group-hover:scale-110 transition-transform" /> : <Maximize className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                </button>
              </div>
              <div className="h-[1px] w-full bg-outline-variant/20 my-0.5" />
              <button
                onClick={() => setShowGridSettings(false)}
                className="p-2.5 bg-error/10 hover:bg-surface-container-highest text-error hover:text-white rounded-full transition-all duration-300 group cursor-pointer"
                title={t('app.alert_wall.close_settings')}
              >
                <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
