const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Load the camera module
let CameraDevice;
try {
  const mod = require('./cameraModule');
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

// Path to SDK - Corrected to current structure
const sdkPath = path.join(__dirname, 'cms-middle-be', 'src', 'module', 'sunell');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 9999;

const device = new CameraDevice({
  id: 'stress-test-camera',
  cameraIp: '192.168.1.208',
  cameraPort: 30001,
  cameraUser: 'admin',
  cameraPass: 'admin1234',
  rtspUrl: 'rtsp://admin:admin1234@192.168.1.208:554/snl/live/1/1',
  snapshotDir: snapshotDir,
  sdkPath: sdkPath,
  onAlarm: (payload) => {
    console.log('[Test] 🚨 Alarm received');
    io.emit('alarm', { time: new Date().toLocaleTimeString(), payload });
  }
});

let stats = {
  totalCalls: 0,
  success: 0,
  failed: 0,
  startTime: new Date().toISOString()
};

// Simple Dashboard HTML
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sunell SDK Stress Test</title>
      <script src="/socket.io/socket.io.js"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 20px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #1e293b; padding: 20px; rounded: 12px; border: 1px solid #334155; text-align: center; }
        .stat-card h3 { margin: 0; font-size: 12px; text-transform: uppercase; color: #94a3b8; }
        .stat-card p { margin: 10px 0 0; font-size: 24px; font-weight: 900; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
        .snap-card { background: #1e293b; border-radius: 8px; overflow: hidden; border: 1px solid #334155; position: relative; }
        .snap-card img { width: 100%; display: block; background: #000; height: 200px; object-fit: cover; }
        .snap-card .info { padding: 10px; font-size: 12px; background: rgba(0,0,0,0.5); position: absolute; bottom: 0; width: 100%; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-bottom: 5px; }
        .badge-success { background: #059669; }
        .badge-fail { background: #dc2626; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Sunell SDK Stress Test 🚀</h1>
          <div id="connection-status" style="color: #10b981;">● Connected to Test Server</div>
        </div>
        
        <div class="stats">
          <div class="stat-card"><h3>Total Calls</h3><p id="total">0</p></div>
          <div class="stat-card"><h3>Success</h3><p id="success" style="color: #10b981;">0</p></div>
          <div class="stat-card"><h3>Failed</h3><p id="failed" style="color: #ef4444;">0</p></div>
          <div class="stat-card"><h3>Success Rate</h3><p id="rate">0%</p></div>
        </div>

        <h2>Latest Snapshots</h2>
        <div class="grid" id="snapshot-grid"></div>
      </div>

      <script>
        const socket = io();
        const grid = document.getElementById('snapshot-grid');
        
        socket.on('snapshot', (data) => {
          document.getElementById('total').innerText = data.stats.totalCalls;
          document.getElementById('success').innerText = data.stats.success;
          document.getElementById('failed').innerText = data.stats.failed;
          const rate = ((data.stats.success / data.stats.totalCalls) * 100).toFixed(1);
          document.getElementById('rate').innerText = rate + '%';

          let s = data.b64;
          if (s.includes('base64,data:image')) s = s.split('base64,')[1];
          if (!s.startsWith('data:image')) s = 'data:image/jpeg;base64,' + s;
          const card = document.createElement('div');
          card.className = 'snap-card';
          card.innerHTML = \`
            <img src="\${s}">
            <div class="info">
              <span class="badge badge-success">OK</span>
              <div>Time: \${data.time}</div>
              <div>Size: \${(data.b64.length / 1024).toFixed(1)} KB</div>
            </div>
          \`;
          grid.prepend(card);
          if (grid.children.length > 12) grid.removeChild(grid.lastChild);
        });

        socket.on('status', (data) => {
          document.getElementById('total').innerText = data.stats.totalCalls;
          document.getElementById('failed').innerText = data.stats.failed;
          
          if (data.msg) {
            console.error('[Stress Test] Received error from server:', data.msg);
            const grid = document.getElementById('snapshot-grid');
            const card = document.createElement('div');
            card.className = 'snap-card';
            card.style.border = '1px solid #ef4444';
            card.innerHTML = \`
              <div style="height: 200px; display: flex; align-items: center; justify-content: center; background: #450a0a; color: #fca5a5; font-size: 11px; padding: 20px; text-align: center;">
                \${data.msg}
              </div>
              <div class="info">
                <span class="badge badge-fail">ERROR</span>
                <div>Time: \${data.time || 'unknown'}</div>
              </div>
            \`;
            grid.prepend(card);
            if (grid.children.length > 12) grid.removeChild(grid.lastChild);
          }
        });
      </script>
    </body>
    </html>
  `);
});

async function capture() {
  stats.totalCalls++;
  console.log(`[Test] [Call #${stats.totalCalls}] Capturing snapshot...`);
  try {
    const b64 = await device.captureSnapshotBase64();
    if (b64) {
      stats.success++;
      console.log(`[Test] [Call #${stats.totalCalls}] ✅ Success (Start: ${b64.substring(0, 50)}...)`);
      io.emit('snapshot', { b64, time: new Date().toLocaleTimeString(), stats });
    } else {
      throw new Error("Returned empty base64");
    }
  } catch (e) {
    stats.failed++;
    console.error(`[Test] [Call #${stats.totalCalls}] ❌ FAILED:`, e.message);
    io.emit('status', { 
      msg: `Error: ${e.message}`, 
      time: new Date().toLocaleTimeString(),
      stats 
    });
  }
}

server.listen(PORT, async () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Stress Test UI: http://localhost:${PORT}`);
  console.log(`=================================================\n`);

  console.log('[Test] Connecting to camera via SDK...');
  const result = await device.connectCamera();

  if (result.online) {
    console.log('[Test] ✅ Camera is online! Starting stress test interval (2 calls / 10s)...');

    // Stress Test: 1 calls every 5seconds
    setInterval(async () => {
      console.log(`\n[Test] --- Cycle Start (${new Date().toLocaleTimeString()}) ---`);
      capture(); // Call 1
      // setTimeout(() => capture(), 1500); // Call 2 after 1.5s delay within the cycle
    }, 1000);

  } else {
    console.error('[Test] ❌ Camera failed to connect:', result.error);
  }
});
