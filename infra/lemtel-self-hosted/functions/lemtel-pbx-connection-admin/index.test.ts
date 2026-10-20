// End-to-end (offline): portal intake -> validation against a fake FusionPBX over WSS -> activation ->
// Mobile/Desktop provisioning. In-memory Supabase fake; no network.
import { assert, assertEquals } from "../_shared/lemtelTestAssert.ts";
import { handle as adminHandle, validateBody } from "./index.ts";
import { handle as provisionHandle } from "../lemtel-softphone-provisioning/index.ts";
import { digestAuthorization, parseChallenge, type SocketLike } from "../_shared/lemtelPbxConnection.ts";

const eq = assertEquals;
const ok = (v: unknown, m?: string) => assert(v, m);

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const ALICE = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
function fakeSupabase(tables: Record<string, Row[]>, users: Record<string, { email: string; name: string }>, revokedClients: string[] = []): any {
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" | "update" | "delete"; patch?: Row } = { kind: "select" };
    let lim = Infinity; let orderBy: string | null = null;
    const rows = () => (tables[table] ??= []);
    const matched = () => rows().filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op.kind === "update") { for (const r of matched()) Object.assign(r, op.patch); return { data: null, error: null }; }
      if (op.kind === "delete") { tables[table] = rows().filter((r) => !filters.every((f) => f(r))); return { data: null, error: null }; }
      let out = matched();
      if (orderBy) out = [...out].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      return { data: out.slice(0, lim).map((r) => ({ ...r })), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b, order: (k: string) => { orderBy = k; return b; }, limit: (n: number) => { lim = n; return b; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b; },
      not: (k: string, _o: string, _v: null) => { filters.push((r) => r[k] !== null && r[k] !== undefined); return b; },
      update: (patch: Row) => { op = { kind: "update", patch }; return b; },
      delete: () => { op = { kind: "delete" }; return b; },
      maybeSingle: () => Promise.resolve({ data: (run().data as Row[] | null)?.[0] ?? null, error: null }),
      insert: (v: Row) => { rows().push({ ...v }); return Promise.resolve({ error: null }); },
      upsert: (v: Row, o: { onConflict: string }) => {
        const k = o.onConflict.split(","); const existing = rows().find((r) => k.every((x) => r[x] === v[x]));
        if (existing) Object.assign(existing, v); else rows().push({ state: "draft", revision: 1, credential_revision: 0, ...v });
        return Promise.resolve({ error: null });
      },
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
  return {
    from: query,
    rpc: (name: string, args: Row) => {
      eq(name, "lemtel_session_bootstrap_context_for_client");
      const memberships = (tables.lemtel_organization_memberships ?? []).filter((m) => m.user_id === args.p_user_id && m.status === "active");
      return Promise.resolve({ data: revokedClients.includes(String(args.p_client_kind)) ? [] : memberships.map((m) => ({ organization_id: m.organization_id })), error: null });
    },
    auth: {
      getUser: (token: string) => Promise.resolve(users[token] ? { data: { user: { id: token, email: users[token].email, user_metadata: { full_name: users[token].name }, app_metadata: {} } }, error: null } : { data: null, error: { message: "x" } }),
      admin: { getUserById: (id: string) => Promise.resolve({ data: { user: users[id] ? { id, email: users[id].email, user_metadata: { full_name: users[id].name } } : null } }) },
    },
  };
}

function fakePbx(password: string) {
  const sent: string[] = [];
  const socket = (_u: string, protocol: string): SocketLike => {
    eq(protocol, "sip");
    const s: SocketLike = { onopen: null, onmessage: null, onerror: null, onclose: null, close() {},
      send(msg: string) {
        sent.push(msg);
        const h = (n: string) => (msg.match(new RegExp(`^${n}: (.*)$`, "mi")) ?? [])[1] ?? "";
        const reply = (st: string, extra = "") => queueMicrotask(() => s.onmessage?.({ data: `SIP/2.0 ${st}\r\nCSeq: ${h("CSeq")}\r\n${extra}\r\n` }));
        if (msg.startsWith("OPTIONS")) return reply("200 OK");
        const auth = h("Authorization");
        if (!auth) return reply("401 Unauthorized", 'WWW-Authenticate: Digest realm="lemtel.lemtel.tel", nonce="n1", qop="auth"\r\n');
        const cnonce = /cnonce="([^"]+)"/.exec(auth)![1];
        reply(auth === digestAuthorization(parseChallenge('Digest realm="lemtel.lemtel.tel", nonce="n1", qop="auth"')!, "1042", password, "REGISTER", "sip:lemtel.lemtel.tel", cnonce) ? "200 OK" : "403 Forbidden");
      } };
    queueMicrotask(() => s.onopen?.({}));
    return s;
  };
  return { socket, sent };
}

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
function setup(env: Record<string, string> = {}, pbxPassword = "Ext1042!Pass", revokedClients: string[] = []) {
  const tables: Record<string, Row[]> = {
    lemtel_organizations: [{ id: ORG, status: "active" }],
    lemtel_platform_administrators: [],
    lemtel_organization_memberships: [
      { organization_id: ORG, user_id: ADMIN, role: "owner", status: "active" },
      { organization_id: ORG, user_id: ALICE, role: "member", status: "active" },
    ],
  };
  const users = { [ADMIN]: { email: "admin@lemtel.tel", name: "Admin" }, [ALICE]: { email: "alice@lemtel.tel", name: "Alice" }, [OUTSIDER]: { email: "x@y.z", name: "X" } };
  const admin = fakeSupabase(tables, users, revokedClients);
  const pbx = fakePbx(pbxPassword);
  const fullEnv = { LEMTEL_PBX_SECRET_ENCRYPTION_KEY: KEY, LEMTEL_PBX_SECRET_KEY_VERSION: "1", ...env };
  const deps = { admin, env: (n: string) => (fullEnv as Record<string, string>)[n], socket: pbx.socket, now: () => Date.parse("2026-10-19T12:00:00Z") };
  const call = async (as: string, body: Record<string, unknown>) => {
    const r = await adminHandle(new Request("https://x/f", { method: "POST", headers: { Authorization: `Bearer ${as}` }, body: JSON.stringify({ organizationId: ORG, ...body }) }), deps);
    return { status: r.status, body: await r.json() };
  };
  const provision = async (as: string, client = "mobile") => {
    const r = await provisionHandle(new Request("https://x/p", { headers: { Authorization: `Bearer ${as}`, "X-Lemtel-Client": client } }), deps);
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  return { tables, call, provision, pbx };
}

const SETTINGS = { sipDomain: "lemtel.lemtel.tel", pbxHost: "pbxnode.lemtel.tel", wssUrl: "wss://pbxnode.lemtel.tel:7443", stunUrls: ["stun:turn.lemtel.tel:3478"], turnUrls: ["turns:turn.lemtel.tel:5349?transport=tcp"] };

Deno.test("body validation refuses secrets outside the write-only actions", () => {
  eq((validateBody({ action: "save_settings", organizationId: ORG, settings: { ...SETTINGS, sipPassword: "x" } }) as { error: string }).error, "unexpected_field_sipPassword");
  eq((validateBody({ action: "get_connection", organizationId: ORG, value: "x" }) as { error: string }).error, "invalid_request");
  eq((validateBody({ action: "set_secret", organizationId: ORG, kind: "root_password", value: "x".repeat(20) }) as { error: string }).error, "invalid_secret_kind");
});

Deno.test("Kenny/Phil info entered once -> validated -> active -> Mobile and Desktop receive the same connection", async () => {
  const w = setup({ LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY: "enabled" });
  eq((await w.call(OUTSIDER, { action: "get_connection" })).status, 403, "non-members are refused");
  eq((await w.call(ALICE, { action: "get_connection" })).status, 403, "members are not portal admins");
  eq((await w.provision(ALICE)).body.status, "not_assigned");

  eq((await w.call(ADMIN, { action: "save_settings", settings: SETTINGS })).status, 200);
  eq((await w.call(ADMIN, { action: "set_secret", kind: "turn_shared_secret", value: "turn-shared-secret-0123456789" })).status, 200);
  const assigned = await w.call(ADMIN, { action: "assign_extension", assignment: { userId: ALICE, extension: "1042", isTest: true }, sipPassword: "Ext1042!Pass" });
  eq(assigned.status, 200);
  eq(assigned.body.assignments[0].credentialSet, true);
  const dump = JSON.stringify(w.tables);
  ok(!dump.includes("Ext1042!Pass") && !dump.includes("turn-shared-secret"), "no secret in clear anywhere in the database");
  ok(!JSON.stringify(assigned.body).includes("Ext1042!Pass"), "no secret returned to the portal");
  eq(assigned.body.secrets.turn_shared_secret.set, true);

  eq((await w.provision(ALICE)).body.status, "pending_activation", "nothing reaches the apps before activation");
  eq((await w.call(ADMIN, { action: "set_state", state: "active" })).body.error, "validation_not_passed");

  const v = await w.call(ADMIN, { action: "validate" });
  eq(v.status, 200);
  eq(v.body.report.passed, true, JSON.stringify(v.body.report));
  eq(v.body.report.checks.map((c: { key: string; status: string }) => `${c.key}:${c.status}`), ["wss_tls_websocket:ok", "sip_options:ok", "register_1042:ok", "turn_relay:ok"]);
  eq(v.body.connection.state, "validated");
  eq((await w.call(ADMIN, { action: "set_state", state: "active" })).body.connection.state, "active");

  const mobile = await w.provision(ALICE, "mobile");
  const desktop = await w.provision(ALICE, "desktop");
  eq(mobile.body.status, "ready");
  eq(mobile.headers.get("Cache-Control"), "no-store, private");
  eq(mobile.body.telephony, desktop.body.telephony, "Mobile and Desktop get the exact same connection");
  eq(mobile.body.telephony, { sipDomain: "lemtel.lemtel.tel", extension: "1042", authorizationUser: "1042", displayName: "Alice", wssUrls: ["wss://pbxnode.lemtel.tel:7443"],
    outboundProxy: null, registerExpires: 300, codecs: ["opus", "PCMU", "PCMA"], srtpMode: "dtls_srtp", password: "Ext1042!Pass" });
  const turn = mobile.body.media.iceServers[1];
  ok(/^\d+:[0-9a-f]{16}$/.test(turn.username) && turn.credential, "TURN is a short-lived HMAC credential");
  ok(!JSON.stringify(mobile.body).includes("turn-shared-secret"), "the TURN secret never leaves the server");
  eq((await w.provision(ADMIN)).body.status, "not_assigned", "only the caller's own extension");
});

Deno.test("gates: delivery switch, revoked client family, settings change re-requires validation, wrong password fails validation", async () => {
  const w = setup({}, "something-else");
  await w.call(ADMIN, { action: "save_settings", settings: SETTINGS });
  await w.call(ADMIN, { action: "assign_extension", assignment: { userId: ALICE, extension: "1042", isTest: true }, sipPassword: "Ext1042!Pass" });
  const v = await w.call(ADMIN, { action: "validate" });
  eq(v.body.report.passed, false);
  eq(v.body.report.checks.find((c: { key: string }) => c.key === "register_1042").detail, "forbidden_check_acl_or_domain");
  eq((await w.call(ADMIN, { action: "set_state", state: "active" })).body.error, "validation_not_passed");

  const g = setup({});
  await g.call(ADMIN, { action: "save_settings", settings: SETTINGS });
  await g.call(ADMIN, { action: "assign_extension", assignment: { userId: ALICE, extension: "1042", isTest: true }, sipPassword: "Ext1042!Pass" });
  await g.call(ADMIN, { action: "validate" });
  await g.call(ADMIN, { action: "set_state", state: "active" });
  const off = await g.provision(ALICE);
  eq(off.body.status, "delivery_disabled", "platform gate off: descriptor only, no password");
  ok(!JSON.stringify(off.body).includes("Ext1042!Pass"));

  const r = setup({ LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY: "enabled" }, "Ext1042!Pass", ["desktop"]);
  eq((await r.provision(ALICE, "desktop")).status, 403, "a revoked client family gets nothing");
  eq((await r.provision(ALICE, "browser")).status, 400);
  const other = await r.call(ADMIN, { action: "assign_extension", assignment: { userId: OUTSIDER, extension: "1043" }, sipPassword: null });
  eq(other.body.error, "user_not_active_member");
});

Deno.test("D2: Lemtel-hosted TURN is used when the organization configures none; an organization's own TURN wins", async () => {
  const HOSTED = { LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY: "enabled", LEMTEL_STUN_URLS: "stun:turn.assistantvirtualai.com:3478",
    LEMTEL_TURN_URLS: "turns:turn.assistantvirtualai.com:5349?transport=tcp,turn:turn.assistantvirtualai.com:3478?transport=udp",
    LEMTEL_TURN_SHARED_SECRET: "hosted-turn-secret-0123456789abcdef0123" };
  const w = setup(HOSTED);
  await w.call(ADMIN, { action: "save_settings", settings: { ...SETTINGS, stunUrls: [], turnUrls: [] } });
  await w.call(ADMIN, { action: "assign_extension", assignment: { userId: ALICE, extension: "1042", isTest: true }, sipPassword: "Ext1042!Pass" });
  const v = await w.call(ADMIN, { action: "validate" });
  eq(v.body.report.checks.find((c: { key: string }) => c.key === "turn_relay"), { key: "turn_relay", status: "ok", detail: "lemtel_hosted_relay" });
  await w.call(ADMIN, { action: "set_state", state: "active" });
  const p = await w.provision(ALICE, "desktop");
  eq(p.body.status, "ready");
  eq(p.body.media.iceServers[0], { urls: ["stun:turn.assistantvirtualai.com:3478"] });
  eq(p.body.media.iceServers[1].urls, ["turns:turn.assistantvirtualai.com:5349?transport=tcp", "turn:turn.assistantvirtualai.com:3478?transport=udp"]);
  ok(/^\d+:[0-9a-f]{16}$/.test(p.body.media.iceServers[1].username), "short-lived HMAC username");
  ok(!JSON.stringify(p.body).includes("hosted-turn-secret"), "the hosted secret never leaves the server");

  const own = setup(HOSTED);
  await own.call(ADMIN, { action: "save_settings", settings: SETTINGS });
  await own.call(ADMIN, { action: "set_secret", kind: "turn_shared_secret", value: "turn-shared-secret-0123456789" });
  await own.call(ADMIN, { action: "assign_extension", assignment: { userId: ALICE, extension: "1042", isTest: true }, sipPassword: "Ext1042!Pass" });
  await own.call(ADMIN, { action: "validate" });
  await own.call(ADMIN, { action: "set_state", state: "active" });
  const q = await own.provision(ALICE, "mobile");
  eq(q.body.media.iceServers[0], { urls: ["stun:turn.lemtel.tel:3478"] });
  eq(q.body.media.iceServers[1].urls, ["turns:turn.lemtel.tel:5349?transport=tcp"]);

  const bad = setup({ ...HOSTED, LEMTEL_TURN_URLS: "turns:user:pw@evil.example:5349", LEMTEL_TURN_SHARED_SECRET: "short" });
  await bad.call(ADMIN, { action: "save_settings", settings: { ...SETTINGS, stunUrls: [], turnUrls: [] } });
  await bad.call(ADMIN, { action: "assign_extension", assignment: { userId: ALICE, extension: "1042", isTest: true }, sipPassword: "Ext1042!Pass" });
  const bv = await bad.call(ADMIN, { action: "validate" });
  eq(bv.body.report.checks.find((c: { key: string }) => c.key === "turn_relay").status, "skipped", "an invalid hosted relay is ignored");
});
