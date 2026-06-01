/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, TileLayer, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Search, ShieldAlert, Camera, CameraOff, Calendar, Tag, ShieldCheck, MapPin, RefreshCw, Shield, X, ChevronLeft, ChevronRight, Maximize, Minimize } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/apiClient';
import {
  HCM_CENTER,
  buildTrafficTraceRoutePath,
  buildTraceRouteArrows,
  escapeHtml,
  filterSecurityTraffic,
  filterTrafficBlacklist,
  filterTrafficCatalog,
  getUniqueTrafficCameras,
  trafficCatalogToArray,
} from '../utils/trafficManagerLogic';
import type { GridDevice } from './AlertWall';
import 'leaflet/dist/leaflet.css';

// Leaflet TS bypass
type LeafletMap = any;
const LeafletMarker = Marker as any;
const LeafletPopup = Popup as any;
const LeafletTileLayer = TileLayer as any;
const LeafletMapContainer = MapContainer as any;
const LeafletPolyline = Polyline as any;

const TILE_PROVIDERS = {
  openstreetmap: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
};

const showLegacyTraceTimeline = false;

const normalizeAddress = (value?: string) => String(value || '').split(':')[0];

const isKnownDevice = (device: GridDevice, knownDevices: GridDevice[]) => (
  knownDevices.some(known =>
    known.server_id === device.server_id &&
    normalizeAddress(known.device_ip) === normalizeAddress(device.device_ip) &&
    known.device_type === device.device_type
  )
);

const imageBase64Src = (value?: string | null) => {
  if (!value) return null;
  return value.startsWith('data:image') ? value : `data:image/jpeg;base64,${value}`;
};

const trafficSnapshotUrl = (imagePath?: string | null) => {
  if (!imagePath) return null;
  const baseURL = String(apiClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${baseURL}/api/v1/traffic/snapshot?path=${encodeURIComponent(imagePath)}`;
};

const getPlateCutoutSrc = (item: any) => (
  imageBase64Src(item.plateImageBase64 || item.snapshot_base64)
  || trafficSnapshotUrl(item.plateImagePath || item.snapshot_path)
);

const getFullSnapshotSrc = (item: any) => (
  imageBase64Src(item.fullPlateImageBase64)
  || trafficSnapshotUrl(item.fullPlateImagePath)
);

// CCTV camera pin icon with flashing capability
const makeLprPinIcon = (flashing: boolean, isBlacklist: boolean = false) => {
  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
      <circle cx="7" cy="17" r="2"/>
      <path d="M9 17h6"/>
      <circle cx="17" cy="17" r="2"/>
    </svg>
  `;

  let classes = 'lpr-pin-normal bg-primary text-on-primary border-primary';
  if (flashing) {
    classes = isBlacklist
      ? 'lpr-pin-flash-blacklist bg-error text-on-error border-error shadow-lg shadow-error/50'
      : 'lpr-pin-flash-normal bg-warning text-on-warning border-warning shadow-lg shadow-warning/50';
  }

  return L.divIcon({
    className: '',
    html: `
      <div class="flex items-center justify-center rounded-full border-2 transition-all duration-300 ${classes}" style="width: 28px; height: 28px;">
        ${svgContent}
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

function MapRef({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

interface TrafficManagerProps {
  trafficHistory: any[];
  trafficCatalog: Record<string, any>;
  blacklistPlates: string[];
  setBlacklistPlates: (plates: string[] | ((prev: string[]) => string[])) => void;
  blacklistMechanism: number;
  setBlacklistMechanism: (val: number) => void;
  eMapLayout: { pins: any[]; tileProviderId: string };
  eMapKnownDevices: GridDevice[];
  saveEMapLayout?: (pins: any[], tileProviderId?: string) => void;
}

export function TrafficManager({
  trafficHistory,
  trafficCatalog,
  blacklistPlates,
  setBlacklistPlates,
  blacklistMechanism,
  setBlacklistMechanism,
  eMapLayout,
  eMapKnownDevices,
}: TrafficManagerProps) {
  const { t } = useTranslation();
  const mapRef = useRef<LeafletMap | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // List Management
  const [listTab, setListTab] = useState<'search' | 'security' | 'blacklist'>('search');
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);

  // Sync fullscreen state when user presses Escape or exits via browser
  useEffect(() => {
    const onFsChange = () => {
      setIsMapFullscreen(!!document.fullscreenElement);
      // Leaflet cần biết container đã đổi kích thước sau fullscreen
      setTimeout(() => mapRef.current?.invalidateSize(), 320);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const [searchQuery, setSearchQuery] = useState('');

  const [newBlacklistInput, setNewBlacklistInput] = useState('');

  // Dropdown filter inside Security tab
  const [cameraFilter, setCameraFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all'); // all, lpr_normal, blacklist

  // Time filter state
  const [showTimeFilter, setShowTimeFilter] = useState(false);
  const [appliedTimeFilterFrom, setAppliedTimeFilterFrom] = useState('');
  const [appliedTimeFilterTo, setAppliedTimeFilterTo] = useState('');
  const [tempTimeFilterFrom, setTempTimeFilterFrom] = useState('');
  const [tempTimeFilterTo, setTempTimeFilterTo] = useState('');
  const timeFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (timeFilterRef.current && !timeFilterRef.current.contains(event.target as Node)) {
        setShowTimeFilter(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Preview management
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [fullPreviewImage, setFullPreviewImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  // Real-time camera flashing trigger
  const [flashingCameras, setFlashingCameras] = useState<Record<string, { flash: boolean; isBlacklist: boolean }>>({});
  const lastHistoryCountRef = useRef(trafficHistory.length);

  // Right-click context menu and route tracing
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; plate: string } | null>(null);
  const [activeTraceRoute, setActiveTraceRoute] = useState<{
    plate: string;
    path: Array<{ lat: number; lng: number; label: string; time: number; camera: string; snapshotUrl?: string | null }>;
  } | null>(null);

  const handlePlateContextMenu = (e: React.MouseEvent, plate: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      plate,
    });
  };

  const handleStartTraceRoute = (plate: string) => {
    setContextMenu(null);
    const nextPath = buildTrafficTraceRoutePath(trafficHistory, plate, mapPins);
    if (nextPath.length === 0) {
      alert(`Khong tim thay lich su di chuyen cho bien so ${plate}`);
      return;
    }
    // Enrich each path point with snapshot image from matching trafficHistory record
    const sortedRecords = trafficHistory
      .filter(h => h.plate_num?.toUpperCase() === plate.toUpperCase())
      .sort((a: any, b: any) => a.receive_time - b.receive_time);
    const enrichedPath = nextPath.map((point, idx) => {
      const record = sortedRecords[idx];
      const snapshotUrl = record
        ? (getFullSnapshotSrc(record) || getPlateCutoutSrc(record))
        : null;
      return { ...point, snapshotUrl };
    });
    setActiveTraceRoute({ plate, path: enrichedPath });
    if (mapRef.current && enrichedPath.length > 0) {
      const bounds = L.latLngBounds(enrichedPath.map(p => [p.lat, p.lng]));
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
    return;
    const history = trafficHistory
      .filter(h => h.plate_num.toUpperCase() === plate.toUpperCase())
      .sort((a, b) => a.receive_time - b.receive_time);

    if (history.length === 0) {
      alert(`Không tìm thấy lịch sử di chuyển cho biển số ${plate}`);
      return;
    }

    const path = history.map((item, index) => {
      const locations: Array<{ lat: number; lng: number; label: string }> = [];
      (eMapLayout?.pins || []).forEach(pin => {
        const hasDev = (pin.devices || []).some((dev: any) =>
          dev.device_name === item.camera_name ||
          dev.device_name?.includes(item.camera_name) ||
          dev.mqtt_device_id === item.camera_id ||
          dev.server_id === item.camera_id
        );
        if (hasDev) {
          locations.push({
            lat: pin.lat,
            lng: pin.lng,
            label: pin.label || 'Vị trí camera'
          });
        }
      });

      let selectedLoc = null;
      if (locations.length > 0) {
        selectedLoc = locations[Math.floor(Math.random() * locations.length)];
      } else {
        // Deterministic mock hash to keep locations consistent for same camera in demo
        const hashCode = (str: string) => {
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
          }
          return hash;
        };
        const idx = Math.abs(hashCode(item.camera_name || 'Sunell'));
        const mockLat = HCM_CENTER[0] + (Math.sin(idx + index * 1.5) * 0.015);
        const mockLng = HCM_CENTER[1] + (Math.cos(idx + index * 1.5) * 0.015);
        selectedLoc = {
          lat: mockLat,
          lng: mockLng,
          label: `Chốt giám sát ${item.camera_name || 'Sunell'}`
        };
      }

      return {
        lat: selectedLoc.lat,
        lng: selectedLoc.lng,
        label: selectedLoc.label,
        time: item.receive_time,
        camera: item.camera_name || 'Sunell Camera',
      };
    });

    setActiveTraceRoute({ plate, path });

    // Smoothly pan and zoom Leaflet map to fit all path bounds
    if (mapRef.current && path.length > 0) {
      const bounds = L.latLngBounds(path.map(p => [p.lat, p.lng]));
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  };

  // Auto-detect when new LPR logs arrive and trigger map flashing
  useEffect(() => {
    if (trafficHistory.length > lastHistoryCountRef.current) {
      const newItems = trafficHistory.slice(lastHistoryCountRef.current);
      newItems.forEach(item => {
        const camId = item.camera_id;
        if (camId) {
          const isBlack = blacklistPlates.includes(item.plate_num);
          setFlashingCameras(prev => ({
            ...prev,
            [camId]: { flash: true, isBlacklist: isBlack }
          }));

          // Stop flashing after 5 seconds
          setTimeout(() => {
            setFlashingCameras(prev => ({
              ...prev,
              [camId]: { flash: false, isBlacklist: false }
            }));
          }, 5000);
        }
      });
    }
    lastHistoryCountRef.current = trafficHistory.length;
  }, [trafficHistory, blacklistPlates]);

  // Load snapshot image either from direct base64 or via backend proxy
  const handleSelectItem = async (item: any) => {
    setSelectedItem(item);
    setFullPreviewImage(getFullSnapshotSrc(item));
    setImageLoading(false);
  };

  // Convert trafficCatalog Map to an array
  const catalogArray = useMemo(() => {
    return trafficCatalogToArray(trafficCatalog);
  }, [trafficCatalog]);

  // Filter Catalog Tab
  const filteredCatalog = useMemo(() => {
    return filterTrafficCatalog(catalogArray, searchQuery);
  }, [catalogArray, searchQuery]);

  // Filter Blacklist Tab
  const filteredBlacklist = useMemo(() => {
    return filterTrafficBlacklist(catalogArray, blacklistPlates, searchQuery);
  }, [catalogArray, blacklistPlates, searchQuery]);

  // Collect unique camera list for the filters
  const uniqueCameras = useMemo(() => {
    return getUniqueTrafficCameras(trafficHistory);
  }, [trafficHistory]);

  // Filter Security Tab
  const filteredSecurity = useMemo(() => {
    return filterSecurityTraffic(trafficHistory, {
      cameraFilter,
      typeFilter,
      searchQuery,
      blacklistPlates,
      timeFilterFrom: appliedTimeFilterFrom,
      timeFilterTo: appliedTimeFilterTo,
    });
  }, [trafficHistory, cameraFilter, typeFilter, searchQuery, blacklistPlates, appliedTimeFilterFrom, appliedTimeFilterTo]);

  const handleAddBlacklist = (e: React.FormEvent) => {
    e.preventDefault();
    const plate = newBlacklistInput.toUpperCase().trim();
    if (plate && !blacklistPlates.includes(plate)) {
      setBlacklistPlates(prev => [...prev, plate]);
      setNewBlacklistInput('');
    }
  };

  const handleRemoveBlacklist = (plate: string) => {
    setBlacklistPlates(prev => prev.filter(p => p !== plate));
  };

  // Filter pins from layout
  const mapPins = useMemo(() => {
    return (eMapLayout?.pins || [])
      .map(pin => ({
        ...pin,
        devices: (pin.devices || []).filter((device: GridDevice) => isKnownDevice(device, eMapKnownDevices)),
      }))
      .filter(pin => pin.devices.length > 0);
  }, [eMapKnownDevices, eMapLayout]);

  const traceRouteArrows = useMemo(() => {
    return buildTraceRouteArrows(activeTraceRoute?.path || []);
  }, [activeTraceRoute]);

  const renderPlateCutout = (item: any, isAlert = false) => {
    const src = getPlateCutoutSrc(item);
    return (
      <div className={`w-28 h-16 shrink-0 rounded-lg overflow-hidden border bg-black flex items-center justify-center ${isAlert ? 'border-error/40' : 'border-outline-variant/20'}`}>
        {src ? (
          <img src={src} className="w-full h-full object-contain" alt={item.plate_num || 'Plate cutout'} />
        ) : (
          <CameraOff className="w-6 h-6 text-on-surface/25" />
        )}
      </div>
    );
  };

  const renderPlateTextInfo = (item: any) => (
    <div className="min-w-0 flex flex-col gap-1">
      <div className="text-[16px] font-bold tracking-widest text-on-surface truncate">{item.plate_num}</div>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-on-surface-variant">
        <span className="min-w-0 flex items-center gap-1">
          <Camera className="w-3 h-3 shrink-0 text-primary" />
          <span className="truncate">{item.camera_name || 'Sunell Camera'}</span>
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3 shrink-0 text-secondary" />
          <span>{new Date(item.receive_time).toLocaleString('vi-VN')}</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className="TrafficManager flex flex-col h-full bg-background overflow-hidden p-3 gap-4">
      {/* Dynamic Keyframes injected safely */}
      <style>{`
        .lpr-pin-flash-normal {
          animation: lpr-normal-ping 1.2s infinite ease-in-out;
        }
        .lpr-pin-flash-blacklist {
          animation: lpr-blacklist-ping 1.2s infinite ease-in-out;
        }
        @keyframes lpr-normal-ping {
          0% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.8); }
          70% { box-shadow: 0 0 0 10px rgba(234, 179, 8, 0); }
          100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); }
        }
        @keyframes lpr-blacklist-ping {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.8); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .plate-container-vietnam {
          background: #ffffff;
          border: 2.5px solid #222222;
          color: #111111;
          font-family: 'Inter', monospace;
          font-weight: 900;
          letter-spacing: 1.5px;
          border-radius: 6px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        }
        .traffic-trace-node-wrap {
          position: relative;
          width: 220px;
          min-height: 86px;
          transform: translate(-98px, -66px);
          pointer-events: auto;
        }
        .traffic-trace-dialog {
          position: absolute;
          left: 50%;
          bottom: 38px;
          transform: translateX(-50%);
          min-width: 156px;
          max-width: 220px;
          overflow-y: auto;
          scrollbar-width: none;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid rgba(59, 130, 246, 0.45);
          background: rgba(15, 23, 42, 0.96);
          color: #eff6ff;
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.45);
          font-size: 10px;
          line-height: 1.45;
          font-weight: 800;
          white-space: nowrap;
        }
        .traffic-trace-dialog::-webkit-scrollbar {
          display: none;
        }
        .traffic-trace-dialog::after {
          content: '';
          position: absolute;
          left: 50%;
          bottom: -6px;
          width: 10px;
          height: 10px;
          transform: translateX(-50%) rotate(45deg);
          background: rgba(15, 23, 42, 0.96);
          border-right: 1px solid rgba(59, 130, 246, 0.45);
          border-bottom: 1px solid rgba(59, 130, 246, 0.45);
        }
        .traffic-trace-dialog-row {
          display: block;
          color: #bfdbfe;
          font-family: 'Inter', monospace;
        }
        .traffic-trace-pin {
          position: absolute;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: 28px;
          height: 28px;
          border-radius: 9999px;
          border: 2px solid #ffffff;
          background: #2563eb;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 900;
          box-shadow: 0 10px 18px rgba(37, 99, 235, 0.45);
          animation: trace-pin-pulse 1.2s infinite ease-in-out;
        }
        .traffic-trace-arrow {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #dbeafe;
          filter: drop-shadow(0 4px 8px rgba(15, 23, 42, 0.45));
        }
        .traffic-trace-arrow svg {
          width: 24px;
          height: 24px;
        }
        @keyframes trace-pin-pulse {
          0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.65); }
          70% { box-shadow: 0 0 0 10px rgba(37, 99, 235, 0); }
          100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
        }
        .traffic-mini-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.45) transparent;
        }
        .traffic-mini-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .traffic-mini-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .traffic-mini-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.38);
          border-radius: 999px;
        }
        .traffic-mini-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.62);
        }
        /* Trace node dialog: expand on hover to show image + camera */
        .traffic-trace-node-wrap:hover .traffic-trace-dialog {
          white-space: normal;
          padding: 0 0 8px;
          overflow: hidden;
        }
        .traffic-trace-dialog-img {
          display: none;
        }
        .traffic-trace-node-wrap:hover .traffic-trace-dialog-img {
          display: block;
          width: 100%;
          height: auto;
          object-fit: cover;
          background: #050a14;
        }
        .traffic-trace-dialog-img-placeholder {
          display: none;
          width: 100%;
          height: 90px;
          align-items: center;
          justify-content: center;
          background: #0a0f1e;
          color: rgba(148,163,184,0.35);
          font-size: 9px;
          font-weight: 700;
          font-family: 'Inter', monospace;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .traffic-trace-node-wrap:hover .traffic-trace-dialog-img-placeholder {
          display: flex;
        }
        .traffic-trace-dialog-camera {
          display: none;
          color: white;
          font-size: 11px;
          font-weight: 700;
          font-family: 'Inter', monospace;
          padding: 5px 10px 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border-bottom: 1px solid rgba(59,130,246,0.18);
          margin-bottom: 2px;
        }
        .traffic-trace-node-wrap:hover .traffic-trace-dialog-camera {
          display: block;
        }
        .traffic-trace-node-wrap:hover .traffic-trace-dialog-row {
          padding: 0 10px;
          display: block;
        }
      `}</style>

      {/* Traffic management layout */}
      <div className={`grid grid-cols-1 gap-4 flex-1 min-h-0 transition-all duration-300 ${isLeftPanelVisible ? 'lg:grid-cols-[1fr_1.75fr]' : 'lg:grid-cols-[0fr_1fr]'}`}>
        <div className={`flex flex-col gap-4 min-h-0 overflow-hidden transition-all duration-300 ${isLeftPanelVisible ? 'opacity-100' : 'opacity-0 pointer-events-none w-0'}`}>

          {/* LIST AREA */}
          <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col shadow-xl flex-[3] min-h-0">
            {/* Header tabs */}
            <div className="flex items-center justify-between bg-surface-container-high/50 px-4 py-2.5 border-b border-outline-variant/20">
              <div className="flex gap-1">
                <button
                  onClick={() => setListTab('search')}
                  title={t('app.traffic.tab_search', { defaultValue: 'Danh sách biển số' })}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${listTab === 'search'
                    ? 'bg-error text-on-error shadow'
                    : 'text-on-surface/60 hover:text-on-surface hover:bg-surface-container-high'
                    }`}
                >
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  {listTab === 'search' && <span>{t('app.traffic.tab_search', { defaultValue: 'Danh sách biển số' })}</span>}
                </button>
                <button
                  onClick={() => setListTab('security')}
                  title={t('app.traffic.tab_security', { defaultValue: 'Nhật ký an ninh' })}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${listTab === 'security'
                    ? 'bg-error text-on-error shadow'
                    : 'text-on-surface/60 hover:text-on-surface hover:bg-surface-container-high'
                    }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  {listTab === 'security' && <span>{t('app.traffic.tab_security', { defaultValue: 'Nhật ký an ninh' })}</span>}
                </button>
                <button
                  onClick={() => setListTab('blacklist')}
                  title={t('app.traffic.tab_blacklist', { defaultValue: 'Danh sách đen' })}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${listTab === 'blacklist'
                    ? 'bg-error text-on-error shadow'
                    : 'text-on-surface/60 hover:text-on-surface hover:bg-surface-container-high'
                    }`}
                >
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  {listTab === 'blacklist' && <span>{t('app.traffic.tab_blacklist', { defaultValue: 'Danh sách đen' })}</span>}
                </button>
              </div>

              {/* Quick search input */}
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Tìm biển số..."
                  className="w-full bg-background border border-outline-variant/30 rounded-lg pl-8 pr-3 py-1 text-xs text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            {/* Catalog Tab Content */}
            {listTab === 'search' && (
              <div className="traffic-mini-scrollbar flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                {filteredCatalog.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-40 py-10 gap-2">
                    <Tag className="w-10 h-10" />
                    <span className="text-xs uppercase font-bold tracking-widest">Không tìm thấy biển số xe</span>
                  </div>
                ) : (
                  filteredCatalog.map(item => {
                    const isBlack = blacklistPlates.includes(item.plate_num);
                    const isSelected = selectedItem?.plate_num === item.plate_num;
                    return (
                      <div
                        key={item.plate_num}
                        onClick={() => handleSelectItem(item)}
                        onContextMenu={(e) => handlePlateContextMenu(e, item.plate_num)}
                        className={`traffic-card p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${isSelected
                          ? 'bg-primary/10 border-primary'
                          : isBlack
                            ? 'bg-error/5 border-error/20 hover:border-error/40'
                            : 'bg-surface-container border-outline-variant/10 hover:border-outline-variant/30'
                          }`}
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          {renderPlateCutout(item, isBlack)}
                          {renderPlateTextInfo(item)}
                        </div>
                        <div className="hidden">
                          <div className={`plate-info px-3 py-1 rounded plate-container-vietnam flex flex-col items-center justify-center min-w-[100px] ${isBlack ? 'border-error bg-error/10 text-error' : ''
                            }`}>
                            <div className="text-[9px] opacity-60 tracking-wider">VIỆT NAM</div>
                            <div className="text-sm font-black">{item.plate_num}</div>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
                              <Camera className="w-3 h-3 text-primary" />
                              {item.camera_name || 'Sunell Camera'}
                            </span>
                            <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-secondary" />
                              {new Date(item.receive_time).toLocaleString('vi-VN')}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isBlack) {
                                handleRemoveBlacklist(item.plate_num);
                              } else {
                                setBlacklistPlates(prev => [...prev, item.plate_num]);
                              }
                            }}
                            className={`p-2 rounded-xl border transition-all flex items-center justify-center ${isBlack
                              ? 'bg-error/20 border-error/40 text-error hover:bg-error/30 shadow shadow-error/10 animate-pulse'
                              : 'bg-surface-container border-outline-variant/30 text-on-surface/50 hover:bg-error/10 hover:border-error/30 hover:text-error'
                              }`}
                            title={isBlack ? "Xóa khỏi danh sách đen" : "Thêm vào danh sách đen"}
                          >
                            {isBlack ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Blacklist Tab Content */}
            {listTab === 'blacklist' && (
              <div className="traffic-mini-scrollbar flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                {/* Blacklist Mechanism Configuration Panel */}
                <div className="hidden bg-surface-container-high/50 p-3 rounded-2xl border border-outline-variant/10 flex flex-col gap-2 mb-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-black text-on-surface flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-error" />
                      Cấu hình cơ chế xử lý danh sách đen
                    </span>
                    <span className="text-[10px] text-on-surface-variant leading-tight">
                      Chọn cách thức hệ thống ghi nhận nhật ký khi phát hiện biển số xe thuộc danh sách đen.
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setBlacklistMechanism(2)}
                      className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${blacklistMechanism === 2
                        ? 'bg-error/10 border-error/50 text-error shadow-sm shadow-error/5'
                        : 'bg-surface border-outline-variant/20 hover:border-outline-variant/40 text-on-surface/80'
                        }`}
                    >
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        Cơ chế 2 (Mặc định)
                        {blacklistMechanism === 2 && <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" />}
                      </span>
                      <span className="text-[9px] leading-tight opacity-75">
                        THAY THẾ log_type thành lpr_blacklist (chỉ hiển thị bản ghi an ninh).
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlacklistMechanism(1)}
                      className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${blacklistMechanism === 1
                        ? 'bg-error/10 border-error/50 text-error shadow-sm shadow-error/5'
                        : 'bg-surface border-outline-variant/20 hover:border-outline-variant/40 text-on-surface/80'
                        }`}
                    >
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        Cơ chế 1
                        {blacklistMechanism === 1 && <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" />}
                      </span>
                      <span className="text-[9px] leading-tight opacity-75">
                        Tạo THÊM 1 log mới lpr_blacklist (vừa giữ log thường vừa có log blacklist).
                      </span>
                    </button>
                  </div>
                </div>

                {filteredBlacklist.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-40 py-10 gap-2">
                    <Shield className="w-10 h-10 text-error/60" />
                    <span className="text-xs uppercase font-bold tracking-widest text-on-surface/60">Không có biển số nào trong danh sách đen</span>
                  </div>
                ) : (
                  filteredBlacklist.map(item => {
                    const isBlack = blacklistPlates.includes(item.plate_num);
                    const isSelected = selectedItem?.plate_num === item.plate_num;
                    return (
                      <div
                        key={item.plate_num}
                        onClick={() => handleSelectItem(item)}
                        onContextMenu={(e) => handlePlateContextMenu(e, item.plate_num)}
                        className={`traffic-card p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${isSelected
                          ? 'bg-error/10 border-error font-bold'
                          : 'bg-error/5 border-error/20 hover:border-error/40'
                          }`}
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          {renderPlateCutout(item, isBlack)}
                          {renderPlateTextInfo(item)}
                        </div>
                        <div className="hidden">
                          <div className="px-3 py-1 rounded plate-container-vietnam flex flex-col items-center justify-center min-w-[100px] border-error bg-error/10 text-error">
                            <div className="text-[9px] opacity-60 tracking-wider">VIỆT NAM</div>
                            <div className="text-sm font-black">{item.plate_num}</div>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
                              <Camera className="w-3 h-3 text-primary" />
                              {item.camera_name || 'Sunell Camera'}
                            </span>
                            <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-secondary" />
                              {new Date(item.receive_time).toLocaleString('vi-VN')}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isBlack) {
                                handleRemoveBlacklist(item.plate_num);
                              } else {
                                setBlacklistPlates(prev => [...prev, item.plate_num]);
                              }
                            }}
                            className="p-2 rounded-xl border transition-all flex items-center justify-center bg-error/20 border-error/40 text-error hover:bg-error/30 shadow shadow-error/10 animate-pulse"
                            title="Xóa khỏi danh sách đen"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Security Tab Content */}
            {listTab === 'security' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Filter subheader */}
                <div className="flex gap-2 p-3 bg-surface-container-high/20 border-b border-outline-variant/10">
                  <select
                    value={cameraFilter}
                    onChange={e => setCameraFilter(e.target.value)}
                    className="flex-1 bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1 text-xs text-on-surface focus:outline-none"
                  >
                    <option value="all">Tất cả Camera</option>
                    {uniqueCameras.map(cam => (
                      <option key={cam} value={cam}>{cam}</option>
                    ))}
                  </select>
                  <select
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value)}
                    className="flex-1 bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1 text-xs text-on-surface focus:outline-none"
                  >
                    <option value="all">Tất cả sự kiện</option>
                    <option value="lpr_normal">Phát hiện thông thường</option>
                    <option value="blacklist">Cảnh báo Blacklist</option>
                  </select>

                  <div className="relative" ref={timeFilterRef}>
                    <button
                      onClick={() => {
                        if (!showTimeFilter) {
                          setTempTimeFilterFrom(appliedTimeFilterFrom);
                          setTempTimeFilterTo(appliedTimeFilterTo);
                        }
                        setShowTimeFilter(!showTimeFilter);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${showTimeFilter || appliedTimeFilterFrom || appliedTimeFilterTo
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-surface-container border-outline-variant/30 text-on-surface'
                        }`}
                      title="Lọc theo thời gian"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Thời gian
                    </button>

                    {showTimeFilter && (
                      <div className="absolute right-0 top-full mt-2 w-64 bg-background shadow-lg border border-outline-variant/20 rounded-xl p-3 z-[1000] flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-on-surface/70">Bộ lọc thời gian</span>
                          <button onClick={() => setShowTimeFilter(false)} className="text-on-surface/50 hover:text-on-surface">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex flex-col gap-2 text-sm">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] uppercase font-bold text-on-surface/60">Từ</label>
                            <input
                              type="datetime-local"
                              value={tempTimeFilterFrom}
                              onChange={(e) => setTempTimeFilterFrom(e.target.value)}
                              className="bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1.5 text-xs text-on-surface focus:outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] uppercase font-bold text-on-surface/60">Đến</label>
                            <input
                              type="datetime-local"
                              value={tempTimeFilterTo}
                              onChange={(e) => setTempTimeFilterTo(e.target.value)}
                              className="bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1.5 text-xs text-on-surface focus:outline-none"
                            />
                          </div>
                          <div className="flex justify-end gap-2 mt-1">
                            <button
                              onClick={() => {
                                setTempTimeFilterFrom('');
                                setTempTimeFilterTo('');
                                setAppliedTimeFilterFrom('');
                                setAppliedTimeFilterTo('');
                                setShowTimeFilter(false);
                              }}
                              className="text-[10px] px-3 py-1.5 border border-outline-variant/30 hover:bg-surface-container-high rounded text-on-surface/70"
                            >
                              Xóa lọc
                            </button>
                            <button
                              onClick={() => {
                                setAppliedTimeFilterFrom(tempTimeFilterFrom);
                                setAppliedTimeFilterTo(tempTimeFilterTo);
                                setShowTimeFilter(false);
                              }}
                              className="text-[10px] px-3 py-1.5 bg-primary hover:bg-primary/90 text-on-primary rounded font-bold"
                            >
                              Áp dụng
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Blacklist Quick Input Form */}
                {/* <form onSubmit={handleAddBlacklist} className="flex gap-2 px-3 py-2 bg-surface-container-high/10 border-b border-outline-variant/10">
                  <input
                    type="text"
                    value={newBlacklistInput}
                    onChange={e => setNewBlacklistInput(e.target.value)}
                    placeholder="Nhập biển số để thêm blacklist..."
                    className="flex-1 bg-surface-container border border-outline-variant/30 rounded-lg px-2.5 py-1 text-xs text-on-surface focus:outline-none"
                  />
                  <button type="submit" className="px-3 py-1 bg-error/90 hover:bg-error text-on-error rounded-lg text-xs font-bold transition-all shadow-sm">
                    Thêm Blacklist
                  </button>
                </form> */}

                {/* Security events list */}
                <div className="traffic-mini-scrollbar flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                  {filteredSecurity.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-40 py-10 gap-2">
                      <ShieldCheck className="w-10 h-10" />
                      <span className="text-xs uppercase font-bold tracking-widest">Không có cảnh báo an ninh nào</span>
                    </div>
                  ) : (
                    filteredSecurity.map(item => {
                      const isBlackAlarm = item.log_type === 'lpr_blacklist' || (item.log_type === undefined && blacklistPlates.includes(item.plate_num));
                      const isSelected = selectedItem?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectItem(item)}
                          onContextMenu={(e) => handlePlateContextMenu(e, item.plate_num)}
                          className={`traffic-card p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${isSelected
                            ? 'bg-primary/10 border-primary'
                            : isBlackAlarm
                              ? 'bg-error/10 border-error/40 shadow shadow-error/10'
                              : 'bg-surface-container border-outline-variant/10 hover:border-outline-variant/30'
                            }`}
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            {renderPlateCutout(item, isBlackAlarm)}
                            {renderPlateTextInfo(item)}
                          </div>
                          <div className="hidden">
                            <div className={`px-3 py-1 rounded plate-container-vietnam flex flex-col items-center justify-center min-w-[100px] ${isBlackAlarm ? 'border-error bg-error/10 text-error' : ''
                              }`}>
                              <div className="text-[9px] opacity-60 tracking-wider">VIỆT NAM</div>
                              <div className="text-sm font-black">{item.plate_num}</div>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-on-surface-variant flex items-center gap-1 font-bold">
                                <Camera className="w-3 h-3 text-primary" />
                                {item.camera_name || 'Sunell Camera'}
                              </span>
                              <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-secondary" />
                                {new Date(item.receive_time).toLocaleString('vi-VN')}
                              </span>
                            </div>
                          </div>

                          <div>
                            {isBlackAlarm ? (
                              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-error text-[8px] text-on-error font-black uppercase tracking-wider animate-pulse shadow">
                                {/* <ShieldAlert className="w-3.5 h-3.5" /> */}
                                BLACKLIST ALARM
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high border border-outline-variant/30 text-[8px] text-on-surface/60 font-bold uppercase tracking-wider">
                                {/* <Camera className="w-3.5 h-3.5" /> */}
                                LPR Detect
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* IMAGE PREVIEW AREA */}
          <div className="bg-surface-container-low  border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col shadow-xl flex-[2] min-h-0">

            <div className="flex-1 flex flex-col p-0.5 overflow-hidden">
              {/* Left box: Image */}
              <div className="flex-1 bg-black rounded-xl overflow-hidden relative border border-outline-variant/10 flex items-center justify-center min-h-[200px]">
                {imageLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-primary">
                    <RefreshCw className="w-8 h-8 animate-spin" />
                    <span className="text-xs uppercase tracking-widest font-bold opacity-60">Đang tải hình ảnh...</span>
                  </div>
                ) : fullPreviewImage ? (
                  <img
                    src={fullPreviewImage}
                    onError={() => setFullPreviewImage(null)}
                    className="w-full h-full object-contain"
                    alt="Full snapshot LPR"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-on-surface/20">
                    <CameraOff className="w-12 h-12" />
                    <span className="text-xs uppercase tracking-widest font-black">Không có ảnh toàn cảnh</span>
                  </div>
                )}
              </div>

              {/* Right box: Metadata Card */}
              <div className="hidden w-full md:w-56 shrink-0 flex-col gap-3 justify-center">
                {selectedItem ? (
                  <div className="flex flex-col gap-3.5">
                    <div className="plate-container-vietnam px-4 py-2 flex flex-col items-center justify-center border-3">
                      <div className="text-[10px] opacity-60 tracking-wider">VIỆT NAM</div>
                      <div className="text-lg font-black">{selectedItem.plate_num}</div>
                    </div>

                    <div className="flex flex-col gap-2.5 bg-surface-container px-3 py-3 rounded-xl border border-outline-variant/10 text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-on-surface/40 uppercase font-black tracking-widest">Thời gian</span>
                        <span className="font-mono text-on-surface">{new Date(selectedItem.receive_time).toLocaleString('vi-VN')}</span>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-on-surface/40 uppercase font-black tracking-widest">Thiết bị Camera</span>
                        <span className="font-bold text-primary flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5" />
                          {selectedItem.camera_name || 'Sunell Camera'}
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-on-surface/40 uppercase font-black tracking-widest">Độ tin cậy (Confidence)</span>
                        <span className="font-bold text-secondary">{selectedItem.confidence || 95}%</span>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-on-surface/40 uppercase font-black tracking-widest">Loại Sự kiện</span>
                        {blacklistPlates.includes(selectedItem.plate_num) ? (
                          <span className="text-error font-black uppercase flex items-center gap-1">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            BLACKLIST ALARM
                          </span>
                        ) : (
                          <span className="text-success font-bold uppercase flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Phát hiện thường
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-xs opacity-30 py-6 border border-dashed border-outline-variant/40 rounded-xl">
                    Chưa có dữ liệu chi tiết
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Map Area */}
        <div ref={mapContainerRef} className="bg-surface-container-low border border-outline-variant/20 rounded-2xl overflow-hidden shadow-xl relative min-h-[520px] lg:min-h-0">
          {/* Header toolbar overlay (Default Map Legend) */}
          <div
            className="absolute top-3 left-12 z-[1000] flex gap-2 transition-all duration-300 pointer-events-auto opacity-100 scale-100"
          >
            <div className="bg-surface-container-high/95 backdrop-blur border border-outline-variant/20 rounded-xl px-3 py-1.5 flex items-center gap-3 shadow-lg">
              <span className="text-[10px] font-black uppercase tracking-wider text-on-surface/70 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                Bản đồ định vị giao thông
              </span>
              {/* <div className="flex gap-4 border-l border-outline-variant/20 pl-3">
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-on-surface/60">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary border border-on-surface/10"></div>
                  Thông thường
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-on-surface/60">
                  <div className="w-2.5 h-2.5 rounded-full bg-warning border border-on-surface/10 animate-pulse"></div>
                  Nhận diện LPR
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-on-surface/60">
                  <div className="w-2.5 h-2.5 rounded-full bg-error border border-on-surface/10 animate-pulse"></div>
                  Cảnh báo danh sách đen
                </div>
              </div> */}
              {activeTraceRoute && (
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveTraceRoute(null); }}
                  className="ml-1 rounded-lg border border-primary/25 bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-primary hover:bg-primary/20 transition-all flex items-center gap-1"
                  title="Dong che do theo doi"
                >
                  <X className="w-3 h-3" />
                  {activeTraceRoute.plate}
                </button>
              )}
            </div>
          </div>

          {/* Left panel collapse toggle — dính vào viền trái giữa bản đồ */}
          <button
            onClick={() => {
              setIsLeftPanelVisible(v => !v);
              // Leaflet cần biết container đã đổi kích thước sau transition 300ms
              setTimeout(() => mapRef.current?.invalidateSize(), 320);
            }}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-[1001] flex items-center justify-center w-5 h-10 bg-surface-container-high/90 backdrop-blur border border-l-0 border-outline-variant/30 rounded-r-xl shadow-lg hover:bg-surface-container-highest transition-colors cursor-pointer"
            title={isLeftPanelVisible ? 'Ẩn danh sách và ảnh' : 'Hiện danh sách và ảnh'}
          >
            {isLeftPanelVisible
              ? <ChevronLeft className="w-3.5 h-3.5 text-on-surface/70" />
              : <ChevronRight className="w-3.5 h-3.5 text-on-surface/70" />}
          </button>

          {/* Fullscreen button — góc dưới phải bản đồ, chỉ fullscreen DIV bản đồ */}
          <button
            onClick={() => {
              if (!isMapFullscreen) {
                mapContainerRef.current?.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
              } else if (document.fullscreenElement) {
                document.exitFullscreen().catch(err => console.error('Exit fullscreen error:', err));
              }
            }}
            className="absolute bottom-3 right-3 z-[1001] p-2 bg-surface-container-high/90 backdrop-blur border border-outline-variant/20 rounded-xl shadow-lg hover:bg-surface-container-highest transition-colors cursor-pointer group"
            title={isMapFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình bản đồ'}
          >
            {isMapFullscreen
              ? <Minimize className="w-4 h-4 text-on-surface/70 group-hover:scale-110 transition-transform" />
              : <Maximize className="w-4 h-4 text-on-surface/70 group-hover:scale-110 transition-transform" />}
          </button>

          {/* Floating Trace Route Timeline Panel */}
          {showLegacyTraceTimeline && activeTraceRoute && (
            <div
              onMouseEnter={() => undefined}
              onMouseLeave={() => undefined}
              className={`absolute top-3 left-12 z-[1001] bg-surface-container-high/95 backdrop-blur border border-outline-variant/30 rounded-2xl p-4 shadow-2xl w-96 flex flex-col gap-3 transition-all duration-300 pointer-events-auto ${'opacity-0 scale-95 pointer-events-none'
                }`}
            >
              {/* Title Header */}
              <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2">
                <div className="flex items-center gap-2.5">
                  <div className="plate-container-vietnam px-3 py-1 border-2 text-[10px] font-black text-center flex flex-col justify-center min-w-[90px] shadow-sm">
                    <div className="text-[7px] opacity-60 leading-none">VIỆT NAM</div>
                    <div className="text-xs leading-tight font-black">{activeTraceRoute.plate}</div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-black uppercase text-primary tracking-wider">Tuyến đường di chuyển</span>
                    <span className="text-[9px] text-on-surface-variant font-bold">Lịch sử: {activeTraceRoute.path.length} điểm ghi nhận</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveTraceRoute(null); }}
                  className="p-1 rounded-lg hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
                  title="Đóng chế độ theo dõi"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Timeline Steps */}
              <div className="flex-1 overflow-y-auto max-h-48 pr-1 flex flex-col gap-3 scrollbar-thin">
                {activeTraceRoute.path.map((step, idx) => (
                  <div key={idx} className="flex gap-3 relative group">
                    {/* Vertical connecting line */}
                    {idx < activeTraceRoute.path.length - 1 && (
                      <div className="absolute left-[11px] top-6 bottom-[-16px] w-[1.5px] bg-primary/20 group-hover:bg-primary/50 transition-colors"></div>
                    )}

                    {/* Number Node */}
                    <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/50 text-[10px] font-black flex items-center justify-center text-primary shrink-0 relative z-10 shadow-sm">
                      {idx + 1}
                    </div>

                    {/* Step Metadata Card */}
                    <div className="flex flex-col gap-0.5 leading-tight">
                      <span className="text-[11px] font-black text-on-surface">{step.label}</span>
                      <span className="text-[10px] text-primary/90 font-bold flex items-center gap-1">
                        <Camera className="w-3 h-3" />
                        {step.camera}
                      </span>
                      <span className="text-[9px] text-on-surface-variant font-mono">
                        {new Date(step.time).toLocaleString('vi-VN')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Help / Micro-copy Footer */}
              <div className="border-t border-outline-variant/10 pt-2 flex items-center justify-between text-[9px] text-on-surface-variant/60 font-bold italic">
                <span>💡 Rê chuột vào đây để xem chú thích bản đồ</span>
                <span className="text-primary font-black uppercase tracking-wider">Demo Mode</span>
              </div>
            </div>
          )}

          {/* Map Container */}
          <LeafletMapContainer
            center={HCM_CENTER}
            zoom={13}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
          >
            <LeafletTileLayer
              url={TILE_PROVIDERS.openstreetmap.url}
              attribution={TILE_PROVIDERS.openstreetmap.attribution}
            />
            <MapRef onReady={(map) => { mapRef.current = map; }} />

            {/* Render Active Trace Route drawings */}
            {activeTraceRoute && (
              <>
                {/* Glowing outer backdrop polyline */}
                <LeafletPolyline
                  positions={activeTraceRoute.path.map(p => [p.lat, p.lng])}
                  color="#3b82f6"
                  weight={10}
                  opacity={0.3}
                />
                {/* Glowing inner neon polyline */}
                <LeafletPolyline
                  positions={activeTraceRoute.path.map(p => [p.lat, p.lng])}
                  color="#2563eb"
                  weight={4}
                  opacity={0.9}
                  dashArray="6, 8"
                />

                {/* Direction arrows */}
                {traceRouteArrows.map((arrow) => {
                  const arrowIcon = L.divIcon({
                    html: `
                    <div class="traffic-trace-arrow" style="transform: rotate(${arrow.bearing}deg);">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 19V5"></path>
                        <path d="M5 12l7-7 7 7"></path>
                      </svg>
                    </div>
                  `,
                    className: 'custom-path-arrow-icon',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                  });

                  return (
                    <LeafletMarker
                      key={`path-arrow-${arrow.key}`}
                      position={[arrow.lat, arrow.lng]}
                      icon={arrowIcon}
                      interactive={false}
                    />
                  );
                })}

                {/* Path Node markers */}
                {activeTraceRoute.path.map((step, idx) => {
                  const row = `${idx + 1}. ${new Date(step.time).toLocaleString('vi-VN')}`;
                  const nodeIcon = L.divIcon({
                    html: `
                    <div class="traffic-trace-node-wrap">
                      <div class="traffic-trace-dialog">
                        ${step.snapshotUrl
                        ? `<img class="traffic-trace-dialog-img" src="${escapeHtml(step.snapshotUrl)}" alt="snapshot" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><div class="traffic-trace-dialog-img-placeholder" style="display:none">No image</div>`
                        : `<div class="traffic-trace-dialog-img-placeholder">No image</div>`
                      }
                        <div class="traffic-trace-dialog-camera">${escapeHtml(step.camera || 'Camera')}</div>
                        <span class="traffic-trace-dialog-row">${escapeHtml(row)}</span>
                      </div>
                      <div class="traffic-trace-pin">${idx + 1}</div>
                    </div>
                  `,
                    className: 'custom-path-node-icon',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                  });

                  return (
                    <LeafletMarker
                      key={`path-node-${idx}`}
                      position={[step.lat, step.lng]}
                      icon={nodeIcon}
                    >
                      {showLegacyTraceTimeline && (
                        <LeafletPopup closeButton={false}>
                          <div className="p-2 flex flex-col gap-1 text-on-surface bg-surface-container font-mono text-[10px]">
                            <span className="text-xs font-black text-blue-500 uppercase">Chặng ${idx + 1}</span>
                            <span className="font-bold">{step.label}</span>
                            <span className="text-[9px] text-on-surface-variant">{step.camera}</span>
                            <span className="text-[8px] opacity-75">{new Date(step.time).toLocaleString('vi-VN')}</span>
                          </div>
                        </LeafletPopup>
                      )}
                    </LeafletMarker>
                  );
                })}
              </>
            )}

            {/* Render markers from the eMapLayout pins */}
            {mapPins.map(pin => {
              // Check if any device inside this pin is currently flashing
              let isFlashing = false;
              let isBlack = false;

              pin.devices.forEach((dev: any) => {
                // Check flashing map
                Object.keys(flashingCameras).forEach(camKey => {
                  if (
                    camKey === dev.server_id ||
                    camKey === dev.device_ip ||
                    camKey === dev.mqtt_device_id ||
                    camKey === dev.device_name ||
                    (flashingCameras[camKey].flash && dev.device_name?.includes(camKey))
                  ) {
                    const state = flashingCameras[camKey];
                    if (state.flash) {
                      isFlashing = true;
                      if (state.isBlacklist) isBlack = true;
                    }
                  }
                });
              });

              return (
                <LeafletMarker
                  key={pin.id}
                  position={[pin.lat, pin.lng]}
                  icon={makeLprPinIcon(isFlashing, isBlack)}
                >
                  <LeafletPopup closeButton={false}>
                    <div className="p-2 flex flex-col gap-1 text-on-surface bg-surface-container">
                      <span className="text-xs font-black uppercase tracking-wider text-primary">{pin.label}</span>
                      <span className="text-[10px] text-on-surface-variant font-mono">{pin.devices.length} Camera LPR</span>
                      {isFlashing && (
                        <span className={`text-[9px] font-black uppercase tracking-widest mt-1 animate-pulse ${isBlack ? 'text-error' : 'text-warning'
                          }`}>
                          {isBlack ? '⚠️ Cảnh báo Blacklist!' : '🚗 Phát hiện biển số xe'}
                        </span>
                      )}
                    </div>
                  </LeafletPopup>
                </LeafletMarker>
              );
            })}
          </LeafletMapContainer>
        </div>
      </div>

      {/* Floating Plate Context Menu */}
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
              onClick={() => handleStartTraceRoute(contextMenu.plate)}
              className="w-full text-left px-3.5 py-2.5 text-xs font-black text-primary hover:bg-primary/10 rounded-xl transition-all flex items-center gap-2"
            >
              <MapPin className="w-4 h-4 text-primary" />
              Theo dõi tuyến đường
            </button>
            <div className="border-t border-outline-variant/10 my-1"></div>
            <button
              onClick={() => {
                if (blacklistPlates.includes(contextMenu.plate)) {
                  handleRemoveBlacklist(contextMenu.plate);
                } else {
                  setBlacklistPlates(prev => [...prev, contextMenu.plate]);
                }
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-black text-error hover:bg-error/10 rounded-xl transition-all flex items-center gap-2"
            >
              <Shield className="w-4 h-4 text-error" />
              {blacklistPlates.includes(contextMenu.plate) ? 'Xóa khỏi Blacklist' : 'Thêm vào Blacklist'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
