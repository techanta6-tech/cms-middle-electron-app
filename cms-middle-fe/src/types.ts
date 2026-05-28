export interface SystemConnection {
  ip: string;
  port: string;
  status?: 'connecting' | 'connected' | 'disconnected';
  server_id?: string;
  sentCount?: number;
  receivedCount?: number;
  socketId?: string;
}

export interface SystemConfig {
  fe: { ip: string; port: string };
  be: { ip: string; port: string };
}

export interface Sunell_PlateInfo {
  Have_plate?: number;
  Plate_angleH?: number;
  Plate_angleV?: number;
  Plate_color?: number;
  Plate_type?: number;
  Plate_confidence?: number;
  Plate_country?: number;
  Char_num?: number;
  Plate_num?: string;
  Plate_char_confidence?: string;
  [key: string]: any;
}

export interface Sunell_TargetDetectItem {
  TargeId?: number;
  TargetId?: number;
  Type?: number;
  X?: number;
  Y?: number;
  W?: number;
  H?: number;
  AttrDataLen?: number;
  PlateInfo?: Sunell_PlateInfo;
  [key: string]: any;
}

export interface Sunell_AlarmData {
  dev_ip?: string;
  src_type?: number;
  src_id?: number;
  src_name?: string;
  dev_id?: string;
  dev_descript?: string;
  io_port_id?: number;
  targer_type?: number;
  target_type?: number;
  upleft_x?: number;
  upleft_y?: number;
  lowright_x?: number;
  lowright_y?: number;
  alarm_pic_len?: number;
  alarm_pic?: string;
  dev_type?: number;
  main_type?: number;
  sub_type?: number;
  alarm_flag?: number;
  time?: string;
  [key: string]: any;
}

export interface Sunell_LogPayload {
  Magic?: string;
  Vesion?: number;
  Version?: number;
  TotalLen?: number;
  PictureLen?: number;
  FullImageWidth?: number;
  FullImageHeight?: number;
  Capture_TimeH?: number;
  Capture_TimeL?: number;
  SequenceID?: number;
  Full_crop?: number;
  TargetSize?: number;
  TargetDetectList?: Sunell_TargetDetectItem[];
  data?: Sunell_AlarmData;
  SNPointList?: any[];
  AlarmAreaList?: any[];
  eventName?: string;
  snapshotBase64?: string;
  rawJson?: string;
  timestamp?: string;
  snapshotPath?: string | null;
  [key: string]: any;
}

export interface LogData {
  id?: string;
  receive_time: number;
  device_index?: number | string;
  log_type: string;
  log_description: string;
  snapshot?: string;
  overviewSnapshotBase64?: string;
  overviewSnapshotPath?: string;
  overviewSnapshotSource?: string;
  log_snapshot_image_path?: string;
  log_source: 'svms' | 'milesight-radar' | 'milesight-button' | 'sunell-camera' | 'i3ai' | 'other';
  device_info: {
    name: string;
    id: string;
  }
  server_unique_id: string;
  raw: SVMS_LogPayload | MQTT_Milesight_LogEntry | Sunell_LogPayload | any;
}

/** Một mục trong danh sách filter Event Types */
export interface EventTypeItem {
  event_type: string;
  log_source: 'svms' | 'mqtt' | 'sunell-camera' | 'i3ai' | 'other' | null;
}

export interface SVMS_LogPayload {
  id?: string;
  time?: number | string;
  device_index?: number;
  device_ip?: string;
  device_type?: string;
  device_name?: string;
  log_type?: string;
  description?: string;
  snapshot?: string;
  server?: {
    server_id?: string;
    serial?: string;
  };
  ip?: string;
  sender_ip?: string;
  raw?: any;
  body?: any;
  source?: 'svms';
  log_source?: 'svms';
  [key: string]: any;
}

export interface AddExternalServerProps {
  onSave: (ip: string, port: string) => void;
  onSaveMqtt: (config: MqttServerConfig) => void;
  onClose: () => void;
  initialIp?: string;
  initialPort?: string;
  initialMode?: 'receive';
  initialConnectionType?: 'svms' | 'mqtt';
  mqttToEdit?: MqttServerConfig;
}

export interface ServerData {
  server_id: string;
  server_name: string;
  type: 'svms' | 'milesight-radar' | 'direct' | 'forwarded' | 'mqtt' | 'i3ai';
  custom_server_name: string;
  svms_server_info?: SVMSServerData;
  milesight_server_info?: MqttServerConfig;
  raw: any;

  // Compatibility fields from the current BE socket payload.
  id: string;
  serial: string;
  server_ip: string;
  svms_ipv4_ip: string;
  version: string;
  location: string;
  day: number;
  month: number;
  year: number;
  sender_ip: string;
  lastSeen: string;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastLogReceived: string;
  mqttTopic?: string;
  status?: 'connecting' | 'connected' | 'disconnected' | 'error';
  name?: string;
}

export interface SVMSServer {
  id: string;
  serial: string;
  server_ip: string;
  server_name: string;
  version: string;
  location: string;
  day: number;
  month: number;
  year: number;
}

export interface SVMSServerData {
  // og log datas
  id: string;
  serial: string;
  server_ip: string;
  server_name: string;
  version: string;
  location: string;
  day: number;
  month: number;
  year: number;
}

// export interface ServerData {
//   // og log datas
//   id: string;
//   serial: string;
//   server_ip: string;
//   server_name: string;
//   version: string;
//   location: string;
//   day: number;
//   month: number;
//   year: number;
//   sender_ip?: string;
//   lastSeen?: string;
//   // new datas
//   svms_ipv4_ip?: string;
//   // connectivity monitor fields
//   type?: 'direct' | 'forwarded' | 'mqtt';
//   connectionStatus?: 'connected' | 'disconnected' | 'connecting';
//   lastLogReceived?: string;
//   mqttTopic?: string;
// }

export interface DeviceItem {
  name: string;
  ip: string;
  type: string;
  index: number;
}

export interface SMVSDevices {
  server: { serial: string; server_id: string, server_name?: string };
  devices: DeviceItem[];
}

export interface DeviceItem {
  name: string;
  ip: string;
  type: string;
  index: number;
  // connectivity monitor fields
  device_ip?: string;
  device_port?: number;
  connectionStatus?: 'connected' | 'disconnected';
  lastLogReceived?: string;
}

export interface DeviceData {
  server: { serial: string; server_id: string, server_name?: string };
  devices: DeviceItem[];
  sender_ip?: string;
  lastSeen?: string;
}

export interface MQTT_Milesight_Radar {
  tenantId: string;
  tenantName: string;
  applicationId: string;
  applicationName: string;
  deviceProfileId: string;
  deviceProfileName: string; // VD: 'Radar_LivingRoom'
  deviceName: string;        // VD: 'Radar_test'
  devEui: string;            // Unique device ID — dùng để đối chiếu
  deviceClassEnabled: string;
  tags: Record<string, string>;
}

export interface MqttServerConfig {
  id: string;
  groupId?: string;
  name?: string;
  brokerHost: string;
  brokerPort: string;
  protocol: 'mqtt' | 'mqtts';
  topic: string;
  defaultTopic: string;
  status?: 'connecting' | 'connected' | 'disconnected' | 'error';
  logCount?: number;
  cameraId?: string;
  deviceInfo?: MQTT_Milesight_DeviceInfo;
}

export interface MqttGroup {
  id: string;
  name: string;
  cameraId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  devices?: MqttDevice[];
}

export interface MqttDevice {
  id: string;
  groupId: string;
  topic: string;
  deviceInfo: MQTT_Milesight_DeviceInfo;
  brokerHost: string;
  brokerPort: string;
  protocol: 'mqtt' | 'mqtts';
  status?: 'connecting' | 'connected' | 'disconnected' | 'error';
  logCount?: number;
  cameraId?: string | null;
  features?: Record<string, boolean | { enabled: boolean; cameraId?: string | null }>;
  lastSeen?: string;
}

export interface CameraFeatures {
  enableMotion: boolean;
  enableLPR: boolean;
  enableFace?: boolean;
  enableIVA?: boolean;
  enableSystem?: boolean;
}

/** Camera device added manually (independent of MQTT/SVMS). */
export interface ManualAddedCamera {
  id: string;
  name?: string;
  type: 'sunell' | 'other';
  cameraIp: string;
  cameraPort: number;
  cameraUser: string;
  rtspUrl: string | null;
  snapshotUrl?: string | null;
  status: 'connecting' | 'connected' | 'error' | 'disconnected' | 'ready';
  handle: number | null;
  features?: CameraFeatures;
  rtspStream?: {
    status?: 'idle' | 'starting' | 'running' | 'stopped' | 'error' | string;
    latestFramePath?: string | null;
    lastError?: string | null;
    latestFrame?: {
      size: number;
      updatedAtMs: number;
      updatedAt: string;
    } | null;
  } | null;
}

/** Backward compat alias — gradually replace usages */
export type MqttDeviceConfig = ManualAddedCamera;

/** Links a specific MQTT sensor device to a manually added camera. */
export interface DeviceCameraLink {
  mqttDeviceId?: string;
  groupId?: string;
  devEui?: string;
  mqttServerId?: string;
  cameraId: string | null;
  features?: Record<string, boolean | { enabled: boolean; cameraId?: string | null }>;
}

// ─── MQTT Log Types ──────────────────────────────────────────────────────────

/** Một alarm event trong trường object.events */
export interface MQTT_Milesight_LogEvent {
  alarm_type: string;   // VD: 'dwell', 'fall', 'stay', ...
  alarm_id: number;
  alarm_status: string; // VD: 'alarm_triggered', 'alarm_canceled'
}

/** Thông tin thiết bị/gửi data (deviceInfo) — dùng để định danh device */
export interface MQTT_Milesight_DeviceInfo {
  tenantId: string;
  tenantName: string;
  applicationId: string;
  applicationName: string;
  deviceProfileId: string;
  deviceProfileName: string; // VD: 'Radar_LivingRoom'
  deviceName: string;        // VD: 'Radar_test'
  devEui: string;            // Unique device ID — dùng để đối chiếu
  deviceClassEnabled: string;
  tags: Record<string, string>;
}

/** Toàn bộ raw payload nhận từ MQTT (ChirpStack uplink format) */
export interface MQTT_Milesight_LogPayload {
  deduplicationId: string;
  time: string;
  deviceInfo: MQTT_Milesight_DeviceInfo;
  devAddr: string;
  adr: boolean;
  dr: number;
  fCnt: number;
  fPort: number;
  confirmed: boolean;
  data: string;             // Base64-encoded raw LoRa payload
  object: {
    events: MQTT_Milesight_LogEvent[];
    [key: string]: any;     // Các trường khác trong object (region, respiratory, ...)
  };
  rxInfo: Array<{
    gatewayId: string;
    uplinkId: number;
    gwTime: string;
    nsTime: string;
    rssi: number;
    snr: number;
    location?: { latitude: number; longitude: number };
    context: string;
    crcStatus: string;
  }>;
  txInfo: {
    frequency: number;
    modulation: {
      lora: {
        bandwidth: number;
        spreadingFactor: number;
        codeRate: string;
      };
    };
  };
  regionConfigId: string;
}

/** Log entry được BE emit qua socket — bao gồm metadata để đối chiếu MQTT server */
export interface MQTT_Milesight_LogEntry {
  time: string;
  type: 'data' | 'system';
  topic: string;            // MQTT topic nhận message
  payload: MQTT_Milesight_LogPayload;  // Raw payload gốc
  snapshot?: string;        // Base64 image snapshot (nếu có)
  mqttServerId: string;     // ID của MqttServerConfig — key để đối chiếu
  mqttDeviceId?: string;
  groupId?: string;
  brokerHost?: string;
  brokerPort?: string;
}

export interface ExternalAlertPayload {
  source: string;
  camera_ip: string;
  camera_url: string;
  channel_id: number;
  event_timestamp: number;
  inserted_timestamp: number;
  alarm_type: number;
  event_type: string;
  ai_score: number;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  image_base64: string;
} 
