const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let windows = [];
const isDev = !app.isPackaged;

function createWindows() {
  const configs = [
    { tab: null, title: 'CMS - Main' },
    { tab: 'alertwall', title: 'CMS - Alert Wall' },
    { tab: 'traffic', title: 'CMS - Traffic' }
  ];

  configs.forEach((config, index) => {
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      x: 100 + index * 50,
      y: 100 + index * 50,
      autoHideMenuBar: true,
      title: config.title,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (isDev) {
      const devUrl = config.tab 
        ? `http://localhost:5173?tab=${config.tab}`
        : 'http://localhost:5173';
      win.loadURL(devUrl);
      win.webContents.openDevTools();
    } else {
      const indexPath = path.join(__dirname, 'cms-middle-fe', 'dist', 'index.html');
      const fileUrl = pathToFileURL(indexPath);
      if (config.tab) {
        fileUrl.search = `?tab=${config.tab}`;
      }
      win.loadURL(fileUrl.href);
    }

    win.on('closed', () => {
      windows = windows.filter(w => w !== win);
    });

    windows.push(win);
  });
}

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (windows.length === 0) {
      createWindows();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
