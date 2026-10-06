import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Credentials (encrypted via electron-store)
  getCredentials: () => ipcRenderer.invoke('get-stored-credentials'),
  saveCredentials: (creds: object) =>
    ipcRenderer.invoke('save-credentials', creds),
  clearCredentials: () => ipcRenderer.invoke('clear-credentials'),

  // Startup diagnostics are local-only and contain no credential payload.
  logRendererCrash: (payload: { scope: string; message: string; stack?: string }) =>
    ipcRenderer.invoke('log-renderer-crash', payload),

  // Notifications
  showNotification: (title: string, body: string, opts?: { tag?: string; urgent?: boolean }) =>
    ipcRenderer.invoke('show-notification', { title, body, tag: opts?.tag, urgent: opts?.urgent }),
  clearNotification: (tag: string) =>
    ipcRenderer.invoke('clear-notification', { tag }),
  onNotificationClicked: (cb: (info: { tag: string }) => void) =>
    ipcRenderer.on('notification-clicked', (_e, i) => cb(i)),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Startup
  setLaunchOnStartup: (enabled: boolean) =>
    ipcRenderer.invoke('set-launch-on-startup', enabled),

  // Tray
  updateTrayStatus: (status: string) =>
    ipcRenderer.invoke('update-tray-status', status),

  // Updates
  getAppVersion: () => ipcRenderer.invoke('updater:app-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (cb: (info: { version: string }) => void) =>
    ipcRenderer.on('update-available', (_e, i) => cb(i)),
  onUpdateProgress: (cb: (p: { percent: number; bps: number }) => void) =>
    ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb: (info: { version: string }) => void) =>
    ipcRenderer.on('update-downloaded', (_e, i) => cb(i)),
  onUpdateError: (cb: (msg: string) => void) =>
    ipcRenderer.on('update-error', (_e, m) => cb(m)),

  // Status from tray / global shortcuts
  onSetStatus: (cb: (status: string) => void) =>
    ipcRenderer.on('set-status', (_e, status) => cb(status)),
  onSetUiStatus: (cb: (status: 'available' | 'busy' | 'meeting' | 'away') => void) =>
    ipcRenderer.on('set-ui-status', (_e, status) => cb(status)),
  onFocusMeetingNote: (cb: () => void) =>
    ipcRenderer.on('focus-meeting-note', () => cb()),

  // Custom protocol (lemtel://call/<number>)
  onProtocolCall: (cb: (data: { number: string }) => void) =>
    ipcRenderer.on('protocol-call', (_e, data) => cb(data)),

  platform: process.platform,
});
