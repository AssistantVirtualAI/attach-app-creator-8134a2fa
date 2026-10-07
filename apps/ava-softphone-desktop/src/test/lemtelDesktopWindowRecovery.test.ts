import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../electron/main.ts'), 'utf8');

describe('Lemtel Desktop window recovery', () => {
  it('reveals the workspace from renderer lifecycle events', () => {
    expect(mainSource).toContain("mainWindow.webContents.on('did-fail-load'");
    expect(mainSource).toContain("mainWindow.webContents.once('did-finish-load'");
    expect(mainSource).toContain("mainWindow.once('ready-to-show'");
    expect(mainSource).toContain('revealWindow(\'did-fail-load\')');
    expect(mainSource).toContain('revealWindow(\'did-finish-load\')');
    expect(mainSource).toContain('revealWindow(\'ready-to-show\')');
  });

  it('uses a bounded visible-window fallback and local diagnostics', () => {
    expect(mainSource).toContain("writeCrashLog('window-show-timeout'");
    expect(mainSource).toContain("revealWindow('window-show-timeout')");
    expect(mainSource).toContain('}, 5000);');
  });
});
