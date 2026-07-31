export {};

declare global {
  interface Window {
    electronAPI: {
      getCredentials: () => Promise<any>;
      saveCredentials: (creds: object | null) => Promise<boolean>;
      clearCredentials: () => Promise<boolean>;
      showNotification: (title: string, body: string, opts?: { tag?: string; urgent?: boolean }) => Promise<void>;
      clearNotification: (tag: string) => Promise<void>;
      onNotificationClicked?: (cb: (info: { tag: string }) => void) => void;
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      setLaunchOnStartup: (enabled: boolean) => Promise<void>;
      updateTrayStatus: (status: string) => Promise<void>;
      getAppVersion: () => Promise<string>;
      checkForUpdates: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateAvailable: (cb: (info: { version: string }) => void) => void;
      onUpdateProgress: (cb: (p: { percent: number; bps: number }) => void) => void;
      onUpdateDownloaded: (cb: (info: { version: string }) => void) => void;
      onUpdateError?: (cb: (msg: string) => void) => void;
      onSetStatus: (cb: (s: string) => void) => void;
      onSetUiStatus: (cb: (s: 'available' | 'busy' | 'meeting' | 'away') => void) => void;
      onFocusMeetingNote: (cb: () => void) => void;
      platform: NodeJS.Platform;
    };
  }
}
