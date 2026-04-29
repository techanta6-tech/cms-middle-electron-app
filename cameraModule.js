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
const { execFile } = require('child_process');

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
    '6/37': 'Nhận diện biển số (License plate recognition)'
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
                try {
                    ffmpegPath = require(path.join(__dirname, 'cms-middle-be', 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
                } catch (err) {
                    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
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

            this.log('IN', `[RTSP] Chụp snapshot: ${outputPath}`);
            const startTime = Date.now();

            execFile(ffmpegPath, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
                const elapsed = Date.now() - startTime;
                if (error) {
                    this.log('IN', `[RTSP] Lỗi ffmpeg (${elapsed}ms)`, error.message);
                    return reject(error);
                }

                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                    const sizeKB = parseFloat((fs.statSync(outputPath).size / 1024).toFixed(1));
                    this.log('IN', `[RTSP] ✅ Snapshot OK!`, `${sizeKB} KB (${elapsed}ms)`);
                    resolve({ filePath: outputPath, sizeKB });
                } else {
                    reject(new Error('File snapshot rỗng hoặc không tồn tại'));
                }
            });
        });
    }

    /**
     * Chụp snapshot và trả về chuỗi Base64
     */
    async captureSnapshotBase64(rtspUrlOverride, timeoutMs = 8000) {
        const url = rtspUrlOverride || this.rtspUrl;
        if (!url) {
            this.log('IN', 'captureSnapshotBase64: RTSP URL chưa cấu hình');
            return null;
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
                    if (this.onAlarm) this.onAlarm(payload.rawJson);
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

                    // Nếu muốn trigger tự động chụp ảnh SDK khi có alarm, xử lý ở đây
                    // Tạm thời truyền ra ngoài
                    if (this.onAlarm) this.onAlarm(JSON.stringify(parsed));
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
}

module.exports = {
    CameraDevice,
    getAlarmName,
    ALARM_NAMES
};
