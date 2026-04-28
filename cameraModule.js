/**
 * ============================================================
 *  Camera Module — Sunell Camera Integration
 * ============================================================
 *  Module tách riêng các chức năng camera để tích hợp vào bất kỳ server nào.
 *
 *  Chức năng:
 *    1. captureSnapshot()     — Chụp snapshot qua RTSP (FFmpeg)
 *    2. triggerSnapshot()     — Chụp snapshot + broadcast qua WebSocket
 *    3. getStatus()           — Lấy trạng thái kết nối camera & WebSocket
 *    4. connectCamera()       — Kết nối camera qua SDK C# (edge-js)
 *    5. registerRoutes(app)   — Đăng ký các API routes vào Express app
 *    6. setupWebSocket(server)— Khởi tạo WebSocket server
 *    7. broadcastMessage()    — Gửi message tới tất cả client WebSocket
 *
 *  Cách sử dụng:
 *    const camera = require('./cameraModule');
 *
 *    // Khởi tạo với cấu hình
 *    camera.init({
 *        rtspUrl: 'rtsp://admin:admin1234@192.168.1.208:555/snl/live/1/1',
 *        snapshotDir: path.join(__dirname, '..', 'snapshots'),
 *        sdkPath: path.join(__dirname, '..'),
 *        cameraIp: '192.168.1.208',
 *        cameraPort: 30001,
 *        cameraUser: 'admin',
 *        cameraPass: 'admin1234'
 *    });
 *
 *    // Đăng ký routes vào Express app
 *    camera.registerRoutes(app);
 *
 *    // Khởi tạo WebSocket trên HTTP server
 *    camera.setupWebSocket(server);
 *
 *    // Kết nối camera (tùy chọn, nếu có SDK)
 *    camera.connectCamera();
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const WebSocket = require('ws');

// Lazy-load optional dependencies
let ffmpegPath = null;
let edge = null;

// ===== TRẠNG THÁI NỘI BỘ =====
const state = {
    // Cấu hình
    rtspUrl: '',
    snapshotDir: '',
    sdkPath: '',
    cameraIp: '',
    cameraPort: 30001,
    cameraUser: '',
    cameraPass: '',

    // Trạng thái runtime
    initialized: false,
    cameraConnected: false,
    cameraHandle: null,
    cameraError: null,
    lastSnapshotTime: null,
    snapshotCount: 0,

    // WebSocket
    wss: null,
    clients: new Set(),

    // Logger tùy chỉnh (có thể override)
    logger: null
};

// ===== BẢNG TÊN SỰ KIỆN SUNELL =====
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

// ===== HÀM NỘI BỘ =====

function log(direction, label, data) {
    if (state.logger) {
        state.logger(direction, label, data);
    } else {
        const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        const arrow = direction === 'IN' ? '⬇️  IN' : '⬆️ OUT';
        const line = `[${ts}] ${arrow} | ${label}` + (data !== undefined ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}` : '');
        console.log(line);
    }
}

function getAlarmName(mainType, subType) {
    const name = ALARM_NAMES[`${mainType}/${subType}`];
    if (!name) {
        console.log(`[ALARM] ⚠️ Sự kiện CHƯA BIẾT TÊN: main_type=${mainType}, sub_type=${subType}`);
    }
    return name || `Sự kiện chưa bóc tách (${mainType}/${subType})`;
}

// ===== HÀM CHỤP SNAPSHOT QUA RTSP BẰNG FFMPEG =====

/**
 * Chụp 1 frame ảnh JPEG từ camera qua giao thức RTSP bằng FFmpeg.
 * @param {string} [rtspUrl] - URL RTSP (mặc định dùng config đã init)
 * @param {string} [outputPath] - Đường dẫn file output (tự tạo nếu không truyền)
 * @param {number} [timeoutMs=8000] - Timeout (ms)
 * @returns {Promise<{filePath: string, sizeKB: number}>} Thông tin file snapshot
 */
function captureSnapshot(rtspUrl, outputPath, timeoutMs = 8000) {
    const url = rtspUrl || state.rtspUrl;
    if (!url) return Promise.reject(new Error('RTSP URL chưa được cấu hình'));

    // Tạo đường dẫn output nếu chưa truyền
    if (!outputPath) {
        if (!state.snapshotDir) return Promise.reject(new Error('snapshotDir chưa được cấu hình'));
        const filename = `snap_${Date.now()}.jpg`;
        outputPath = path.join(state.snapshotDir, filename);
    }

    // Lazy-load ffmpeg
    if (!ffmpegPath) {
        try {
            ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        } catch (e) {
            return Promise.reject(new Error('Không tìm thấy @ffmpeg-installer/ffmpeg. Chạy: npm install @ffmpeg-installer/ffmpeg'));
        }
    }

    return new Promise((resolve, reject) => {
        const args = [
            '-y',                        // Ghi đè file
            '-rtsp_transport', 'tcp',    // Dùng TCP cho ổn định
            '-i', url,                   // URL RTSP
            '-frames:v', '1',            // Chỉ lấy 1 frame
            '-q:v', '2',                 // Chất lượng JPEG (2 = cao)
            outputPath                   // File output
        ];

        log('IN', `[RTSP] Chụp snapshot: ${outputPath}`);
        const startTime = Date.now();

        execFile(ffmpegPath, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
            const elapsed = Date.now() - startTime;
            if (error) {
                log('IN', `[RTSP] Lỗi ffmpeg (${elapsed}ms)`, error.message);
                return reject(error);
            }

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                const sizeKB = parseFloat((fs.statSync(outputPath).size / 1024).toFixed(1));
                log('IN', `[RTSP] ✅ Snapshot OK!`, `${sizeKB} KB (${elapsed}ms)`);
                state.lastSnapshotTime = new Date().toISOString();
                state.snapshotCount++;
                resolve({ filePath: outputPath, sizeKB });
            } else {
                reject(new Error('File snapshot rỗng hoặc không tồn tại'));
            }
        });
    });
}

// ===== BROADCAST WEBSOCKET =====

/**
 * Gửi message tới tất cả client WebSocket đang kết nối.
 * @param {string} message - Chuỗi JSON hoặc text
 */
function broadcastMessage(message) {
    log('OUT', `Broadcast tới ${state.clients.size} client(s)`, message);
    for (const ws of state.clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    }
}

// ===== TRIGGER SNAPSHOT =====

/**
 * Chụp snapshot + broadcast kết quả qua WebSocket.
 * Dùng khi thiết bị bên ngoài gửi event trigger hoặc gọi thủ công.
 * @param {Object} options
 * @param {string} [options.device_id='unknown'] - ID thiết bị trigger
 * @param {string} [options.event_type='trigger'] - Loại sự kiện
 * @param {string} [options.message] - Mô tả sự kiện
 * @returns {Promise<Object>} Kết quả trigger
 */
async function triggerSnapshot({ device_id = 'unknown', event_type = 'trigger', message = '' } = {}) {
    const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });

    log('IN', `TRIGGER từ thiết bị ngoài`, { device_id, event_type, message });

    const filename = `trigger_${device_id}_${Date.now()}.jpg`;
    const snapFilePath = path.join(state.snapshotDir, filename);

    try {
        const { sizeKB } = await captureSnapshot(null, snapFilePath);

        const imgBytes = fs.readFileSync(snapFilePath);
        const snapBase64 = imgBytes.toString('base64');

        log('IN', 'TRIGGER Snapshot OK', `${sizeKB} KB`);

        const broadcastPayload = {
            type: 'external_trigger',
            device_id,
            event_type,
            message: message || 'Thiết bị bên ngoài yêu cầu chụp ảnh',
            snapshot: `data:image/jpeg;base64,${snapBase64}`,
            snapshotFile: filename,
            time: ts
        };

        broadcastMessage(JSON.stringify(broadcastPayload));

        return {
            success: true,
            message: 'Snapshot đã chụp và broadcast thành công',
            snapshotFile: filename,
            snapshotUrl: `/snapshots/${filename}`,
            sizeKB,
            triggeredBy: device_id,
            time: ts
        };
    } catch (err) {
        log('IN', 'TRIGGER Snapshot FAIL', err.message);

        const broadcastPayload = {
            type: 'external_trigger',
            device_id,
            event_type,
            message: message || 'Thiết bị bên ngoài yêu cầu chụp ảnh',
            snapshot: null,
            snapshotFile: null,
            error: 'Chụp snapshot thất bại: ' + err.message,
            time: ts
        };

        broadcastMessage(JSON.stringify(broadcastPayload));

        throw {
            success: false,
            error: 'Không thể chụp snapshot qua RTSP',
            message: err.message,
            triggeredBy: device_id
        };
    }
}

// ===== TRẠNG THÁI KẾT NỐI =====

/**
 * Lấy trạng thái hiện tại của hệ thống camera.
 * @returns {Object} Trạng thái camera, WebSocket, snapshot
 */
function getStatus() {
    return {
        initialized: state.initialized,
        camera: {
            connected: state.cameraConnected,
            handle: state.cameraHandle,
            ip: state.cameraIp,
            port: state.cameraPort,
            error: state.cameraError,
            rtspUrl: state.rtspUrl ? state.rtspUrl.replace(/:[^:@]+@/, ':***@') : null
        },
        websocket: {
            active: state.wss !== null,
            connectedClients: state.clients.size
        },
        snapshot: {
            directory: state.snapshotDir,
            totalCaptured: state.snapshotCount,
            lastCapturedAt: state.lastSnapshotTime
        }
    };
}

// ===== KHỞI TẠO WEBSOCKET =====

/**
 * Khởi tạo WebSocket server và quản lý kết nối client.
 * @param {http.Server} server - HTTP server instance
 * @returns {WebSocket.Server} WebSocket server instance
 */
function setupWebSocket(server) {
    state.wss = new WebSocket.Server({ server });

    state.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        log('IN', `Client kết nối (${clientIp}), tổng: ${state.clients.size + 1}`);
        state.clients.add(ws);

        ws.on('message', (rawMsg) => {
            log('IN', `Tin nhắn từ client (${clientIp})`, rawMsg.toString());
        });

        ws.on('close', (code) => {
            state.clients.delete(ws);
            log('IN', `Client ngắt (${clientIp}), code=${code}, còn ${state.clients.size}`);
        });

        ws.on('error', (err) => {
            log('IN', `Lỗi WebSocket (${clientIp})`, err.message);
        });
    });

    return state.wss;
}

// ===== KẾT NỐI CAMERA QUA SDK C# =====

/**
 * Kết nối camera Sunell qua SDK C# (edge-js).
 * @returns {Promise<Object>} Kết quả kết nối
 */
function connectCamera() {
    return new Promise((resolve) => {
        try {
            edge = require('edge-js');
        } catch (e) {
            state.cameraError = 'Không tìm thấy edge-js';
            log('IN', '[SDK] edge-js không khả dụng', e.message);
            resolve({ online: false, error: state.cameraError });
            return;
        }

        const csPath = path.join(state.sdkPath, 'SunellWrapper.cs');
        if (!fs.existsSync(csPath)) {
            state.cameraError = `Không tìm thấy SunellWrapper.cs ở: ${csPath}`;
            log('IN', '[SDK]', state.cameraError);
            resolve({ online: false, error: state.cameraError });
            return;
        }

        const code = fs.readFileSync(csPath, 'utf8');

        const onCameraEvent = function (payload, callback) {
            if (payload.source === 'FACE_DETECT_STREAM') {
                log('IN', 'LPR/Face Detect Stream data', payload.rawJson);
                broadcastMessage(payload.rawJson);
                callback(null, true);
                return;
            }

            log('IN', 'SDK C# → Node.js ALARM', { handle: payload.handle, timestamp: payload.timestamp });

            try {
                const jsonStr = payload.rawJson;
                if (!jsonStr) { callback(null, true); return; }

                let parsed;
                try { parsed = JSON.parse(jsonStr); } catch (e) {
                    log('IN', 'Raw alarm (parse failed)', jsonStr.substring(0, 200));
                    broadcastMessage(jsonStr);
                    callback(null, true);
                    return;
                }

                const d = parsed.data || {};
                const alarmFlag = d.alarm_flag;

                parsed.eventName = getAlarmName(d.main_type, d.sub_type);

                log('IN', `Alarm [${parsed.eventName}]`, { main_type: d.main_type, sub_type: d.sub_type, alarm_flag: alarmFlag, time: d.time });

                // Chỉ chụp snapshot khi alarm BẮT ĐẦU (alarm_flag = 1)
                if (alarmFlag === 1) {
                    const filename = `snap_${Date.now()}.jpg`;
                    const snapFilePath = path.join(state.snapshotDir, filename);

                    captureSnapshot(null, snapFilePath)
                        .then(({ filePath }) => {
                            const imgBytes = fs.readFileSync(filePath);
                            const snapBase64 = imgBytes.toString('base64');
                            log('IN', 'RTSP Snapshot OK', `${(imgBytes.length / 1024).toFixed(1)} KB`);
                            parsed.snapshot = `data:image/jpeg;base64,${snapBase64}`;
                            parsed.snapshotFile = filename;
                            broadcastMessage(JSON.stringify(parsed));
                        })
                        .catch((err) => {
                            log('IN', 'RTSP Snapshot FAIL', err.message);
                            broadcastMessage(JSON.stringify(parsed));
                        });
                } else {
                    broadcastMessage(JSON.stringify(parsed));
                }
            } catch (error) {
                log('IN', 'Lỗi xử lý alarm', error.message);
            }

            callback(null, true);
        };

        const connectFn = edge.func({
            source: code,
            references: ['System.Data.dll']
        });

        const sdkPayload = {
            sdkPath: state.sdkPath,
            snapshotDir: state.snapshotDir,
            ip: state.cameraIp,
            port: state.cameraPort,
            username: state.cameraUser,
            password: state.cameraPass,
            onEvent: onCameraEvent
        };

        console.log("--------------------------------------------------");
        console.log("Đang gọi C# SDK để login tới:", sdkPayload.ip);

        connectFn(sdkPayload, function (error, result) {
            if (error) {
                state.cameraConnected = false;
                state.cameraError = error.message;
                log('IN', '[SDK] Lỗi kết nối', error.message);
                broadcastMessage(`[LỖI HỆ THỐNG] Lỗi Exception C# SDK: ${error.message}`);
                resolve({ online: false, error: error.message });
            } else {
                console.log("Kết quả phản hồi từ thiết bị:", result);
                if (result.online) {
                    state.cameraConnected = true;
                    state.cameraHandle = result.handle;
                    state.cameraError = null;
                    broadcastMessage(`[Hệ thống] SDK kết nối thành công tới ${sdkPayload.ip}! Đang chờ bắt sự kiện...`);
                } else {
                    state.cameraConnected = false;
                    state.cameraError = result.message;
                    broadcastMessage(`[Lỗi Thiết Bị] Không thể đăng nhập: ${result.message}`);
                }
                resolve(result);
            }
        });
    });
}

// ===== ĐĂNG KÝ API ROUTES =====

/**
 * Đăng ký các API routes vào Express app.
 * Routes được tạo:
 *   GET  /api/status           — Trạng thái hệ thống
 *   POST /api/trigger-snapshot — Trigger chụp snapshot từ thiết bị ngoài
 *   GET  /api/snapshot         — Test chụp snapshot thủ công (trả file JPEG)
 *
 * @param {express.Application} app - Express app instance
 * @param {string} [prefix=''] - Prefix cho route (VD: '/camera' → '/camera/api/status')
 */
function registerRoutes(app, prefix = '') {
    // Serve ảnh snapshot qua HTTP
    app.use(`${prefix}/snapshots`, require('express').static(state.snapshotDir));

    // API lấy trạng thái
    app.get(`${prefix}/api/status`, (req, res) => {
        res.json(getStatus());
    });

    // API trigger snapshot từ thiết bị ngoài
    app.post(`${prefix}/api/trigger-snapshot`, async (req, res) => {
        try {
            const result = await triggerSnapshot(req.body || {});
            res.json(result);
        } catch (err) {
            res.status(500).json(err);
        }
    });

    // API test snapshot thủ công (trả file ảnh)
    app.get(`${prefix}/api/snapshot`, async (req, res) => {
        const filename = `test_snap_${Date.now()}.jpg`;
        const snapFilePath = path.join(state.snapshotDir, filename);
        try {
            await captureSnapshot(null, snapFilePath);
            res.sendFile(snapFilePath);
        } catch (err) {
            res.status(500).json({
                error: 'Không thể chụp snapshot qua RTSP',
                message: err.message,
                rtspUrl: state.rtspUrl ? state.rtspUrl.replace(/:[^:@]+@/, ':***@') : null,
                hint: 'Kiểm tra lại RTSP URL, port, user/pass.'
            });
        }
    });

    console.log(`[CameraModule] Routes đã đăng ký (prefix: "${prefix || '/'}")`);
}

// ===== KHỞI TẠO MODULE =====

/**
 * Khởi tạo module với cấu hình.
 * @param {Object} config
 * @param {string} config.rtspUrl - URL RTSP của camera
 * @param {string} config.snapshotDir - Thư mục lưu ảnh snapshot
 * @param {string} [config.sdkPath] - Đường dẫn tới thư mục chứa SDK DLLs + SunellWrapper.cs
 * @param {string} [config.cameraIp] - IP camera (cho SDK)
 * @param {number} [config.cameraPort=30001] - Port SDK camera
 * @param {string} [config.cameraUser] - Username camera
 * @param {string} [config.cameraPass] - Password camera
 * @param {Function} [config.logger] - Hàm log tùy chỉnh: (direction, label, data) => void
 */
function init(config = {}) {
    state.rtspUrl = config.rtspUrl || state.rtspUrl;
    state.snapshotDir = config.snapshotDir || state.snapshotDir;
    state.sdkPath = config.sdkPath || state.sdkPath;
    state.cameraIp = config.cameraIp || state.cameraIp;
    state.cameraPort = config.cameraPort || state.cameraPort;
    state.cameraUser = config.cameraUser || state.cameraUser;
    state.cameraPass = config.cameraPass || state.cameraPass;
    state.logger = config.logger || state.logger;

    // Tạo thư mục snapshot nếu chưa có
    if (state.snapshotDir && !fs.existsSync(state.snapshotDir)) {
        fs.mkdirSync(state.snapshotDir, { recursive: true });
    }

    state.initialized = true;
    console.log('[CameraModule] Đã khởi tạo thành công');
    console.log(`  RTSP URL: ${state.rtspUrl ? state.rtspUrl.replace(/:[^:@]+@/, ':***@') : '(chưa cấu hình)'}`);
    console.log(`  Snapshot Dir: ${state.snapshotDir || '(chưa cấu hình)'}`);
    console.log(`  Camera IP: ${state.cameraIp || '(chưa cấu hình)'}`);
}

// ===== EXPORTS =====
module.exports = {
    init,
    captureSnapshot,
    triggerSnapshot,
    getStatus,
    broadcastMessage,
    setupWebSocket,
    connectCamera,
    registerRoutes,
    getAlarmName,
    ALARM_NAMES
};
