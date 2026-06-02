# Quy trình kiểm tra chất lượng kết nối của thiết bị Milesight

Quá trình kiểm tra chất lượng kết nối dựa vào hai yếu tố chính là Packet Loss (Tỷ lệ mất gói tin) đối với các thiết bị cảm biến định kỳ (như Radar) và RSSI (Cường độ tín hiệu) đối với các thiết bị dạng Nút bấm (WS101 Button).

## 1. Cấu hình
Các thông số cấu hình được lấy từ file `signalQualityMilesightConfig.json` ở thư mục gốc của backend:
- `X`: Khoảng thời gian chạy cron kiểm tra (tính bằng giây). Mặc định là `60`.
- `Y`: Số lượng gói tin kỳ vọng nhận được từ cảm biến định kỳ (hoặc số lần cron) dùng làm mốc đánh giá. Mặc định là `5`.
Tổng thời gian đánh giá Packet Loss là `X * Y` giây (Ví dụ mặc định: 60 * 5 = 300 giây = 5 phút).

## 2. Hoạt động trên từng Log (Xử lý theo RSSI)
Mỗi khi có thông tin gửi đến từ Broker MQTT:
- Trích xuất tham số `rssi` và `sf` (Spreading Factor) từ payload (`rxInfo`, `txInfo`).
- Lưu **Thời gian nhận (timestamp)** vào một danh sách (`milesightLossRate`) quản lý theo từng thiết bị (`devEui`). Điều này giúp hệ thống lưu giữ số lượng tín hiệu của thiết bị gửi vào.
- Sau khi lấy được `rssi`, hệ thống gọi hàm đánh giá `evaluateMilesightSignal({ rssis, sf })`. Kết quả tính chất lượng (như `STRONG`, `MEDIUM`, `WEAK`, `ABNORMAL`) được ghi ngay vào trường `signalQuality` của thiết bị trong bộ nhớ.
- *Lưu ý: Nút bấm (WS101) chỉ cập nhật chất lượng qua bước này.*

## 3. Hoạt động của Cron Job (Xử lý theo Packet Loss)
Một tiến trình ngầm (Cron) sẽ chạy đều đặn mỗi `X` giây.
- **Biến đếm `cronRuns`:** Sẽ tăng thêm 1 ở mỗi chu kỳ cron.
- **Bỏ qua Y chu kỳ đầu:** Trong `Y` lần chạy đầu tiên (ví dụ 5 lần), hệ thống sẽ *bỏ qua* việc đánh giá Packet Loss. Điều này để đảm bảo danh sách lưu trữ có đủ thời gian để hứng bản ghi từ thiết bị (có cơ hội nạp đủ dữ liệu trong khoảng thời gian `X * Y`).
- **Dọn dẹp (Cleanup):** Ở mỗi chu kỳ, quét qua danh sách và loại bỏ các mốc thời gian nhận cũ hơn `X * Y` giây nhằm tránh tràn bộ nhớ máy chủ (Memory Leak).
- **Tính toán Packet Loss:**
  - Với mỗi thiết bị Milesight, kiểm tra nếu đây là Nút bấm (Button) thì **BỎ QUA** việc tính Packet Loss (vì thiết bị này chỉ gửi tín hiệu khi có người bấm, không phải gửi định kỳ).
  - Với các thiết bị cảm biến định kỳ khác, lấy độ dài danh sách thời gian (gọi là `Z`). 
  - Nếu `Z > Y`, gán lại `Z = Y` (trường hợp thiết bị gửi dư tín hiệu, giúp LossRate không bị âm).
  - Tính tỷ lệ mất gói: `lossRate = ((Y - Z) / Y) * 100`.
  - Ghi đè tỷ lệ này vào trường `packetLoss` của thiết bị, sau đó gọi lại `evaluateMilesightSignal({ packetLossRate: lossRate })`.
  - Kết quả cập nhật mới đè lên trường `signalQuality` và phát sự kiện `update-mqtt-devices` xuống Frontend để người dùng nhìn thấy.
