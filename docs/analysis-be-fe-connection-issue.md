# Phân Tích Sâu: Nguyên Nhân FE Không Kết Nối Được BE Sau Khi Build

## Tóm tắt: Có 4 vấn đề tiềm ẩn, được xếp theo mức độ nghiêm trọng

---

## 🔴 [VẤN ĐỀ NGHIÊM TRỌNG #1] BE bị crash ngay khi khởi động do `dotenv` load sai path

### Mô tả
Trong `cms-middle-be/index.js`, BE load `.env` bằng đường dẫn tương đối:

```js
require('dotenv').config(); // → tìm .env trong cwd của process
require('dotenv').config({ path: path.join(__dirname, '../.env.generated') }); // → tìm relative từ __dirname
```

### Vấn đề trong môi trường Packaged (pkg)

Khi BE được đóng gói bằng `pkg` thành `node.exe`, giá trị `__dirname` bên trong file đóng gói sẽ là **virtual path bên trong binary** (ví dụ: `C:\snapshot\project\cms-middle-be`), **không phải thư mục thực của exe**.

- `require('dotenv').config()` → Tìm `.env` tại `cwd()` — tức là thư mục chứa `node.exe` (thư mục `bin/`). **File này KHÔNG tồn tại ở đó!**
- `path.join(__dirname, '../.env.generated')` → Trỏ ra ngoài virtual fs, tìm `.env.generated` trong một đường dẫn không tồn tại.

**Hậu quả:** Các biến môi trường quan trọng như `BE_PORT`, `JWT_SECRETKEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` đều về **undefined** hoặc sử dụng giá trị fallback mặc định trong code.

### Điều gì xảy ra tiếp theo?

- `port` trong `config.js` = `process.env.BE_PORT || process.env.THIS_PORT || 5050`
- Vì `BE_PORT` không được đọc từ dotenv (load thất bại), nó phụ thuộc vào **biến môi trường của process**
- **MÁY CHỦ ĐANG CHẠY ĐÚNG!** vì Electron truyền `BE_PORT` qua `spawn env`: `env: { ...process.env, BE_PORT: bePort }`
- Tuy nhiên, `JWT_SECRETKEY` nếu về `'12345'` (fallback) thì vẫn hoạt động được

**→ Vấn đề này KHÔNG khiến BE crash, nhưng cần ghi nhận.**

---

## 🔴 [VẤN ĐỀ NGHIÊM TRỌNG #2] `socket.ts` - `beURL` bị baked-in tại module load time

### Code hiện tại:
```ts
export const getBeUrl = () => `http://${getBeHost()}:${getBePort()}`;
const beURL = getBeUrl(); // ← Gọi 1 lần khi module được import lần đầu

export const socket = io(beURL, { ... }); // ← URL bị fix cứng ngay khi load
```

### Vấn đề

Module `socket.ts` được import và khởi tạo khi React app **bắt đầu render** (lúc `main.tsx` import `App.tsx` import các component).

Tại thời điểm đó:
1. `window.electronAPI` **đã có** (vì preload chạy trước renderer).
2. `window.electronAPI.getBePort()` được gọi → trả về `resolvedBePort` từ main process.

**Tuy nhiên có Race Condition tinh vi:**

Trong `main.js`:
```js
let resolvedBePort = null; // ← Ban đầu là null

app.whenReady().then(async () => {
  ipcMain.on('get-be-port', (event) => {
    event.returnValue = resolvedBePort; // ← Trả về null nếu BE chưa xong!
  });

  if (!isDev) {
    resolvedBePort = await findFreePort(5050); // ← Gán giá trị
    startBackend(resolvedBePort);
    await waitForBackend(resolvedBePort); // ← Đợi BE sẵn sàng
  }

  createWindow(); // ← Mở window SAU KHI BE đã sẵn sàng ✅
```

**Tốt!** `createWindow()` được gọi SAU `waitForBackend()`, nghĩa là khi window mở, BE đã sẵn sàng và `resolvedBePort` đã có giá trị.

**Nhưng có 1 edge case:** Nếu `waitForBackend` bị timeout (15s) và reject, code vẫn tiếp tục sang `createWindow()` vì lỗi chỉ được `console.error`, không dừng luồng.

```js
try {
  await waitForBackend(resolvedBePort);
} catch (err) {
  console.error(`[Electron] ${err.message}`);
  // ← Không `return`, code tiếp tục!
}
createWindow(); // ← Window mở dù BE chưa sẵn sàng!
```

**→ Nếu BE mất hơn 15 giây để start (hoặc bị crash), window vẫn mở nhưng FE không kết nối được BE.**

---

## 🟡 [VẤN ĐỀ QUAN TRỌNG #3] BE có thể crash do `edge-js` / `cameraModule`

### Trong `cameras.service.js`:
```js
try {
  if (process.pkg) {
    const mod = require(path.join(path.dirname(process.execPath), 'cameraModule.js'));
    // ↑ Đây là path ngoài binary, cần file thực sự tồn tại trong build-be/
    ...
  }
} catch (err) {
  console.warn('[Cameras-Service] ❌ cameraModule load failed:', err.message);
  CameraDevice = class DummyCamera { ... }; // ← Fallback gracefully, không crash
}
```

Phần này được xử lý tốt — có `try/catch` và fallback về DummyCamera.

**Tuy nhiên**, `cameraModule.js` có thể import `edge-js` và `edge-cs` — đây là các native addon **cực kỳ khó đóng gói**. Nếu `edge-js` thiếu file native hoặc DLL, cả process BE sẽ **crash ngay lập tức** (process.exit với SIGSEGV), không phải JavaScript error, nên `uncaughtException` handler cũng không bắt được.

**Dấu hiệu:** Nếu BE crash, `waitForBackend` sẽ timeout và FE sẽ không kết nối được.

---

## 🟡 [VẤN ĐỀ QUAN TRỌNG #4] `grid-layout` và `device-camera-link` routes thiếu `authMiddleware`

```js
// grid-layout.routes.js — KHÔNG có authMiddleware
router.get('/api/v1/grid-layout', ...)
router.put('/api/v1/grid-layout', ...)

// device-camera-link.routes.js — KHÔNG có authMiddleware  
router.get('/api/v1/device-camera-links', ...)
router.patch('/api/v1/mqtt-device-camera-link', ...)
```

Trong khi đó, FE (`apiClient.ts`) luôn gửi kèm `Authorization: Bearer <token>` header trong mọi request. Điều này không gây lỗi kết nối, nhưng những route không có auth middleware sẽ không được bảo vệ.

---

## Kết luận: Nguyên nhân chính NHẤT có thể là gì?

| # | Vấn đề | Khả năng gây lỗi |
|---|--------|-----------------|
| 1 | BE crash do `edge-js`/native addon | **Rất cao** nếu build không đúng |
| 2 | `waitForBackend` timeout, window mở dù BE chưa ready | **Cao** nếu BE start chậm |
| 3 | `dotenv` load sai path trong pkg | Thấp (BE_PORT vẫn được truyền qua env) |
| 4 | Routes thiếu auth middleware | Không gây lỗi kết nối |

---

## Hướng kiểm tra ngay lập tức

1. **Kiểm tra file log BE** (sau lần build + chạy tiếp theo):
   ```
   %APPDATA%\cms-electron-app\backend.log
   ```
   Tìm xem BE có log dòng `🚀 MIDDLE SERVER RUNNING` không. Nếu không → BE đã crash.

2. **Thêm `backendProcess.on('exit')` handler** trong `main.js` để biết exit code.

---

## Fixes Đề Xuất

### Fix #1 — Phát hiện BE crash sớm (main.js)

```js
backendProcess.on('exit', (code, signal) => {
  const msg = `[BE] Process exited with code=${code}, signal=${signal}`;
  console.error(msg);
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${msg}\n`);
});
```

### Fix #2 — Không mở window nếu BE thất bại hoàn toàn (main.js)

Thêm flag để track và show thông báo lỗi thay vì mở app rỗng không kết nối được.

### Fix #3 — Kiểm tra BE alive trong FE trước khi login

Hiển thị trạng thái BE rõ ràng hơn trên LoginPage (đã có phần này nhưng cần đảm bảo UI phản ánh đúng).
