const mqtt = require('mqtt');
const { mqttConfig } = require('../config');

let mqttClient = null;

// Array to store logs specifically for fall detection
const fall_detection_logs = [];

/**
 * Initialize the MQTT Client and subscribe to the specific topic.
 */
const initMqtt = () => {
  const { brokerUrl, appId, deviceEui } = mqttConfig;

  console.log(`[MQTT] Activating MQTT Service...`);
  console.log(`[MQTT] Target Broker: ${brokerUrl}`);
  
  try {
    mqttClient = mqtt.connect(brokerUrl);

    mqttClient.on('connect', () => {
      console.log(`[MQTT] Successfully connected to broker at ${brokerUrl}`);
      
      const topic = `application/${appId}/device/${deviceEui}/event/up`;
      mqttClient.subscribe(topic, (err) => {
        if (err) {
          console.error(`[MQTT] Subscription error for topic ${topic}:`, err);
        } else {
          console.log(`[MQTT] Subscribed to topic: ${topic}`);
        }
      });
    });

    mqttClient.on('message', (topic, message) => {
      console.log(`\n[MQTT DATA RECEIVED] Topic: ${topic}`);
      try {
        const payload = JSON.parse(message.toString());
        // Save to log array
        fall_detection_logs.push({
          time: new Date().toISOString(),
          topic: topic,
          payload: payload
        });
        
        // Keep array length reasonable (max 100 items)
        if (fall_detection_logs.length > 100) {
          fall_detection_logs.shift();
        }

        console.log(`[MQTT] Payload (JSON) stored.`);
        console.log(`[MQTT] Total Logs Count:`, fall_detection_logs.length);
      } catch (e) {
        console.log(`[MQTT] Payload (Text) received but not saved to JSON array:`, message.toString());
      }
      console.log(`--------------------------------------------------\n`);
    });

    mqttClient.on('error', (err) => {
      console.error(`[MQTT] Connection Error:`, err);
    });

    mqttClient.on('close', () => {
      console.log(`[MQTT] Connection closed`);
    });

    mqttClient.on('reconnect', () => {
      console.log(`[MQTT] Reconnecting to broker...`);
    });

  } catch (error) {
    console.error(`[MQTT] Initialization Error:`, error);
  }
};

/**
 * Get the current MQTT client instance
 * @returns {mqtt.MqttClient | null}
 */
const getMqttClient = () => mqttClient;

/**
 * Get the fall detection logs array
 * @returns {Array}
 */
const getFallDetectionLogs = () => fall_detection_logs;

module.exports = {
  initMqtt,
  getMqttClient,
  getFallDetectionLogs
};
