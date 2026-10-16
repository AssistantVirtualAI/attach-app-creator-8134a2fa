// Root-only local key generation fallback for hosts with Node WebCrypto but no Deno.
// No network, subprocess, publication, timer, service, provider or runtime action.
import { createHash, webcrypto } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, openSync, writeFileSync } from 'node:fs';

const CONFIG = '/etc/lemtel-node-publication';
const STATE = '/var/lib/lemtel-node-publication';
const VERSION = 'lemtel-node-enrollment-v1';
const deny = () => { throw new Error('blocked'); };

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const text = JSON.stringify(value);
  if (text === undefined || (typeof value === 'number' && !Number.isSafeInteger(value))) deny();
  return text;
}
export function b64(value) { return Buffer.from(value).toString('base64url'); }
export function fingerprint(descriptor) {
  if (!descriptor || typeof descriptor.signingKey !== 'string' || typeof descriptor.encryptionKey !== 'string') deny();
  return `sha256:${createHash('sha256').update(`${VERSION}:descriptor\n${canonical(descriptor)}`, 'utf8').digest('hex')}`;
}
export async function generateNodeKeys() {
  const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const encryption = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const descriptor = {
    signingKey: b64(await webcrypto.subtle.exportKey('raw', signing.publicKey)),
    encryptionKey: b64(await webcrypto.subtle.exportKey('raw', encryption.publicKey)),
  };
  if (!/^[-_A-Za-z0-9]{86,88}$/u.test(descriptor.signingKey) || !/^[-_A-Za-z0-9]{86,88}$/u.test(descriptor.encryptionKey) || descriptor.signingKey === descriptor.encryptionKey) deny();
  return {
    descriptor,
    signingPrivate: await webcrypto.subtle.exportKey('jwk', signing.privateKey),
    encryptionPrivate: await webcrypto.subtle.exportKey('jwk', encryption.privateKey),
  };
}
function safeDirectory(path) {
  const meta = lstatSync(path, { throwIfNoEntry: false });
  return !!meta && meta.isDirectory() && !meta.isSymbolicLink() && meta.uid === 0 && meta.gid === 0 && (meta.mode & 0o777) === 0o700;
}
function writeNew(path, value) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, canonical(value), { encoding: 'utf8' });
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  const parent = openSync(path.slice(0, path.lastIndexOf('/')), 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
export async function init({ config = CONFIG, state = STATE } = {}) {
  if (!safeDirectory(config) || !safeDirectory(state) || existsSync(`${config}/keys.json`)) deny();
  const value = await generateNodeKeys();
  writeNew(`${config}/keys.json`, value);
  return fingerprint(value.descriptor);
}
async function main() {
  try {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0 || process.argv.length !== 3 || process.argv[2] !== 'init' || process.env.LEMTEL_NODE_LOCAL_APPROVAL !== 'generate_publication_keys_only') deny();
    const publicFingerprint = await init();
    process.stdout.write(`status=initialized fingerprint=${publicFingerprint}\n`);
  } catch {
    process.stderr.write('status=blocked\n');
    process.exitCode = 78;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
