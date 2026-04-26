// ─── CONFIG & URL HELPERS ─────────────────────────────────────────────────────
const port = process.env.BE_PORT || process.env.THIS_PORT || 5050;

const getURL = (host, p) => (host && p ? `http://${host}:${p}` : null);
const getCMSBackendURL = () => getURL(process.env.BE_CMS_IP, process.env.BE_CMS_PORT);

// Parse SVMS_PORT_LIST từ .env (space-separated), fallback nếu không có
const SVMS_PORT_LIST = (process.env.SVMS_PORT_LIST || '17221 17222 7500 48021')
  .split(/\s+/)
  .map(Number)
  .filter(Boolean);

// Timeout cho connectivity monitor (ms)
const CONNECTIVITY_TIMEOUT_MS = parseInt(process.env.CONNECTIVITY_TIMEOUT_MS, 10) || 30000;

const declaredRoutes = [
  '/api/v1/login',
  '/api/v1/logs',
  '/healthcheck',
  '/api/v1/create-connection',
  '/api/v1/remove-connection',
  '/api/v1/connections',
  '/server-information',
  '/api/v1/server',
  '/api/v1/devices',
];

const mqttConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.93:1883',
  appId: process.env.MQTT_APPLICATION_ID || '32dc910f-33ae-4526-ac0b-6344e378f00f',
  deviceEui: process.env.MQTT_DEVICE_EUI || '24e124806e515126',
};

module.exports = { port, getCMSBackendURL, declaredRoutes, SVMS_PORT_LIST, CONNECTIVITY_TIMEOUT_MS, mqttConfig };
