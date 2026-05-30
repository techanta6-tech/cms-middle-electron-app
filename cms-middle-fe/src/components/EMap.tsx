import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Move, Trash2, X, Upload, Image as ImageIcon, CameraOff, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/apiClient';
import type { LogData } from '../types';
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
      rawDeviceName === device.device_name &&
      (rawServerSerial === device.server_serial || rawServerSerial === device.server_id) &&
      normalizeAddress(rawDeviceIp) === normalizeAddress(device.device_ip)
    );
  }

  return (
    normalizeAddress(log.device_info?.id) === normalizeAddress(device.device_ip) &&
    log.device_info?.name === device.device_name &&
    (log.server_unique_id === device.server_id || log.server_unique_id === device.server_serial)
  );
}

function isKnownDevice(device: GridDevice, knownDevices: GridDevice[]) {
  return knownDevices.some(known =>
    known.server_id === device.server_id &&
    normalizeAddress(known.device_ip) === normalizeAddress(device.device_ip) &&
    known.device_name === device.device_name &&
    known.device_type === device.device_type
  );
}

const CCTV_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" className="shrink-0">
    <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97"/>
    <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z"/>
    <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15"/>
    <path d="M2 21v-4"/>
    <path d="M7 9h.01"/>
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
}: {
  pin: EMapPin;
  latestLog?: LogData;
  moving: boolean;
  interactionsDisabled: boolean;
  onOpenContextMenu: (e: React.MouseEvent, pinId: string) => void;
  onMouseDown: (pinId: string, event: React.MouseEvent) => void;
  hoveredPinId: string | null;
  setHoveredPinId: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const [alerting, setAlerting] = useState(false);

  useEffect(() => {
    if (!latestLog) return;
    setAlerting(true);
    const timer = window.setTimeout(() => setAlerting(false), 5000);
    return () => window.clearTimeout(timer);
  }, [latestLog]);

  const snapshot = latestLog?.snapshot;
  const descKey = latestLog?.log_description?.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
  const description = descKey ? t(`app.logtype.${descKey}`, { defaultValue: latestLog?.log_description }) : t('app.emap.waiting_event');

  const isHovered = hoveredPinId === pin.id;

  return (
    <div
      style={{
        left: `${pin.lng}%`,
        top: `${pin.lat}%`,
      }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 transition-transform ${moving ? 'scale-110 cursor-grabbing' : 'cursor-grab'}`}
      onMouseDown={(e) => onMouseDown(pin.id, e)}
      onMouseEnter={() => !interactionsDisabled && setHoveredPinId(pin.id)}
      onMouseLeave={() => setHoveredPinId(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu(e, pin.id);
      }}
    >
      {/* Blinking Pin Icon */}
      <div 
        className={`emap-pin relative w-5 h-5 rounded-full border-2 border-white/95 flex items-center justify-center text-white shadow-xl transition-all duration-300 ${
          alerting ? 'bg-error scale-110' : 'bg-primary'
        }`}
      >
        {CCTV_ICON}
        {alerting && (
          <div className="absolute inset-0 rounded-full bg-error animate-ping opacity-75 z-[-1]" />
        )}
      </div>

      {/* Glassmorphic native React popup tooltip on hover */}
      {isHovered && (
        <div 
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[999] pointer-events-none w-[260px] bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/30 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          onMouseEnter={(e) => e.stopPropagation()}
        >
          <div className="h-[130px] bg-black/40 flex items-center justify-center overflow-hidden border-b border-outline-variant/10">
            {snapshot ? (
              <img
                src={snapshot.startsWith('data:image') ? snapshot : `data:image/jpeg;base64,${snapshot}`}
                className="w-full h-full object-cover"
                alt={pin.label}
              />
            ) : (
              <div className="flex flex-col items-center justify-center opacity-30 gap-1.5">
                <CameraOff className="w-6 h-6 text-on-surface" />
                <span className="text-[8px] uppercase tracking-widest font-bold">{t('app.alert_wall.waiting_data', 'Chờ dữ liệu...')}</span>
              </div>
            )}
          </div>
          <div className="p-2.5 flex flex-col gap-1 bg-surface-container-lowest/80">
            <div className="text-[10px] font-black uppercase tracking-widest text-primary truncate">{pin.label}</div>
            <div className="text-[10px] leading-tight text-on-surface line-clamp-2">{description}</div>
            <div className="text-[8px] font-mono text-on-surface-variant/60 mt-1 flex items-center justify-between">
              <span>{latestLog ? new Date(logTime(latestLog)).toLocaleTimeString() : `${pin.devices.length} thiết bị`}</span>
              {latestLog && <span>{new Date(logTime(latestLog)).toLocaleDateString()}</span>}
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
}: {
  pins: EMapPin[];
  tileProviderId: string;
  logs: LogData[];
  knownDevices: GridDevice[];
  onSaveLayout: (pins: EMapPin[], tileProviderId?: string) => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedLogCountRef = useRef(0);

  const [bgTimestamp, setBgTimestamp] = useState<number>(Date.now());
  const [movingPinId, setMovingPinId] = useState<string | null>(null);
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
    // Left empty since positioning is committed on mouseUp, keeping render fluid and simple
  };

  const handlePinMouseDown = useCallback((pinId: string, event: React.MouseEvent) => {
    if (event.button !== 0) return; // Left button only
    event.stopPropagation();
    setMovingPinId(pinId);
  }, []);

  const handleContainerMouseUp = (event: React.MouseEvent) => {
    const targetRef = innerRef.current || containerRef.current;
    if (!movingPinId || !targetRef) return;

    const rect = targetRef.getBoundingClientRect();
    let leftPercent = ((event.clientX - rect.left) / rect.width) * 100;
    let topPercent = ((event.clientY - rect.top) / rect.height) * 100;

    leftPercent = Math.max(0, Math.min(100, leftPercent));
    topPercent = Math.max(0, Math.min(100, topPercent));

    savePins(pins.map(pin => pin.id === movingPinId
      ? { ...pin, lat: topPercent, lng: leftPercent, updatedAt: new Date().toISOString() }
      : pin
    ));

    setMovingPinId(null);
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
      className={`relative h-full w-full overflow-hidden bg-slate-950/40 select-none flex items-center justify-center ${
        movingPinId ? 'cursor-grabbing' : 'cursor-default'
      }`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onContextMenu={(event) => event.preventDefault()}
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
        {visiblePins.map(pin => (
          <EMapPinMarker
            key={`${pin.id}-${movingPinId === pin.id ? 'moving' : 'fixed'}`}
            pin={pin}
            latestLog={latestLogsByPin[pin.id]}
            moving={movingPinId === pin.id}
            interactionsDisabled={!!contextMenu || !!movingPinId}
            onOpenContextMenu={handleOpenContextMenu}
            onMouseDown={handlePinMouseDown}
            hoveredPinId={hoveredPinId}
            setHoveredPinId={setHoveredPinId}
          />
        ))}
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
          {t('app.emap.move_hint', 'Kéo để định vị lại thiết bị trên sơ đồ')}
        </div>
      )}

      {/* Floating purple upload photo button - Styled exactly like gridSettingsButton */}
      <div className="absolute bottom-4 right-4 opacity-30 hover:opacity-100 transition-all duration-300 z-30 flex flex-col gap-2">
        <button
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`p-2.5 text-on-surface hover:text-white border border-outline-variant/30 rounded-full shadow-lg transition-all duration-300 group backdrop-blur-md cursor-pointer ${
            uploading ? 'bg-surface-container-high/50' : 'bg-surface-container-high/90 hover:bg-primary/95'
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
