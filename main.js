const { app, BrowserWindow, ipcMain } = require('electron');
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

function waitForBackend(port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const startTime = Date.now();
    function tryConnect() {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.end();
        resolve();
      });
      client.on('error', () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Backend did not start within ${timeout}ms`));
        } else {
          setTimeout(tryConnect, 300);
        }
      });
    }
    tryConnect();
  });
}

// In dev mode, we assume the backend is started via concurrently or separately.
// For production mode, we might want to start the backend directly here.
const isDev = !app.isPackaged;
let backendProcess = null;

function startBackend(bePort) {
  const osPlatform = os.platform();
  const beExecutableName = osPlatform === 'win32' ? 'node.exe' : 'node';

  const binaryPath = isDev
    ? path.join(__dirname, 'build-be', beExecutableName)
    : path.join(process.resourcesPath, 'bin', beExecutableName);

  const runtimeIP = getLocalIP();
  const logPath = path.join(app.getPath('userData'), 'backend.log');

  if (fs.existsSync(binaryPath)) {
    console.log(`[Electron] Starting Backend Sidecar on port ${bePort}...`, binaryPath);
    fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] --- Starting Backend on port ${bePort} ---\n`);
    
    const executeEnv = { 
      ...process.env, 
      IS_PACKAGED: 'true', 
      USER_DATA_PATH: app.getPath('userData'),
      LOCAL_IP: runtimeIP,
      BE_PORT: bePort
    };
    
    backendProcess = spawn(binaryPath, [], { cwd: path.dirname(binaryPath), env: executeEnv });
    
    backendProcess.stdout.on('data', (data) => {
      const msg = `[BE]: ${data}`;
      console.log(msg);
      fs.appendFileSync(logPath, msg);
    });
    
    backendProcess.stderr.on('data', (data) => {
      const msg = `[BE ERROR]: ${data}`;
      console.error(msg);
      fs.appendFileSync(logPath, msg);
    });

    backendProcess.on('exit', (code, signal) => {
      const msg = `\n[${new Date().toISOString()}] [BE] Process EXITED — code=${code}, signal=${signal}\n`;
      console.error(msg);
      fs.appendFileSync(logPath, msg);
    });

    backendProcess.on('error', (err) => {
      const msg = `\n[${new Date().toISOString()}] [BE] Process ERROR — ${err.message}\n`;
      console.error(msg);
      fs.appendFileSync(logPath, msg);
    });
  } else {
    const errorMsg = `[Electron] Backend sidecar not found at ${binaryPath}`;
    console.error(errorMsg);
    fs.appendFileSync(logPath, `\n[ERROR] ${errorMsg}\n`);
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

let resolvedBePort = null;

app.whenReady().then(async () => {
  ipcMain.on('get-local-ip', (event) => {
    event.returnValue = getLocalIP();
  });

  ipcMain.on('get-be-port', (event) => {
    event.returnValue = resolvedBePort;
  });

  if (!isDev) {
    // Start backend in production
    resolvedBePort = await findFreePort(5050);
    startBackend(resolvedBePort);
    try {
      console.log(`[Electron] Waiting for backend to be ready on port ${resolvedBePort}...`);
      await waitForBackend(resolvedBePort);
      console.log(`[Electron] Backend is ready!`);
    } catch (err) {
      console.error(`[Electron] ${err.message}`);
    }
  }

  createWindow();

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