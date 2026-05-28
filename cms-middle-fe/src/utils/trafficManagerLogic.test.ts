import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTraceRouteArrows,
  buildTrafficTraceRoutePath,
  filterSecurityTraffic,
  filterTrafficBlacklist,
  filterTrafficCatalog,
  getUniqueTrafficCameras,
  trafficCatalogToArray,
  type EMapPin,
  type TrafficRecord,
} from './trafficManagerLogic.ts';

const history: TrafficRecord[] = [
  {
    plate_num: '59P249458',
    receive_time: 3000,
    camera_id: 'cam-b',
    camera_name: 'Camera B',
    log_type: 'lpr_blacklist',
  },
  {
    plate_num: '51A12345',
    receive_time: 2000,
    camera_id: 'cam-c',
    camera_name: 'Camera C',
    log_type: 'lpr_normal',
  },
  {
    plate_num: '59P249458',
    receive_time: 1000,
    camera_id: 'cam-a',
    camera_name: 'Camera A',
  },
];

const pins: EMapPin[] = [
  {
    id: 'pin-a',
    lat: 10.77,
    lng: 106.7,
    label: 'Gate A',
    devices: [{ device_name: 'Camera A', mqtt_device_id: 'cam-a' }],
  },
  {
    id: 'pin-b',
    lat: 10.78,
    lng: 106.71,
    label: 'Gate B',
    devices: [{ device_name: 'Camera B', mqtt_device_id: 'cam-b' }],
  },
];

test('buildTrafficTraceRoutePath sorts matching plate logs and maps each log to its pin', () => {
  const path = buildTrafficTraceRoutePath(history, '59p249458', pins);

  assert.equal(path.length, 2);
  assert.deepEqual(path.map(point => point.time), [1000, 3000]);
  assert.deepEqual(path.map(point => point.label), ['Gate A', 'Gate B']);
  assert.deepEqual(path.map(point => [point.lat, point.lng]), [[10.77, 106.7], [10.78, 106.71]]);
});

test('buildTrafficTraceRoutePath avoids reusing random pin locations while alternatives remain', () => {
  const repeatedHistory: TrafficRecord[] = [
    { plate_num: '59P249458', receive_time: 1000, camera_id: 'cam-a', camera_name: 'Camera A' },
    { plate_num: '59P249458', receive_time: 2000, camera_id: 'cam-a', camera_name: 'Camera A' },
    { plate_num: '59P249458', receive_time: 3000, camera_id: 'cam-a', camera_name: 'Camera A' },
  ];
  const repeatedPins: EMapPin[] = [
    { id: 'pin-a1', lat: 10.77, lng: 106.7, label: 'Gate A1', devices: [{ device_name: 'Camera A', mqtt_device_id: 'cam-a' }] },
    { id: 'pin-a2', lat: 10.78, lng: 106.71, label: 'Gate A2', devices: [{ device_name: 'Camera A', mqtt_device_id: 'cam-a' }] },
    { id: 'pin-a3', lat: 10.79, lng: 106.72, label: 'Gate A3', devices: [{ device_name: 'Camera A', mqtt_device_id: 'cam-a' }] },
  ];

  const path = buildTrafficTraceRoutePath(repeatedHistory, '59P249458', repeatedPins, undefined, () => 0);
  const locationKeys = path.map(point => `${point.lat}:${point.lng}`);

  assert.equal(new Set(locationKeys).size, 3);
  assert.deepEqual(path.map(point => point.label), ['Gate A1', 'Gate A2', 'Gate A3']);
});

test('buildTraceRouteArrows creates one midpoint direction marker per route segment', () => {
  const path = buildTrafficTraceRoutePath(history, '59P249458', pins);
  const arrows = buildTraceRouteArrows(path);

  assert.equal(arrows.length, 1);
  assert.ok(Math.abs(arrows[0].lat - 10.775) < 0.000001);
  assert.ok(Math.abs(arrows[0].lng - 106.705) < 0.000001);
  assert.ok(arrows[0].bearing >= 0 && arrows[0].bearing < 360);
});

test('traffic catalog, blacklist, and security filters match the TrafficManager tabs', () => {
  const catalog = trafficCatalogToArray({
    '59P249458': history[0],
    '51A12345': history[1],
  });

  assert.deepEqual(catalog.map(item => item.plate_num), ['59P249458', '51A12345']);
  assert.deepEqual(filterTrafficCatalog(catalog, '59P').map(item => item.plate_num), ['59P249458']);
  assert.deepEqual(filterTrafficBlacklist(catalog, ['59P249458'], '').map(item => item.plate_num), ['59P249458']);

  const blacklistOnly = filterSecurityTraffic(history, {
    cameraFilter: 'all',
    typeFilter: 'blacklist',
    searchQuery: '',
    blacklistPlates: ['59P249458'],
  });
  assert.deepEqual(blacklistOnly.map(item => item.receive_time), [3000, 1000]);

  const cameraFiltered = filterSecurityTraffic(history, {
    cameraFilter: 'Camera C',
    typeFilter: 'lpr_normal',
    searchQuery: '51A',
    blacklistPlates: ['59P249458'],
  });
  assert.deepEqual(cameraFiltered.map(item => item.plate_num), ['51A12345']);

  const newestFirst = filterSecurityTraffic([...history].reverse(), {
    cameraFilter: 'all',
    typeFilter: 'all',
    searchQuery: '',
    blacklistPlates: ['59P249458'],
  });
  assert.deepEqual(newestFirst.map(item => item.receive_time), [3000, 2000, 1000]);

  assert.deepEqual(getUniqueTrafficCameras(history), ['Camera B', 'Camera C', 'Camera A']);
});
