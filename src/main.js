const path = require('path');
const fs = require('fs');
const https = require('https');
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const configNodeModules = path.join(__dirname, '..', 'config', 'node_modules');
if (!module.paths.includes(configNodeModules)) {
  module.paths.push(configNodeModules);
}
const { autoUpdater } = require('electron-updater');
const loudness = require('loudness');
const wifi = require('node-wifi');
let mainWindow;

const UPDATE_REPO = {
  owner: 'DaddyPilkers',
  repo: 'PilkOS',
};

let lastGithubCheck = {
  isNewer: false,
  version: null,
  checkedAt: 0,
};

const normalizeVersion = (value) => {
  if (!value) return [];
  const cleaned = String(value).trim().replace(/^v/i, '');
  return cleaned
    .split(/[.+-]/)
    .map((part) => parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
};

const compareVersions = (a, b) => {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
};

const fetchLatestReleaseTag = (timeoutMs = 8000) => new Promise((resolve) => {
  const { owner, repo } = UPDATE_REPO;
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${owner}/${repo}/releases/latest`,
    method: 'GET',
    headers: {
      'User-Agent': 'PilkOS',
      'Accept': 'application/vnd.github+json',
    },
  };
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        finish(null);
        return;
      }
      try {
        const data = JSON.parse(body);
        const tag = data?.tag_name || data?.name;
        finish(tag ? String(tag) : null);
      } catch (error) {
        finish(null);
      }
    });
  });
  req.on('error', () => {
    if (timeoutId) clearTimeout(timeoutId);
    finish(null);
  });
  const timeoutId = setTimeout(() => {
    try {
      req.destroy(new Error('timeout'));
    } catch (error) {
      // Ignore destroy errors.
    }
    finish(null);
  }, Math.max(1000, Number(timeoutMs) || 8000));
  req.end();
});

const isDev =
  !app.isPackaged ||
  process.env.NODE_ENV === 'development' ||
  process.argv.includes('--dev');

app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

ipcMain.on('runtime:is-dev', (event) => {
  event.returnValue = isDev;
});

const devWatchers = [];
let devReloadTimer = null;

function requestDevRendererReload() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (devReloadTimer) clearTimeout(devReloadTimer);
  devReloadTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.webContents.reloadIgnoringCache();
    } catch (error) {
      // Ignore reload failures in dev mode.
    }
  }, 180);
}

function setupDevRendererReload() {
  if (!isDev) return;
  if (devWatchers.length > 0) return;

  const shouldIgnore = (filename) => {
    if (!filename) return true;
    const name = String(filename);
    return /\.(md|txt)$/i.test(name);
  };

  const watchDirs = [
    __dirname,
    path.join(__dirname, '..', 'assets'),
  ];

  watchDirs.forEach((dir) => {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (shouldIgnore(filename)) return;
        requestDevRendererReload();
      });
      devWatchers.push(watcher);
    } catch (error) {
      // Ignore watch failures; dev reload will simply be unavailable for that path.
    }
  });
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
    sendUpdateStatus('checking', { source: 'autoUpdater' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', {
      version: info?.version || '',
      releaseName: info?.releaseName || '',
      releaseDate: info?.releaseDate || '',
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    if (!isDev) {
      if (lastGithubCheck.isNewer) {
        return;
      }
      sendUpdateStatus('not-available', {
        version: info?.version || '',
        releaseName: info?.releaseName || '',
        releaseDate: info?.releaseDate || '',
      });
      return;
    }
    fetchLatestReleaseTag()
      .then((tag) => {
        if (tag) {
          sendUpdateStatus('available-dev', { version: tag });
        } else {
          sendUpdateStatus('not-available');
        }
      })
      .catch(() => {
        sendUpdateStatus('not-available');
      });
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
  const preloadStatus = {
    path: preloadPath,
    exists: fs.existsSync(preloadPath),
    error: null,
  };
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
      sandbox: false,
      preload: preloadPath,
    },
  });

  const { session } = mainWindow.webContents;
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'geolocation') {
      callback(true);
      return;
    }
    if (permission === 'display-capture') {
      callback(true);
      return;
    }
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'geolocation') {
      return true;
    }
    if (permission === 'display-capture') {
      return true;
    }
    if (permission === 'media') {
      return true;
    }
    return false;
  });

  session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const primarySource = sources[0];
      if (!primarySource) {
        callback({ video: null });
        return;
      }
      callback({
        video: primarySource,
        audio: undefined,
      });
    } catch (error) {
      callback({ video: null });
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Append "(Dev Build)" to the titlebar in development (npm start) only
  if (isDev) {
    const devSuffix = ' (Dev Build)';
    // Prevent page title updates from replacing our dev suffix and set the title
    mainWindow.webContents.on('page-title-updated', (event, title) => {
      try {
        event.preventDefault();
        const next = (typeof title === 'string' && title.length > 0) ? title + devSuffix : 'PilkOS' + devSuffix;
        mainWindow.setTitle(next);
      } catch (error) {
        // Ignore title update errors in dev mode
      }
    });
    try {
      const initial = mainWindow.getTitle() || 'PilkOS';
      mainWindow.setTitle(initial + devSuffix);
    } catch (error) {
      // Ignore
    }
  }
  mainWindow.webContents.on('preload-error', (event, preloadPathValue, error) => {
    preloadStatus.error = {
      path: preloadPathValue || preloadStatus.path,
      message: error?.message || String(error),
    };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const payload = JSON.stringify(preloadStatus);
    mainWindow.webContents.executeJavaScript(`window.__preloadStatus = ${payload};`, true).catch(() => {});
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setupDevRendererReload();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    devWatchers.forEach((watcher) => {
      try {
        watcher.close();
      } catch (error) {
        // Ignore watcher close errors.
      }
    });
    devWatchers.length = 0;
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
    const debugInfo = {
      isDev: !!isDev,
      isPackaged: !!app.isPackaged,
    };
    sendUpdateStatus('debug', debugInfo);
    if (isDev) {
      sendUpdateStatus('checking');
      const tag = await fetchLatestReleaseTag();
      if (tag) {
        const detail = { version: tag, debug: debugInfo };
        sendUpdateStatus('available-dev', detail);
        return { state: 'available-dev', detail };
      } else {
        const detail = { debug: debugInfo };
        sendUpdateStatus('not-available', detail);
        return { state: 'not-available', detail };
      }
    }
    if (!app.isPackaged && !isDev) {
      const detail = {
        message: 'Updates are available in packaged builds only.',
        debug: debugInfo,
      };
      sendUpdateStatus('disabled', detail);
      return { state: 'disabled', detail };
    }
    lastGithubCheck = { isNewer: false, version: null, checkedAt: Date.now() };
    sendUpdateStatus('checking');
    const latestTag = await fetchLatestReleaseTag();
    const currentVersion = app.getVersion();
    const isNewer = latestTag
      ? compareVersions(latestTag, currentVersion) > 0
      : false;
    lastGithubCheck = {
      isNewer,
      version: latestTag || null,
      checkedAt: Date.now(),
    };
    if (isNewer) {
      const detail = { version: latestTag, source: 'github' };
      sendUpdateStatus('available', detail);
      autoUpdater.checkForUpdates().catch(() => {});
      return { state: 'available', detail };
    }
    const detail = {
      version: latestTag || '',
      source: 'github',
      current: currentVersion,
    };
    sendUpdateStatus('not-available', detail);
    return { state: 'not-available', detail };
  } catch (error) {
    const detail = { message: error?.message || 'Update check failed' };
    sendUpdateStatus('error', detail);
    return { state: 'error', detail };
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

ipcMain.handle('capture:get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id || null,
  }));
});

ipcMain.handle('capture:window-snapshot', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const image = await mainWindow.webContents.capturePage();
    if (!image) return null;
    return image.toDataURL();
  } catch (error) {
    return null;
  }
});

app.whenReady().then(async () => {
  await createMainWindow();
  if (app.isPackaged) {
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
