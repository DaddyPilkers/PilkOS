const { contextBridge, ipcRenderer } = require('electron');

let runtimeIsDev = false;
try {
  runtimeIsDev = !!ipcRenderer.sendSync('runtime:is-dev');
} catch (error) {
  runtimeIsDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
}

contextBridge.exposeInMainWorld('pilkOSSystemAudio', {
  getStatus: () => ipcRenderer.invoke('system-audio:get'),
  setVolume: (volume) => ipcRenderer.invoke('system-audio:set-volume', volume),
  setMuted: (muted) => ipcRenderer.invoke('system-audio:set-muted', muted),
});

contextBridge.exposeInMainWorld('pilkOSWifi', {
  listNetworks: () => ipcRenderer.invoke('system-wifi:list'),
});

contextBridge.exposeInMainWorld('pilkOSWindow', {
  setSize: (width, height) => ipcRenderer.invoke('window:set-size', width, height),
  getSize: () => ipcRenderer.invoke('window:get-size'),
});

contextBridge.exposeInMainWorld('pilkOSApp', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
});

contextBridge.exposeInMainWorld('pilkOSUpdates', {
  check: () => ipcRenderer.invoke('updates:check'),
  install: () => ipcRenderer.invoke('updates:install'),
  onStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
});

contextBridge.exposeInMainWorld('pilkOSRuntime', {
  isDev: runtimeIsDev,
});

contextBridge.exposeInMainWorld('pilkOSCapture', {
  getSources: async () => ipcRenderer.invoke('capture:get-sources'),
  captureWindow: async () => ipcRenderer.invoke('capture:window-snapshot'),
});

contextBridge.exposeInMainWorld('pilkOSPreloadStatus', {
  loaded: true,
  versions: {
    electron: process?.versions?.electron || '',
    chrome: process?.versions?.chrome || '',
    node: process?.versions?.node || '',
  },
});
