const mqtt = require('mqtt');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// const BROKER_URL = 'mqtt://192.168.1.93:1883'; 
const BROKER_URL = 'mqtt://localhost:1883';
// Cần trỏ đúng IP/Port của MQTT Broker mà App đang lắng nghe
const TOPIC = 'application/32dc910f-33ae-4526-ac0b-6344e378f00f/device/24e124806e515126/event/up';
const INTERVAL = 1000; // 1 giây một lần

// Khởi tạo MQTT client
console.log(`[SIM-MQTT] Đang kết nối tới ${BROKER_URL}...`);
const client = mqtt.connect(BROKER_URL);

let eventSequence = 0;

// Hàm tạo payload giống định dạng mà cms-middle-be (mqtt.service.js) xử lý
function buildPayload() {
  eventSequence++;
  return {
    // bọc trong 'object' và 'events' theo chuẩn mà BE đang parse
    object: {
      events: [
        {
          alarm_type: 'simulated_motion_detection',
          alarm_id: eventSequence,
          alarm_status: 'active',
          description: `Simulated event #${eventSequence}`,
          timestamp: new Date().toISOString()
        }
      ]
    }
  };
}

// ─── MQTT EVENTS ─────────────────────────────────────────────────────────────
client.on('connect', () => {
  console.log(`[SIM-MQTT] ✅ Kết nối thành công tới ${BROKER_URL}`);
  console.log(`[SIM-MQTT] 🚀 Bắt đầu gửi event giả lập vào topic '${TOPIC}' mỗi ${INTERVAL}ms\n`);

  // Gửi định kỳ
  setInterval(() => {
    const payload = buildPayload();
    const payloadString = JSON.stringify(payload);

    client.publish(TOPIC, payloadString, (err) => {
      if (err) {
        console.error(`[SIM-MQTT] ❌ Lỗi khi gửi tin nhắn:`, err);
      } else {
        console.log(`[SIM-MQTT] 📡 Đã gửi event #${eventSequence} -> topic: ${TOPIC}`);
      }
    });
  }, INTERVAL);
});

client.on('error', (err) => {
  console.error('[SIM-MQTT] ❌ Lỗi kết nối MQTT:', err.message);
});

client.on('close', () => {
  console.log('[SIM-MQTT] ⚠️ Kết nối đã đóng');
});
