// Lemtel platform signer — source-only, closed unless every runtime gate is configured.
// One encrypted node-enrollment delivery shape only; all unrelated operations
// are outside the allowed interface.

const MAX_BODY_BYTES = 6144;
const MAX_AUTHORIZATION_BYTES = 2048;
const MAX_ACCESS_JWKS_BYTES = 16384;
const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 600;
const MAX_AUTHORIZATION_LIFETIME_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 15;
const PURPOSE = 'node_enrollment_publication_delivery';
const SIGNER_HOST = 'signer.lemtel.assistantvirtualai.com';
const SIGNER_PATH = '/v1/node-enrollment-delivery';
const AUTHORIZATION_ISSUER = 'lemtel-node-enrollment-authority-v1';
const AUTHORIZATION_AUDIENCE = 'lemtel-platform-signer-v1';
const DELIVERY_CONTEXT = 'lemtel-node-enrollment-v1:delivery';
const REPLAY_CONTEXT = 'lemtel-platform-signer-replay-v2';
const noStore = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'text/plain; charset=utf-8',
  'x-content-type-options': 'nosniff',
});
const jsonHeaders = Object.freeze({ ...noStore, 'content-type': 'application/json' });
const empty = (status) => new Response('', { status, headers: noStore });
const json = (value) => new Response(canonical(value), { status: 200, headers: jsonHeaders });
const text = new TextEncoder();
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hex64 = /^[a-f0-9]{64}$/u;
const b64url = /^[A-Za-z0-9_-]+$/u;
const roles = new Set(['digitalocean_writer', 'hostinger_standby']);

class Deny extends Error {}

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Deny();
}

function rawB64(value) {
  if (typeof value !== 'string' || !b64url.test(value)) throw new Deny();
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    if (encodeB64(bytes) !== value) throw new Deny();
    return bytes;
  } catch (error) { if (error instanceof Deny) throw error; throw new Deny(); }
}

function encodeB64(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function boundedString(value, maximum) {
  if (typeof value !== 'string' || !value || value.length > maximum) throw new Deny();
  return value;
}

function boundedCanonicalB64(value, minimum, maximum) {
  const encoded = boundedString(value, maximum);
  if (encoded.length < minimum) throw new Deny();
  rawB64(encoded);
  return encoded;
}

function sealed(value) {
  if (!exact(value, ['challenge', 'ephemeralKey', 'iv', 'ciphertext'])) return false;
  try {
    boundedCanonicalB64(value.challenge, 43, 43); // 32-byte challenge
    boundedCanonicalB64(value.ephemeralKey, 87, 87); // uncompressed P-256 point
    boundedCanonicalB64(value.iv, 16, 16); // 96-bit AES-GCM IV
    boundedCanonicalB64(value.ciphertext, 22, 2800); // authenticated ciphertext
    return true;
  } catch { return false; }
}

async function boundedText(request, maximum) {
  if (!request.body) throw new Deny();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximum) throw new Deny();
      chunks.push(item.value);
    }
  } finally {
    if (size > maximum) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!size) throw new Deny();
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}

function parseCanonicalRequest(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Deny(); }
  if (canonical(value) !== raw || !exact(value, ['purpose', 'requestId', 'role', 'recipientFingerprint', 'sealed', 'authorization'])) throw new Deny();
  if (
    value.purpose !== PURPOSE || typeof value.requestId !== 'string' || !uuidV4.test(value.requestId) ||
    typeof value.role !== 'string' || !roles.has(value.role) || typeof value.recipientFingerprint !== 'string' || !hex64.test(value.recipientFingerprint) ||
    !sealed(value.sealed)
  ) throw new Deny();
  boundedString(value.authorization, MAX_AUTHORIZATION_BYTES);
  return value;
}

function parsedJwkSet(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ACCESS_JWKS_BYTES) throw new Deny();
  let value;
  try { value = JSON.parse(raw); } catch { throw new Deny(); }
  if (!exact(value, ['keys']) || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 3) throw new Deny();
  for (const key of value.keys) {
    if (!key || typeof key !== 'object' || key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig' || typeof key.kid !== 'string' || !hex64.test(key.kid) || typeof key.n !== 'string' || typeof key.e !== 'string') throw new Deny();
  }
  return value.keys;
}

function parsedAuthorizationJwk(raw, expectedKid) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024 || typeof expectedKid !== 'string' || !hex64.test(expectedKid)) throw new Deny();
  let key;
  try { key = JSON.parse(raw); } catch { throw new Deny(); }
  if (!key || typeof key !== 'object' || key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' || key.use !== 'sig' || key.kid !== expectedKid || typeof key.x !== 'string' || typeof key.y !== 'string' || Object.prototype.hasOwnProperty.call(key, 'd')) throw new Deny();
  rawB64(key.x); rawB64(key.y);
  return key;
}

function configuration(env) {
  if (env?.SIGNER_MODE !== 'active') return null;
  const team = env?.ACCESS_TEAM_DOMAIN;
  const audience = env?.ACCESS_POLICY_AUD;
  const commonName = env?.MTLS_RELAY_COMMON_NAME;
  const fingerprint = env?.MTLS_RELAY_CERT_SHA256;
  const authorizationKeyId = env?.ENROLLMENT_AUTHORIZATION_KEY_ID;
  if (
    typeof team !== 'string' || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/u.test(team) ||
    typeof audience !== 'string' || !hex64.test(audience) ||
    typeof commonName !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,62}$/u.test(commonName) ||
    typeof fingerprint !== 'string' || !hex64.test(fingerprint) ||
    typeof authorizationKeyId !== 'string' || !hex64.test(authorizationKeyId)
  ) throw new Deny();
  return {
    team, audience, commonName, fingerprint, authorizationKeyId,
    accessKeys: parsedJwkSet(env?.ACCESS_JWKS_JSON),
    authorizationKey: parsedAuthorizationJwk(env?.ENROLLMENT_AUTHORIZATION_PUBLIC_JWK, authorizationKeyId),
  };
}

function jwtPayload(token, algorithm) {
  if (typeof token !== 'string' || token.length > MAX_AUTHORIZATION_BYTES) throw new Deny();
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part || !b64url.test(part))) throw new Deny();
  try {
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawB64(parts[0])));
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawB64(parts[1])));
    if (!exact(header, ['alg', 'kid', 'typ']) || header.alg !== algorithm || header.typ !== 'JWT' || typeof header.kid !== 'string' || !hex64.test(header.kid)) throw new Deny();
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new Deny();
    return { header, payload, signed: `${parts[0]}.${parts[1]}`, signature: rawB64(parts[2]) };
  } catch (error) { if (error instanceof Deny) throw error; throw new Deny(); }
}

function verifyMtls(request, value) {
  const client = request.cf?.tlsClientAuth;
  if (!client || client.certVerified !== 'SUCCESS' || client.certPresented !== '1' || client.certRevoked !== '0') throw new Deny();
  if (client.certFingerprintSHA256 !== value.fingerprint || client.certSubjectDNRFC2253 !== `CN=${value.commonName}`) throw new Deny();
}

function validLifetime(payload, now, maximum) {
  return Number.isSafeInteger(payload.exp) && Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.nbf) &&
    payload.nbf <= payload.iat && payload.iat <= payload.exp && payload.exp > now && payload.exp <= now + maximum &&
    payload.iat >= now - maximum && payload.iat <= now + CLOCK_SKEW_SECONDS && payload.nbf <= now + CLOCK_SKEW_SECONDS;
}

async function verifyAccess(request, value, now) {
  verifyMtls(request, value);
  const token = jwtPayload(request.headers.get('cf-access-jwt-assertion'), 'RS256');
  const payload = token.payload;
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== value.team || !audience.includes(value.audience) || !validLifetime(payload, now, MAX_ACCESS_TOKEN_LIFETIME_SECONDS)) throw new Deny();
  const key = value.accessKeys.find((candidate) => candidate.kid === token.header.kid);
  if (!key) throw new Deny();
  try {
    const imported = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, token.signature, text.encode(token.signed))) throw new Deny();
    return payload.exp;
  } catch (error) { if (error instanceof Deny) throw error; throw new Deny(); }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', text.encode(value));
  return Array.from(new Uint8Array(bytes), (part) => part.toString(16).padStart(2, '0')).join('');
}

async function verifyAuthorization(value, config, now) {
  const token = jwtPayload(value.authorization, 'ES256');
  const payload = token.payload;
  const sealedDigest = await digest(canonical(value.sealed));
  if (
    token.header.kid !== config.authorizationKeyId || payload.iss !== AUTHORIZATION_ISSUER || payload.aud !== AUTHORIZATION_AUDIENCE || payload.purpose !== PURPOSE ||
    typeof payload.jti !== 'string' || !uuidV4.test(payload.jti) || payload.rid !== value.requestId ||
    payload.fp !== value.recipientFingerprint || payload.role !== value.role || payload.challenge !== value.sealed.challenge ||
    payload.sealedDigest !== sealedDigest || !validLifetime(payload, now, MAX_AUTHORIZATION_LIFETIME_SECONDS)
  ) throw new Deny();
  try {
    const imported = await crypto.subtle.importKey('jwk', config.authorizationKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, token.signature, text.encode(token.signed))) throw new Deny();
    return { authorizationId: payload.jti, expiresAt: payload.exp, sealedDigest };
  } catch (error) { if (error instanceof Deny) throw error; throw new Deny(); }
}

async function claimReplay(env, requestId, requestText, expiresAt) {
  if (!env?.REPLAY_LEDGER || typeof env.REPLAY_LEDGER.getByName !== 'function') throw new Deny();
  const requestDigest = await digest(`${REPLAY_CONTEXT}\n${requestText}`);
  const response = await env.REPLAY_LEDGER.getByName(requestId).fetch('https://lemtel-replay-ledger/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: canonical({ requestId, digest: requestDigest, expiresAt }),
  });
  if (response.status !== 204) throw new Deny();
}

async function signerKey(env) {
  if (!env?.PLATFORM_SIGNING_PRIVATE_JWK || typeof env.PLATFORM_SIGNING_PRIVATE_JWK.get !== 'function') throw new Deny();
  let jwk;
  try { jwk = JSON.parse(await env.PLATFORM_SIGNING_PRIVATE_JWK.get()); } catch { throw new Deny(); }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string' || !b64url.test(jwk.d)) throw new Deny();
  try { return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); } catch { throw new Deny(); }
}

async function signDelivery(value, authorization, env) {
  const delivery = Object.freeze({
    authorizationId: authorization.authorizationId, expiresAt: authorization.expiresAt, nodeRole: value.role,
    recipientFingerprint: value.recipientFingerprint, requestId: value.requestId, sealed: value.sealed, sealedDigest: authorization.sealedDigest,
  });
  const key = await signerKey(env);
  try {
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(`${DELIVERY_CONTEXT}\n${canonical(delivery)}`));
    const encoded = encodeB64(signature);
    if (encoded.length !== 86 || !b64url.test(encoded)) throw new Deny();
    return { delivery, signature: encoded };
  } catch (error) { if (error instanceof Deny) throw error; throw new Deny(); }
}

export class LemtelSignerReplayLedger {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/claim' || request.headers.get('content-type') !== 'application/json') return empty(404);
    try {
      const raw = await boundedText(request, 512);
      const value = JSON.parse(raw);
      const now = Math.floor(Date.now() / 1000);
      if (canonical(value) !== raw || !exact(value, ['requestId', 'digest', 'expiresAt']) || typeof value.requestId !== 'string' || !uuidV4.test(value.requestId) || typeof value.digest !== 'string' || !hex64.test(value.digest) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + MAX_ACCESS_TOKEN_LIFETIME_SECONDS) throw new Deny();
      let accepted = false;
      await this.state.storage.transaction(async (store) => {
        const existing = await store.get('claim');
        if (existing && existing.expiresAt > now) return;
        if (existing) await store.delete('claim');
        await store.put('claim', { digest: value.digest, expiresAt: value.expiresAt });
        await store.setAlarm(value.expiresAt * 1000);
        accepted = true;
      });
      return accepted ? new Response(null, { status: 204, headers: noStore }) : empty(409);
    } catch { return empty(409); }
  }
  async alarm() { await this.state.storage.deleteAll(); }
}

function expectedRequest(request) {
  const url = new URL(request.url);
  return url.protocol === 'https:' && url.hostname === SIGNER_HOST && !url.port && url.pathname === SIGNER_PATH && !url.search && !url.hash;
}

export function createPlatformSigner({ now = () => Math.floor(Date.now() / 1000) } = {}) {
  return async (request, env) => {
    let active;
    try { active = configuration(env); } catch { return empty(503); }
    if (!active) return empty(404);
    if (!expectedRequest(request) || request.method !== 'POST' || request.headers.get('content-type') !== 'application/json' || request.headers.has('origin') || request.headers.has('sec-fetch-mode')) return empty(404);
    try {
      const raw = await boundedText(request, MAX_BODY_BYTES);
      const value = parseCanonicalRequest(raw);
      const epoch = now();
      const accessExpiresAt = await verifyAccess(request, active, epoch);
      const authorization = await verifyAuthorization(value, active, epoch);
      await claimReplay(env, value.requestId, raw, Math.min(accessExpiresAt, authorization.expiresAt));
      return json(await signDelivery(value, authorization, env));
    } catch { return empty(409); }
  };
}

export default Object.freeze({
  fetch(request, env) { return createPlatformSigner()(request, env); },
  scheduled() {},
});
