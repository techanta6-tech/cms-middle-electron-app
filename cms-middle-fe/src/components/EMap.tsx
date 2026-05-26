import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Popup, useMap } from 'react-leaflet';
import L, { type Map as LeafletMap } from 'leaflet';

const LeafletMarker = Marker as any;
const LeafletPopup = Popup as any;
import { Move, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LogData } from '../types';
import type { GridDevice } from './AlertWall';
import 'leaflet/dist/leaflet.css';

export type EMapPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  devices: GridDevice[];
  createdAt?: string;
  updatedAt?: string;
};

type TileProvider = {
  id: string;
  url: string;
  attribution: string;
};

const TILE_PROVIDERS: Record<string, TileProvider> = {
  openstreetmap: {
    id: 'openstreetmap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
};

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

const normalizeAddress = (value?: string) => String(value || '').split(':')[0];

const makePinIcon = (alerting: boolean) => {
  const cctvIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97"/>
      <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z"/>
      <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15"/>
      <path d="M2 21v-4"/>
      <path d="M7 9h.01"/>
    </svg>
  `;
  return L.divIcon({
    className: '',
    html: `<div class="emap-pin ${alerting ? 'emap-pin-alert' : 'emap-pin-normal'}">${cctvIcon}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
};

function MapRef({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

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

const EMapPinMarker = memo(function EMapPinMarker({
  pin,
  latestLog,
  moving,
  interactionsDisabled,
  onOpenContextMenu,
  onMoveEnd,
  closeAllPopups,
}: {
  pin: EMapPin;
  latestLog?: LogData;
  moving: boolean;
  interactionsDisabled: boolean;
  onOpenContextMenu: (point: { x: number; y: number }, pinId: string) => void;
  onMoveEnd: (pinId: string, marker: L.Marker) => void;
  closeAllPopups: () => void;
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

  return (
    <LeafletMarker
      key={`${pin.id}-${moving ? 'moving' : 'fixed'}`}
      position={[pin.lat, pin.lng]}
      icon={makePinIcon(alerting)}
      draggable={moving}
      eventHandlers={{
        mouseover: (event) => {
          if (interactionsDisabled) return;
          (event.target as L.Marker).openPopup();
        },
        mouseout: (event) => {
          (event.target as L.Marker).closePopup();
        },
        click: (event) => {
          (event.originalEvent as MouseEvent | undefined)?.preventDefault();
          closeAllPopups();
        },
        popupopen: (event) => {
          if (interactionsDisabled) {
            (event.target as L.Marker).closePopup();
          }
        },
        contextmenu: (event) => {
          closeAllPopups();
          onOpenContextMenu({ x: event.containerPoint.x, y: event.containerPoint.y }, pin.id);
        },
        dragend: (event) => onMoveEnd(pin.id, event.target as L.Marker),
      }}
    >
      <LeafletPopup closeButton={false} autoPan={false}>
        <div className="w-[300px] h-auto overflow-hidden flex flex-col bg-surface-container-low text-on-surface">
          <div className="h-[190px] bg-black flex items-center justify-center overflow-hidden">
            {snapshot ? (
              <img
                src={snapshot.startsWith('data:image') ? snapshot : `data:image/jpeg;base64,${snapshot}`}
                className="w-full h-full object-cover"
                alt={pin.label}
              />
            ) : (
              <span className="text-[10px] uppercase tracking-widest text-on-surface-variant/50 font-bold">{t('app.alert_wall.waiting_data')}</span>
            )}
          </div>
          <div className="p-3 flex-1 flex flex-col gap-2">
            <div className="text-[12px] font-black uppercase tracking-widest text-primary line-clamp-2">{pin.label}</div>
            <div className="text-[12px] leading-relaxed text-on-surface">{description}</div>
            <div className="mt-auto text-[10px] font-mono text-on-surface-variant/70">
              {latestLog ? new Date(logTime(latestLog)).toLocaleString() : `${pin.devices.length} devices`}
            </div>
          </div>
        </div>
      </LeafletPopup>
    </LeafletMarker>
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
  const mapRef = useRef<LeafletMap | null>(null);
  const processedLogCountRef = useRef(0);
  const [movingPinId, setMovingPinId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pinId: string } | null>(null);
  const [latestLogsByPin, setLatestLogsByPin] = useState<Record<string, LogData | undefined>>({});

  const tileProvider = TILE_PROVIDERS[tileProviderId] || TILE_PROVIDERS.openstreetmap;

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
  }, [visiblePinSignature]);

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

  const closeAllPopups = useCallback(() => {
    mapRef.current?.closePopup();
  }, []);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const map = mapRef.current;
    const data = event.dataTransfer.getData('application/json');
    if (!map || !data) return;
    try {
      const devices = parseDroppedDevices(data).filter(device => isKnownDevice(device, knownDevices));
      if (devices.length === 0) return;
      const latLng = map.mouseEventToLatLng(event.nativeEvent);
      const now = new Date().toISOString();
      const label = devices.length > 1 ? `${devices[0].server_id} (${devices.length})` : devices[0].device_name;
      const nextPin: EMapPin = {
        id: `emap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lat: latLng.lat,
        lng: latLng.lng,
        label,
        devices,
        createdAt: now,
        updatedAt: now,
      };
      savePins([...pins, nextPin]);
    } catch {
      // Ignore invalid drag payload.
    }
  };

  const handleMoveEnd = useCallback((pinId: string, marker: L.Marker) => {
    const latLng = marker.getLatLng();
    setMovingPinId(null);
    savePins(pins.map(pin => pin.id === pinId
      ? { ...pin, lat: latLng.lat, lng: latLng.lng, updatedAt: new Date().toISOString() }
      : pin
    ));
  }, [pins, savePins]);

  const handleOpenContextMenu = useCallback((point: { x: number; y: number }, pinId: string) => {
    setContextMenu({ x: point.x, y: point.y, pinId });
  }, []);

  const deletePin = (pinId: string) => {
    setContextMenu(null);
    savePins(pins.filter(pin => pin.id !== pinId));
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-surface-container-low"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <style>{`
        .emap-pin {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 3px solid rgba(255,255,255,0.92);
          box-shadow: 0 10px 24px rgba(0,0,0,0.35);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .emap-pin-normal { background: #2563eb; }
        .emap-pin-alert {
          background: #ef4444;
          animation: emap-pulse 0.9s ease-in-out infinite;
        }
        @keyframes emap-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,0.65); }
          50% { transform: scale(1.18); box-shadow: 0 0 0 10px rgba(239,68,68,0); }
        }
        .leaflet-popup-content-wrapper {
          background: rgba(18,18,26,0.96);
          color: white;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
        }
        .leaflet-popup-tip { background: rgba(18,18,26,0.96); }
        .leaflet-popup-content { margin: 0; }
      `}</style>

      <MapContainer center={HCM_CENTER} zoom={12} minZoom={3} className="h-full w-full z-0">
        <MapRef onReady={(map) => { mapRef.current = map; }} />
        <TileLayer attribution={tileProvider.attribution} url={tileProvider.url} />
        {visiblePins.map(pin => (
          <EMapPinMarker
            key={`${pin.id}-${movingPinId === pin.id ? 'moving' : 'fixed'}`}
            pin={pin}
            latestLog={latestLogsByPin[pin.id]}
            moving={movingPinId === pin.id}
            interactionsDisabled={!!contextMenu || !!movingPinId}
            onOpenContextMenu={handleOpenContextMenu}
            onMoveEnd={handleMoveEnd}
            closeAllPopups={closeAllPopups}
          />
        ))}
      </MapContainer>

      {contextMenu && (
        <div
          className="absolute z-[1000] w-44 bg-surface-container-high border border-outline-variant/20 rounded-sm shadow-2xl overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest hover:bg-primary/20 text-on-surface"
            onClick={() => {
              closeAllPopups();
              setMovingPinId(contextMenu.pinId);
              setContextMenu(null);
            }}
          >
            <Move className="w-4 h-4" /> {t('app.emap.move')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest hover:bg-error/20 text-error"
            onClick={() => deletePin(contextMenu.pinId)}
          >
            <Trash2 className="w-4 h-4" /> {t('app.emap.delete')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest hover:bg-surface-container-highest text-on-surface-variant"
            onClick={() => setContextMenu(null)}
          >
            <X className="w-4 h-4" /> {t('app.emap.close')}
          </button>
        </div>
      )}

      {movingPinId && (
        <div className="absolute left-4 top-4 z-[900] bg-surface-container-high/90 border border-primary/30 text-primary px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-widest shadow-xl">
          {t('app.emap.move_hint')}
        </div>
      )}
    </div>
  );
}
