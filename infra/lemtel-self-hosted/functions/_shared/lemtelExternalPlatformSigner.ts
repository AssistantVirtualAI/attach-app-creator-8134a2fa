// Lemtel external signer client. No HTTP endpoint, secret persistence, logging or fallback signer.
import { b64, canonical, empty, exact, fingerprintOK, unb64, type Challenge, type Delivery, type Sealed } from "./lemtelNodeEnrollment.ts";

const PURPOSE = "node_enrollment_publication_delivery";
const ISSUER = "lemtel-node-enrollment-authority-v1";
const AUDIENCE = "lemtel-platform-signer-v1";
const SOCKET_PATH = "/run/lemtel-platform-signer/relay.sock";
const MAX_REQUEST_BYTES = 6144;
const MAX_RESPONSE_BYTES = 4096;
const DEADLINE_MS = 2000;
const hex64 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

export type ExternalSignerAuthority = { key: JsonWebKey; keyId: string };
export type ExternalSignerRequest = {
  purpose: typeof PURPOSE;
  requestId: string;
  role: "do_writer" | "hostinger_standby";
  recipientFingerprint: string;
  sealed: Sealed;
  authorization: string;
};

export function externalSignerEnabled(): boolean {
  return Deno.env.get("LEMTEL_EXTERNAL_PLATFORM_SIGNER_ENABLED") === "approved_delivery_only";
}

export function externalSignerAuthority(raw: string | undefined, keyId: string | undefined): ExternalSignerAuthority | undefined {
  if (!raw || !hex64(keyId)) return undefined;
  try {
    const key = JSON.parse(raw);
    if (!key || typeof key !== "object" || key.kty !== "EC" || key.crv !== "P-256" || typeof key.d !== "string" || !/^[A-Za-z0-9_-]+$/.test(key.d)) return undefined;
    return { key, keyId };
  } catch { return undefined; }
}

async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function delivery(value: unknown, expected: ExternalSignerRequest): Delivery {
  if (!exact(value, ["sealed", "signature"]) || canonical(value.sealed) !== canonical(expected.sealed) || typeof value.signature !== "string") throw new Error("external_signer_rejected");
  unb64(value.signature, 64);
  return value as Delivery;
}

export async function authorizationToken(authority: ExternalSignerAuthority, sealed: Sealed, challenge: Challenge, now: number): Promise<string> {
  if (challenge.purpose !== "claim" || !uuid(challenge.requestId) || !fingerprintOK(challenge.fingerprint) || !hex64(authority.keyId)) throw new Error("external_signer_rejected");
  const header = b64(new TextEncoder().encode(canonical({ alg: "ES256", kid: authority.keyId, typ: "JWT" })));
  const payload = b64(new TextEncoder().encode(canonical({
    aud: AUDIENCE,
    challenge,
    exp: now + 90,
    fp: challenge.fingerprint,
    iat: now,
    iss: ISSUER,
    jti: crypto.randomUUID(),
    nbf: now,
    purpose: PURPOSE,
    rid: challenge.requestId,
    role: challenge.role,
    sealedDigest: await sha256(canonical(sealed)),
  })));
  const key = await crypto.subtle.importKey("jwk", authority.key, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`)));
  if (signature.length !== 86) throw new Error("external_signer_rejected");
  return `${header}.${payload}.${signature}`;
}

async function withDeadline<T>(work: Promise<T>, close: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => { timer = setTimeout(() => { try { close(); } finally { reject(new Error("external_signer_timeout")); } }, DEADLINE_MS); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function writeAll(connection: Deno.Conn, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.length) {
    const written = await withDeadline(connection.write(value.subarray(offset)), () => connection.close());
    if (written < 1) throw new Error("external_signer_rejected");
    offset += written;
  }
}

async function readAll(connection: Deno.Conn): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const buffer = new Uint8Array(1024);
    const count = await withDeadline(connection.read(buffer), () => connection.close());
    if (count === null) break;
    if (count < 0) throw new Error("external_signer_rejected");
    if (count === 0) continue;
    total += count;
    if (total > MAX_RESPONSE_BYTES) throw new Error("external_signer_rejected");
    chunks.push(buffer.subarray(0, count));
  }
  const merged = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

export async function exchangeExternalSigner(request: ExternalSignerRequest, send: (raw: string) => Promise<string>): Promise<Delivery> {
  if (request.purpose !== PURPOSE || !uuid(request.requestId) || !fingerprintOK(request.recipientFingerprint) || request.sealed.challenge.requestId !== request.requestId || request.sealed.challenge.role !== request.role || request.sealed.challenge.fingerprint !== request.recipientFingerprint) throw new Error("external_signer_rejected");
  const raw = canonical(request);
  if (raw.length > MAX_REQUEST_BYTES) throw new Error("external_signer_rejected");
  const reply = await send(raw);
  const parsed = JSON.parse(reply);
  if (canonical(parsed) !== reply) throw new Error("external_signer_rejected");
  return delivery(parsed, request);
}

export async function requestExternalSignerDelivery(request: ExternalSignerRequest): Promise<Delivery> {
  return await exchangeExternalSigner(request, async (raw) => {
    const connection = await Deno.connect({ transport: "unix", path: SOCKET_PATH });
    try {
      const message = new TextEncoder().encode(raw);
      const frame = new Uint8Array(4 + message.byteLength);
      new DataView(frame.buffer).setUint32(0, message.byteLength, false);
      frame.set(message, 4);
      await writeAll(connection, frame);
      await withDeadline(connection.closeWrite(), () => connection.close());
      return await readAll(connection);
    } finally { connection.close(); }
  });
}

export const externalSignerUnavailable = () => empty(503);
