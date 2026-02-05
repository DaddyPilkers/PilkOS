const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const configNodeModules = path.join(__dirname, '..', 'config', 'node_modules');
if (!module.paths.includes(configNodeModules)) {
  module.paths.push(configNodeModules);
}
const { autoUpdater } = require('electron-updater');
const loudness = require('loudness');
const wifi = require('node-wifi');
let mainWindow;

const isDev =
  !app.isPackaged ||
  process.env.NODE_ENV === 'development' ||
  process.argv.includes('--dev');

ipcMain.on('runtime:is-dev', (event) => {
  event.returnValue = isDev;
});

if (isDev) {
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
}

wifi.init({ iface: null });

function sendUpdateStatus(state, detail = null) {
  if (!mainWindow) return;
  mainWindow.webContents.send('updates:status', { state, detail });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', { version: info?.version || '' });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('download-progress', {
      percent: Math.round(Number(progress?.percent) || 0),
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('downloaded', { version: info?.version || '' });
  });

  autoUpdater.on('error', (error) => {
    sendUpdateStatus('error', { message: error?.message || 'Update error' });
  });
}

async function createMainWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'pilkos-logo.ico');
  const preloadPath = isDev
    ? path.join(__dirname, 'preload.js')
    : (fs.existsSync(path.join(app.getAppPath(), 'preload.js'))
        ? path.join(app.getAppPath(), 'preload.js')
        : path.join(app.getAppPath(), 'src', 'preload.js'));
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
      preload: preloadPath,
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

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('updates:check', async () => {
  try {
    if (!app.isPackaged && !isDev) {
      sendUpdateStatus('disabled', { message: 'Updates are available in packaged builds only.' });
      return { state: 'disabled' };
    }
    await autoUpdater.checkForUpdates();
    return { state: 'checking' };
  } catch (error) {
    sendUpdateStatus('error', { message: error?.message || 'Update check failed' });
    return { state: 'error' };
  }
});

ipcMain.handle('updates:install', async () => {
  if (!app.isPackaged) {
    sendUpdateStatus('disabled', { message: 'Install is disabled in dev builds.' });
    return { state: 'disabled' };
  }
  try {
    autoUpdater.quitAndInstall();
    return { state: 'installing' };
  } catch (error) {
    sendUpdateStatus('error', { message: error?.message || 'Update install failed' });
    return { state: 'error' };
  }
});

app.whenReady().then(async () => {
  await createMainWindow();
  if (app.isPackaged || isDev) {
    setupAutoUpdater();
  } else {
    sendUpdateStatus('disabled', { message: 'Updates are available in packaged builds only.' });
  }

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
