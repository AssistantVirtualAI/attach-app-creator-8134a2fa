// Library only. All keys/configuration live in one authorized controller's memory.
// No CLI, environment discovery, network calls, logs, files, deployment or mode activation.
export const protocol = Object.freeze({
  keyPath: '/.well-known/lemtel-failover-bootstrap-key',
  bootstrapPath: '/.well-known/lemtel-failover-bootstrap',
  authContext: 'lemtel-failover-bootstrap-auth-v1',
  transportContext: 'lemtel-failover-bootstrap-transport-v1',
  stateContext: 'lemtel-failover-sealed-state-v1',
});
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const encode = (context, value) => new TextEncoder().encode(`${context}\n${canonical(value)}`);
const base64url = (value) => btoa(String.fromCharCode(...new Uint8Array(value)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (part) => part.charCodeAt(0));
const random = (size) => crypto.getRandomValues(new Uint8Array(size));
const revision = (value) => typeof value === 'string' && /^[a-z0-9-]{8,80}$/.test(value);
async function identity(jwk) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ e: jwk.e, kty: jwk.kty, n: jwk.n }))));
}

export async function createBootstrapSession(configRevision) {
  if (!revision(configRevision)) throw new Error('invalid_bootstrap_input');
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const publicJWK = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJWK = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    configRevision,
    publicDescriptor: { format: 'lemtel_failover_bootstrap_key_v1', version: 1,
      algorithm: 'RSA-OAEP-256+A256GCM', kid: await identity(publicJWK), public_jwk: publicJWK },
    // Only the three secret entries may be sent through reviewed runtime SECRET binding APIs.
    secretBindings: { CONFIG_DECRYPTION_PRIVATE_JWK: JSON.stringify(privateJWK),
      BOOTSTRAP_AUTH_SECRET: base64url(random(32)), CONFIG_STATE_ENCRYPTION_KEY: base64url(random(32)) },
    textBindings: { CONFIG_DECRYPTION_PUBLIC_JWK: JSON.stringify(publicJWK), CONFIG_REVISION: configRevision },
  };
}

export async function createBootstrapEnvelope({ session, publicDescriptor, configuration,
  now = Math.floor(Date.now() / 1000), bootstrapTTL = 120, configTTL = 3600, nonce = base64url(random(32)) }) {
  // Pin to the locally generated public key, not merely to whatever the endpoint returns.
  if (canonical(publicDescriptor) !== canonical(session.publicDescriptor) ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(bootstrapTTL) || bootstrapTTL < 1 || bootstrapTTL > 300 ||
      !Number.isSafeInteger(configTTL) || configTTL < bootstrapTTL || configTTL > 3600 ||
      !/^[A-Za-z0-9_-]{43}$/.test(nonce) || decode(nonce).length !== 32) throw new Error('invalid_bootstrap_input');
  const metadata = { format: 'lemtel_failover_bootstrap_v1', version: 1, algorithm: 'RSA-OAEP-256+A256GCM',
    kid: publicDescriptor.kid, config_revision: session.configRevision, nonce,
    issued_at: now, expires_at: now + bootstrapTTL };
  const payload = { format: 'lemtel_failover_protected_config_v1', config_revision: session.configRevision,
    issued_at: now, expires_at: now + configTTL, configuration };
  const label = encode(protocol.transportContext, metadata), transportBytes = random(32), iv = random(12);
  const rsa = await crypto.subtle.importKey('jwk', publicDescriptor.public_jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.importKey('raw', transportBytes, 'AES-GCM', false, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP', label }, rsa, transportBytes);
  transportBytes.fill(0); // Best effort only: JS objects/engine copies cannot be reliably zeroized.
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: label },
    aes, new TextEncoder().encode(JSON.stringify(payload)));
  const envelope = { ...metadata, wrapped_key: base64url(wrapped), iv: base64url(iv), ciphertext: base64url(ciphertext) };
  const auth = await crypto.subtle.importKey('raw', new TextEncoder().encode(session.secretBindings.BOOTSTRAP_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const proof = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', auth, encode(protocol.authContext, envelope))),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { envelope, proof }; // Ciphertext and proof only; no clear configuration in the return value.
}

export async function sealDrillReceipt({ session, receipt, issuedAt, expiresAt }) {
  // Does NOT grant approval or sign a drill. A separately approved signed receipt must be supplied.
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
      expiresAt <= issuedAt || expiresAt - issuedAt > 3600) throw new Error('invalid_bootstrap_input');
  const metadata = { format: 'lemtel_failover_sealed_state_v1', version: 1, algorithm: 'AES-256-GCM', kind: 'drill',
    config_revision: session.configRevision, issued_at: issuedAt, expires_at: expiresAt };
  const iv = random(12), aes = await crypto.subtle.importKey('raw',
    decode(session.secretBindings.CONFIG_STATE_ENCRYPTION_KEY), 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
    additionalData: encode(protocol.stateContext, metadata) }, aes, new TextEncoder().encode(JSON.stringify(receipt)));
  return { ...metadata, iv: base64url(iv), ciphertext: base64url(ciphertext) };
}

const attemptedSessions = new WeakSet();
export async function injectBootstrapConfiguration({ session, configuration, transport,
  enterBootstrap, returnToDisabled, now, bootstrapTTL = 120, configTTL = 3600 }) {
  // Adapters are separately authorized. No real transport or runtime mutation is provided here.
  if (!session || attemptedSessions.has(session) || typeof transport !== 'function' ||
      typeof enterBootstrap !== 'function' || typeof returnToDisabled !== 'function') throw new Error('bootstrap_injection_rejected');
  attemptedSessions.add(session); // No retries, including after an unknown response or failed reset.
  let accepted = false;
  try {
    await enterBootstrap(); // This callback may set ONLY bootstrap, never active.
    const keyResponse = await transport({ method: 'GET', path: protocol.keyPath });
    if (keyResponse.status !== 200) throw new Error('invalid');
    const publicDescriptor = await keyResponse.json();
    const { envelope, proof } = await createBootstrapEnvelope({ session, publicDescriptor,
      configuration, now, bootstrapTTL, configTTL });
    const response = await transport({ method: 'POST', path: protocol.bootstrapPath,
      headers: { 'content-type': 'application/json', 'x-lemtel-bootstrap-proof': proof }, body: JSON.stringify(envelope) });
    if (response.status !== 201) throw new Error('invalid');
    accepted = true;
  } catch { throw new Error('bootstrap_injection_rejected'); }
  finally {
    try { await returnToDisabled(); } catch { throw new Error('bootstrap_disabled_reset_unconfirmed'); }
  }
  return { state: accepted ? 'bootstrap_injected' : 'blocked', failover_mode: 'disabled',
    automatic_promotion_enabled: false, automatic_runtime_start_enabled: false,
    automatic_traffic_routing_enabled: false, automatic_failback_enabled: false };
}
