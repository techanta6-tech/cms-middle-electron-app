const fs = require('fs');
const file = 'cms-middle-be/src/services/cameras.service.js';
let content = fs.readFileSync(file, 'utf8');

const startStr = '// --- FALLBACK SNAPSHOT ---';
const endStr = 'saveSunellSnapshotAfterPrefilter(device, payload, logType);';

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex > -1 && endIndex > startIndex) {
  const newText = `// --- FALLBACK SNAPSHOT ---
        // YÊU CẦU: Tắt chức năng chụp qua sdk (đánh dấu lỗi), chuyển qua RTSP streaming liên tục.
        // Khi nhận sự kiện biển số xe từ camera sunell, lấy ảnh từ frame của luồng rtsp streaming đó.
        if (isLpr && !payload.snapshotBase64) {
          try {
            console.log(\`[Camera-\${id}] [LPR SNAPSHOT] Lấy ảnh từ luồng RTSP streaming ngầm...\`);
            const rtspResult = await captureRtspSnapshot(device.id, {
              fresh: true,
              save: true,
              timeoutMs: OVERVIEW_SNAPSHOT_TIMEOUT_MS,
              includeBase64: true,
            });

            if (rtspResult && rtspResult.success && rtspResult.snapshotBase64) {
              payload.snapshotBase64 = rtspResult.snapshotBase64;
              payload.snapshotPath = rtspResult.snapshotPath || null;
              payload.snapshotSource = 'rtsp-stream';
              console.log(\`[Camera-\${id}] [LPR SNAPSHOT] ✅ Lấy ảnh RTSP streaming thành công, size=\${rtspResult.snapshotBase64.length}\`);
            } else {
              console.warn(\`[Camera-\${id}] [LPR SNAPSHOT] ❌ Không lấy được ảnh từ luồng RTSP: \${rtspResult ? rtspResult.error : 'Unknown'}\`);
            }
          } catch (err) {
            console.error(\`[Camera-\${id}] [LPR SNAPSHOT] ❌ Lỗi lấy ảnh RTSP streaming: \${err.message}\`);
          }
        }

        `;
  content = content.substring(0, startIndex) + newText + content.substring(endIndex);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Replaced successfully');
} else {
  console.log('Not found');
}
