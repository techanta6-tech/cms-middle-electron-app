# Bảng Mã Sự Kiện Nhận Diễn Camera SUNELL

*(Trích xuất từ Tài liệu Phụ lục SDK Chính Hãng: `sdk_english_20230428.docx`)*

---

## 1. PHÂN LOẠI CHÍNH (`main_type`)
| ID | Tên Sự Kiện |
| :---: | :--- |
| **1** | Báo động an ninh cơ bản (Safety alarm) |
| **4** | Báo động ổ cứng (Disk alarm) |
| **5** | Báo động luồng Video (Video alarm) |
| **6** | Báo động phân tích thông minh - AI / IVS (Intelligent analysis alarm) |

---

## 2. PHÂN LOẠI CHI TIẾT (`sub_type`)

### 🛑 Nhóm an ninh cơ bản (`main_type` = 1)
| ID | Tên Sự Kiện | Ý Nghĩa (Tiếng Việt) |
| :---: | :--- | :--- |
| **1** | I/O alarm | Báo động từ cổng vật lý I/O |
| **2** | Motion detection alarm | Phát hiện chuyển động |
| **3** | Camera blocking alarm | Camera bị che khuất |
| **4** | Video loss alarm | Mất tín hiệu hình ảnh |
| **5** | Network disconnection alarm | Rớt kết nối mạng / Lỗi IP |
| **9** | PIR analysis police | Phát hiện thân nhiệt PIR |
| **10**| NVR channel I/O alarm | Báo động cổng I/O trên đầu ghi NVR |

---

### 🧠 Nhóm AI & Phân tích thông minh (`main_type` = 6)
*(Thường gặp nhất trong các luồng nhận diện bằng thuật toán)*

| ID | Tên Nguyên Bản | Ý Nghĩa Chức Năng (Ứng dụng cho Web) |
| :---: | :--- | :--- |
| **21** | Trip wire detection | **Vượt hàng rào ảo** |
| **22** | Mobile detection | **Phát hiện đối tượng di chuyển di động** (SMD) |
| **23** | Occlusion detection | Phân tích che khuất thông minh |
| **24** | Perimeter intrusion | **Xâm nhập vùng cấm** |
| **25** | Double trip wire | Vượt hàng rào ảo kép |
| **26** | Wandering | Lảng vảng (Loitering) |
| **27** | Multi-person wandering | Đám đông lảng vảng |
| **28** | Items left behind | Bỏ quên đồ vật |
| **29** | Goods removal | Mất cắp đồ vật |
| **30** | Abnormal speed | Phương tiện đi quá tốc độ |
| **31** | Retrograde | Đi ngược chiều |
| **32** | Illegal parking | Đậu xe trái phép |
| **33** | Camera shift | Phát hiện góc quay camera bị dời (phá hoại) |
| **34** | Video signal abnormal | Tín hiệu Video AI có vấn đề |
| **37** | License plate recognition | **Nhận diện biển số (LPR/ANPR)** |

---

### 💾 Nhóm Báo động Ổ cứng (`main_type` = 4)
| ID | Tên Sự Kiện | Ý Nghĩa (Tiếng Việt) |
| :---: | :--- | :--- |
| **1** | Disk status OK | Trạng thái ổ cứng bình thường |
| **2** | Disk read write exception| Lỗi đọc/ghi ổ cứng |
| **3** | Network disk connection failed| Lỗi kết nối ổ cứng mạng (NAS) |
| **4** | Disk full | Ổ cứng đầy |
| **5** | Disk does not exist | Không nhận diện được ổ cứng |
| **6** | Space reaches the specified threshold | Dung lượng đạt mức cảnh báo |
| **7** | Disk is not formatted | Ổ cứng chưa được Format |
| **8** | Insufficient storage space | Thiếu phân vùng lưu trữ |
| *(9-11)* | Data version mis-match | Phiên bản dữ liệu không tương thích / lỗi truy cập đĩa |

---

### 🎥 Nhóm Báo động Luồng Video (`main_type` = 5)
| ID | Tên Nguyên Bản | Ý Nghĩa |
| :---: | :--- | :--- |
| **1** | Connection successful | Kết nối luồng dữ liệu (Data source) thành công |
| **2** | Username/password error | Sai tài khoản/mật khẩu khi kết nối |
| **3** | Does not have permission | Tài khoản không có quyền truy cập luồng |
| **4** | Reached maximum connections | Đạt giới hạn số lượng thiết bị kết nối tối đa |
