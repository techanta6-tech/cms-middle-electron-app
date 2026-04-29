# Báo cáo Luồng Vận Hành (Operational Flow) của CMS Middle App

Dựa trên cấu trúc codebase, ứng dụng `cms-middle-electron-app` là một hệ thống phân tán thu nhỏ hoạt động dưới dạng một ứng dụng Desktop (Electron), kết hợp backend Node.js (Express + Socket.IO) và frontend React (Vite). 

Dưới đây là luồng vận hành chi tiết của hệ thống:

## 1. Khởi động hệ thống (Electron Wrapper)
File cấu hình chính: `main.js`
- **Xác định IP:** Hệ thống tìm kiếm Local IP (ưu tiên Ethernet/Wi-Fi).
- **Khởi chạy Backend (Sidecar):**
  - Trong môi trường **Dev**, chạy `node build-be/node.exe` hoặc để developer tự chạy script.
  - Trong môi trường **Production**, chạy file thực thi Node.js đi kèm (`process.resourcesPath`) với các biến môi trường cấu hình sẵn (`IS_PACKAGED`, `USER_DATA_PATH`, `BE_PORT`).
- **Khởi chạy Frontend:**
  - Tạo cửa sổ Chromium.
  - Load URL `http://localhost:5173` (Dev) hoặc load file `index.html` tĩnh từ thư mục `dist` (Production).

## 2. Backend Server (Express + Socket.IO)
File chính: `cms-middle-be/index.js`, `cms-middle-be/src/app.js`
- **Khởi tạo HTTP Server:** Chạy trên port được cấp phát (mặc định 5050).
- **Socket.IO:** Lắng nghe kết nối từ Frontend (`socketEvents.js`) để đồng bộ dữ liệu theo thời gian thực (Server status, Logs, Devices).
- **In-memory State (`socketState.js`):** Lưu trữ tạm thời trạng thái của tất cả các entities đang hoạt động:
  - `servers`, `devices` (Từ SVMS).
  - `connections` (Các Middle Server ngang hàng).
  - `mqttServers`, `mqttDevices` (Hệ thống MQTT).
- **API Routes:** Xử lý RESTful APIs:
  - Nhận dữ liệu Log, Server, Device từ các hệ thống ngoại vi (SVMS, Camera).
  - Cấu hình kết nối MQTT.
  - Phục vụ file snapshot qua HTTP.
- **Monitoring Cronjob:** Hệ thống chạy ping/kiểm tra kết nối định kỳ tới các SVMS servers (`check-server.service.js`).

## 3. Quản lý MQTT & Camera (Module tích hợp)
- **MQTT Service (`mqtt.service.js`):** 
  - Khởi tạo client kết nối tới các MQTT broker.
  - Khi có thông điệp MQTT (event) tới, trích xuất dữ liệu.
  - Tự động gọi Camera Module để chụp ảnh (nếu camera được liên kết).
  - Bắn sự kiện kèm log và ảnh (dạng base64) qua Socket.IO về Frontend.
- **Camera Module (`cameraModule.js`):**
  - **FFmpeg (RTSP):** Dùng để chụp snapshot (`captureSnapshot`) trả về đường dẫn file hoặc Base64.
  - **Edge-js (C# SDK):** Tích hợp thư viện `.dll` (SunellWrapper.cs) để giao tiếp, nhận sự kiện trực tiếp từ Camera (chuyển động, nhận diện khuôn mặt...).
  - Quản lý trạng thái và cung cấp dữ liệu ảnh tĩnh (snapshot) cho các log báo động.

## 4. Frontend UI (React + Vite)
File chính: `cms-middle-fe/src/App.tsx`, `useSocketManager.ts`
- **Quản lý trạng thái (useSocketManager):** Là trung tâm giao tiếp, kết nối Socket.IO tới Backend. Nó lắng nghe các events như `receive-mqtt-log`, `receive-server-information`, `update-mqtt-devices`, v.v...
- **Dashboard:**
  - **Alert Wall:** Hiển thị danh sách Log/Sự kiện theo thời gian thực, có khả năng lọc (LogFilter) theo Server, Device, hoặc Event Type. Có các ô Grid (Drag & Drop) để gán camera lên màn hình theo dõi.
  - **Connections Monitor:** Quản lý trạng thái các kết nối mạng: Peer Connections, SVMS Servers, MQTT Servers, và danh sách các MQTT Camera Devices đang được cấu hình.
  - **Log Popup:** Bấm vào một sự kiện để xem chi tiết thông tin và ảnh Snapshot.

## 5. Tóm tắt Data Flow (Luồng Dữ Luệu)
1. **Dữ liệu vào (Input):**
   - HTTP POST tới `/api/v1/logs`, `/api/v1/server` từ hệ thống VMS.
   - Hoặc dữ liệu từ thiết bị IoT gửi tới **MQTT Broker** -> `mqtt.service.js` nhận được message qua TCP.
   - Sự kiện từ Camera thông qua C# SDK (Edge-js) -> `cameraModule.js`.
2. **Xử lý (Processing):** 
   - Backend cập nhật dữ liệu vào RAM (`socketState.js`).
   - Yêu cầu `ffmpeg` chụp snapshot (nếu là báo động MQTT/Camera).
   - Ghi log (nếu config `log-saving` bật).
3. **Phát sóng (Broadcast):** Backend dùng `socket.emit` gửi trực tiếp cục dữ liệu xuống Frontend.
4. **Hiển thị (Output):** React cập nhật state, UI hiển thị Log mới nhất trên Dashboard hoặc đẩy ảnh lên Alert Wall.
