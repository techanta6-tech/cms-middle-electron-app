const mqtt = require('mqtt');

const brokerUrl = 'mqtt://192.168.1.93:1883';
const topic = 'application/32dc910f-33ae-4526-ac0b-6344e378f00f/device/24e124806e515126/event/up';

console.log(`Connecting to ${brokerUrl}...`);

const client = mqtt.connect(brokerUrl);

client.on('connect', () => {
  console.log(`Connected successfully to ${brokerUrl}`);
  client.subscribe(topic, (err) => {
    if (err) {
      console.error('Subscription error:', err);
    } else {
      console.log(`Subscribed to topic: ${topic}`);
      console.log('Waiting for messages...');
    }
  });
});

client.on('message', (msgTopic, message) => {
  console.log(`\n[${new Date().toISOString()}] Received message on topic: ${msgTopic}`);
  try {
    const parsed = JSON.parse(message.toString());
    console.log('Payload structure:', Object.keys(parsed));
    if (parsed.object && parsed.object.events) {
      console.log('Events array length:', parsed.object.events.length);
    } else {
      console.log('Notice: Payload does not have object.events property.');
    }
    // Dump full payload for inspection (truncated if too long)
    const jsonStr = JSON.stringify(parsed, null, 2);
    if (jsonStr.length > 1000) {
      console.log(jsonStr.substring(0, 1000) + '\n... [TRUNCATED]');
    } else {
      console.log(jsonStr);
    }
  } catch (e) {
    console.log('Raw message (not JSON):', message.toString());
  }
});

client.on('error', (err) => {
  console.error('Connection error:', err);
});

// Run for 30 seconds then exit
setTimeout(() => {
  console.log('Test completed. Exiting...');
  client.end();
  process.exit(0);
}, 30000);
