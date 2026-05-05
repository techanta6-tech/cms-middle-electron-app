/**
 * ============================================================
 *  Camera Module — Camera Integration (Class-based)
 * ============================================================
 *  Chức năng:
 *    1. captureSnapshot()     — Chụp snapshot qua RTSP (FFmpeg)
 *    2. connectCamera()       — Kết nối camera qua SDK C# (edge-js)
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

let ffmpegPath = null;
let edge = null;

const ALARM_NAMES = {
    // main_type 1: Báo động an ninh chung
    '1/1': 'Báo động I/O',
    '1/2': 'Phát hiện chuyển động (Motion detection)',
    '1/3': 'Camera bị che khuất (Camera blocking)',
    '1/4': 'Mất tín hiệu hình ảnh (Video loss)',
    '1/5': 'Rớt mạng (Network disconnection)',
    '1/9': 'Phát hiện thân nhiệt PIR',
    '1/10': 'Báo động cổng I/O NVR',

    // main_type 4: Báo động ổ cứng
    '4/1': 'Ổ cứng bình thường',
    '4/2': 'Lỗi đọc/ghi ổ cứng',
    '4/3': 'Mất kết nối ổ mạng',
    '4/4': 'Ổ cứng đầy',
    '4/5': 'Không có ổ cứng',
    '4/6': 'Dung lượng đạt ngưỡng giới hạn',
    '4/7': 'Ổ cứng chưa được format',
    '4/8': 'Thiếu dung lượng lưu trữ trên thiết bị',

    // main_type 5: Báo động luồng Video
    '5/1': 'Kết nối luồng dữ liệu thành công',
    '5/2': 'Sai user/pass luồng dữ liệu',
    '5/3': 'Không có quyền truy cập',
    '5/4': 'Đạt giới hạn số lượng kết nối luồng',

    // main_type 6: AI Phân tích thông minh
    '6/21': 'Vượt hàng rào ảo (Trip wire)',
    '6/22': 'Phát hiện đối tượng di chuyển (Mobile detection/SMD)',
    '6/23': 'Phân tích che khuất (Occlusion)',
    '6/24': 'Xâm nhập vùng cấm (Perimeter intrusion)',
    '6/25': 'Vượt hàng rào kép (Double trip wire)',
    '6/26': 'Lảng vảng (Wandering/Loitering)',
    '6/27': 'Đám đông lảng vảng (Multi-person wandering)',
    '6/28': 'Bỏ quên đồ vật (Items left behind)',
    '6/29': 'Mất cắp đồ vật (Goods removal)',
    '6/30': 'Đi quá tốc độ (Abnormal speed)',
    '6/31': 'Đi ngược chiều (Retrograde)',
    '6/32': 'Đậu xe trái phép (Illegal parking)',
    '6/33': 'Camera bị dời góc (Camera shift)',
    '6/34': 'Lỗi tín hiệu video AI (Video signal abnormal)',
    '6/37': 'Nhận diện biển số (License plate recognition)',

    // main_type 7: Báo động nhiệt độ (Thermal)
    '7/0': 'Cảnh báo ngưỡng nhiệt độ (Temperature threshold warning)',
    '7/1': 'Báo động vượt ngưỡng nhiệt (Temperature threshold alarm)',
    '7/4': 'Cảnh báo chênh lệch nhiệt (Temperature difference warning)',
    '7/5': 'Báo động chênh lệch nhiệt (Temperature difference alarm)',
    '7/16': 'Phát hiện điểm cháy (Fire spot detection)',
    '7/17': 'Phát hiện hút thuốc (Smoking detection)',
    '7/18': 'Phát hiện khói và lửa (Smoke & flame detection)'
};

function getAlarmName(mainType, subType) {
    const name = ALARM_NAMES[`${mainType}/${subType}`];
    return name || `Sự kiện chưa bóc tách (${mainType}/${subType})`;
}

class CameraDevice {
    /**
     * @param {Object} config
     * @param {string} config.id - ID thiết bị
     * @param {string} [config.rtspUrl] - URL RTSP của camera
     * @param {string} config.snapshotDir - Thư mục lưu ảnh snapshot
     * @param {string} [config.sdkPath] - Đường dẫn tới thư mục chứa SDK DLLs + SunellWrapper.cs
     * @param {string} [config.cameraIp] - IP camera (cho SDK)
     * @param {number} [config.cameraPort=30001] - Port SDK camera
     * @param {string} [config.cameraUser] - Username camera
     * @param {string} [config.cameraPass] - Password camera
     * @param {Function} [config.logger] - Hàm log tùy chỉnh
     * @param {Function} [config.onAlarm] - Hàm callback khi có báo động SDK: (payload) => void
     */
    constructor(config = {}) {
        this.id = config.id || 'unknown';
        this.rtspUrl = config.rtspUrl || '';
        this.snapshotDir = config.snapshotDir || '';
        this.sdkPath = config.sdkPath || '';
        this.cameraIp = config.cameraIp || '';
        this.cameraPort = config.cameraPort || 30001;
        this.cameraUser = config.cameraUser || '';
        this.cameraPass = config.cameraPass || '';
        this.logger = config.logger || null;
        this.onAlarm = config.onAlarm || null;

        this.initialized = false;
        this.cameraConnected = false;
        this.cameraHandle = null;
        this.cameraError = null;

        if (this.snapshotDir && !fs.existsSync(this.snapshotDir)) {
            fs.mkdirSync(this.snapshotDir, { recursive: true });
        }
        
        this.initialized = true;
    }

    log(direction, label, data) {
        if (this.logger) {
            this.logger(direction, label, data);
        } else {
            const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
            const arrow = direction === 'IN' ? '⬇️  IN' : '⬆️ OUT';
            const line = `[${ts}] ${arrow} | [${this.id}] ${label}` + (data !== undefined ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}` : '');
            console.log(line);
        }
    }

    /**
     * Chụp 1 frame ảnh JPEG từ camera qua giao thức RTSP bằng FFmpeg.
     */
    captureSnapshot(rtspUrlOverride, outputPath, timeoutMs = 8000) {
        const url = rtspUrlOverride || this.rtspUrl;
        if (!url) return Promise.reject(new Error('RTSP URL chưa được cấu hình'));

        if (!outputPath) {
            if (!this.snapshotDir) return Promise.reject(new Error('snapshotDir chưa được cấu hình'));
            const filename = `snap_${this.id}_${Date.now()}.jpg`;
            outputPath = path.join(this.snapshotDir, filename);
        }

        if (!ffmpegPath) {
            try {
                if (process.pkg) {
                    // Production: ffmpeg cạnh file exe
                    ffmpegPath = require(path.join(path.dirname(process.execPath), 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
                } else {
                    try {
                        ffmpegPath = require(path.join(__dirname, 'cms-middle-be', 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
                    } catch (err) {
                        ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                    }
                }
            } catch (e) {
                return Promise.reject(new Error('Không tìm thấy @ffmpeg-installer/ffmpeg.'));
            }
        }

        return new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-rtsp_transport', 'tcp',
                '-i', url,
                '-frames:v', '1',
                '-q:v', '2',
                outputPath
            ];

            this.log('IN', `[RTSP] Bắt đầu quá trình chụp ảnh qua RTSP...`);
            this.log('IN', `[RTSP] URL đích: ${url.replace(/:[^:@]+@/, ':***@')}`);
            const startTime = Date.now();

            const proc = spawn(ffmpegPath, args);
            
            let isTimeout = false;
            let rawStderr = '';
            const timeoutTimer = setTimeout(() => {
                isTimeout = true;
                proc.kill('SIGKILL');
                this.log('IN', `[RTSP] ❌ Quá hạn kết nối (Timeout) sau ${timeoutMs}ms!`);
                reject(new Error('RTSP Connection Timeout'));
            }, timeoutMs);

            proc.stderr.on('data', (data) => {
                const str = data.toString();
                rawStderr += str;
                
                // Phân tích stderr của ffmpeg để thông báo tiến trình thực
                if (str.includes('Input #0')) {
                    this.log('IN', `[RTSP] ✅ Mở luồng thành công! Đang đọc thông tin luồng...`);
                } else if (str.includes('tcp://')) {
                    // Tránh log quá nhiều dòng tcp
                    if (str.includes('Connection to tcp://') || str.includes('Opening')) {
                        this.log('IN', `[RTSP] ⏳ Đang kết nối giao thức TCP...`);
                    }
                } else if (str.includes('401 Unauthorized')) {
                    this.log('IN', `[RTSP] ❌ Từ chối truy cập (401 Unauthorized) - Sai user/pass!`);
                } else if (str.includes('Connection refused')) {
                    this.log('IN', `[RTSP] ❌ Bị từ chối kết nối (Connection refused) - Kiểm tra port!`);
                } else if (str.includes('Server returned 404') || str.includes('Stream not found')) {
                    this.log('IN', `[RTSP] ❌ Không tìm thấy luồng (404 Not Found) - Sai đường dẫn stream!`);
                } else if (str.includes('Output #0')) {
                    this.log('IN', `[RTSP] 📸 Bắt đầu trích xuất frame ảnh (JPEG)...`);
                }
            });

            proc.on('close', (code) => {
                clearTimeout(timeoutTimer);
                if (isTimeout) return; // Đã xử lý ở setTimeout

                const elapsed = Date.now() - startTime;
                if (code !== 0) {
                    this.log('IN', `[RTSP] ❌ Quá trình thất bại (Mã lỗi FFmpeg: ${code}) sau ${elapsed}ms`);
                    
                    // Lấy 3 dòng cuối của log FFmpeg để hiển thị chi tiết lý do lỗi
                    const lines = rawStderr.trim().split('\n');
                    const lastLines = lines.slice(-3).join(' | ').trim();
                    if (lastLines) {
                        this.log('IN', `[RTSP-DETAIL] Chi tiết lỗi FFmpeg: ${lastLines}`);
                    }
                    
                    return reject(new Error(`ffmpeg exited with code ${code}`));
                }

                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                    const sizeKB = parseFloat((fs.statSync(outputPath).size / 1024).toFixed(1));
                    this.log('IN', `[RTSP] ✅ Chụp xong Snapshot thành công! Kích thước: ${sizeKB} KB (${elapsed}ms)`);
                    resolve({ filePath: outputPath, sizeKB });
                } else {
                    this.log('IN', `[RTSP] ❌ File rỗng hoặc ảnh không được tạo ra.`);
                    reject(new Error('File snapshot rỗng hoặc không tồn tại'));
                }
            });
            
            proc.on('error', (err) => {
                clearTimeout(timeoutTimer);
                this.log('IN', `[RTSP] ❌ Lỗi khi khởi chạy tiến trình hệ thống:`, err.message);
                reject(err);
            });
        });
    }

    /**
     * Chụp snapshot và trả về chuỗi Base64
     */
    async captureSnapshotBase64(rtspUrlOverride, timeoutMs = 8000) {
        let url = rtspUrlOverride || this.rtspUrl;
        // Tự tạo RTSP URL nếu chưa cấu hình nhưng có thông tin IP camera
        if (!url && this.cameraIp) {
            const user = this.cameraUser || 'admin';
            const pass = this.cameraPass || 'admin1234';
            const rtspPort = 554; // Sunell RTSP port chuẩn
            url = `rtsp://${user}:${pass}@${this.cameraIp}:${rtspPort}/snl/live/1/1`;
            this.log('IN', `[RTSP] Auto-generated RTSP URL: rtsp://${user}:***@${this.cameraIp}:${rtspPort}/snl/live/1/1`);
        }
        if (!url) {
            this.log('IN', 'captureSnapshotBase64: RTSP URL chưa cấu hình và không có IP camera');
            return null;
        }

        // ⚠️ Phát hiện và sửa port sai: SDK port (30001) không phải RTSP port
        // Sunell dùng 30001 cho SDK control, RTSP streaming dùng port 554 (chuẩn RTSP)
        const SDK_PORTS = [30001, 30000];
        const RTSP_FALLBACK_PORT = 554;
        try {
            const parsedUrl = new URL(url);
            const configuredPort = parseInt(parsedUrl.port, 10);
            if (SDK_PORTS.includes(configuredPort)) {
                const fixedUrl = url.replace(`:${configuredPort}/`, `:${RTSP_FALLBACK_PORT}/`);
                this.log('IN', `[RTSP] ⚠️ Phát hiện SDK port (${configuredPort}) trong RTSP URL — tự động chuyển sang port ${RTSP_FALLBACK_PORT}`);
                this.log('IN', `[RTSP] URL gốc: ${url.replace(/:[^:@]+@/, ':***@')}`);
                this.log('IN', `[RTSP] URL sửa: ${fixedUrl.replace(/:[^:@]+@/, ':***@')}`);
                url = fixedUrl;
            }
        } catch (_) {
            // Nếu URL không hợp lệ thì bỏ qua bước sửa port
        }

        if (url.includes('fake') || this.cameraIp === '127.0.0.1') {
            this.log('IN', `[MOCK RTSP] Trả về ảnh giả lập cho: ${url || this.cameraIp}`);
            // Chuỗi Base64 của một bức ảnh 1x1 đỏ mẫu
            const fakeImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            return fakeImageBase64;
        }

        const tmpDir = this.snapshotDir;
        const filename = `snap_${this.id}_${Date.now()}.jpg`;
        const outputPath = path.join(tmpDir, filename);

        try {
            await this.captureSnapshot(url, outputPath, timeoutMs);
            const imgBytes = fs.readFileSync(outputPath);
            const base64 = imgBytes.toString('base64');
            try { fs.unlinkSync(outputPath); } catch (_) {}
            return `data:image/jpeg;base64,${base64}`;
        } catch (err) {
            this.log('IN', '[RTSP→Base64] FAIL', err.message);
            try { fs.unlinkSync(outputPath); } catch (_) {}
            return null;
        }
    }

    /**
     * Kết nối camera Sunell qua SDK C# (edge-js).
     */
    connectCamera() {
        return new Promise((resolve) => {
            try {
                if (process.pkg) {
                    const edgeJsPath = path.join(path.dirname(process.execPath), 'node_modules', 'edge-js');
                    edge = require(edgeJsPath);
                } else {
                    try {
                        // Trực tiếp require từ thư mục backend nơi edge-js được cài đặt
                        const beEdgePath = path.join(__dirname, 'cms-middle-be', 'node_modules', 'edge-js');
                        edge = require(beEdgePath);
                    } catch (err) {
                        edge = require('edge-js');
                    }
                }
            } catch (e) {
                this.cameraError = e.message;
                this.log('IN', '[SDK] edge-js không khả dụng', e.stack || e.message);
                resolve({ online: false, error: this.cameraError });
                return;
            }

            const csPath = path.join(this.sdkPath, 'SunellWrapper.cs');
            if (!fs.existsSync(csPath)) {
                this.cameraError = `Không tìm thấy SunellWrapper.cs ở: ${csPath}`;
                this.log('IN', '[SDK]', this.cameraError);
                resolve({ online: false, error: this.cameraError });
                return;
            }

            const code = fs.readFileSync(csPath, 'utf8');

            const onCameraEvent = (payload, callback) => {
                if (payload.source === 'FACE_DETECT_STREAM') {
                    let parsedData = payload.rawJson;
                    try {
                        let p = JSON.parse(payload.rawJson);
                        if (payload.snapshotBase64) {
                            p.snapshotBase64 = payload.snapshotBase64;
                            parsedData = JSON.stringify(p);
                            if (this.onAlarm) this.onAlarm(parsedData);
                        } else {
                            this.log('IN', '[FALLBACK] Chụp ảnh RTSP do SDK không trả về snapshotBase64 (FACE_DETECT)');
                            this.captureSnapshotBase64().then(b64 => {
                                if (b64) {
                                    p.snapshotBase64 = b64;
                                    this.log('IN', `[FALLBACK] ✅ RTSP snapshot OK, size=${b64.length}`);
                                } else {
                                    this.log('IN', '[FALLBACK] ❌ RTSP snapshot trả về null');
                                }
                                if (this.onAlarm) this.onAlarm(JSON.stringify(p));
                            }).catch((err) => {
                                this.log('IN', `[FALLBACK] ❌ RTSP snapshot lỗi: ${err.message}`);
                                if (this.onAlarm) this.onAlarm(JSON.stringify(p));
                            });
                        }
                    } catch(e) {
                        if (this.onAlarm) this.onAlarm(parsedData);
                    }
                    
                    callback(null, true);
                    return;
                }

                this.log('IN', 'SDK C# → Node.js ALARM', { handle: payload.handle, timestamp: payload.timestamp });

                try {
                    const jsonStr = payload.rawJson;
                    if (!jsonStr) { callback(null, true); return; }

                    let parsed;
                    try { parsed = JSON.parse(jsonStr); } catch (e) {
                        if (this.onAlarm) this.onAlarm(jsonStr);
                        callback(null, true);
                        return;
                    }

                    const d = parsed.data || {};
                    const alarmFlag = d.alarm_flag;
                    parsed.eventName = getAlarmName(d.main_type, d.sub_type);
                    
                    this.log('IN', `Alarm [${parsed.eventName}]`, { main_type: d.main_type, sub_type: d.sub_type, alarm_flag: alarmFlag, time: d.time });

                    if (payload.snapshotBase64) {
                        parsed.snapshotBase64 = payload.snapshotBase64;
                        if (this.onAlarm) this.onAlarm(JSON.stringify(parsed));
                    } else {
                        this.log('IN', `[FALLBACK] Chụp ảnh RTSP do SDK không trả về ảnh cho sự kiện [${parsed.eventName}]`);
                        this.captureSnapshotBase64().then(b64 => {
                            if (b64) {
                                parsed.snapshotBase64 = b64;
                                this.log('IN', `[FALLBACK] ✅ RTSP snapshot OK cho [${parsed.eventName}], size=${b64.length}`);
                            } else {
                                this.log('IN', `[FALLBACK] ❌ RTSP snapshot trả về null cho [${parsed.eventName}]`);
                            }
                            if (this.onAlarm) this.onAlarm(JSON.stringify(parsed));
                        }).catch((err) => {
                            this.log('IN', `[FALLBACK] ❌ RTSP snapshot lỗi cho [${parsed.eventName}]: ${err.message}`);
                            if (this.onAlarm) this.onAlarm(JSON.stringify(parsed));
                        });
                    }
                } catch (error) {
                    this.log('IN', 'Lỗi xử lý alarm', error.message);
                }

                callback(null, true);
            };

            const connectFn = edge.func({
                source: code,
                references: ['System.Data.dll']
            });

            const sdkPayload = {
                sdkPath: this.sdkPath,
                snapshotDir: this.snapshotDir,
                ip: this.cameraIp,
                port: this.cameraPort,
                username: this.cameraUser,
                password: this.cameraPass,
                onEvent: onCameraEvent
            };

            this.log('IN', "Đang gọi C# SDK để login tới:", sdkPayload.ip);

            connectFn(sdkPayload, (error, result) => {
                if (error) {
                    this.cameraConnected = false;
                    this.cameraError = error.message;
                    this.log('IN', '[SDK] Lỗi kết nối', error.message);
                    resolve({ online: false, error: error.message });
                } else {
                    if (result.online) {
                        this.cameraConnected = true;
                        this.cameraHandle = result.handle;
                        this.cameraError = null;
                        this.log('IN', 'SDK kết nối thành công', `handle: ${this.cameraHandle}`);
                    } else {
                        this.cameraConnected = false;
                        this.cameraError = result.message;
                        this.log('IN', 'SDK lỗi đăng nhập', result.message);
                    }
                    resolve(result);
                }
            });
        });
    }

    async disconnectCamera() {
        if (!this.cameraConnected || !this.cameraHandle) {
            return { success: true, message: 'Camera already disconnected' };
        }

        return new Promise((resolve, reject) => {
            if (!this.edgeMethod) {
                return resolve({ success: false, message: 'Edge method not initialized' });
            }

            const payload = {
                action: 'disconnect',
                handle: this.cameraHandle
            };

            this.edgeMethod(payload, (error, result) => {
                if (error) {
                    this.log('IN', 'SDK lỗi ngắt kết nối', String(error));
                    return reject(error);
                }

                this.cameraConnected = false;
                this.cameraHandle = null;
                this.log('IN', 'SDK đã ngắt kết nối', result);
                resolve(result);
            });
        });
    }

    getStatus() {
        return {
            id: this.id,
            initialized: this.initialized,
            camera: {
                connected: this.cameraConnected,
                handle: this.cameraHandle,
                ip: this.cameraIp,
                port: this.cameraPort,
                error: this.cameraError,
                rtspUrl: this.rtspUrl ? this.rtspUrl.replace(/:[^:@]+@/, ':***@') : null
            }
        };
    }

    /**
     * Kiểm tra kết nối RTSP nhanh (probe) — dùng FFmpeg chỉ để mở stream, không lưu file.
     * @param {number} timeoutMs - Thời gian tối đa chờ kết nối (mặc định 5000ms)
     * @returns {Promise<{online: boolean, error?: string}>}
     */
    probeRtsp(timeoutMs = 5000) {
        const url = this.rtspUrl;
        if (!url) {
            return Promise.resolve({ online: false, error: 'RTSP URL chưa được cấu hình' });
        }

        if (!ffmpegPath) {
            try {
                if (process.pkg) {
                    ffmpegPath = require(path.join(path.dirname(process.execPath), 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
                } else {
                    try {
                        ffmpegPath = require(path.join(__dirname, 'cms-middle-be', 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
                    } catch (err) {
                        ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                    }
                }
            } catch (e) {
                return Promise.resolve({ online: false, error: 'FFmpeg không khả dụng' });
            }
        }

        return new Promise((resolve) => {
            const args = [
                '-rtsp_transport', 'tcp',
                '-i', url,
                '-t', '1',         // chỉ đọc 1 giây
                '-f', 'null',       // không ghi file
                '-'
            ];

            let rawStderr = '';
            let settled = false;

            const proc = spawn(ffmpegPath, args);

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    proc.kill('SIGKILL');
                    resolve({ online: false, error: 'Timeout kết nối RTSP' });
                }
            }, timeoutMs);

            proc.stderr.on('data', (data) => {
                rawStderr += data.toString();

                // Nếu thấy "Input #0" nghĩa là stream mở thành công → online
                if (!settled && rawStderr.includes('Input #0')) {
                    settled = true;
                    clearTimeout(timer);
                    proc.kill('SIGKILL');
                    resolve({ online: true });
                }
            });

            proc.on('close', () => {
                clearTimeout(timer);
                if (settled) return;
                settled = true;

                // Phân tích lỗi từ stderr
                if (rawStderr.includes('401 Unauthorized')) {
                    resolve({ online: false, error: 'Sai user/password (401)' });
                } else if (rawStderr.includes('Connection refused')) {
                    resolve({ online: false, error: 'Bị từ chối kết nối' });
                } else if (rawStderr.includes('Server returned 404') || rawStderr.includes('Stream not found')) {
                    resolve({ online: false, error: 'Không tìm thấy luồng (404)' });
                } else if (rawStderr.includes('No route to host') || rawStderr.includes('Network is unreachable')) {
                    resolve({ online: false, error: 'Không thể kết nối mạng' });
                } else {
                    resolve({ online: false, error: 'Không thể mở luồng RTSP' });
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    resolve({ online: false, error: err.message });
                }
            });
        });
    }
}

module.exports = {
    CameraDevice,
    getAlarmName,
    ALARM_NAMES
};
