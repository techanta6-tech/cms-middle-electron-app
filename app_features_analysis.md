# Phân Tích Chức Năng và Tính Năng (Features & Functionalities) của CMS Middle App

CMS Middle App là một ứng dụng phần mềm trung gian (middleware) được đóng gói dưới dạng Desktop App bằng Electron. Ứng dụng đóng vai trò làm cầu nối (bridge) và trung tâm giám sát (monitoring hub) giữa các hệ thống quản lý video (SVMS), thiết bị IoT (MQTT), các thiết bị camera (Sunell) và hệ thống CMS Backend chính.

Dưới đây là phân tích chi tiết về các chức năng và tính năng cốt lõi của ứng dụng:

## 1. Tính Năng Giám Sát và Cảnh Báo (Monitoring & Alerting)
Giao diện người dùng (Frontend) được thiết kế tập trung vào việc giám sát thời gian thực.
- **Alert Wall (Tường Cảnh Báo):**
  - **Nhận Log Real-time:** Tự động cập nhật và hiển thị ngay lập tức các bản ghi log, báo động (alarms) từ mọi nguồn kết nối (SVMS, MQTT, Camera).
  - **Lọc Dữ Liệu Nâng Cao (LogFilter):** Cho phép người dùng lọc log theo Server, Device, hoặc Event Type một cách linh hoạt.
  - **Xem Chi Tiết Sự Kiện (Log Popup):** Cung cấp cửa sổ pop-up hiển thị thông tin chi tiết của cảnh báo kèm theo ảnh chụp tĩnh (Snapshot) ngay tại thời điểm xảy ra sự kiện.
  - **Layout Camera Động (Grid Drag & Drop):** Hỗ trợ kéo thả (Drag & Drop) thiết bị camera vào các ô lưới (Grid) để thiết lập màn hình giám sát trực quan, hoặc tính năng tự động sắp xếp (Auto Config).

## 2. Quản Lý Kết Nối Đa Kênh (Connections Management)
Ứng dụng có khả năng quản lý đồng thời nhiều loại kết nối thông qua giao diện **Connections Monitor**.
- **Quản lý SVMS Servers:** Theo dõi trạng thái, địa chỉ IP, và tính khả dụng của các máy chủ quản lý video truyền thống.
- **Quản lý MQTT Brokers:** 
  - Khả năng thêm, sửa, xoá và kết nối tới các hệ thống MQTT Broker (ví dụ: nhận dữ liệu từ các cảm biến Radar như Milesight VS373).
  - Liên kết các thiết bị Camera vào một MQTT Broker cụ thể để phục vụ cho kịch bản báo động kết hợp (VD: Radar phát hiện ngã -> kích hoạt Camera chụp ảnh).
- **Quản lý Peer-to-Peer (Middle Servers):** 
  - Cho phép cấu hình các "Send Servers" (đẩy dữ liệu đi) và "Receive Servers" (nhận dữ liệu từ máy khác). Điều này tạo ra một mạng lưới các Middle App có thể đồng bộ chéo dữ liệu cho nhau.

## 3. Tích Hợp Camera & Xử Lý Hình Ảnh
Đây là một tính năng mạnh mẽ được xây dựng thành module độc lập (`cameraModule.js`).
- **Giao Tiếp Bằng C# SDK (Edge-js):** Tích hợp sâu vào SDK của các dòng Camera (Sunell) qua thư viện `.dll`. Ứng dụng có khả năng lắng nghe trực tiếp các sự kiện AI từ camera như: Phát hiện khuôn mặt (Face Detect), Nhận diện biển số (LPR), Vượt hàng rào ảo (Trip wire)...
- **Chụp Ảnh RTSP (FFmpeg):** Tự động gọi `ffmpeg` để trích xuất 1 frame ảnh tĩnh (JPEG) qua luồng RTSP mỗi khi có sự kiện quan trọng.
- **Gắn Ảnh (Snapshot) vào Log:** Chuyển đổi ảnh thành chuỗi Base64 và đính kèm trực tiếp vào gói tin Log để gửi lên giao diện cho người quản trị xem ngay lập tức.

## 4. Xử Lý và Phân Phối Dữ Liệu (Data Ingestion & Routing)
- **Cổng Thu Thập Dữ Liệu (REST API):** Cung cấp các Endpoints (`/api/v1/logs`, `/api/v1/server`, `/api/v1/devices`) cho phép các hệ thống ngoại vi chủ động POST dữ liệu vào ứng dụng.
- **Chuyển Tiếp Dữ Liệu (Forwarding):** Hệ thống có cơ chế hàng đợi và chuyển tiếp (forward) log/server status lên hệ thống CMS Backend chính. Hỗ trợ cơ chế tự động thử lại (Retry) và làm mới token (Auth) nếu gặp lỗi 401.
- **Lưu Trữ Log Cục Bộ (Local File Logging):** Tính năng tự động lưu lại toàn bộ Payload Request và Response của các API quan trọng vào các file `.txt` trong thư mục `request_logs` giúp truy vết và debug hiệu quả.

## 5. Các Chức Năng Nền Hệ Thống (System Features)
- **Tự Động Nhận Diện Mạng (Auto-IP Detection):** Tự động rà quét các network interfaces để chọn ra IP nội bộ tối ưu nhất, đồng thời tự tìm port trống (Dynamic Port Binding) giúp ứng dụng luôn chạy mượt mà không bị kẹt port.
- **Monitoring Cronjob:** Các tiến trình chạy ngầm liên tục ping (TCP ping) tới các cổng dịch vụ của SVMS để đảm bảo hệ thống luôn nắm được tình trạng "Sống/Chết" (Online/Offline) của các máy chủ.
- **Auto-Update:** Sử dụng `electron-updater` để tự động kiểm tra, tải về và cài đặt các phiên bản cập nhật mới khi được đóng gói (Production).
