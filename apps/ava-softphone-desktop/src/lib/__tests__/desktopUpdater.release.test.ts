import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Static contract: native Electron update installation cannot run in JSDOM.
// The actual signed install/restart remains a mandatory Windows/macOS smoke test.
const source = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
const install = source.slice(source.indexOf('function doInstallUpdate()'), source.indexOf("ipcMain.handle('updater:install'"));

describe('Desktop updater installation safety', () => {
  it('refuses to install before the download is complete', () => {
    expect(source).toContain("autoUpdater.on('update-downloaded'");
    expect(source).toContain('updateReady = true');
    expect(install).toContain('if (!updateReady)');
    expect(install).toContain('return false');
  });

  it('lets the signed platform installer control restart instead of forcing exit', () => {
    expect(install).toContain('autoUpdater.quitAndInstall(false, true)');
    expect(install).not.toMatch(/app\.relaunch\s*\(|process\.exit\s*\(|\.destroy\s*\(/);
    expect(install).toContain("mainWindow?.webContents.send('update-error'");
  });
});
