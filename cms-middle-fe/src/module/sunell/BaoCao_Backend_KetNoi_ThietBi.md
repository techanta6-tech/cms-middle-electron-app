# Báo Cáo Kỹ Thuật Backend — Kết Nối Thiết Bị Camera Sunell

> **Ngày:** 25/04/2026  
> **Dự án:** CMS — Hệ thống giám sát camera Sunell IP  
> **Thư mục:** `d:\CMS\hieutt\SDK\backend\`

---

## 1. Tổng Quan Kiến Trúc

Hệ thống sử dụng **Node.js** làm backend trung gian, kết nối camera Sunell IP thông qua **SDK C# gốc** của nhà sản xuất, rồi đẩy dữ liệu realtime tới giao diện web qua **WebSocket**.

```
┌──────────────┐     SDK C# (DLL)      ┌──────────────────┐    WebSocket     ┌──────────────┐
│  Camera IP   │ ◄──────────────────►   │  Backend Node.js │ ◄─────────────►  │  Frontend    │
│ 192.168.1.208│   Control Port 30001   │  (server.js)     │   ws://          │  (index.html)│
│              │                        │  Port: 3000      │   localhost:3000 │              │
│  RTSP :555   │ ◄── FFmpeg ──────────► │                  │                  │              │
└──────────────┘    Chụp snapshot       └──────────────────┘                  └──────────────┘
```

### Các thành phần chính

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Camera | Sunell IP (192.168.1.208) | Thiết bị phần cứng |
| SDK C# | `Sdk_C_Sharp_Lib.dll` + `SunellWrapper.cs` | Giao tiếp native với camera |
| Bridge | `edge-js` | Cầu nối giữa Node.js ↔ C# |
| Backend | Express + WebSocket (`ws`) | Server HTTP + WS |
| Snapshot | FFmpeg qua RTSP | Chụp ảnh khi có sự kiện |
| Frontend | HTML + JavaScript | Giao diện hiển thị |

---

## 2. Kết Nối Với Thiết Bị

### 2.1. Thông tin kết nối

| Thông số | Giá trị |
|---|---|
| IP thiết bị | `192.168.1.208` |
| Control Port (SDK) | `30001` |
| HTTP Port | `80` |
| RTSP Port | `555` |
| Username | `admin` |
| Password | `admin1234` |

> [!IMPORTANT]
> Control Port `30001` là cổng giao tiếp SDK riêng của Sunell — khác hoàn toàn với HTTP port 80. Trình duyệt không thể kết nối trực tiếp tới cổng này, vì vậy cần sử dụng Backend Node.js làm trung gian.

### 2.2. Quy trình kết nối (chi tiết từng bước)

#### Bước 1 — Nạp DLL

Backend sử dụng `edge-js` để chạy code C# (`SunellWrapper.cs`) bên trong Node.js. Khi khởi động, C# sẽ nạp **4 file DLL** theo đúng thứ tự phụ thuộc:

```
1. libcrypto-3-x64.dll   → Thư viện mã hóa (OpenSSL)
2. libssl-3-x64.dll      → Thư viện SSL
3. sdk.dll               → SDK core của Sunell
4. Sdk_C_Sharp_Lib.dll   → Wrapper C# cho SDK
```

Sử dụng `kernel32.dll` → `SetDllDirectory()` và `LoadLibrary()` để nạp thủ công.

#### Bước 2 — Khởi tạo SDK

```csharp
Int32 initResult = sdk_dev_init("");  // Trả về 0 = thành công
```

#### Bước 3 — Đăng nhập thiết bị

```csharp
UInt32 handle = sdk_dev_conn(
    "192.168.1.208",    // IP
    30001,              // Control Port
    "admin",            // Username
    "admin1234",        // Password
    disconn_cb,         // Callback khi mất kết nối
    IntPtr.Zero
);
// handle > 0 → kết nối thành công (ví dụ: handle = 1000)
// handle = 0 → thất bại
```

#### Bước 4 — Bắt đầu lắng nghe alarm

```csharp
sdk_dev_start_alarm(handle, alarm_cb, IntPtr.Zero);
// Từ đây, mỗi khi camera phát hiện sự kiện → gọi alarm_cb()
```

#### Sơ đồ tuần tự

```mermaid
sequenceDiagram
    participant Node as Node.js (server.js)
    participant CS as C# (SunellWrapper.cs)
    participant DLL as Sdk_C_Sharp_Lib.dll
    participant Cam as Camera 192.168.1.208

    Node->>CS: edge.func(SunellWrapper.cs)
    CS->>DLL: LoadLibrary(4 DLLs)
    DLL-->>CS: OK
    CS->>DLL: sdk_dev_init("")
    DLL-->>CS: 0 (success)
    CS->>DLL: sdk_dev_conn(ip, port, user, pass)
    DLL->>Cam: TCP connect :30001
    Cam-->>DLL: Authenticated
    DLL-->>CS: handle = 1000
    CS->>DLL: sdk_dev_start_alarm(handle)
    Note over DLL,Cam: Alarm listener đang hoạt động
    
    loop Khi có sự kiện
        Cam->>DLL: Alarm data (JSON)
        DLL->>CS: alarm_cb(handle, p_data)
        CS->>Node: globalNodeCallback(payload)
        Node->>Node: Parse + Broadcast WebSocket
    end
```

---

## 3. Thông Tin Được Lấy Về

### 3.1. Dữ liệu Alarm từ Camera

Mỗi khi camera phát hiện sự kiện (chuyển động, nhận diện AI...), SDK gọi callback và trả về **JSON** có cấu trúc:

```json
{
  "data": {
    "dev_ip": "192.168.1.208",
    "src_type": 8,
    "src_id": 1,
    "dev_id": "1BC712",
    "main_type": 6,
    "sub_type": 21,
    "alarm_flag": 1,
    "time": "2024-02-08 00:35:20",
    "alarm_pic_len": 0,
    "alarm_pic": "",
    "upleft_x": 0,
    "upleft_y": 0,
    "lowright_x": 0,
    "lowright_y": 0
  },
  "SNPointList": [],
  "AlarmAreaList": []
}
```

#### Giải thích các trường quan trọng

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `dev_ip` | string | IP thiết bị gửi alarm |
| `dev_id` | string | Mã định danh thiết bị |
| `main_type` | int | Nhóm sự kiện chính (xem bảng 3.2) |
| `sub_type` | int | Loại sự kiện cụ thể (xem bảng 3.2) |
| `alarm_flag` | int | `1` = alarm **bắt đầu**, `2` = alarm **kết thúc** |
| `time` | string | Thời điểm sự kiện trên thiết bị |
| `alarm_pic_len` | int | Độ dài ảnh đính kèm (byte). Hiện tại = 0 |
| `alarm_pic` | string | Dữ liệu ảnh base64 (nếu camera cấu hình). Hiện tại rỗng |
| `src_type` | int | Loại nguồn phát hiện |
| `src_id` | int | ID kênh/nguồn |

### 3.2. Bảng mã sự kiện (main_type / sub_type)

#### main_type 1 — Alarm cơ bản

| sub_type | Tên sự kiện |
|---|---|
| 1 | Mất tín hiệu video |
| 2 | Phát hiện chuyển động |
| 3 | Che khuất camera |
| 4 | Mất kết nối mạng |
| 5 | Xung đột IP |
| 6 | Báo động I/O |
| 7 | Đĩa cứng đầy |
| 8 | Lỗi đĩa cứng |

#### main_type 2 — IVS (Phân tích hành vi)

| sub_type | Tên sự kiện |
|---|---|
| 1 | Vượt hàng rào ảo |
| 2 | Xâm nhập vùng cấm |
| 3 | Đi vào vùng |
| 4 | Rời khỏi vùng |
| 5 | Đi sai hướng |
| 6 | Lảng vảng |
| 7 | Đỗ xe trái phép |
| 8 | Vật thể bị bỏ lại |
| 9 | Vật thể bị lấy đi |

#### main_type 3–5 — Nhận diện / Nhiệt

| Mã | Tên sự kiện |
|---|---|
| 3/1 | Nhận diện khuôn mặt |
| 3/2 | So khớp khuôn mặt |
| 4/1 | Nhận diện biển số xe |
| 5/1 | Nhiệt độ bất thường |
| 5/2 | Cảnh báo nhiệt cao |
| 5/3 | Cảnh báo nhiệt thấp |

#### main_type 6 — AI / Intelligent Analytics (IVS)

| sub_type | Tên sự kiện |
|---|---|
| 1 | Phát hiện âm thanh |
| 2 | Vượt đường kẻ (AI) |
| 3 | Xâm nhập vùng (AI) |
| 4 | Phát hiện khuôn mặt (AI) |
| 5 | Nhận diện khuôn mặt (AI) |
| 6 | Nhận diện biển số (AI) |
| 7 | Đếm người (AI) |
| 8 | Bản đồ nhiệt (AI) |
| 9 | Phát hiện che khuất (AI) |
| 10 | Phát hiện thay đổi cảnh (AI) |
| 11 | Phát hiện lửa (AI) |
| 12 | Phát hiện khói (AI) |
| 13 | Phát hiện chạy (AI) |
| 14 | Phát hiện ngã (AI) |
| 15 | Phát hiện đánh nhau (AI) |
| 16 | Phát hiện tụ tập đông (AI) |
| 17 | Theo dõi mục tiêu (AI) |
| 18 | Phân loại phương tiện (AI) |
| 19 | Đếm phương tiện (AI) |
| **20** | **Phát hiện người (SMD)** |
| **21** | **Phát hiện phương tiện (SMD)** |
| 22 | Phát hiện chuyển động thông minh (SMD) |
| 23 | Phát hiện người & phương tiện (SMD) |
| 24 | Sự kiện AI nhận diện |
| 25 | Phân tích hành vi AI |
| 26 | Nhận diện đặc điểm người (AI) |
| 27 | Phát hiện đồ vật bỏ rơi (AI) |
| 28 | Phát hiện đồ vật bị lấy (AI) |
| 29 | Phát hiện xếp hàng (AI) |
| 30 | Phát hiện mũ bảo hiểm (AI) |

> [!NOTE]
> **SMD** = Smart Motion Detection — tính năng AI phân loại đối tượng chuyển động (người/phương tiện) thay vì phát hiện chuyển động chung chung.

#### main_type 7–8 — Đám đông / Đối tượng

| Mã | Tên sự kiện |
|---|---|
| 7/1 | Phát hiện đám đông |
| 8/1 | Phát hiện người |
| 8/2 | Phát hiện phương tiện |
| 8/3 | Phát hiện vật nuôi |

---

## 4. Chụp Snapshot (Ảnh Tại Thời Điểm Sự Kiện)

### 4.1. Vấn đề với SDK

SDK Sunell chỉ cho phép **1 session media** tại 1 thời điểm. Khi `sdk_dev_start_alarm` đang chạy (chiếm kênh), các hàm chụp ảnh của SDK đều thất bại:

| Hàm SDK | Kết quả | Nguyên nhân |
|---|---|---|
| `sdk_open_snap(handle, channel, path)` | Error = 4 | Kênh bị chiếm bởi alarm |
| `sdk_md_capture(md_handle, path)` | Error = -1 | Không có live stream |
| `sdk_md_live_start(...)` | 0xFFFFFFFF + disconnect | Xung đột với alarm listener |

### 4.2. Giải pháp: RTSP + FFmpeg

Sử dụng **giao thức RTSP** (hoàn toàn độc lập với SDK) để chụp snapshot bằng **FFmpeg**:

```
RTSP URL: rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1
```

#### Cách hoạt động

```mermaid
flowchart LR
    A["Camera phát hiện\nsự kiện"] -->|alarm_cb| B["C# SDK"]
    B -->|globalNodeCallback| C["Node.js\nonCameraEvent"]
    C -->|"alarm_flag = 1\nBẮT ĐẦU"| D["Gọi FFmpeg"]
    D -->|"ffmpeg -i rtsp://\n-frames:v 1"| E["Camera\nRTSP :555"]
    E -->|"1 frame JPEG"| F["snapshots/\nsnap_xxx.jpg"]
    F -->|"Base64 encode"| G["WebSocket\nBroadcast"]
    C -->|"alarm_flag = 2\nKẾT THÚC"| H["Gửi text\nkhông snapshot"]
```

#### Lệnh FFmpeg thực thi

```bash
ffmpeg -y -rtsp_transport tcp -i "rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1" -frames:v 1 -q:v 2 output.jpg
```

| Tham số | Ý nghĩa |
|---|---|
| `-y` | Ghi đè file nếu tồn tại |
| `-rtsp_transport tcp` | Dùng TCP thay vì UDP cho ổn định |
| `-i rtsp://...` | URL stream RTSP của camera |
| `-frames:v 1` | Chỉ lấy 1 frame duy nhất |
| `-q:v 2` | Chất lượng JPEG (2 = cao nhất) |
| Timeout | 8 giây |

#### Kết quả snapshot

- **Kích thước:** ~350–400 KB / ảnh
- **Thời gian chụp:** ~2–3 giây
- **Lưu trữ:** `d:\CMS\hieutt\SDK\snapshots\snap_{timestamp}.jpg`
- **Phục vụ HTTP:** `http://localhost:3000/snapshots/snap_xxx.jpg`

---

## 5. Dữ Liệu Gửi Tới Frontend

Backend đẩy dữ liệu tới frontend qua **WebSocket** (`ws://localhost:3000`) dưới dạng JSON:

### 5.1. Khi có alarm kèm snapshot (flag = start)

```json
{
  "type": "alarm",
  "ip": "192.168.1.208",
  "eventName": "Phát hiện phương tiện (SMD)",
  "flag": "start",
  "time": "2024-02-08 00:35:20",
  "snapshot": "data:image/jpeg;base64,/9j/4AAQ...",
  "snapshotFile": "snap_1777103128969.jpg"
}
```

### 5.2. Khi alarm kết thúc (flag = end, không có ảnh)

```json
{
  "type": "alarm",
  "ip": "192.168.1.208",
  "eventName": "Phát hiện phương tiện (SMD)",
  "flag": "end",
  "time": "2024-02-08 00:35:32",
  "snapshot": null,
  "snapshotFile": null
}
```

### 5.3. Giải thích các trường

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `type` | string | Luôn là `"alarm"` |
| `ip` | string | IP camera gửi sự kiện |
| `eventName` | string | Tên sự kiện bằng tiếng Việt (tra theo bảng mã) |
| `flag` | string | `"start"` = bắt đầu, `"end"` = kết thúc |
| `time` | string | Thời điểm trên camera |
| `snapshot` | string/null | Ảnh base64 data URI (chỉ khi flag = start) |
| `snapshotFile` | string/null | Tên file ảnh đã lưu trên server |

---

## 6. Hệ Thống Log

### 6.1. File log

| File | Đường dẫn | Nội dung |
|---|---|---|
| Input | `backend/input.txt` | Dữ liệu **nhận vào**: alarm từ camera, tin nhắn từ frontend, kết nối/ngắt |
| Output | `backend/output.txt` | Dữ liệu **gửi đi**: broadcast tới frontend |

> [!NOTE]
> File log được **tạo mới** mỗi lần restart server.

### 6.2. Format log

```
[14:57:41] ⬇️  IN | SDK C# → Node.js ALARM | {"handle":1000, ...}
[14:57:41] ⬇️  IN | Parsed alarm | {"name":"Phát hiện phương tiện (SMD)", ...}
[14:57:43] ⬇️  IN | RTSP Snapshot OK | 360.5 KB
[14:57:43] ⬆️ OUT | Broadcast tới 2 client(s) | {"type":"alarm", ...}
```

---

## 7. API Endpoint

| Method | URL | Mô tả |
|---|---|---|
| GET | `http://localhost:3000/api/snapshot` | Chụp ảnh snapshot thủ công qua RTSP (trả về JPEG) |
| GET | `http://localhost:3000/snapshots/{filename}` | Xem ảnh snapshot đã lưu |
| WS | `ws://localhost:3000` | WebSocket nhận alarm realtime |

---

## 8. Cấu Trúc File

```
d:\CMS\hieutt\SDK\
├── backend/
│   ├── server.js              ← Backend chính (Express + WebSocket + edge-js)
│   ├── input.txt              ← Log dữ liệu nhận vào
│   ├── output.txt             ← Log dữ liệu gửi đi
│   ├── scan_ports.js          ← Công cụ quét port (đã dùng để tìm port 30001)
│   ├── test_edge.js           ← Test edge-js load DLL
│   └── package.json           ← Dependencies
├── snapshots/                 ← Thư mục lưu ảnh snapshot
│   ├── snap_1777103128969.jpg
│   └── ...
├── SunellWrapper.cs           ← C# wrapper giao tiếp SDK
├── Sdk_C_Sharp_Lib.dll        ← SDK chính (native)
├── sdk.dll                    ← SDK core
├── libcrypto-3-x64.dll        ← OpenSSL crypto
└── libssl-3-x64.dll           ← OpenSSL SSL
```

---

## 9. Dependencies (npm)

| Package | Vai trò |
|---|---|
| `express` | HTTP server |
| `ws` | WebSocket server |
| `cors` | Cross-Origin Resource Sharing |
| `edge-js` | Bridge Node.js ↔ C# (.NET) |
| `fluent-ffmpeg` | FFmpeg wrapper |
| `@ffmpeg-installer/ffmpeg` | FFmpeg binary tự kèm theo, không cần cài hệ thống |

---

## 10. Cách Chạy

```bash
cd d:\CMS\hieutt\SDK\backend
node server.js
```

Kết quả mong đợi:

```
[DLL] Load libcrypto-3-x64.dll -> OK
[DLL] Load libssl-3-x64.dll -> OK
[DLL] Load sdk.dll -> OK
[DLL] Load Sdk_C_Sharp_Lib.dll -> OK
[SDK] sdk_dev_init result = 0
[SDK] Connecting to 192.168.1.208:30001 user=admin
[SDK] sdk_dev_conn handle = 1000
Backend NodeJS chạy tại: http://localhost:3000
WebSocket đang mở cửa: ws://localhost:3000
Test RTSP snapshot: http://localhost:3000/api/snapshot
```

Sau đó mở `d:\CMS\hieutt\index.html` trên trình duyệt — trang web tự động kết nối WebSocket tới `ws://localhost:3000` và hiển thị alarm + snapshot realtime.
