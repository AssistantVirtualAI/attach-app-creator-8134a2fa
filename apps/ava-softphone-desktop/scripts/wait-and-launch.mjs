import { spawn } from 'child_process';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const VITE_URL = 'http://localhost:5173/';
const MAX_WAIT_MS = 60_000;
const POLL_MS = 500;

function isViteReady() {
  return new Promise((resolve) => {
    const req = http.get(VITE_URL, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(400, () => { req.destroy(); resolve(false); });
  });
}

async function waitForVite() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isViteReady()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Vite did not respond on ' + VITE_URL + ' within 60 seconds');
}

console.log('[wait-and-launch] Waiting for Vite at', VITE_URL, '...');
await waitForVite();
console.log('[wait-and-launch] Vite ready — launching Electron');

const appDir = new URL('..', import.meta.url).pathname;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
  cwd: appDir,
});

child.on('exit', (code) => process.exit(code ?? 0));
