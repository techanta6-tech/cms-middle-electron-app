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

export interface LogData {
  id?: string;
  time: number;
  device_index: number;
  device_ip: string;
  device_type: string;
  device_name: string;
  log_type: string;
  description: string;
  snapshot?: string;
  server: {
    server_id: string;
    serial: string;
  };
  ip: string;
  raw?: any;
  cameraIp?: string;
  source?: 'svms' | 'mqtt' | 'sunell-camera';
  mqttServerId?: string;
}

export interface AddExternalServerProps {
  onSave: (ip: string, port: string, mode: 'receive' | 'send') => void;
  onSaveMqtt: (config: MqttServerConfig) => void;
  onClose: () => void;
  initialIp?: string;
  initialPort?: string;
  initialMode?: 'receive' | 'send';
  initialConnectionType?: 'svms' | 'mqtt';
}

export interface ServerData {
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
  sender_ip?: string;
  lastSeen?: string;
  // new datas
  svms_ipv4_ip?: string;
  // connectivity monitor fields
  type?: 'direct' | 'forwarded' | 'mqtt';
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
  lastLogReceived?: string;
  mqttTopic?: string;
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
  server: { serial: string; server_id: string };
  devices: DeviceItem[];
  sender_ip?: string;
  lastSeen?: string;
}

export interface MqttServerConfig {
  id: string;
  brokerHost: string;
  brokerPort: string;
  protocol: 'mqtt' | 'mqtts';
  topic: string;
  defaultTopic: string;
  status?: 'connecting' | 'connected' | 'disconnected' | 'error';
  logCount?: number;
  cameraId?: string;
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
  status: 'connecting' | 'connected' | 'error' | 'disconnected' | 'ready';
  handle: number | null;
  features?: CameraFeatures;
}

/** Backward compat alias — gradually replace usages */
export type MqttDeviceConfig = ManualAddedCamera;

/** Links a specific MQTT sensor device to a manually added camera. */
export interface DeviceCameraLink {
  devEui: string;
  mqttServerId: string;
  cameraId: string;
}

// ─── MQTT Log Types ──────────────────────────────────────────────────────────

/** Một alarm event trong trường object.events */
export interface MqttLogEvent {
  alarm_type: string;   // VD: 'dwell', 'fall', 'stay', ...
  alarm_id: number;
  alarm_status: string; // VD: 'alarm_triggered', 'alarm_canceled'
}

/** Thông tin thiết bị gửi data (deviceInfo) — dùng để định danh device */
export interface MqttDeviceInfo {
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
export interface MqttLogPayload {
  deduplicationId: string;
  time: string;
  deviceInfo: MqttDeviceInfo;
  devAddr: string;
  adr: boolean;
  dr: number;
  fCnt: number;
  fPort: number;
  confirmed: boolean;
  data: string;             // Base64-encoded raw LoRa payload
  object: {
    events: MqttLogEvent[];
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
export interface MqttLogEntry {
  time: string;
  type: 'data' | 'system';
  topic: string;            // MQTT topic nhận message
  payload: MqttLogPayload;  // Raw payload gốc
  snapshot?: string;        // Base64 image snapshot (nếu có)
  mqttServerId: string;     // ID của MqttServerConfig — key để đối chiếu
  brokerHost?: string;
  brokerPort?: string;
}