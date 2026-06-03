import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Move, Trash2, X, Upload, Image as ImageIcon, ChevronDown, Check, OctagonAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/apiClient';
import type { LogData, MqttDevice } from '../types';
import type { GridDevice } from './AlertWall';

export type EMapPin = {
  id: string;
  lat: number; // Used for Top percentage (0 - 100)
  lng: number; // Used for Left percentage (0 - 100)
  label: string;
  devices: GridDevice[];
  createdAt?: string;
  updatedAt?: string;
};

const normalizeAddress = (value?: string) => String(value || '').split(':')[0];

function parseDroppedDevices(raw: string): GridDevice[] {
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
}

function logTime(log?: LogData) {
  if (!log) return 0;
  if (typeof log.receive_time === 'number') return log.receive_time > 10_000_000_000 ? log.receive_time : log.receive_time * 1000;
  const parsed = new Date(log.receive_time).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isDeviceLog(device: GridDevice, log: LogData) {
  if (device.device_type === 'mqtt-sensor') {
    const groupId = device.server_id || device.server_serial;
    return (
      (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button') &&
      log.server_unique_id === groupId &&
      ((device.mqtt_device_id && (log as any).mqtt_device_id === device.mqtt_device_id) || log.device_info?.id === device.device_ip)
    );
  }

  if (device.device_type === 'sunell') {
    return log.log_source === 'sunell-camera' && log.device_info?.id === device.device_ip;
  }

  if (log.log_source === 'svms') {
    const rawDeviceName = log.raw?.device_name;
    const rawServerSerial = log.raw?.server?.serial;
    const rawDeviceIp = log.raw?.device_ip;
    return (
      (rawServerSerial === device.server_serial || rawServerSerial === device.server_id) &&
      normalizeAddress(rawDeviceIp) === normalizeAddress(device.device_ip)
    );
  }

  return (
    normalizeAddress(log.device_info?.id) === normalizeAddress(device.device_ip) &&
    (log.server_unique_id === device.server_id || log.server_unique_id === device.server_serial)
  );
}

function isKnownDevice(device: GridDevice, knownDevices: GridDevice[]) {
  return knownDevices.some(known =>
    known.server_id === device.server_id &&
    normalizeAddress(known.device_ip) === normalizeAddress(device.device_ip) &&
    known.device_type === device.device_type
  );
}

const CCTV_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97" />
    <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z" />
    <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15" />
    <path d="M2 21v-4" />
    <path d="M7 9h.01" />
  </svg>
);

const EMapPinMarker = memo(function EMapPinMarker({
  pin,
  latestLog,
  moving,
  interactionsDisabled,
  onOpenContextMenu,
  onMouseDown,
  hoveredPinId,
  setHoveredPinId,
  isOffline,
  offlineDeviceNames = [],
}: {
  pin: EMapPin;
  latestLog?: LogData;
  moving: boolean;
  interactionsDisabled: boolean;
  onOpenContextMenu: (e: React.MouseEvent, pinId: string) => void;
  onMouseDown: (pinId: string, event: React.MouseEvent) => void;
  hoveredPinId: string | null;
  setHoveredPinId: (id: string | null) => void;
  /** True when all mqtt-sensor devices in this pin are offline/disconnected */
  isOffline?: boolean;
  /** Names of offline devices for display in tooltip */
  offlineDeviceNames?: string[];
}) {
  const { t } = useTranslation();
  const [alerting, setAlerting] = useState(false);
  // Track previous log ref: initialize with current value so remount doesn't trigger alert
  const prevLogRef = useRef(latestLog);

  useEffect(() => {
    // Only alert when log genuinely changes, not on initial mount or tab-switch remount
    if (latestLog === prevLogRef.current) return;
    prevLogRef.current = latestLog;
    if (!latestLog) return;
    setAlerting(true);
    const timer = window.setTimeout(() => setAlerting(false), 5000);
    return () => window.clearTimeout(timer);
  }, [latestLog]);

  const descKey = latestLog?.log_description?.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
  let description = t('app.emap.waiting_event');
  if (descKey) {
    if (latestLog?.log_source === 'milesight-radar' || latestLog?.log_source === 'milesight-button') {
      const formattedKey = descKey.startsWith('milesight_') ? descKey : `milesight_${descKey}`;
      description = t(`app.logtype.${formattedKey}_description`, { defaultValue: latestLog?.log_description });
    } else {
      description = t(`app.logtype.${descKey}`, { defaultValue: latestLog?.log_description });
    }
  }

  const isHovered = hoveredPinId === pin.id;

  return (
    <div
      style={{

        left: `${pin.lng}%`,
        top: `${pin.lat}%`,
      }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 transition-all duration-300 ${moving ? 'scale-110 pointer-events-none' : 'cursor-pointer hover:scale-110'
        } ${alerting ? 'opacity-100' : 'opacity-50 hover:opacity-100'
        }`}
      onMouseDown={(e) => onMouseDown(pin.id, e)}
      onMouseEnter={() => !interactionsDisabled && setHoveredPinId(pin.id)}
      onMouseLeave={() => setHoveredPinId(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu(e, pin.id);
      }}
    >
      {/* Blinking / Offline Pin Icon */}
      <div
        className={`emap-pin relative w-7 h-7 rounded-full border-2 border-white/95 flex items-center justify-center text-white shadow-xl transition-all duration-300 ${isOffline
          ? 'bg-[#ef4444]'
          : alerting
            ? 'bg-error scale-110'
            : 'bg-primary'
          }`}
      >
        {isOffline ? (
          <OctagonAlert className="w-3 h-3 stroke-[2.5]" />
        ) : (
          CCTV_ICON
        )}
        {alerting && !isOffline && (
          <div className="absolute inset-0 rounded-full bg-error animate-ping opacity-75 z-[-1]" />
        )}
      </div>

      {/* Stacked tooltip container: offline warning (top) + event dialog (bottom) */}
      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[999] pointer-events-none flex flex-col gap-1.5 items-center animate-in fade-in zoom-in-95 duration-200">
          {/* Offline warning dialog - sits on top */}
          {offlineDeviceNames.length > 0 && (
            <div className="w-[260px] bg-[#1a0a0a]/95 backdrop-blur-xl border border-[#ef4444]/40 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-3 py-2 flex flex-col gap-0.5">
                {offlineDeviceNames.map((name, i) => (
                  <div key={i} className="leading-[1.3]">
                    <span className="text-[11px] font-bold text-[#ef4444]">
                      Thiết bị &apos;{name}&apos; mất tín hiệu
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event info dialog - sits on bottom */}
          <div className="w-[260px] bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/30 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2.5 flex flex-col gap-1 bg-surface-container-lowest/80">
              <div className="text-[11px] font-black uppercase tracking-widest text-primary truncate leading-none">{pin.label}</div>
              <div className="text-[11px] leading-[1.35] text-on-surface line-clamp-2">{description}</div>
              <div className="text-[9px] font-mono text-on-surface-variant/60 flex items-center justify-between mt-0.5">
                <div className="flex gap-1.5">
                  {latestLog ? (
                    <span>
                      {new Date(logTime(latestLog)).toLocaleTimeString()} {new Date(logTime(latestLog)).toLocaleDateString()}
                    </span>
                  ) : (
                    <span>{pin.devices.length} thiết bị</span>
                  )}
                </div>
                {latestLog?.raw?.signalQuality && (
                  <span
                    className={`px-1.5 py-0.5 rounded font-bold tracking-widest uppercase border ${latestLog.raw.signalQuality.level === 'STRONG' ? 'text-secondary bg-secondary/10 border-secondary/20' :
                      latestLog.raw.signalQuality.level === 'MEDIUM' ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' :
                        latestLog.raw.signalQuality.level === 'WEAK' ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' :
                          latestLog.raw.signalQuality.level === 'ABNORMAL' ? 'text-tertiary bg-tertiary/10 border-tertiary/20' :
                            'text-on-surface-variant bg-surface-container border-outline-variant/20'
                      }`}
                    title={latestLog.raw.signalQuality.reason}
                  >
                    SIGNAL: {latestLog.raw.signalQuality.level}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
});

export function EMap({
  pins,
  tileProviderId,
  logs,
  knownDevices,
  onSaveLayout,
  mqttDevices,
}: {
  pins: EMapPin[];
  tileProviderId: string;
  logs: LogData[];
  knownDevices: GridDevice[];
  onSaveLayout: (pins: EMapPin[], tileProviderId?: string) => void;
  mqttDevices?: MqttDevice[];
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedLogCountRef = useRef(0);

  const [bgTimestamp, setBgTimestamp] = useState<number>(Date.now());
  const [movingPinId, setMovingPinId] = useState<string | null>(null);
  const [movingPinPos, setMovingPinPos] = useState<{ lat: number, lng: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pinId: string } | null>(null);
  const [latestLogsByPin, setLatestLogsByPin] = useState<Record<string, LogData | undefined>>({});
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Dynamic baseURL from apiClient default settings
  const mapBgUrl = useMemo(() => {
    const baseURL = String(apiClient.defaults.baseURL || '').replace(/\/$/, '');
    return `${baseURL}/api/v1/emap-bg-static/emap-bg.jpg?t=${bgTimestamp}`;
  }, [bgTimestamp]);

  const visiblePins = useMemo(() => (
    pins
      .map(pin => ({ ...pin, devices: (pin.devices || []).filter(device => isKnownDevice(device, knownDevices)) }))
      .filter(pin => pin.devices.length > 0)
  ), [knownDevices, pins]);

  const visiblePinSignature = useMemo(() => (
    visiblePins.map(pin => `${pin.id}:${pin.devices.map(device => `${device.server_id}/${device.device_ip}/${device.device_name}/${device.device_type}`).join('|')}`).join(';')
  ), [visiblePins]);

  useEffect(() => {
    const next: Record<string, LogData | undefined> = {};
    visiblePins.forEach(pin => {
      for (let i = logs.length - 1; i >= 0; i -= 1) {
        const log = logs[i];
        if (pin.devices.some(device => isDeviceLog(device, log))) {
          next[pin.id] = log;
          break;
        }
      }
    });
    setLatestLogsByPin(next);
    processedLogCountRef.current = logs.length;
  }, [visiblePinSignature, logs]);

  useEffect(() => {
    if (logs.length < processedLogCountRef.current) {
      processedLogCountRef.current = 0;
      setLatestLogsByPin({});
    }

    const newLogs = logs.slice(processedLogCountRef.current);
    if (newLogs.length === 0) return;

    setLatestLogsByPin(prev => {
      let next = prev;
      newLogs.forEach(log => {
        visiblePins.forEach(pin => {
          if (pin.devices.some(device => isDeviceLog(device, log))) {
            if (next === prev) next = { ...prev };
            next[pin.id] = log;
          }
        });
      });
      return next;
    });
    processedLogCountRef.current = logs.length;
  }, [logs, visiblePins]);

  const savePins = useCallback((nextPins: EMapPin[]) => {
    onSaveLayout(nextPins, tileProviderId);
  }, [onSaveLayout, tileProviderId]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      if (!base64) {
        setUploading(false);
        return;
      }
      try {
        await apiClient.post('/api/v1/emap-layout/background', { image: base64 });
        setBgTimestamp(Date.now());
      } catch (err) {
        console.error('Failed to upload background image:', err);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const innerRef = useRef<HTMLDivElement>(null);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const data = event.dataTransfer.getData('application/json');
    const targetRef = innerRef.current || containerRef.current;
    if (!targetRef || !data) return;

    try {
      const devices = parseDroppedDevices(data).filter(device => isKnownDevice(device, knownDevices));
      if (devices.length === 0) return;

      const rect = targetRef.getBoundingClientRect();
      const leftPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const topPercent = ((event.clientY - rect.top) / rect.height) * 100;

      const now = new Date().toISOString();
      const label = devices.length > 1 ? `${devices[0].server_id} (${devices.length})` : devices[0].device_name;

      const nextPin: EMapPin = {
        id: `emap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lat: Math.max(0, Math.min(100, topPercent)),
        lng: Math.max(0, Math.min(100, leftPercent)),
        label,
        devices,
        createdAt: now,
        updatedAt: now,
      };

      savePins([...pins, nextPin]);
    } catch (err) {
      console.error('[EMap] Failed to drop device:', err);
    }
  };

  const handleContainerMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!movingPinId || !innerRef.current) return;
    const rect = innerRef.current.getBoundingClientRect();
    let leftPercent = ((event.clientX - rect.left) / rect.width) * 100;
    let topPercent = ((event.clientY - rect.top) / rect.height) * 100;

    leftPercent = Math.max(0, Math.min(100, leftPercent));
    topPercent = Math.max(0, Math.min(100, topPercent));

    setMovingPinPos({ lat: topPercent, lng: leftPercent });
  };

  const handlePinMouseDown = useCallback((pinId: string, event: React.MouseEvent) => {
    // Disabled drag and drop
  }, []);

  const handleContainerMouseUp = (event: React.MouseEvent) => {
    if (movingPinId && movingPinPos && event.button === 0) {
      savePins(pins.map(pin => pin.id === movingPinId
        ? { ...pin, lat: movingPinPos.lat, lng: movingPinPos.lng, updatedAt: new Date().toISOString() }
        : pin
      ));
      setMovingPinId(null);
      setMovingPinPos(null);
    }
  };

  const handleOpenContextMenu = useCallback((e: React.MouseEvent, pinId: string) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setContextMenu({ x, y, pinId });
  }, []);

  const deletePin = (pinId: string) => {
    setContextMenu(null);
    savePins(pins.filter(pin => pin.id !== pinId));
  };

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-slate-950/40 select-none flex items-center justify-center ${movingPinId ? 'cursor-grabbing' : 'cursor-default'
        }`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onContextMenu={(event) => {
        event.preventDefault();
        if (movingPinId) {
          setMovingPinId(null);
          setMovingPinPos(null);
        }
      }}
    >
      {/* Sơ đồ Nền Inner Contain Wrapper */}
      <div
        ref={innerRef}
        className="relative max-w-full max-h-full flex items-center justify-center"
      >
        {/* Background Map Sơ đồ Image - object-contain fits beautifully in wrapper boundary */}
        <img
          src={mapBgUrl}
          className="max-w-full max-h-full object-contain pointer-events-none select-none"
          alt="Sơ đồ khu vực"
          onError={(e) => {
            // Fallback image source if static file endpoint hasn't been initialized yet
            e.currentTarget.src = 'https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=1000';
          }}
        />

        {/* Dark overlay for rich aesthetics */}
        <div className="absolute inset-0 bg-black/5 pointer-events-none" />

        {/* Render Camera/Device Pins placed exactly relative to the sơ đồ image boundaries */}
        {visiblePins.map(pin => {
          const isMovingThis = movingPinId === pin.id;
          const displayPin = isMovingThis && movingPinPos
            ? { ...pin, lat: movingPinPos.lat, lng: movingPinPos.lng }
            : pin;

          // Determine offline status and collect offline device names
          const mqttSensorDevices = pin.devices.filter(d => d.device_type === 'mqtt-sensor');
          const offlineDeviceNames: string[] = [];
          mqttSensorDevices.forEach(d => {
            if (!mqttDevices || mqttDevices.length === 0) return;
            const mqttDev = mqttDevices.find(m =>
              m.id === d.mqtt_device_id ||
              m.deviceInfo?.devEui === d.device_ip
            );
            if (mqttDev && mqttDev.connectionStatus === 'offline') {
              const name = mqttDev.deviceNickname || mqttDev.deviceInfo?.deviceName || d.device_name || mqttDev.id;
              offlineDeviceNames.push(name);
            }
          });
          const isOffline = mqttSensorDevices.length > 0 && offlineDeviceNames.length === mqttSensorDevices.length;

          return (
            <EMapPinMarker
              key={`${pin.id}-${isMovingThis ? 'moving' : 'fixed'}`}
              pin={displayPin}
              latestLog={latestLogsByPin[pin.id]}
              moving={isMovingThis}
              interactionsDisabled={!!contextMenu || !!movingPinId}
              onOpenContextMenu={handleOpenContextMenu}
              onMouseDown={handlePinMouseDown}
              hoveredPinId={hoveredPinId}
              setHoveredPinId={setHoveredPinId}
              isOffline={isOffline}
              offlineDeviceNames={offlineDeviceNames}
            />
          )
        })}
      </div>

      {/* Floating interactive context menu */}
      {contextMenu && (
        <div
          className="absolute z-[1000] w-44 bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/30 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-wider hover:bg-primary/20 text-on-surface transition-colors cursor-pointer text-left"
            onClick={() => {
              setMovingPinId(contextMenu.pinId);
              setContextMenu(null);
            }}
          >
            <Move className="w-3.5 h-3.5 text-primary" /> {t('app.emap.move', 'Di chuyển')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-wider hover:bg-error/20 text-error transition-colors cursor-pointer text-left"
            onClick={() => deletePin(contextMenu.pinId)}
          >
            <Trash2 className="w-3.5 h-3.5 text-error" /> {t('app.emap.delete', 'Xóa Ghim')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-wider hover:bg-surface-container-highest text-on-surface-variant transition-colors cursor-pointer text-left"
            onClick={() => setContextMenu(null)}
          >
            <X className="w-3.5 h-3.5" /> {t('app.emap.close', 'Đóng')}
          </button>
        </div>
      )}

      {/* Hints for dragging pin movement */}
      {movingPinId && (
        <div className="absolute left-4 top-4 z-[900] bg-surface-container-high/90 backdrop-blur border border-primary/30 text-primary px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider shadow-2xl animate-pulse">
          {t('app.emap.moving_hint', 'Chuột trái: Lưu vị trí | Chuột phải: Hủy bỏ')}
        </div>
      )}

      {/* Floating purple upload photo button - Styled exactly like gridSettingsButton */}
      <div className="absolute bottom-4 right-4 opacity-30 hover:opacity-100 transition-all duration-300 z-30 flex flex-col gap-2">
        <button
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`p-2.5 text-on-surface hover:text-white border border-outline-variant/30 rounded-full shadow-lg transition-all duration-300 group backdrop-blur-md cursor-pointer ${uploading ? 'bg-surface-container-high/50' : 'bg-surface-container-high/90 hover:bg-primary/95'
            }`}
          title="Tải ảnh sơ đồ nền mới"
          disabled={uploading}
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-t-transparent border-primary rounded-full animate-spin" />
          ) : (
            <Upload className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
      </div>
    </div>
  );
}
