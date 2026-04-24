const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

const os = require('os');

const SKIP_KEYWORDS = ['Tailscale', 'vEthernet', 'Loopback', 'VMware', 'VirtualBox', 'Pseudo'];

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (SKIP_KEYWORDS.some(kw => name.includes(kw))) continue;
    for (const iface of addrs) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }

  if (candidates.length === 0) return '127.0.0.1';

  // Ưu tiên Ethernet thực > Wi-Fi > còn lại
  const preferred =
    candidates.find(c => /ethernet/i.test(c.name) && !/vethernet/i.test(c.name)) ||
    candidates.find(c => /wi.fi|wlan|wireless/i.test(c.name)) ||
    candidates[0];

  return preferred?.address || '127.0.0.1';
}

// ─── Tìm cổng trống ─────────────────────────────────────────────────────────
function findFreePort(startPort) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        resolve(findFreePort(startPort + 1));
      } else {
        resolve(startPort);
      }
    });
  });
}

// In dev mode, we assume the backend is started via concurrently or separately.
// For production mode, we might want to start the backend directly here.
const isDev = !app.isPackaged;
let backendProcess = null;

function startBackend(bePort) {
  const osPlatform = os.platform();
  const beExecutableName = osPlatform === 'win32' ? 'cms-ai-vms-middle.exe' : 'cms-ai-vms-middle';

  const binaryPath = isDev
    ? path.join(__dirname, 'build-be', beExecutableName)
    : path.join(process.resourcesPath, 'bin', beExecutableName);

  const runtimeIP = getLocalIP();
  if (fs.existsSync(binaryPath)) {
    console.log(`[Electron] Starting Backend Sidecar on port ${bePort}...`, binaryPath);
    const executeEnv = { 
      ...process.env, 
      IS_PACKAGED: 'true', 
      USER_DATA_PATH: app.getPath('userData'),
      LOCAL_IP: runtimeIP,
      BE_PORT: bePort
    };
    backendProcess = spawn(binaryPath, [], { cwd: path.dirname(binaryPath), env: executeEnv });
    backendProcess.stdout.on('data', (data) => console.log(`[BE]: ${data}`));
    backendProcess.stderr.on('data', (data) => console.error(`[BE ERROR]: ${data}`));
  } else {
    console.error('[Electron] Backend sidecar not found at', binaryPath);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true, // Ẩn menu bar (File/Edit/View...), vẫn giữ title bar OS
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // In dev, load Vite's local server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built React app
    mainWindow.loadFile(path.join(__dirname, 'cms-middle-fe', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Auto Updater Logic ──────────────────────────────────────────────────
function setupAutoUpdater() {
  // Chỉ chạy auto-update nếu app đã được packaged (trong môi trường Production)
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    // Có thể thông báo cho người dùng ở đây
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] Update not available.');
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error in auto-updater: ', err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    console.log('[Updater] ' + log_message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded');
    dialog.showMessageBox({
      type: 'info',
      title: 'Cập nhật sẵn sàng',
      message: 'Phiên bản mới đã được tải xuống. Bạn có muốn khởi động lại để cài đặt ngay không?',
      buttons: ['Bây giờ', 'Để sau']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Bắt đầu kiểm tra update
  autoUpdater.checkForUpdatesAndNotify();
}

let resolvedBePort = null;

app.whenReady().then(async () => {
  ipcMain.on('get-local-ip', (event) => {
    event.returnValue = getLocalIP();
  });

  ipcMain.on('get-be-port', (event) => {
    event.returnValue = resolvedBePort;
  });

  ipcMain.on('get-app-version', (event) => {
    event.returnValue = app.getVersion();
  });

  if (!isDev) {
    // Start backend in production
    resolvedBePort = await findFreePort(5050);
    startBackend(resolvedBePort);
  }

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});