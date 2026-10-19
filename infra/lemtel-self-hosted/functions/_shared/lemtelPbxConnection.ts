// Lemtel PBX connection core (FusionPBX first) — pure logic shared by the portal admin function and the
// client provisioning function. Ringotel-like model: one connection profile per organization, one
// extension assignment per user, secrets write-only and encrypted at rest with a server-only key.
// Nothing here logs, returns or persists a secret in clear text.

export const CONNECTION_STATES = ["draft", "validated", "active", "suspended"] as const;
export type ConnectionState = typeof CONNECTION_STATES[number];
export const SIP_TRANSPORTS = ["udp", "tcp", "tls"] as const;
export const SRTP_MODES = ["dtls_srtp", "sdes", "none"] as const;
export const MANAGEMENT_MODES = ["none", "fusionpbx_api"] as const;
export const SECRET_KINDS = ["turn_shared_secret", "fusionpbx_api_key"] as const;
export type SecretKind = typeof SECRET_KINDS[number];
export const CODECS = ["opus", "G722", "PCMU", "PCMA", "G729"] as const;

export type ConnectionSettings = {
  vendor: "fusionpbx";
  sipDomain: string;
  pbxHost: string;
  sipTransport: typeof SIP_TRANSPORTS[number];
  sipPort: number;
  wssUrl: string;
  outboundProxy: string | null;
  stunUrls: string[];
  turnUrls: string[];
  registrationExpires: number;
  codecs: string[];
  srtpMode: typeof SRTP_MODES[number];
  managementMode: typeof MANAGEMENT_MODES[number];
  managementBaseUrl: string | null;
};

export type Invalid = { error: string };
export const isInvalid = (v: unknown): v is Invalid => typeof v === "object" && v !== null && "error" in v;

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const EXTENSION_RE = /^[0-9]{2,8}$/;
const AUTH_USER_RE = /^[A-Za-z0-9._@+-]{1,64}$/;
const DISPLAY_RE = /^[^\u0000-\u001f<>"\\]{1,64}$/u;

function host(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return HOST_RE.test(v) || IPV4_RE.test(v) ? v : null;
}
function port(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}
function url(value: unknown, schemes: string[]): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { return null; }
  if (!schemes.includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (!host(parsed.hostname)) return null;
  return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "" : "/");
}
/** stun:/turn:/turns: URI (RFC 7064/7065), no credentials embedded. */
function iceUrl(value: unknown, turn: boolean): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const re = turn
    ? /^(turns?):([a-z0-9.-]{1,253})(?::(\d{1,5}))?(\?transport=(udp|tcp))?$/i
    : /^(stun):([a-z0-9.-]{1,253})(?::(\d{1,5}))?$/i;
  const m = re.exec(v);
  if (!m || !host(m[2]) || (m[3] && !port(Number(m[3])))) return null;
  return v;
}
function list(value: unknown, max: number, each: (v: unknown) => string | null): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const item of value) { const v = each(item); if (!v) return null; if (!out.includes(v)) out.push(v); }
  return out;
}

const SETTINGS_KEYS = ["vendor", "sipDomain", "pbxHost", "sipTransport", "sipPort", "wssUrl", "outboundProxy", "stunUrls", "turnUrls",
  "registrationExpires", "codecs", "srtpMode", "managementMode", "managementBaseUrl"];

/** Strict validation of the non-secret connection profile. Unknown keys are refused (no secret can sneak in). */
export function parseSettings(raw: unknown): ConnectionSettings | Invalid {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "invalid_settings" };
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) if (!SETTINGS_KEYS.includes(key)) return { error: `unexpected_field_${key.replace(/[^A-Za-z]/g, "").slice(0, 32)}` };
  if ((r.vendor ?? "fusionpbx") !== "fusionpbx") return { error: "invalid_vendor" };
  const sipDomain = host(r.sipDomain); if (!sipDomain || IPV4_RE.test(sipDomain)) return { error: "invalid_sip_domain" };
  const pbxHost = host(r.pbxHost); if (!pbxHost) return { error: "invalid_pbx_host" };
  const sipTransport = (r.sipTransport ?? "tls") as ConnectionSettings["sipTransport"];
  if (!SIP_TRANSPORTS.includes(sipTransport)) return { error: "invalid_sip_transport" };
  const sipPort = port(r.sipPort ?? (sipTransport === "tls" ? 5061 : 5060)); if (!sipPort) return { error: "invalid_sip_port" };
  const wssUrl = url(r.wssUrl, ["wss:"]); if (!wssUrl) return { error: "invalid_wss_url_wss_required" };
  let outboundProxy: string | null = null;
  if (r.outboundProxy !== undefined && r.outboundProxy !== null && r.outboundProxy !== "") {
    const m = typeof r.outboundProxy === "string" ? /^([a-z0-9.-]+):(\d{1,5})$/i.exec(r.outboundProxy.trim()) : null;
    if (!m || !host(m[1]) || !port(Number(m[2]))) return { error: "invalid_outbound_proxy" };
    outboundProxy = `${m[1].toLowerCase()}:${Number(m[2])}`;
  }
  const stunUrls = list(r.stunUrls, 4, (v) => iceUrl(v, false)); if (!stunUrls) return { error: "invalid_stun_urls" };
  const turnUrls = list(r.turnUrls, 4, (v) => iceUrl(v, true)); if (!turnUrls) return { error: "invalid_turn_urls" };
  const registrationExpires = r.registrationExpires ?? 300;
  if (typeof registrationExpires !== "number" || !Number.isInteger(registrationExpires) || registrationExpires < 60 || registrationExpires > 3600) return { error: "invalid_registration_expires" };
  const codecs = list(r.codecs ?? ["opus", "PCMU", "PCMA"], 5, (v) => (typeof v === "string" && (CODECS as readonly string[]).includes(v) ? v : null));
  if (!codecs || codecs.length === 0) return { error: "invalid_codecs" };
  const srtpMode = (r.srtpMode ?? "dtls_srtp") as ConnectionSettings["srtpMode"];
  if (!SRTP_MODES.includes(srtpMode)) return { error: "invalid_srtp_mode" };
  const managementMode = (r.managementMode ?? "none") as ConnectionSettings["managementMode"];
  if (!MANAGEMENT_MODES.includes(managementMode)) return { error: "invalid_management_mode" };
  let managementBaseUrl: string | null = null;
  if (managementMode === "fusionpbx_api") {
    managementBaseUrl = url(r.managementBaseUrl, ["https:"]);
    if (!managementBaseUrl) return { error: "invalid_management_base_url_https_required" };
  }
  return { vendor: "fusionpbx", sipDomain, pbxHost, sipTransport, sipPort, wssUrl, outboundProxy, stunUrls, turnUrls,
    registrationExpires, codecs, srtpMode, managementMode, managementBaseUrl };
}

export type AssignmentInput = { userId: string; extension: string; authUsername: string | null; displayName: string | null; isTest: boolean };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseAssignment(raw: unknown): AssignmentInput | Invalid {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "invalid_assignment" };
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) if (!["userId", "extension", "authUsername", "displayName", "isTest"].includes(key)) return { error: "invalid_assignment" };
  if (typeof r.userId !== "string" || !UUID_RE.test(r.userId)) return { error: "invalid_user" };
  if (typeof r.extension !== "string" || !EXTENSION_RE.test(r.extension)) return { error: "invalid_extension" };
  const authUsername = r.authUsername === undefined || r.authUsername === null || r.authUsername === "" ? null : String(r.authUsername);
  if (authUsername !== null && !AUTH_USER_RE.test(authUsername)) return { error: "invalid_auth_username" };
  const displayName = r.displayName === undefined || r.displayName === null || r.displayName === "" ? null : String(r.displayName).trim();
  if (displayName !== null && !DISPLAY_RE.test(displayName)) return { error: "invalid_display_name" };
  return { userId: r.userId.toLowerCase(), extension: r.extension, authUsername, displayName, isTest: r.isTest === true };
}

/** A secret is accepted only as printable ASCII of a sane length; it is never echoed back. */
export function parseSecret(value: unknown, min = 8): string | Invalid {
  if (typeof value !== "string") return { error: "invalid_secret" };
  if (value.length < min || value.length > 256 || !/^[\x21-\x7e]+$/.test(value)) return { error: "invalid_secret" };
  return value;
}

// ---------- encryption at rest (AES-256-GCM, key only in the function environment) ----------
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export type SecretKey = { key: CryptoKey; version: number };
/** LEMTEL_PBX_SECRET_ENCRYPTION_KEY = base64 of 32 random bytes; LEMTEL_PBX_SECRET_KEY_VERSION = integer. */
export async function loadSecretKey(env: (name: string) => string | undefined): Promise<SecretKey | null> {
  const raw = env("LEMTEL_PBX_SECRET_ENCRYPTION_KEY") ?? "";
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = unb64(raw.trim()); } catch { return null; }
  if (bytes.length !== 32) return null;
  const version = Number(env("LEMTEL_PBX_SECRET_KEY_VERSION") ?? "1");
  if (!Number.isInteger(version) || version < 1 || version > 1000) return null;
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { key, version };
}
/** The ciphertext is bound to its row (aad) so it cannot be moved to another organization or user. */
export async function sealSecret(k: SecretKey, plaintext: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, k.key, new TextEncoder().encode(plaintext)));
  return `v${k.version}.${b64(iv)}.${b64(ct)}`;
}
export async function openSecret(k: SecretKey, sealed: string, aad: string): Promise<string | null> {
  const m = /^v(\d+)\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)$/.exec(sealed);
  if (!m || Number(m[1]) !== k.version) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(m[2]), additionalData: new TextEncoder().encode(aad) }, k.key, unb64(m[3]));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
export const secretAad = (organizationId: string, kind: string) => `lemtel-pbx:${organizationId}:${kind}`;
export const extensionAad = (organizationId: string, userId: string, extension: string) => `lemtel-ext:${organizationId}:${userId}:${extension}`;

// ---------- TURN short-lived credentials (coturn use-auth-secret / TURN REST API) ----------
export async function turnCredential(sharedSecret: string, subject: string, ttlSeconds: number, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${subject}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sharedSecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username)));
  return { username, credential: b64(sig), ttlSeconds };
}

// ---------- readiness: what the portal shows and what unlocks activation ----------
export type ValidationCheck = { key: string; status: "ok" | "failed" | "skipped"; detail: string };
export type ValidationReport = { checkedAt: string; checks: ValidationCheck[]; passed: boolean };

export type ConnectionRow = ConnectionSettings & { state: ConnectionState; revision: number; lastValidation: ValidationReport | null };

/** Maps a lemtel_pbx_connections row (snake_case) to the typed profile. */
export function rowFromDb(r: Record<string, unknown> | null): ConnectionRow | null {
  if (!r) return null;
  return {
    vendor: "fusionpbx", sipDomain: String(r.sip_domain), pbxHost: String(r.pbx_host), sipTransport: r.sip_transport as ConnectionRow["sipTransport"],
    sipPort: Number(r.sip_port), wssUrl: String(r.wss_url), outboundProxy: (r.outbound_proxy as string | null) ?? null,
    stunUrls: (r.stun_urls as string[]) ?? [], turnUrls: (r.turn_urls as string[]) ?? [], registrationExpires: Number(r.registration_expires),
    codecs: (r.codecs as string[]) ?? [], srtpMode: r.srtp_mode as ConnectionRow["srtpMode"], managementMode: r.management_mode as ConnectionRow["managementMode"],
    managementBaseUrl: (r.management_base_url as string | null) ?? null, state: r.state as ConnectionRow["state"], revision: Number(r.revision),
    lastValidation: (r.last_validation as ConnectionRow["lastValidation"]) ?? null,
  };
}

/** Activation needs: a saved profile, a passing validation (WSS + SIP + one test registration) not older than 24 h. */
export function activationBlocker(row: ConnectionRow | null, now = Date.now()): string | null {
  if (!row) return "connection_not_configured";
  if (row.state === "active") return null;
  const v = row.lastValidation;
  if (!v || !v.passed) return "validation_not_passed";
  if (now - Date.parse(v.checkedAt) > 24 * 3600 * 1000) return "validation_expired_revalidate";
  return null;
}

/** Client-facing descriptor (no secret). The SIP password and TURN credential are added by the caller only when allowed. */
export function clientTelephony(row: ConnectionRow, assignment: { extension: string; authUsername: string | null; displayName: string | null }, fallbackDisplayName: string) {
  return {
    sipDomain: row.sipDomain,
    extension: assignment.extension,
    authorizationUser: assignment.authUsername ?? assignment.extension,
    displayName: assignment.displayName ?? fallbackDisplayName,
    wssUrls: [row.wssUrl],
    outboundProxy: row.outboundProxy,
    registerExpires: row.registrationExpires,
    codecs: row.codecs,
    srtpMode: row.srtpMode,
  };
}

// ---------- minimal SIP-over-WebSocket client for validation (RFC 7118) ----------
// MD5 is required by SIP digest (RFC 2617/3261) and is not in WebCrypto; compact RFC 1321 implementation.
export function md5(input: string): string {
  const msg = new TextEncoder().encode(input);
  const len = msg.length;
  const words = new Uint32Array((((len + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= msg[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[words.length - 2] = (len * 8) >>> 0;
  words[words.length - 1] = Math.floor(len / 0x20000000);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < words.length; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b;
      const sum = (a + f + K[i] + words[off + g]) >>> 0;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((x) => Array.from({ length: 4 }, (_, i) => ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}

export function parseChallenge(header: string): Record<string, string> | null {
  const m = /^Digest\s+(.*)$/i.exec(header.trim());
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const part of m[1].matchAll(/([a-zA-Z]+)=("([^"]*)"|[^,\s]+)/g)) out[part[1].toLowerCase()] = part[3] ?? part[2];
  return out.realm && out.nonce ? out : null;
}
export function digestAuthorization(ch: Record<string, string>, user: string, password: string, method: string, uri: string, cnonce: string): string {
  const ha1 = md5(`${user}:${ch.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = (ch.qop ?? "").split(",").map((q) => q.trim()).includes("auth") ? "auth" : "";
  const nc = "00000001";
  const response = qop ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${ch.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (ch.opaque) h += `, opaque="${ch.opaque}"`;
  return h;
}

export type SipResponse = { status: number; headers: Record<string, string> };
export function parseSipResponse(text: string): SipResponse | null {
  const [head] = text.split("\r\n\r\n");
  const lines = head.split("\r\n");
  const m = /^SIP\/2\.0 (\d{3}) /.exec(lines[0] ?? "");
  if (!m) return null;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in headers)) headers[k] = line.slice(i + 1).trim(); }
  }
  return { status: Number(m[1]), headers };
}

const token = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, n * 2);

export type SipRequestSpec = { method: "OPTIONS" | "REGISTER"; domain: string; user: string; callId: string; cseq: number; expires?: number; authorization?: string; branch: string; tag: string; viaHost: string };
export function buildSipRequest(s: SipRequestSpec): string {
  const ruri = s.method === "REGISTER" ? `sip:${s.domain}` : `sip:${s.domain}`;
  const from = `<sip:${s.user}@${s.domain}>;tag=${s.tag}`;
  const lines = [
    `${s.method} ${ruri} SIP/2.0`,
    `Via: SIP/2.0/WSS ${s.viaHost};branch=z9hG4bK${s.branch};rport`,
    `Max-Forwards: 70`,
    `From: ${from}`,
    `To: <sip:${s.user}@${s.domain}>`,
    `Call-ID: ${s.callId}`,
    `CSeq: ${s.cseq} ${s.method}`,
    `User-Agent: Lemtel-Portal-Validator/1.0`,
  ];
  if (s.method === "REGISTER") {
    lines.push(`Contact: <sip:${s.user}@${s.viaHost};transport=ws>;expires=${s.expires ?? 0}`, `Expires: ${s.expires ?? 0}`);
  }
  if (s.authorization) lines.push(`Authorization: ${s.authorization}`);
  lines.push(`Content-Length: 0`, ``, ``);
  return lines.join("\r\n");
}

/** Minimal WebSocket surface (Deno/browser), injectable for tests. */
export type SocketLike = { send(data: string): void; close(): void; onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onerror: ((ev: unknown) => void) | null; onclose: ((ev: unknown) => void) | null; protocol?: string };
export type SocketFactory = (url: string, protocol: string) => SocketLike;

/** Opens the WSS endpoint with the "sip" subprotocol, then runs a conversation; every step is time-bounded. */
export async function sipSession<T>(factory: SocketFactory, wssUrl: string, timeoutMs: number,
  converse: (send: (msg: string) => Promise<SipResponse>) => Promise<T>): Promise<{ opened: boolean; result?: T; error?: string }> {
  let socket: SocketLike;
  try { socket = factory(wssUrl, "sip"); } catch { return { opened: false, error: "websocket_constructor_failed" }; }
  const pending: Array<(r: SipResponse) => void> = [];
  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.onopen = () => { clearTimeout(timer); resolve(true); };
    socket.onerror = () => { clearTimeout(timer); resolve(false); };
    socket.onclose = () => { clearTimeout(timer); resolve(false); };
  });
  if (!opened) { try { socket.close(); } catch { /* ignore */ } return { opened: false, error: "wss_unreachable_or_tls_rejected" }; }
  socket.onmessage = (ev) => {
    const text = typeof ev.data === "string" ? ev.data : "";
    const parsed = parseSipResponse(text);
    if (parsed && parsed.status >= 200) pending.shift()?.(parsed);
  };
  const send = (msg: string) => new Promise<SipResponse>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sip_response_timeout")), timeoutMs);
    pending.push((r) => { clearTimeout(timer); resolve(r); });
    socket.send(msg);
  });
  try { return { opened: true, result: await converse(send) }; }
  catch (e) { return { opened: true, error: e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "sip_exchange_failed" }; }
  finally { try { socket.close(); } catch { /* ignore */ } }
}

export async function optionsPing(factory: SocketFactory, wssUrl: string, domain: string, timeoutMs = 8000): Promise<ValidationCheck[]> {
  const viaHost = `${token(6)}.invalid`;
  const r = await sipSession(factory, wssUrl, timeoutMs, async (send) => send(buildSipRequest({ method: "OPTIONS", domain, user: "lemtel-validator", callId: token(12), cseq: 1, branch: token(8), tag: token(6), viaHost })));
  const wss: ValidationCheck = { key: "wss_tls_websocket", status: r.opened ? "ok" : "failed", detail: r.opened ? "websocket_sip_subprotocol_open" : (r.error ?? "failed") };
  const sip: ValidationCheck = r.opened
    ? (r.result ? { key: "sip_options", status: "ok", detail: `sip_status_${r.result.status}` } : { key: "sip_options", status: "failed", detail: r.error ?? "no_sip_response" })
    : { key: "sip_options", status: "skipped", detail: "wss_not_open" };
  return [wss, sip];
}

/** REGISTER with digest, then immediately un-REGISTER (expires=0): proves the extension credentials without leaving a binding. */
export async function registrationProbe(factory: SocketFactory, wssUrl: string, domain: string, user: string, authUser: string, password: string, timeoutMs = 8000): Promise<ValidationCheck> {
  const viaHost = `${token(6)}.invalid`;
  const callId = token(12), tag = token(6);
  const r = await sipSession(factory, wssUrl, timeoutMs, async (send) => {
    let cseq = 1;
    const register = (expires: number, authorization?: string) => send(buildSipRequest({ method: "REGISTER", domain, user, callId, cseq: cseq++, expires, authorization, branch: token(8), tag, viaHost }));
    let res = await register(60);
    if (res.status === 401 || res.status === 407) {
      const ch = parseChallenge(res.headers[res.status === 401 ? "www-authenticate" : "proxy-authenticate"] ?? "");
      if (!ch) return { status: 0, detail: "unsupported_challenge" };
      const auth = digestAuthorization(ch, authUser, password, "REGISTER", `sip:${domain}`, token(8));
      res = await register(60, auth);
      if (res.status >= 200 && res.status < 300) {
        const ch2 = parseChallenge(res.headers["www-authenticate"] ?? "") ?? ch;
        await register(0, digestAuthorization(ch2, authUser, password, "REGISTER", `sip:${domain}`, token(8))).catch(() => undefined);
      }
    }
    return { status: res.status, detail: `sip_status_${res.status}` };
  });
  if (!r.opened) return { key: `register_${user}`, status: "failed", detail: r.error ?? "wss_not_open" };
  if (!r.result) return { key: `register_${user}`, status: "failed", detail: r.error ?? "no_sip_response" };
  const s = r.result.status;
  const detail = s >= 200 && s < 300 ? "registered_and_unregistered"
    : s === 401 || s === 407 ? "credentials_rejected"
    : s === 403 ? "forbidden_check_acl_or_domain"
    : s === 404 ? "extension_or_domain_unknown" : r.result.detail;
  return { key: `register_${user}`, status: s >= 200 && s < 300 ? "ok" : "failed", detail };
}

export function summarize(checks: ValidationCheck[], now = new Date()): ValidationReport {
  const required = checks.filter((c) => c.key === "wss_tls_websocket" || c.key === "sip_options" || c.key.startsWith("register_"));
  const registered = checks.some((c) => c.key.startsWith("register_") && c.status === "ok");
  const passed = registered && required.filter((c) => !c.key.startsWith("register_")).every((c) => c.status === "ok");
  return { checkedAt: now.toISOString(), checks, passed };
}
