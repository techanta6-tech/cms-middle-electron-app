const path = require('path');
const fs = require('fs');

// Load the camera module
let CameraDevice;
try {
  const mod = require('../cameraModule');
  CameraDevice = mod.CameraDevice;
  console.log('[Test] Successfully loaded cameraModule.js');
} catch (err) {
  console.error('[Test] Failed to load cameraModule.js:', err);
  process.exit(1);
}

// Ensure snapshot directory exists
const snapshotDir = path.join(__dirname, 'snapshots');
if (!fs.existsSync(snapshotDir)) {
  fs.mkdirSync(snapshotDir, { recursive: true });
}

// Path to SDK
const sdkPath = path.join(__dirname, 'src', 'module', 'sunell');

async function runTest() {
  console.log('[Test] Creating CameraDevice instance...');
  const device = new CameraDevice({
    id: 'test-camera',
    cameraIp: '192.168.1.207',
    cameraPort: 30001,
    cameraUser: 'admin',
    cameraPass: 'admin1234',
    rtspUrl: 'rtsp://admin:admin1234@192.168.1.207:555/snl/live/1/1',
    snapshotDir: snapshotDir,
    sdkPath: sdkPath,
    onAlarm: (payload) => {
      console.log('\n[Test] 🚨 ALARM RECEIVED from SDK:', payload.substring(0, 200));
    }
  });

  console.log('[Test] Connecting to camera via SDK...');
  try {
    const result = await device.connectCamera();
    console.log('[Test] Connect result:', result);

    if (result.online) {
      console.log('\n[Test] ✅ Camera is online and connected!');
      console.log('[Test] Waiting 3 seconds before capturing snapshot...');
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('[Test] Capturing snapshot...');
      const base64 = await device.captureSnapshotBase64();
      
      if (base64) {
        console.log(`[Test] ✅ Snapshot captured successfully! (Base64 length: ${base64.length})`);
        // Save the snapshot for visual verification
        const buffer = Buffer.from(base64, 'base64');
        const imgPath = path.join(snapshotDir, `test-snap-${Date.now()}.jpg`);
        fs.writeFileSync(imgPath, buffer);
        console.log(`[Test] 📸 Snapshot saved to: ${imgPath}`);
      } else {
        console.log('[Test] ❌ Snapshot capture returned null/empty.');
      }
    } else {
      console.log('\n[Test] ❌ Camera failed to connect. Error:', result.error);
    }
  } catch (err) {
    console.error('\n[Test] 💥 Exception during test:', err);
  }

  // Optional: keep process alive to test onAlarm if needed, or exit
  // process.exit(0);
}

runTest();
