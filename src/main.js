const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const loudness = require('loudness');
const wifi = require('node-wifi');
let mainWindow;

try {
  // Auto-reload in development without clearing data/cache.
  require('electron-reload')(__dirname, {
    electron: require(path.join(__dirname, '..', 'node_modules', 'electron')),
    awaitWriteFinish: true,
    ignored: [/\.md$/i, /\.txt$/i],
  });
} catch (error) {
  // No-op: electron-reload is a dev dependency.
}

wifi.init({ iface: null });

async function createMainWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'pilkos-logo.ico');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    resizable: true,
    frame: true,
    show: false,
    backgroundColor: '#10141f',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const { session } = mainWindow.webContents;
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') {
      callback(true);
      return;
    }
    callback(false);
  });
  session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'geolocation') {
      return true;
    }
    return false;
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('system-audio:get', async () => {
  const volume = await loudness.getVolume();
  const muted = await loudness.getMuted();
  return { volume, muted };
});

ipcMain.handle('system-audio:set-volume', async (event, volume) => {
  const nextVolume = Math.max(0, Math.min(100, Math.round(Number(volume))));
  await loudness.setVolume(nextVolume);
  const muted = await loudness.getMuted();
  return { volume: nextVolume, muted };
});

ipcMain.handle('system-audio:set-muted', async (event, muted) => {
  await loudness.setMuted(Boolean(muted));
  const currentMuted = await loudness.getMuted();
  return { muted: currentMuted };
});

ipcMain.handle('system-wifi:list', async () => {
  try {
    const networks = await wifi.scan();
    return Array.isArray(networks) ? networks : [];
  } catch (err) {
    return [];
  }
});

ipcMain.handle('window:set-size', async (event, width, height) => {
  if (!mainWindow) return null;
  const nextWidth = Math.round(Number(width));
  const nextHeight = Math.round(Number(height));
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) return null;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }
  const [minWidth, minHeight] = mainWindow.getMinimumSize();
  const clampedWidth = Math.max(minWidth || 0, nextWidth);
  const clampedHeight = Math.max(minHeight || 0, nextHeight);
  mainWindow.setContentSize(clampedWidth, clampedHeight);
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  return { width: contentWidth, height: contentHeight };
});

ipcMain.handle('window:get-size', async () => {
  if (!mainWindow) return null;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  return { width: contentWidth, height: contentHeight };
});

app.whenReady().then(async () => {
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
