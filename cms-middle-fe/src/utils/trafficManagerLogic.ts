export const HCM_CENTER: [number, number] = [10.7769, 106.7009];

export type TrafficRecord = {
  id?: string | number;
  plate_num: string;
  receive_time: number;
  camera_id?: string;
  camera_name?: string;
  log_type?: string;
  snapshot_path?: string | null;
  snapshot_base64?: string | null;
  plateImagePath?: string | null;
  fullPlateImagePath?: string | null;
  [key: string]: unknown;
};

export type EMapPin = {
  id?: string;
  lat: number;
  lng: number;
  label?: string;
  devices?: Array<{
    device_name?: string;
    mqtt_device_id?: string;
    server_id?: string;
    [key: string]: unknown;
  }>;
};

export type TraceRoutePoint = {
  lat: number;
  lng: number;
  label: string;
  time: number;
  camera: string;
};

export type TraceRouteArrow = {
  key: string;
  lat: number;
  lng: number;
  bearing: number;
};

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));

export const getRouteBearing = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
  const startLat = from.lat * Math.PI / 180;
  const endLat = to.lat * Math.PI / 180;
  const deltaLng = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

export const buildTrafficTraceRoutePath = (
  trafficHistory: TrafficRecord[],
  plate: string,
  pins: EMapPin[] = [],
  center: [number, number] = HCM_CENTER,
  random: () => number = Math.random
): TraceRoutePoint[] => {
  const history = trafficHistory
    .filter(item => item.plate_num?.toUpperCase() === plate.toUpperCase())
    .sort((a, b) => a.receive_time - b.receive_time);
  const usedLocationKeys = new Set<string>();

  return history.map((item, index) => {
    const matchingPins = pins.filter(pin => (pin.devices || []).some(device =>
      device.device_name === item.camera_name ||
      device.device_name?.includes(item.camera_name || '') ||
      device.mqtt_device_id === item.camera_id ||
      device.server_id === item.camera_id
    ));
    const availablePins = matchingPins.filter(pin => !usedLocationKeys.has(`${pin.lat}:${pin.lng}`));
    const selectablePins = availablePins.length > 0 ? availablePins : matchingPins;
    const selectedLoc = selectablePins[Math.floor(random() * selectablePins.length)];

    if (selectedLoc) {
      usedLocationKeys.add(`${selectedLoc.lat}:${selectedLoc.lng}`);
      return {
        lat: selectedLoc.lat,
        lng: selectedLoc.lng,
        label: selectedLoc.label || 'Vi tri camera',
        time: item.receive_time,
        camera: item.camera_name || 'Sunell Camera',
      };
    }

    let hash = 0;
    const cameraName = item.camera_name || 'Sunell';
    for (let i = 0; i < cameraName.length; i += 1) {
      hash = cameraName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash);
    const mockLat = center[0] + (Math.sin(idx + index * 1.5) * 0.015);
    const mockLng = center[1] + (Math.cos(idx + index * 1.5) * 0.015);

    return {
      lat: mockLat,
      lng: mockLng,
      label: `Chot giam sat ${cameraName}`,
      time: item.receive_time,
      camera: item.camera_name || 'Sunell Camera',
    };
  });
};

export const buildTraceRouteArrows = (path: TraceRoutePoint[]): TraceRouteArrow[] => {
  if (path.length < 2) return [];

  return path.slice(0, -1).map((point, index) => {
    const next = path[index + 1];
    return {
      key: `${index}-${point.lat}-${point.lng}-${next.lat}-${next.lng}`,
      lat: (point.lat + next.lat) / 2,
      lng: (point.lng + next.lng) / 2,
      bearing: getRouteBearing(point, next),
    };
  }).filter(arrow => Number.isFinite(arrow.bearing));
};

export const trafficCatalogToArray = (trafficCatalog: Record<string, TrafficRecord> | null | undefined) => {
  if (!trafficCatalog) return [];
  return Object.keys(trafficCatalog).map(plate => ({
    ...trafficCatalog[plate],
    plate_num: plate,
  })).sort((a, b) => b.receive_time - a.receive_time);
};

export const filterTrafficCatalog = (catalogArray: TrafficRecord[], query: string) => {
  const q = query.toUpperCase().trim();
  const arr = q ? catalogArray.filter(item => item.plate_num.toUpperCase().includes(q)) : catalogArray;
  return arr
    .sort((a, b) => b.receive_time - a.receive_time)
    .slice(0, 50);
};

export const filterTrafficBlacklist = (
  catalogArray: TrafficRecord[],
  blacklistPlates: string[],
  query: string
) => {
  const blackPlates = catalogArray.filter(item => blacklistPlates.includes(item.plate_num));
  const q = query.toUpperCase().trim();
  const arr = q ? blackPlates.filter(item => item.plate_num.toUpperCase().includes(q)) : blackPlates;
  return arr
    .sort((a, b) => b.receive_time - a.receive_time)
    .slice(0, 50);
};

export const getUniqueTrafficCameras = (trafficHistory: TrafficRecord[]) => {
  const cams = new Set<string>();
  trafficHistory.forEach(item => {
    if (item.camera_name) cams.add(item.camera_name);
  });
  return Array.from(cams);
};

export const filterSecurityTraffic = (
  trafficHistory: TrafficRecord[],
  options: {
    cameraFilter: string;
    typeFilter: string;
    searchQuery: string;
    blacklistPlates: string[];
    timeFilterFrom?: string;
    timeFilterTo?: string;
  }
) => {
  const arr = trafficHistory.filter(item => {
    if (options.timeFilterFrom) {
      const fromTime = new Date(options.timeFilterFrom).getTime();
      if (!isNaN(fromTime) && item.receive_time < fromTime) return false;
    }
    if (options.timeFilterTo) {
      const toTime = new Date(options.timeFilterTo).getTime();
      if (!isNaN(toTime) && item.receive_time > toTime) return false;
    }

    const logType = item.log_type || (options.blacklistPlates.includes(item.plate_num) ? 'lpr_blacklist' : 'lpr_normal');

    if (options.cameraFilter !== 'all' && item.camera_name !== options.cameraFilter) return false;
    if (options.typeFilter === 'blacklist' && logType !== 'lpr_blacklist') return false;
    if (options.typeFilter === 'lpr_normal' && logType !== 'lpr_normal') return false;

    const q = options.searchQuery.toUpperCase().trim();
    if (q && !item.plate_num.toUpperCase().includes(q)) return false;

    return true;
  });
  return arr
    .sort((a, b) => b.receive_time - a.receive_time)
    .slice(0, 50);
};
