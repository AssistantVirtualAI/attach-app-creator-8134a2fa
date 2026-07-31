import { spawn } from 'child_process';
import { createConnection } from 'net';

const VITE_PORT = 5173;
const MAX_WAIT_MS = 30_000;
const POLL_MS = 300;

function isViteReady() {
  return new Promise((resolve) => {
    const sock = createConnection({ port: VITE_PORT, host: '127.0.0.1' });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
  });
}

async function waitForVite() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isViteReady()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Vite did not start within 30 seconds');
}

console.log('[wait-and-launch] Waiting for Vite on port', VITE_PORT, '...');
await waitForVite();
console.log('[wait-and-launch] Vite ready — launching Electron');

const electronBin = new URL('../node_modules/.bin/electron', import.meta.url).pathname;
const child = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});

child.on('exit', (code) => process.exit(code ?? 0));
