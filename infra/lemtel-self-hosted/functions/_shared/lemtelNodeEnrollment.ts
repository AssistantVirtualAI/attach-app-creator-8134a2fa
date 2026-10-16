// Lemtel publication-only protocol. No environment, filesystem, transport or logging.
export const VERSION = "lemtel-node-enrollment-v1";
export type Role = "do_writer" | "hostinger_standby";
export type Descriptor = { signingKey: string; encryptionKey: string };
export type Challenge = { requestId: string; role: Role; fingerprint: string; purpose: "attest" | "claim"; nonce: string; expiresAt: number };
export type Sealed = { challenge: Challenge; ephemeralKey: string; iv: string; ciphertext: string };
export type Delivery = { sealed: Sealed; signature: string };
export type PublicationConfig = { format: "lemtel-node-publication-v1"; requestId: string; role: Role; fingerprint: string; endpoint: string; grantedUntil: number };
export const encoder = new TextEncoder();
export const bytes = (value: string) => encoder.encode(value);
export const deny = (): never => { throw new Error("enrollment_rejected"); };
export const role = (v: unknown): v is Role => v === "do_writer" || v === "hostinger_standby";
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const fingerprintOK = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
export function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  const text = JSON.stringify(value);
  if (text === undefined || (typeof value === "number" && !Number.isSafeInteger(value))) return deny();
  return text;
}
export function b64(value: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return deny();
  const result = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (v) => v.charCodeAt(0));
  if (b64(result) !== value || (length !== undefined && result.length !== length)) return deny();
  return result;
}
export async function validateDescriptor(value: unknown): Promise<Descriptor> {
  if (!exact(value, ["signingKey", "encryptionKey"])) return deny();
  const signing = unb64(value.signingKey, 65), encryption = unb64(value.encryptionKey, 65);
  if (signing[0] !== 4 || encryption[0] !== 4 || value.signingKey === value.encryptionKey) return deny();
  await crypto.subtle.importKey("raw", signing, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  await crypto.subtle.importKey("raw", encryption, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return { signingKey: value.signingKey as string, encryptionKey: value.encryptionKey as string };
}
export async function fingerprint(descriptor: Descriptor): Promise<string> {
  await validateDescriptor(descriptor);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(`${VERSION}:descriptor\n${canonical(descriptor)}`)));
  return "sha256:" + Array.from(hash, (v) => v.toString(16).padStart(2, "0")).join("");
}
export function validateChallenge(value: unknown, now: number): Challenge {
  if (!exact(value, ["requestId", "role", "fingerprint", "purpose", "nonce", "expiresAt"]) || !uuid(value.requestId) || !role(value.role) || !fingerprintOK(value.fingerprint)
    || (value.purpose !== "attest" && value.purpose !== "claim") || typeof value.nonce !== "string" || !/^[a-f0-9]{64}$/.test(value.nonce)
    || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= now || (value.expiresAt as number) > now + 300) return deny();
  return value as Challenge;
}
export function transcript(purpose: string, payload: unknown): Uint8Array<ArrayBuffer> {
  if (!["attest", "claim", "observe", "seal", "delivery"].includes(purpose)) return deny();
  return bytes(`${VERSION}:${purpose}\n${canonical(payload)}`);
}
export async function generateNodeKeys() {
  // Called only by a future explicitly approved local root action, never during import.
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const encryption = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const descriptor = { signingKey: b64(await crypto.subtle.exportKey("raw", signing.publicKey)), encryptionKey: b64(await crypto.subtle.exportKey("raw", encryption.publicKey)) };
  return { descriptor, signingPrivate: await crypto.subtle.exportKey("jwk", signing.privateKey), encryptionPrivate: await crypto.subtle.exportKey("jwk", encryption.privateKey) };
}
export async function signProof(key: JsonWebKey, purpose: string, payload: unknown): Promise<string> {
  const privateKey = await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, transcript(purpose, payload)));
}
export async function verifyProof(descriptor: Descriptor, purpose: string, payload: unknown, signature: unknown): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", unb64(descriptor.signingKey, 65), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(signature, 64), transcript(purpose, payload));
  } catch { return false; }
}
export function publicationEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 253) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.port === "" && u.username === "" && u.password === "" && u.search === "" && u.hash === ""
      && u.pathname === "/functions/v1/lemtel-node-status-signed-ingest" && u.href === value
      && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname);
  } catch { return false; }
}
export function validateConfig(value: unknown, challenge: Challenge, now: number): PublicationConfig {
  if (!exact(value, ["format", "requestId", "role", "fingerprint", "endpoint", "grantedUntil"]) || value.format !== "lemtel-node-publication-v1"
    || !uuid(value.requestId) || !role(value.role) || !fingerprintOK(value.fingerprint)
    || value.requestId !== challenge.requestId || value.role !== challenge.role || value.fingerprint !== challenge.fingerprint
    || !publicationEndpoint(value.endpoint) || !Number.isSafeInteger(value.grantedUntil) || (value.grantedUntil as number) <= now || (value.grantedUntil as number) > now + 3600) return deny();
  return value as PublicationConfig;
}
/** Same six fields/order as PR #275, but local input uses sorted canonical JSON. Never probe a runtime. */
export function observationText(value: unknown, now: number): string {
  if (!exact(value, ["nodeRole", "observedAt", "agentState", "runtimeState", "replicationState", "storageState"]) || !role(value.nodeRole)
    || typeof value.observedAt !== "string" || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(value.observedAt)
    || !["healthy", "degraded", "unknown"].includes(value.agentState as string) || !["ready", "degraded", "unknown"].includes(value.runtimeState as string)
    || !["streaming", "degraded", "unknown"].includes(value.replicationState as string) || !["synced", "degraded", "unknown"].includes(value.storageState as string)) return deny();
  const time = Date.parse(value.observedAt);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value.observedAt || time < Date.UTC(2026, 0, 1)
    || time >= Date.UTC(2100, 0, 1) || time > now * 1000 || time < (now - 180) * 1000) return deny();
  return JSON.stringify({ nodeRole: value.nodeRole, observedAt: value.observedAt, agentState: value.agentState, runtimeState: value.runtimeState, replicationState: value.replicationState, storageState: value.storageState });
}
async function derive(privateKey: CryptoKey, publicKey: CryptoKey, challenge: Challenge, usages: KeyUsage[]): Promise<CryptoKey> {
  const material = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
  try {
    const hkdf = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: bytes(challenge.nonce), info: transcript("seal", challenge) }, hkdf, { name: "AES-GCM", length: 256 }, false, usages);
  } finally { material.fill(0); }
}
export async function sealConfig(descriptor: Descriptor, challenge: Challenge, config: PublicationConfig, now: number): Promise<Sealed> {
  validateChallenge(challenge, now);
  if (challenge.purpose !== "claim" || await fingerprint(descriptor) !== challenge.fingerprint) return deny();
  validateConfig(config, challenge, now);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const recipient = await crypto.subtle.importKey("raw", unb64(descriptor.encryptionKey, 65), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const aes = await derive(ephemeral.privateKey, recipient, challenge, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: transcript("seal", challenge), tagLength: 128 }, aes, bytes(canonical(config)));
  return { challenge, ephemeralKey: b64(await crypto.subtle.exportKey("raw", ephemeral.publicKey)), iv: b64(iv), ciphertext: b64(ciphertext) };
}
export async function openConfig(encryptionPrivate: JsonWebKey, sealed: Sealed, expected: Challenge, now: number): Promise<PublicationConfig> {
  validateChallenge(expected, now);
  if (!exact(sealed, ["challenge", "ephemeralKey", "iv", "ciphertext"]) || expected.purpose !== "claim" || canonical(sealed.challenge) !== canonical(expected)) return deny();
  const privateKey = await crypto.subtle.importKey("jwk", encryptionPrivate, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephemeral = await crypto.subtle.importKey("raw", unb64(sealed.ephemeralKey, 65), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const aes = await derive(privateKey, ephemeral, expected, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv, 12), additionalData: transcript("seal", expected), tagLength: 128 }, aes, unb64(sealed.ciphertext));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(plain), value = JSON.parse(text);
  if (canonical(value) !== text) return deny();
  return validateConfig(value, expected, now);
}
export async function signDelivery(sealed: Sealed, platformPrivate: JsonWebKey): Promise<Delivery> {
  return { sealed, signature: await signProof(platformPrivate, "delivery", sealed) };
}
export async function openDelivery(encryptionPrivate: JsonWebKey, delivery: Delivery, expected: Challenge, platformPublic: string, endpointPin: string, now: number): Promise<PublicationConfig> {
  if (!exact(delivery, ["sealed", "signature"]) || !publicationEndpoint(endpointPin)
    || !await verifyProof({ signingKey: platformPublic, encryptionKey: "" }, "delivery", delivery.sealed, delivery.signature)) return deny();
  const config = await openConfig(encryptionPrivate, delivery.sealed, expected, now);
  if (config.endpoint !== endpointPin) return deny();
  return config;
}
export async function boundedJSON(req: Request, limit = 2048): Promise<Record<string, unknown> | null> {
  const length = req.headers.get("Content-Length");
  if (!req.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))) return null;
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  const deadline = Date.now() + 2000;
  let size = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        if (Date.now() >= deadline) return null;
        next = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("enrollment_rejected")), Math.max(1, deadline - Date.now())); })]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
    const raw = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw), value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) && canonical(value) === text ? value : null;
  } catch { return null; } finally { try { await reader.cancel(); } catch { /* no output */ } reader.releaseLock(); }
}
export const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const empty = (status: number) => new Response(null, { status, headers });
export const response = (value: unknown, status = 200) => new Response(canonical(value), { status, headers: { ...headers, "Content-Type": "application/json" } });
