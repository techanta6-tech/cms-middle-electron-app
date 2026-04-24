const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalIP: () => ipcRenderer.sendSync('get-local-ip'),
  getBePort: () => ipcRenderer.sendSync('get-be-port'),
  getAppVersion: () => ipcRenderer.sendSync('get-app-version')
});
