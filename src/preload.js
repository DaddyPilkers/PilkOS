const { contextBridge, ipcRenderer } = require('electron');

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
