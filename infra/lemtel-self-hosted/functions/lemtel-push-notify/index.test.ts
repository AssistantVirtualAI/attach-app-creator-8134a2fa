import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { handle as notify } from "./index.ts";
import { handle as register, parse } from "../lemtel-push-register/index.ts";
import { apnsConfig, apnsJwt, fcmMessage, hookSignature, resetPushCaches, sanitizeCall } from "../_shared/lemtelPush.ts";

type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>, sessions: Record<string, string> = {}) {
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op = "select"; let payload: Row = {}; let conflict: string[] = [];
    const run = () => {
      const t = tables[name];
      if (op === "insert") {
        if (name === "lemtel_push_hook_nonces" && t.some((r) => r.nonce === payload.nonce)) return { data: null, error: { code: "23505" } };
        t.push({ ...payload }); return { data: null, error: null };
      }
      if (op === "upsert") { const hit = t.find((r) => conflict.every((k) => r[k] === payload[k])); if (hit) Object.assign(hit, payload); else t.push({ ...payload }); return { data: null, error: null }; }
      const rows = t.filter((r) => filters.every((f) => f(r)));
      if (op === "update") { rows.forEach((r) => Object.assign(r, payload)); return { data: rows, error: null }; }
      if (op === "delete") { tables[name] = t.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b, eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; }, neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return b; },
      lt: (k: string, v: string) => { filters.push((r) => String(r[k]) < v); return b; },
      insert: (p: Row) => { op = "insert"; payload = p; return b; }, update: (p: Row) => { op = "update"; payload = p; return b; }, delete: () => { op = "delete"; return b; },
      upsert: (p: Row, o: { onConflict: string }) => { op = "upsert"; payload = p; conflict = o.onConflict.split(","); return b; },
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from, auth: { getUser: (t: string) => Promise.resolve(sessions[t] ? { data: { user: { id: sessions[t] } }, error: null } : { data: { user: null }, error: {} }) } };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const DEV1 = "44444444-4444-4444-8444-444444444444";
const DEV2 = "55555555-5555-4555-8555-555555555555";
const VOIP = "a".repeat(64);
const FCM = "fcm-token_" + "b".repeat(60);
const SECRET = "c".repeat(64);
const NOW = Date.parse("2026-10-20T03:00:00Z");

async function keys() {
  const ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rsa = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pem = async (k: CryptoKey) => `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", k))))}\n-----END PRIVATE KEY-----`;
  return { ec, rsa, ecPem: await pem(ec.privateKey), rsaPem: await pem(rsa.privateKey) };
}

function env(k: Awaited<ReturnType<typeof keys>>) {
  const sa = JSON.stringify({ project_id: "lemtel-softphone", client_email: "push@lemtel-softphone.iam.gserviceaccount.com", private_key: k.rsaPem });
  return (n: string) => ({ LEMTEL_PUSH_HOOK_SECRET: SECRET, LEMTEL_APNS_KEY_P8: k.ecPem, LEMTEL_APNS_KEY_ID: "ABC123DEFG", LEMTEL_APNS_TEAM_ID: "TEAM123456", LEMTEL_FCM_SERVICE_ACCOUNT_JSON: btoa(sa) } as Record<string, string>)[n];
}

function fakeProviders(opts: { apnsStatus?: number; apnsReason?: string } = {}) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    sent.push({ url, headers, body: JSON.parse(String(init?.body)) });
    if (url.startsWith("https://api.push.apple.com/3/device/")) return opts.apnsStatus && opts.apnsStatus !== 200 ? new Response(JSON.stringify({ reason: opts.apnsReason }), { status: opts.apnsStatus }) : new Response(null, { status: 200 });
    if (url.includes("fcm.googleapis.com")) return new Response(JSON.stringify({ name: "projects/x/messages/1" }), { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { sent, fetchFn };
}

function tables(): Record<string, Row[]> {
  return {
    lemtel_organizations: [{ id: ORG, status: "active" }],
    lemtel_organization_memberships: [{ organization_id: ORG, user_id: USER, status: "active" }, { organization_id: ORG, user_id: OTHER, status: "active" }],
    lemtel_pbx_connections: [{ organization_id: ORG, sip_domain: "acme.lemtel.tel", state: "active" }],
    lemtel_pbx_extension_assignments: [{ organization_id: ORG, user_id: USER, extension: "1001", state: "assigned" }],
    lemtel_push_devices: [], lemtel_push_events: [], lemtel_push_hook_nonces: [],
  };
}

async function signedRequest(body: Record<string, unknown>, opts: { ts?: number; nonce?: string; secret?: string } = {}) {
  const text = JSON.stringify(body);
  const ts = String(Math.floor((opts.ts ?? NOW) / 1000)), nonce = opts.nonce ?? crypto.randomUUID().replace(/-/g, "");
  return new Request("https://x/functions/v1/lemtel-push-notify", { method: "POST", body: text,
    headers: { "X-Lemtel-Timestamp": ts, "X-Lemtel-Nonce": nonce, "X-Lemtel-Signature": await hookSignature(opts.secret ?? SECRET, ts, nonce, text) } });
}
const reg = (body: Row, who = "user") => new Request("https://x/functions/v1/lemtel-push-register", { method: "POST", headers: { Authorization: `Bearer ${who}` }, body: JSON.stringify(body) });

Deno.test("register: strict body, platform/channel coherence, a moved token leaves the previous account", async () => {
  assertEquals(parse({ action: "register", deviceId: DEV1, platform: "ios", channel: "fcm", token: FCM }), { error: "channel_platform_mismatch" });
  assertEquals(parse({ action: "register", deviceId: DEV1, platform: "ios", channel: "apns_voip", token: "zz" }), { error: "invalid_token" });
  assertEquals(parse({ action: "register", deviceId: DEV1, platform: "android", channel: "fcm", token: FCM, extra: 1 }), { error: "invalid_request" });
  const t = tables();
  const admin = fakeAdmin(t, { user: USER, other: OTHER });
  assertEquals((await register(reg({ action: "register", deviceId: DEV1, platform: "android", channel: "fcm", token: FCM }, "other"), { admin, now: () => NOW })).status, 200);
  assertEquals(t.lemtel_push_devices[0].user_id, OTHER);
  assertEquals((await register(reg({ action: "register", deviceId: DEV2, platform: "android", channel: "fcm", token: FCM }), { admin, now: () => NOW })).status, 200);
  assertEquals(t.lemtel_push_devices.map((r) => r.user_id), [USER], "the same phone signed into another account no longer rings for the first one");
  assertEquals((await register(reg({ action: "register", deviceId: DEV1, platform: "ios", channel: "apns_voip", token: VOIP.toUpperCase(), apnsEnvironment: "sandbox" }), { admin, now: () => NOW })).status, 200);
  assertEquals(t.lemtel_push_devices.find((r) => r.channel === "apns_voip")!.token, VOIP);
  assertEquals((await register(reg({ action: "unregister", deviceId: DEV1 }), { admin, now: () => NOW })).status, 200);
  assertEquals(t.lemtel_push_devices.length, 1);
  assertEquals((await register(reg({ action: "register", deviceId: DEV1, platform: "android", channel: "fcm", token: FCM }, "nobody"), { admin, now: () => NOW })).status, 401);
});

Deno.test("notify: signature, timestamp window and single-use nonce are enforced before anything is read", async () => {
  const k = await keys(); resetPushCaches();
  const t = tables(); const p = fakeProviders();
  const d = { admin: fakeAdmin(t), env: env(k), fetch: p.fetchFn, now: () => NOW };
  const body = { sipDomain: "acme.lemtel.tel", extension: "1001", callRef: "abc-123", fromNumber: "5145550000", fromName: "Ana" };
  assertEquals((await notify(await signedRequest(body, { secret: "d".repeat(64) }), d)).status, 401);
  assertEquals((await notify(await signedRequest(body, { ts: NOW - 60_000 }), d)).status, 401);
  const nonce = "n".repeat(20);
  assertEquals((await notify(await signedRequest(body, { nonce }), d)).status, 200);
  assertEquals((await notify(await signedRequest(body, { nonce }), d)).status, 401, "replayed nonce");
  assertEquals(p.sent.length, 0, "no device yet → nothing sent");
  assertEquals(t.lemtel_push_events.at(-1)!.outcome, "no_device");
});

Deno.test("notify: wakes every enabled device of the assigned user (APNs VoIP + FCM high priority); a dead token is disabled", async () => {
  const k = await keys(); resetPushCaches();
  const t = tables();
  t.lemtel_push_devices.push(
    { organization_id: ORG, user_id: USER, device_id: DEV1, channel: "apns_voip", token: VOIP, apns_environment: "production", enabled: true, failure_count: 0 },
    { organization_id: ORG, user_id: USER, device_id: DEV2, channel: "fcm", token: FCM, apns_environment: null, enabled: true, failure_count: 0 },
    { organization_id: ORG, user_id: OTHER, device_id: DEV2, channel: "fcm", token: "x".repeat(40), enabled: true, failure_count: 0 },
  );
  const p = fakeProviders();
  const res = await notify(await signedRequest({ sipDomain: "acme.lemtel.tel", extension: "1001", callRef: "abc-123", fromNumber: "+1 (514) 555-0000", fromName: "<b>Ana</b>" }), { admin: fakeAdmin(t), env: env(k), fetch: p.fetchFn, now: () => NOW });
  const j = await res.json();
  assertEquals(j.accepted, 2); assertEquals(j.devices, 2);
  const apns = p.sent.find((s) => s.url.includes("push.apple.com"))!;
  assertEquals(apns.headers["apns-push-type"], "voip"); assertEquals(apns.headers["apns-topic"], "com.lemtel.softphone.voip"); assertEquals(apns.headers["apns-priority"], "10");
  assertEquals((apns.body as Row).from, "bAna/b"); assertEquals((apns.body as Row).uuid, "abc-123");
  const fcm = p.sent.find((s) => s.url.includes("fcm.googleapis.com"))!;
  assertEquals(((fcm.body as { message: { android: Row } }).message.android.priority), "HIGH");
  assertEquals(((fcm.body as { message: { data: Row } }).message.data.fromNumber), "+15145550000");
  assert(!JSON.stringify(t.lemtel_push_events).includes("5145550000"), "events never store the caller number");
  // A token Apple reports as gone is disabled.
  const p2 = fakeProviders({ apnsStatus: 410, apnsReason: "Unregistered" });
  const j2 = await (await notify(await signedRequest({ sipDomain: "acme.lemtel.tel", extension: "1001", callRef: "abc-124", fromNumber: "1", fromName: "" }), { admin: fakeAdmin(t), env: env(k), fetch: p2.fetchFn, now: () => NOW })).json();
  assertEquals(j2.failed, 1);
  assertEquals(t.lemtel_push_devices.find((r) => r.channel === "apns_voip")!.enabled, false);
});

Deno.test("APNs provider token is a valid ES256 JWT; FCM message is data-only; call labels are sanitized", async () => {
  const k = await keys(); resetPushCaches();
  const c = (await apnsConfig(env(k)))!;
  const jwt = await apnsJwt(c, NOW);
  const [h, p, s] = jwt.split(".");
  const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)), (ch) => ch.charCodeAt(0));
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.ec.publicKey, dec(s), new TextEncoder().encode(`${h}.${p}`)));
  assertEquals(JSON.parse(new TextDecoder().decode(dec(h))), { alg: "ES256", kid: "ABC123DEFG" });
  assertEquals(JSON.parse(new TextDecoder().decode(dec(p))).iss, "TEAM123456");
  const msg = fcmMessage(FCM, sanitizeCall({ callRef: "r1", fromNumber: "514", fromName: "A" }, NOW)!);
  assertEquals((msg.message as Row).notification, undefined);
  assertEquals(sanitizeCall({ callRef: "bad ref;", fromNumber: "1", fromName: "x" }, NOW), null);
});
