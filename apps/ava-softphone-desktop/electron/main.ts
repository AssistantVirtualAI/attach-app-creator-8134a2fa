import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Notification,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';
import path from 'path';
import fs from 'fs';
import { setupTray, updateTrayStatus } from './tray';

// Auto-updater: download silently in background, install on quit
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const APP_NAME = 'Lemtel';
const store = new Store();
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

app.setName(APP_NAME);

// ---------- Crash log persistence ----------
const CRASH_LOG_PATH = path.join(app.getPath('userData'), 'crash.log');
function writeCrashLog(scope: string, payload: Record<string, unknown>) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    scope,
    ...payload,
  }) + '\n';
  try {
    fs.appendFileSync(CRASH_LOG_PATH, line);
  } catch (e) {
    console.error('[main] Failed to write crash log:', e);
  }
  console.error(`[crash:${scope}]`, payload);
}

// ---------- Crash recovery: prevent renderer crashes from killing the app ----------
process.on('uncaughtException', (error) => {
  writeCrashLog('uncaughtException', { message: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason: any) => {
  writeCrashLog('unhandledRejection', { reason: String(reason?.message || reason), stack: reason?.stack });
});

app.on('render-process-gone', (_event, _webContents, details) => {
  writeCrashLog('render-process-gone', { reason: details.reason, exitCode: details.exitCode });
  if (details.reason !== 'clean-exit' && mainWindow) {
    setTimeout(() => {
      try {
        if (process.env.NODE_ENV === 'development') {
          mainWindow?.loadURL('http://localhost:5173');
        } else {
          mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
        }
      } catch (e: any) {
        writeCrashLog('reload-failed', { message: e?.message });
      }
    }, 1000);
  }
});

app.on('child-process-gone', (_event, details) => {
  writeCrashLog('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode });
});

// IPC: renderer-side crashes flow here too.
ipcMain.handle('log-renderer-crash', (_e, payload: Record<string, unknown>) => {
  writeCrashLog('renderer', payload);
});
ipcMain.handle('get-crash-log-path', () => CRASH_LOG_PATH);
ipcMain.handle('read-crash-log', () => {
  try { return fs.existsSync(CRASH_LOG_PATH) ? fs.readFileSync(CRASH_LOG_PATH, 'utf-8') : ''; }
  catch { return ''; }
});

// Register lemtel:// custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('lemtel', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('lemtel');
}

// Ensure single-instance so protocol launches focus the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function handleProtocolUrl(url: string | undefined) {
  if (!url || !url.startsWith('lemtel://')) return;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'call') {
      const number = parsed.pathname.replace(/^\//, '');
      mainWindow?.webContents.send('protocol-call', { number });
    }
  } catch {
    /* ignore malformed protocol urls */
  }
}

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  const url = commandLine.find((arg) => arg.startsWith('lemtel://'));
  handleProtocolUrl(url);
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  handleProtocolUrl(url);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 440,
    height: 760,
    minWidth: 320,
    minHeight: 600,
    maxWidth: 1200,
    resizable: true,
    frame: false,
    transparent: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    alwaysOnTop: false,
    skipTaskbar: false,
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}


// Bypass self-signed SSL certificates for FusionPBX WSS
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.includes('lemtel.lemtel.tel') || url.includes('pbxnode.lemtel.tel') || url.includes('170.39.199.132') || url.includes('lemtelcloud.net')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.whenReady().then(() => {
  // Grant microphone/media permissions on the default session BEFORE any
  // window is created — required so getUserMedia() does not reject in Electron.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set(['media', 'mediaKeySystem', 'microphone', 'audioCapture', 'videoCapture', 'notifications']);
    callback(allowed.has(permission as string));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'microphone', 'audioCapture', 'videoCapture', 'notifications'].includes(permission);
  });

  createWindow();
  setupTray(mainWindow);

  // Global keyboard shortcuts for status switching (works even when hidden)
  const statusShortcuts: [string, string][] = [
    ['CmdOrCtrl+Shift+1', 'available'],
    ['CmdOrCtrl+Shift+2', 'busy'],
    ['CmdOrCtrl+Shift+3', 'meeting'],
    ['CmdOrCtrl+Shift+4', 'away'],
  ];
  for (const [accel, uiStatus] of statusShortcuts) {
    const ok = globalShortcut.register(accel, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('set-ui-status', uiStatus);
      }
    });
    if (!ok) console.warn(`[main] Failed to register global shortcut: ${accel}`);
  }

  // Global shortcut to focus / toggle the meeting note field
  const meetingNoteOk = globalShortcut.register('CmdOrCtrl+Shift+M', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('focus-meeting-note');
    }
  });
  if (!meetingNoteOk) console.warn('[main] Failed to register global shortcut: CmdOrCtrl+Shift+M');

  // Auto-grant media/notification permissions to our own window's session too.
  const winSession = mainWindow?.webContents.session;
  if (winSession) {
    winSession.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = new Set([
        'media',
        'audioCapture',
        'videoCapture',
        'notifications',
        'background-sync',
        'clipboard-read',
      ]);
      callback(allowed.has(permission));
    });
    winSession.setPermissionCheckHandler((_wc, permission) => {
      return ['media', 'audioCapture', 'videoCapture', 'notifications'].includes(permission);
    });
  }

  // macOS: trigger native OS prompts for microphone & camera (TCC). Speaker
  // output never requires authorization. On Windows/Linux this is a no-op.
  if (process.platform === 'darwin' && systemPreferences?.askForMediaAccess) {
    systemPreferences.askForMediaAccess('microphone').catch(() => { /* noop */ });
    systemPreferences.askForMediaAccess('camera').catch(() => { /* noop */ });
  }

  if (store.get('launchOnStartup', true)) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* offline or no release channel — ignore */
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});

// ---------- IPC ----------
ipcMain.handle('get-stored-credentials', () => store.get('credentials', null));
ipcMain.handle('save-credentials', (_e, credentials) => {
  store.set('credentials', credentials);
  return true;
});
ipcMain.handle('clear-credentials', () => {
  store.delete('credentials');
  return true;
});

// Tagged notifications so we can dismiss them on answer/hangup.
const activeNotifications = new Map<string, Notification>();

ipcMain.handle('show-notification', (_e, { title, body, tag, urgent }: { title: string; body: string; tag?: string; urgent?: boolean }) => {
  // Replace existing notification with the same tag.
  if (tag && activeNotifications.has(tag)) {
    try { activeNotifications.get(tag)?.close(); } catch { /* noop */ }
    activeNotifications.delete(tag);
  }
  const notification = new Notification({
    title,
    body,
    icon: path.join(__dirname, '../assets/icon.png'),
    urgency: urgent ? 'critical' : 'normal',
  });
  notification.show();
  notification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    if (tag) {
      mainWindow?.webContents.send('notification-clicked', { tag });
    }
  });
  notification.on('close', () => {
    if (tag) activeNotifications.delete(tag);
  });
  if (tag) activeNotifications.set(tag, notification);
});

ipcMain.handle('clear-notification', (_e, { tag }: { tag: string }) => {
  const n = activeNotifications.get(tag);
  if (n) {
    try { n.close(); } catch { /* noop */ }
    activeNotifications.delete(tag);
  }
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.hide());
ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url));

ipcMain.handle('set-launch-on-startup', (_e, enabled: boolean) => {
  store.set('launchOnStartup', enabled);
  app.setLoginItemSettings({ openAtLogin: enabled });
});

ipcMain.handle('update-tray-status', (_e, status: string) => {
  updateTrayStatus(status);
});

// ---------- Auto-updater ----------
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', { version: info.version });
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('update-progress', {
    percent: Math.round(progress.percent),
    bps: progress.bytesPerSecond,
  });
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-downloaded', { version: info.version });
});
autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('update-error', err?.message ?? String(err));
});
// preload uses 'updater:install' — keep both channel names for compatibility
ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall(false, true));
ipcMain.handle('install-update',  () => autoUpdater.quitAndInstall(false, true));
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates());
