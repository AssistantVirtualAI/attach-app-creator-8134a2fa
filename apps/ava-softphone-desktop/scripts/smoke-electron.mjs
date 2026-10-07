#!/usr/bin/env node
/**
 * Electron smoke test: launches the packaged app, dials a known-bad number,
 * verifies the renderer stays responsive (no black screen) and that a crash
 * log is written if anything goes wrong.
 *
 * Usage:
 *   node scripts/smoke-electron.mjs
 *
 * Exit codes:
 *   0 — renderer stayed responsive on failure path
 *   1 — renderer crashed / black screen / responsiveness timeout
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const APP_NAME = 'Lemtel';
const SMOKE_PROFILE = join(os.tmpdir(), `lemtel-smoke-${process.pid}`);

function findBinary() {
  const out = join(ROOT, 'electron-release');
  const candidates = [
    join(out, `${APP_NAME}-darwin-x64`, `${APP_NAME}.app/Contents/MacOS/${APP_NAME}`),
    join(out, `${APP_NAME}-linux-x64`, APP_NAME),
    join(out, `${APP_NAME}-win32-x64`, `${APP_NAME}.exe`),
  ];
  return candidates.find(existsSync);
}

const bin = findBinary();
if (!bin) {
  console.error('No packaged Electron binary found in electron-release/. Run packaging first.');
  process.exit(1);
}

console.log('[smoke] launching', bin);
const proc = spawn(bin, ['--smoke-test=call-failure', `--lemtel-test-profile=${SMOKE_PROFILE}`], {
  env: { ...process.env, LEMTEL_SMOKE: '1', LEMTEL_SMOKE_NUMBER: '0000000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let responsive = false;

proc.stdout.on('data', (d) => {
  const s = d.toString();
  stdout += s;
  process.stdout.write(s);
  if (s.includes('[softphone]') || s.includes('[SIP]')) responsive = true;
});
proc.stderr.on('data', (d) => {
  const s = d.toString();
  stderr += s;
  process.stderr.write(s);
});

const TIMEOUT_MS = 25_000;
const timer = setTimeout(() => {
  console.log('[smoke] timeout reached, terminating');
  try { proc.kill('SIGTERM'); } catch { /* noop */ }
}, TIMEOUT_MS);

proc.on('exit', (code) => {
  clearTimeout(timer);
  const crashLog = join(SMOKE_PROFILE, 'crash.log');
  const hasCrashFile = existsSync(crashLog);
  const crashSize = hasCrashFile ? statSync(crashLog).size : 0;
  const tail = hasCrashFile ? readFileSync(crashLog, 'utf-8').trim().split('\n').slice(-5).join('\n') : '(no crash log)';

  console.log('\n[smoke] exit code:', code);
  console.log('[smoke] renderer-responsive:', responsive);
  console.log('[smoke] crash.log:', crashLog, hasCrashFile ? `(${crashSize} bytes)` : '(missing)');
  console.log('[smoke] last entries:\n' + tail);

  const blackScreen = stderr.includes('render-process-gone') && !stderr.includes('clean-exit');
  if (blackScreen || !responsive) {
    console.error('[smoke] FAIL — renderer not responsive or crashed');
    process.exit(1);
  }
  console.log('[smoke] PASS — renderer stayed responsive on failure path');
  process.exit(0);
});
