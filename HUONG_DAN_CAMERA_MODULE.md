# 📷 Hướng Dẫn Sử Dụng `cameraModule.js`

## Giới Thiệu

`cameraModule.js` là module Node.js tích hợp camera Sunell, cung cấp các chức năng:

- **Chụp snapshot** qua giao thức RTSP (dùng FFmpeg)
- **Trigger snapshot** từ thiết bị bên ngoài + broadcast realtime qua WebSocket
- **Kiểm tra trạng thái** kết nối camera và WebSocket
- **Kết nối camera SDK** C# qua edge-js (nhận alarm, nhận diện khuôn mặt/biển số)
- **API routes** sẵn sàng gắn vào bất kỳ Express app nào

---

## Yêu Cầu

### Dependencies (npm)

```bash
npm install express ws @ffmpeg-installer/ffmpeg
```

**Tuỳ chọn** (nếu dùng SDK C# kết nối camera trực tiếp):
```bash
npm install edge-js
```

### Cấu Trúc Thư Mục Tối Thiểu

```
project/
├── server.js               ← Server chính của bạn
├── cameraModule.js          ← Module camera (copy file này vào)
└── snapshots/               ← Thư mục lưu ảnh (tự tạo)
```

**Nếu dùng SDK Sunell** (tuỳ chọn):
```
project/
├── server.js
├── cameraModule.js
├── SunellWrapper.cs         ← File C# wrapper
├── Sdk_C_Sharp_Lib.dll      ← SDK DLL
├── sdk.dll
├── libcrypto-3-x64.dll
├── libssl-3-x64.dll
└── snapshots/
```

---

## Hướng Dẫn Từng Bước

### Bước 1: Khởi tạo module — `init(config)`

```js
const camera = require('./cameraModule');
const path = require('path');

camera.init({
    rtspUrl: 'rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1',
    snapshotDir: path.join(__dirname, 'snapshots'),

    // Tuỳ chọn — chỉ cần nếu dùng SDK C#
    sdkPath: path.join(__dirname, '..'),
    cameraIp: '192.168.1.208',
    cameraPort: 30001,
    cameraUser: 'admin',
    cameraPass: 'admin1234',

    // Tuỳ chọn — custom logger
    logger: (direction, label, data) => {
        console.log(`[${direction}] ${label}`, data || '');
    }
});
```

**Bảng tham số `init(config)`:**

| Tham số | Bắt buộc | Mô tả |
|---|---|---|
| `rtspUrl` | ✅ | URL RTSP đầy đủ của camera |
| `snapshotDir` | ✅ | Đường dẫn thư mục lưu ảnh snapshot |
| `sdkPath` | ❌ | Đường dẫn thư mục chứa SDK DLLs + `SunellWrapper.cs` |
| `cameraIp` | ❌ | IP camera (dùng cho SDK C#) |
| `cameraPort` | ❌ | Port SDK camera (mặc định: `30001`) |
| `cameraUser` | ❌ | Username đăng nhập camera |
| `cameraPass` | ❌ | Password đăng nhập camera |
| `logger` | ❌ | Hàm log tùy chỉnh: `(direction, label, data) => void` |

---

### Bước 2: Đăng ký API routes — `registerRoutes(app, prefix)`

```js
const express = require('express');
const app = express();
app.use(express.json());

// Đăng ký routes KHÔNG có prefix
camera.registerRoutes(app);
// → GET  /api/status
// → POST /api/trigger-snapshot
// → GET  /api/snapshot
// → GET  /snapshots/:filename

// HOẶC đăng ký với prefix tuỳ ý
camera.registerRoutes(app, '/camera');
// → GET  /camera/api/status
// → POST /camera/api/trigger-snapshot
// → GET  /camera/api/snapshot
// → GET  /camera/snapshots/:filename
```

**Các API được tạo:**

| Method | URL | Mô tả |
|---|---|---|
| `GET` | `/api/status` | Trả về trạng thái camera, WebSocket, snapshot |
| `POST` | `/api/trigger-snapshot` | Thiết bị ngoài gọi để trigger chụp snapshot |
| `GET` | `/api/snapshot` | Test chụp snapshot thủ công (trả về file JPEG) |
| `GET` | `/snapshots/:file` | Xem ảnh snapshot đã lưu |

---

### Bước 3: Khởi tạo WebSocket — `setupWebSocket(server)`

```js
const http = require('http');

const server = http.createServer(app);
camera.setupWebSocket(server);

server.listen(3000, () => {
    console.log('Server chạy tại http://localhost:3000');
});
```

WebSocket server sẽ tự động:
- Quản lý danh sách client kết nối
- Broadcast message khi có alarm hoặc trigger snapshot

---

### Bước 4 (Tuỳ chọn): Kết nối camera SDK — `connectCamera()`

> ⚠️ **Chỉ cần nếu bạn muốn nhận alarm/sự kiện trực tiếp từ camera qua SDK C#.**
> Nếu chỉ cần chụp snapshot qua RTSP thì **bỏ qua bước này**.

```js
camera.connectCamera().then(result => {
    if (result.online) {
        console.log('Camera đã kết nối! Handle:', result.handle);
    } else {
        console.log('Kết nối thất bại:', result.message || result.error);
    }
});
```

---

## Sử Dụng Các Hàm Trực Tiếp Trong Code

### 📸 Chụp snapshot — `captureSnapshot()`

Chụp 1 frame JPEG từ camera qua RTSP. **Không broadcast** qua WebSocket.

```js
// Chụp với cấu hình mặc định (đã init)
const { filePath, sizeKB } = await camera.captureSnapshot();
console.log(`Ảnh lưu tại: ${filePath} (${sizeKB} KB)`);

// Chụp với RTSP URL khác
const result = await camera.captureSnapshot(
    'rtsp://admin:pass@10.0.0.100:554/stream1',
    'C:/photos/custom.jpg'
);

// Chụp với timeout tuỳ chỉnh (15 giây)
const result = await camera.captureSnapshot(null, null, 15000);
```

**Trả về:** `{ filePath: string, sizeKB: number }`

---

### ⚡ Trigger snapshot — `triggerSnapshot(options)`

Chụp snapshot + **tự động broadcast** kết quả tới tất cả client WebSocket.

```js
const result = await camera.triggerSnapshot({
    device_id: 'sensor_cong_chinh',
    event_type: 'motion',
    message: 'Phát hiện chuyển động tại cổng chính'
});

console.log(result);
// {
//   success: true,
//   snapshotFile: 'trigger_sensor_cong_chinh_1777350701415.jpg',
//   snapshotUrl: '/snapshots/trigger_sensor_cong_chinh_1777350701415.jpg',
//   sizeKB: 125.3,
//   triggeredBy: 'sensor_cong_chinh',
//   time: '14:30:00'
// }
```

**Tham số options:**

| Tham số | Mặc định | Mô tả |
|---|---|---|
| `device_id` | `'unknown'` | ID thiết bị gửi trigger |
| `event_type` | `'trigger'` | Loại sự kiện (motion, intrusion, manual...) |
| `message` | `''` | Mô tả chi tiết sự kiện |

---

### 📊 Kiểm tra trạng thái — `getStatus()`

```js
const status = camera.getStatus();
console.log(status);
// {
//   initialized: true,
//   camera: {
//     connected: true,
//     handle: 12345,
//     ip: '192.168.1.208',
//     port: 30001,
//     error: null,
//     rtspUrl: 'rtsp://admin:***@192.168.1.208:555/snl/live/1/1'
//   },
//   websocket: {
//     active: true,
//     connectedClients: 3
//   },
//   snapshot: {
//     directory: 'C:/project/snapshots',
//     totalCaptured: 42,
//     lastCapturedAt: '2026-04-28T04:30:00.000Z'
//   }
// }
```

---

### 📢 Broadcast message — `broadcastMessage(message)`

Gửi message tới tất cả client WebSocket đang kết nối.

```js
// Gửi text
camera.broadcastMessage('Hệ thống đang bảo trì...');

// Gửi JSON
camera.broadcastMessage(JSON.stringify({
    type: 'custom_event',
    data: { temperature: 38.5, sensorId: 'temp_01' }
}));
```

---

### 🏷️ Tra cứu tên sự kiện — `getAlarmName(mainType, subType)`

```js
const name = camera.getAlarmName(6, 24);
// → 'Xâm nhập vùng cấm (Perimeter intrusion)'

const name2 = camera.getAlarmName(1, 2);
// → 'Phát hiện chuyển động (Motion detection)'
```

---

## Ví Dụ Tích Hợp Đầy Đủ

### Ví dụ 1: Server đơn giản chỉ cần chụp snapshot

```js
const express = require('express');
const http = require('http');
const path = require('path');
const camera = require('./cameraModule');

// 1. Khởi tạo (chỉ cần RTSP URL + thư mục snapshot)
camera.init({
    rtspUrl: 'rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1',
    snapshotDir: path.join(__dirname, 'snapshots')
});

// 2. Tạo Express app
const app = express();
app.use(express.json());

// 3. Đăng ký camera routes
camera.registerRoutes(app);

// 4. Khởi chạy
const server = http.createServer(app);
camera.setupWebSocket(server);

server.listen(3000, () => console.log('Server chạy tại http://localhost:3000'));
```

### Ví dụ 2: Tích hợp vào hệ thống IoT có sẵn

```js
const express = require('express');
const http = require('http');
const path = require('path');
const camera = require('./cameraModule');

camera.init({
    rtspUrl: 'rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1',
    snapshotDir: path.join(__dirname, 'snapshots')
});

const app = express();
app.use(express.json());

// Routes riêng của hệ thống IoT
app.get('/', (req, res) => res.json({ system: 'IoT Gateway' }));

// Camera routes với prefix /camera
camera.registerRoutes(app, '/camera');

// Route IoT: khi sensor báo → trigger camera chụp ảnh
app.post('/iot/sensor', async (req, res) => {
    const { sensorId, type, value } = req.body;

    // Logic xử lý sensor
    console.log(`Sensor ${sensorId}: ${type} = ${value}`);

    // Nếu vượt ngưỡng → trigger camera
    if (type === 'motion' && value > 80) {
        try {
            const result = await camera.triggerSnapshot({
                device_id: sensorId,
                event_type: type,
                message: `Sensor ${sensorId} phát hiện ${type} (${value}%)`
            });
            res.json({ sensor: 'processed', snapshot: result });
        } catch (err) {
            res.json({ sensor: 'processed', snapshot: null, error: err.message });
        }
    } else {
        res.json({ sensor: 'processed', noTrigger: true });
    }
});

const server = http.createServer(app);
camera.setupWebSocket(server);
server.listen(4000, () => console.log('IoT Gateway: http://localhost:4000'));
```

### Ví dụ 3: Chụp snapshot định kỳ (cron)

```js
const path = require('path');
const camera = require('./cameraModule');

camera.init({
    rtspUrl: 'rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1',
    snapshotDir: path.join(__dirname, 'snapshots')
});

// Chụp mỗi 30 giây
setInterval(async () => {
    try {
        const { filePath, sizeKB } = await camera.captureSnapshot();
        console.log(`[CRON] Đã chụp: ${filePath} (${sizeKB} KB)`);
    } catch (err) {
        console.error(`[CRON] Lỗi:`, err.message);
    }
}, 30000);
```

---

## API Reference Tóm Tắt

| Hàm | Mô tả | Async |
|---|---|---|
| `init(config)` | Khởi tạo module với cấu hình | ❌ |
| `captureSnapshot(rtspUrl?, outputPath?, timeoutMs?)` | Chụp 1 frame JPEG qua RTSP | ✅ |
| `triggerSnapshot({ device_id, event_type, message })` | Chụp + broadcast qua WebSocket | ✅ |
| `getStatus()` | Lấy trạng thái camera/WS/snapshot | ❌ |
| `broadcastMessage(message)` | Gửi message tới tất cả WS clients | ❌ |
| `setupWebSocket(server)` | Gắn WebSocket server vào HTTP server | ❌ |
| `connectCamera()` | Kết nối camera qua SDK C# (edge-js) | ✅ |
| `registerRoutes(app, prefix?)` | Đăng ký API routes vào Express app | ❌ |
| `getAlarmName(mainType, subType)` | Tra cứu tên sự kiện Sunell | ❌ |
| `ALARM_NAMES` | Object chứa bảng mã sự kiện | — |

---

## Xử Lý Lỗi Thường Gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `RTSP URL chưa được cấu hình` | Chưa gọi `init()` hoặc thiếu `rtspUrl` | Gọi `camera.init({ rtspUrl: '...' })` |
| `Không tìm thấy @ffmpeg-installer/ffmpeg` | Thiếu dependency FFmpeg | `npm install @ffmpeg-installer/ffmpeg` |
| `File snapshot rỗng hoặc không tồn tại` | RTSP URL sai hoặc camera offline | Kiểm tra URL bằng VLC: Media → Open Network Stream |
| `edge-js không khả dụng` | Thiếu edge-js (chỉ cần cho SDK) | `npm install edge-js` hoặc bỏ qua nếu chỉ dùng RTSP |
| `Không tìm thấy SunellWrapper.cs` | Sai đường dẫn `sdkPath` | Kiểm tra file `.cs` có đúng trong `sdkPath` |

### Cách kiểm tra RTSP URL

Mở **VLC Media Player** → **Media** → **Open Network Stream** → nhập URL RTSP → nếu hiện hình tức URL đúng.

Các định dạng URL RTSP phổ biến của Sunell:
```
rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1
rtsp://admin:admin1234@192.168.1.208:555/live/main
rtsp://admin:admin1234@192.168.1.208:554/cam/realmonitor?channel=1&subtype=0
```
