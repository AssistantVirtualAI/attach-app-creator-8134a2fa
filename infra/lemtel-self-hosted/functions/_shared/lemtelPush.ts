// Lemtel call-notification sender (server only): Apple VoIP push (PushKit → CallKit) and Firebase Cloud Messaging
// high-priority data messages (Android full-screen incoming call). Keys come from the server environment only:
//   LEMTEL_APNS_KEY_P8 (PEM, "-----BEGIN PRIVATE KEY-----"), LEMTEL_APNS_KEY_ID, LEMTEL_APNS_TEAM_ID, LEMTEL_APNS_BUNDLE_ID
//   LEMTEL_FCM_SERVICE_ACCOUNT_JSON (service-account JSON, raw or base64)
// A push carries only what the incoming-call screen shows (caller label/number, call reference, expiry): no credential.

export type Fetch = typeof fetch;
export type Env = (name: string) => string | undefined;
export type IncomingCall = { callRef: string; fromNumber: string; fromName: string; expiresAt: number };
export type SendResult = { ok: true } | { ok: false; permanent: boolean; reason: string };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));
function pemBody(pem: string): ArrayBuffer | null {
  const m = pem.replace(/\\n/g, "\n").match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!m) return null;
  try { return Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) => c.charCodeAt(0)).buffer as ArrayBuffer; } catch { return null; }
}

/** Caller label safe for a lock screen: printable, bounded. */
export function sanitizeCall(c: { callRef: unknown; fromNumber: unknown; fromName: unknown }, now: number, ttlMs = 30_000): IncomingCall | null {
  const ref = typeof c.callRef === "string" && /^[A-Za-z0-9@._-]{1,128}$/.test(c.callRef) ? c.callRef : null;
  const num = typeof c.fromNumber === "string" ? c.fromNumber.replace(/[^0-9+*#]/g, "").slice(0, 32) : "";
  const name = typeof c.fromName === "string" ? c.fromName.replace(/[\u0000-\u001f\u007f<>"]/g, "").trim().slice(0, 64) : "";
  if (!ref) return null;
  return { callRef: ref, fromNumber: num, fromName: name || num, expiresAt: now + ttlMs };
}

// ─── APNs (token-based auth, ES256) ──────────────────────────────────────────────────────────────────────────
export type ApnsConfig = { key: CryptoKey; keyId: string; teamId: string; bundleId: string };
export async function apnsConfig(env: Env): Promise<ApnsConfig | null> {
  const der = pemBody(env("LEMTEL_APNS_KEY_P8") ?? "");
  const keyId = env("LEMTEL_APNS_KEY_ID")?.trim() ?? "", teamId = env("LEMTEL_APNS_TEAM_ID")?.trim() ?? "";
  const bundleId = env("LEMTEL_APNS_BUNDLE_ID")?.trim() || "com.lemtel.softphone";
  if (!der || !/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Za-z0-9.-]{3,155}$/.test(bundleId)) return null;
  try {
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { key, keyId, teamId, bundleId };
  } catch { return null; }
}

let apnsJwtCache: { jwt: string; at: number; kid: string } | null = null;
export async function apnsJwt(c: ApnsConfig, now: number): Promise<string> {
  // Apple accepts a provider token for 60 minutes and rejects refreshing more than once every 20 minutes.
  if (apnsJwtCache && apnsJwtCache.kid === c.keyId && now - apnsJwtCache.at < 45 * 60_000) return apnsJwtCache.jwt;
  const head = b64urlText(JSON.stringify({ alg: "ES256", kid: c.keyId }));
  const claims = b64urlText(JSON.stringify({ iss: c.teamId, iat: Math.floor(now / 1000) }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, c.key, new TextEncoder().encode(`${head}.${claims}`)));
  const jwt = `${head}.${claims}.${b64url(sig)}`;
  apnsJwtCache = { jwt, at: now, kid: c.keyId };
  return jwt;
}
export function resetPushCaches() { apnsJwtCache = null; fcmTokenCache = null; }

/** Payload keys match AppDelegate.pushRegistry(didReceiveIncomingPushWith:): "from", "uuid", plus Lemtel fields. */
export function apnsPayload(call: IncomingCall) {
  return { aps: {}, type: "incoming_call", uuid: call.callRef, from: call.fromName || call.fromNumber || "Lemtel", caller_id_number: call.fromNumber, expiresAt: call.expiresAt };
}

export async function sendApnsVoip(c: ApnsConfig, token: string, environment: "production" | "sandbox", call: IncomingCall, now: number, fetchFn: Fetch = fetch): Promise<SendResult> {
  if (!/^[0-9a-f]{64,200}$/i.test(token)) return { ok: false, permanent: true, reason: "bad_device_token" };
  const host = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  let res: Response;
  try {
    res = await fetchFn(`${host}/3/device/${token}`, {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { authorization: `bearer ${await apnsJwt(c, now)}`, "apns-topic": `${c.bundleId}.voip`, "apns-push-type": "voip", "apns-priority": "10",
        "apns-expiration": String(Math.floor(call.expiresAt / 1000)), "content-type": "application/json" },
      body: JSON.stringify(apnsPayload(call)),
    });
  } catch { return { ok: false, permanent: false, reason: "apns_unreachable" }; }
  if (res.status === 200) { await res.body?.cancel(); return { ok: true }; }
  const reason = String(((await res.json().catch(() => ({}))) as { reason?: unknown }).reason ?? `http_${res.status}`).replace(/[^A-Za-z]/g, "").slice(0, 40) || "unknown";
  const permanent = res.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "TopicDisallowed"].includes(reason);
  if (res.status === 403) apnsJwtCache = null; // expired / invalid provider token: rebuild next time
  return { ok: false, permanent, reason: reason.toLowerCase() };
}

// ─── FCM HTTP v1 (service account, RS256 → OAuth access token) ───────────────────────────────────────────────
export type FcmConfig = { projectId: string; clientEmail: string; key: CryptoKey };
export async function fcmConfig(env: Env): Promise<FcmConfig | null> {
  let raw = env("LEMTEL_FCM_SERVICE_ACCOUNT_JSON")?.trim() ?? "";
  if (!raw) return null;
  if (!raw.startsWith("{")) { try { raw = atob(raw); } catch { return null; } }
  let sa: Record<string, unknown>;
  try { sa = JSON.parse(raw); } catch { return null; }
  const projectId = typeof sa.project_id === "string" && /^[a-z0-9-]{4,64}$/.test(sa.project_id) ? sa.project_id : null;
  const clientEmail = typeof sa.client_email === "string" && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(sa.client_email) ? sa.client_email : null;
  const der = typeof sa.private_key === "string" ? pemBody(sa.private_key) : null;
  if (!projectId || !clientEmail || !der) return null;
  try {
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    return { projectId, clientEmail, key };
  } catch { return null; }
}

let fcmTokenCache: { token: string; until: number; email: string } | null = null;
export async function fcmAccessToken(c: FcmConfig, now: number, fetchFn: Fetch = fetch): Promise<string | null> {
  if (fcmTokenCache && fcmTokenCache.email === c.clientEmail && fcmTokenCache.until > now + 60_000) return fcmTokenCache.token;
  const iat = Math.floor(now / 1000);
  const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({ iss: c.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", c.key, new TextEncoder().encode(`${head}.${claims}`)));
  let res: Response;
  try {
    res = await fetchFn("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(8000), headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }).toString() });
  } catch { return null; }
  const j = await res.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!res.ok || typeof j?.access_token !== "string") return null;
  fcmTokenCache = { token: j.access_token, until: now + Math.min(3600, Number(j.expires_in) || 3600) * 1000, email: c.clientEmail };
  return j.access_token;
}

export function fcmMessage(token: string, call: IncomingCall) {
  // Data-only + HIGH priority: delivered to LemtelPushService even when the app is killed (no system notification).
  return { message: { token, data: { type: "incoming_call", callRef: call.callRef, fromNumber: call.fromNumber, fromName: call.fromName, expiresAt: String(call.expiresAt) },
    android: { priority: "HIGH", ttl: "30s" } } };
}

export async function sendFcm(c: FcmConfig, token: string, call: IncomingCall, now: number, fetchFn: Fetch = fetch): Promise<SendResult> {
  if (!/^[A-Za-z0-9:_-]{32,4096}$/.test(token)) return { ok: false, permanent: true, reason: "bad_device_token" };
  const access = await fcmAccessToken(c, now, fetchFn);
  if (!access) return { ok: false, permanent: false, reason: "fcm_auth_failed" };
  let res: Response;
  try {
    res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${c.projectId}/messages:send`, { method: "POST", signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(fcmMessage(token, call)) });
  } catch { return { ok: false, permanent: false, reason: "fcm_unreachable" }; }
  if (res.ok) { await res.body?.cancel(); return { ok: true }; }
  const j = await res.json().catch(() => null) as { error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> } } | null;
  const code = String(j?.error?.details?.find((d) => d.errorCode)?.errorCode ?? j?.error?.status ?? `http_${res.status}`).replace(/[^A-Za-z_]/g, "").slice(0, 40);
  if (res.status === 401) fcmTokenCache = null;
  return { ok: false, permanent: res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT", reason: code.toLowerCase() || "unknown" };
}

// ─── Signed hook from the Lemtel SIP edge ────────────────────────────────────────────────────────────────────
/** HMAC-SHA256 over `${timestamp}.${nonce}.${body}` with LEMTEL_PUSH_HOOK_SECRET (hex). */
export async function hookSignature(secret: string, timestamp: string, nonce: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
