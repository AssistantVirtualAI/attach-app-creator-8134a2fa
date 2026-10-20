import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { cdrCsv, handle, parseBody, type Deps } from "./index.ts";
import { extensionAad, loadSecretKey, openSecret, sealSecret, secretAad } from "../_shared/lemtelPbxConnection.ts";
import { normalizeCdr, projectRow, RESOURCES, validateValues } from "../_shared/lemtelFusionPbx.ts";

// ─── Fake Supabase (only the query-builder features the gateway uses) ─────────────────────────────────────────
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>, sessions: Record<string, string>, rpc: (name: string, args: Row) => unknown = () => ({})) {
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
    let payload: Row | Row[] = {};
    let conflict: string[] = [];
    let order: [string, boolean] | null = null;
    let range: [number, number] | null = null;
    let count = false;
    const orFilter = (expr: string) => {
      const parts = expr.split(",").map((p) => p.split("."));
      filters.push((r) => parts.some(([col, opn, ...rest]) => {
        const val = rest.join(".");
        if (opn === "eq") return String(r[col]) === val;
        if (opn === "ilike") return String(r[col] ?? "").toLowerCase().includes(val.replace(/%/g, "").toLowerCase());
        return false;
      }));
    };
    const run = () => {
      const t = tables[name];
      if (op === "insert") { (Array.isArray(payload) ? payload : [payload]).forEach((p) => t.push({ ...p })); return { data: null, error: null }; }
      if (op === "upsert") {
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const hit = t.find((r) => conflict.every((k) => r[k] === p[k]));
          if (hit) Object.assign(hit, p); else t.push({ ...p });
        }
        return { data: null, error: null };
      }
      let rows = t.filter((r) => filters.every((f) => f(r)));
      if (op === "update") { rows.forEach((r) => Object.assign(r, payload)); return { data: rows, error: null }; }
      if (op === "delete") { tables[name] = t.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      const total = rows.length;
      if (order) { const [k, asc] = order; rows = [...rows].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1)); }
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: rows.map((r) => ({ ...r })), error: null, count: count ? total : null };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string }) => { if (o?.count) count = true; return b; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
      gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return b; },
      lt: (k: string, v: string) => { filters.push((r) => String(r[k]) < v); return b; },
      not: (k: string, _o: string, _v: null) => { filters.push((r) => r[k] !== null && r[k] !== undefined); return b; },
      or: (expr: string) => { orFilter(expr); return b; },
      order: (k: string, o: { ascending: boolean }) => { order = [k, o.ascending]; return b; },
      range: (a: number, z: number) => { range = [a, z]; return b; },
      limit: () => b,
      insert: (p: Row) => { op = "insert"; payload = p; return b; },
      update: (p: Row) => { op = "update"; payload = p; return b; },
      delete: () => { op = "delete"; return b; },
      upsert: (p: Row | Row[], o: { onConflict: string }) => { op = "upsert"; payload = p; conflict = o.onConflict.split(","); return b; },
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return {
    from, rpc: (n: string, a: Row) => Promise.resolve({ data: rpc(n, a), error: null }),
    auth: { getUser: (t: string) => Promise.resolve(sessions[t] ? { data: { user: { id: sessions[t] } }, error: null } : { data: { user: null }, error: { m: 1 } }) },
  };
}

// ─── Fake FusionPBX ───────────────────────────────────────────────────────────────────────────────────────────
const API_KEY = "fpbx-api-key-0123456789abcdef";
const DOMAIN = "0b8e2c1a-5d3f-4e6a-9b7c-1d2e3f4a5b6c";
const OTHER = "9f9e2c1a-5d3f-4e6a-9b7c-1d2e3f4a5b6c";
const uuidN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Call = { method: string; path: string; body?: unknown };
function fakePbx() {
  const db: Record<string, Row[]> = {
    domains: [{ domain_uuid: DOMAIN, domain_name: "acme.lemtel.tel" }, { domain_uuid: OTHER, domain_name: "other.lemtel.tel" }],
    extensions: [
      { extension_uuid: uuidN(1), domain_uuid: DOMAIN, extension: "1001", password: "SecretSip123!", effective_caller_id_name: "Ana", forward_all_enabled: "false" },
      { extension_uuid: uuidN(2), domain_uuid: OTHER, extension: "2001", password: "OtherSecret99", effective_caller_id_name: "Other" },
    ],
    voicemails: [{ voicemail_uuid: uuidN(10), domain_uuid: DOMAIN, voicemail_id: "1001", voicemail_password: "1234", voicemail_enabled: "true" }],
    voicemail_messages: [
      { voicemail_message_uuid: uuidN(20), domain_uuid: DOMAIN, voicemail_uuid: uuidN(10), created_epoch: "1792000000", caller_id_number: "5145550000", message_length: "12" },
      { voicemail_message_uuid: uuidN(21), domain_uuid: DOMAIN, voicemail_uuid: uuidN(10), created_epoch: "1792000100", caller_id_number: "5145550001", message_length: "5" },
    ],
    gateways: [{ gateway_uuid: uuidN(30), gateway: "voip.ms", proxy: "montreal.voip.ms", profile: "external", password: "gwpass" }],
    xml_cdr: [
      { xml_cdr_uuid: uuidN(40), domain_uuid: DOMAIN, direction: "inbound", caller_id_number: "5145550000", destination_number: "1001", start_epoch: "1792400000", billsec: "60", duration: "70", hangup_cause: "NORMAL_CLEARING", record_name: `${uuidN(40)}.mp3` },
      { xml_cdr_uuid: uuidN(41), domain_uuid: DOMAIN, direction: "outbound", caller_id_number: "1002", caller_id_name: "=HYPERLINK(1)", destination_number: "5145559999", start_epoch: "1792400100", billsec: "0", duration: "20", hangup_cause: "NO_ANSWER" },
      { xml_cdr_uuid: uuidN(42), domain_uuid: OTHER, direction: "inbound", caller_id_number: "1", destination_number: "2001", start_epoch: "1792400200", billsec: "9" },
    ],
  };
  const channels = [
    { uuid: uuidN(50), direction: "inbound", context: "acme.lemtel.tel", presence_id: "1001@acme.lemtel.tel", cid_num: "5145550000", dest: "1001", callstate: "ACTIVE", created_epoch: "1792400000" },
    { uuid: uuidN(51), direction: "inbound", context: "other.lemtel.tel", presence_id: "2001@other.lemtel.tel", cid_num: "1", dest: "2001", callstate: "ACTIVE" },
  ];
  const calls: Call[] = [];
  const commands: string[] = [];
  let nextId = 100;
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/login.php") {
      if (method === "GET") return new Response('<form><input type="hidden" name="abc123" value="tok"></form>', { headers: { "set-cookie": "PHPSESSID=s1; path=/" } });
      const form = new URLSearchParams(String(init?.body));
      return form.get("password") === "WebPass123!" && form.get("abc123") === "tok" ? new Response(null, { status: 302, headers: { location: "/core/dashboard/", "set-cookie": "PHPSESSID=s2; path=/" } }) : new Response(null, { status: 302, headers: { location: "/login.php" } });
    }
    if (url.pathname === "/app/voicemails/voicemail_messages.php") {
      const cookie = (init?.headers as Record<string, string>)?.Cookie;
      if (cookie !== "PHPSESSID=s2" || url.searchParams.get("uuid") !== uuidN(20)) return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]), { headers: { "content-type": "audio/wav" } });
    }
    if (url.pathname === "/app/xml_cdr/download.php") {
      const cookie = (init?.headers as Record<string, string>)?.Cookie;
      if (cookie !== "PHPSESSID=s2") return new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]), { headers: { "content-type": "audio/mpeg" } });
    }
    const m = url.pathname.match(/^\/app\/api\/7\/([a-z_]+)(?:\/([0-9a-f-]{36}))?$/);
    if (!m) return json({ error: "nope" }, 404);
    const [, path, uuid] = m;
    calls.push({ method, path: uuid ? `${path}/${uuid}` : path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") {
      if ((init?.headers as Record<string, string>)?.Authorization !== `Basic ${API_KEY}`) return json({}, 401);
    } else if (url.searchParams.get("key") !== API_KEY || url.searchParams.get("username") !== "lemtel-api") return json({}, 401);
    if (path === "commands") {
      const { command, arguments: args } = (JSON.parse(String(init!.body)) as { commands: Array<{ command: string; arguments: string }> }).commands[0];
      commands.push(`${command} ${args}`.trim());
      if (command === "show" && args === "channels as json") return json({ details: [{ response: JSON.stringify({ rows: channels }) }] });
      if (command === "show" && args === "registrations as json") return json({ details: [{ response: JSON.stringify({ rows: [{ reg_user: "1001", realm: "acme.lemtel.tel", network_ip: "10.0.0.5", user_agent: "Lemtel" }, { reg_user: "2001", realm: "other.lemtel.tel" }] }) }] });
      return json({ details: [{ response: "+OK" }] });
    }
    const coll = db[path] ?? (db[path] = []);
    const uuidField = path === "xml_cdr" ? "xml_cdr_uuid" : path === "voicemail_messages" ? "voicemail_message_uuid" : `${path.replace(/s$/, "")}_uuid`;
    if (method === "GET" && uuid) { const r = coll.find((x) => x[uuidField] === uuid); return r ? json({ [path]: [r] }) : json({}, 404); }
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 1000), offset = Number(url.searchParams.get("offset") ?? 0);
      const eqs = [...url.searchParams.entries()].filter(([k]) => k !== "limit" && k !== "offset");
      return json({ [path]: coll.filter((r) => eqs.every(([k, v]) => String(r[k]) === v)).slice(offset, offset + limit) });
    }
    const row = (JSON.parse(String(init!.body ?? "{}"))[path] ?? [])[0] ?? {};
    if (method === "POST") { const id = uuidN(nextId++); coll.push({ ...row, [uuidField]: id }); return json({ code: "200", [path]: [{ ...row, [uuidField]: id }] }); }
    if (method === "PUT") { const r = coll.find((x) => x[uuidField] === uuid); if (!r) return json({}, 404); Object.assign(r, row); return json({ code: "200" }); }
    if (method === "DELETE") { db[path] = coll.filter((x) => x[uuidField] !== uuid); return json({ code: "200" }); }
    return json({}, 405);
  }) as typeof fetch;
  return { db, calls, commands, fetchFn };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────────────────────────────────────
const ORG = "11111111-1111-4111-8111-111111111111";
const U = { platform: "22222222-2222-4222-8222-222222222222", admin: "33333333-3333-4333-8333-333333333333", member: "44444444-4444-4444-8444-444444444444", stranger: "55555555-5555-4555-8555-555555555555" };
const RAW_KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const env = (n: string) => ({ LEMTEL_PBX_SECRET_ENCRYPTION_KEY: RAW_KEY, LEMTEL_PBX_SECRET_KEY_VERSION: "1" } as Record<string, string>)[n];

async function setup(opts: { writes?: boolean; verified?: boolean } = {}) {
  const key = (await loadSecretKey(env))!;
  const tables: Record<string, Row[]> = {
    lemtel_organizations: [{ id: ORG, status: "active" }],
    lemtel_platform_administrators: [{ user_id: U.platform, status: "active" }],
    lemtel_organization_memberships: [
      { organization_id: ORG, user_id: U.admin, role: "admin", status: "active" },
      { organization_id: ORG, user_id: U.member, role: "member", status: "active" },
    ],
    lemtel_pbx_connections: [{
      organization_id: ORG, sip_domain: "acme.lemtel.tel", pbx_host: "pbx.lemtel.tel", sip_transport: "tls", sip_port: 5061, wss_url: "wss://pbx.lemtel.tel:7443",
      stun_urls: [], turn_urls: [], registration_expires: 300, codecs: ["opus"], srtp_mode: "dtls_srtp", management_mode: "fusionpbx_api", management_base_url: "https://pbx.lemtel.tel",
      management_domain_uuid: DOMAIN, management_username: "lemtel-api", state: "active", revision: 1,
      management_writes_enabled: opts.writes ?? true, management_verified_at: opts.verified === false ? null : "2026-10-19T00:00:00Z", management_domain_name: opts.verified === false ? null : "acme.lemtel.tel",
    }],
    lemtel_pbx_connection_secrets: [
      { organization_id: ORG, secret_kind: "fusionpbx_api_key", ciphertext: await sealSecret(key, API_KEY, secretAad(ORG, "fusionpbx_api_key")) },
      { organization_id: ORG, secret_kind: "fusionpbx_web_password", ciphertext: await sealSecret(key, "WebPass123!", secretAad(ORG, "fusionpbx_web_password")) },
    ],
    lemtel_pbx_extension_assignments: [
      { organization_id: ORG, user_id: U.member, extension: "1001", state: "assigned" },
      { organization_id: ORG, user_id: U.admin, extension: "1002", state: "assigned" },
    ],
    lemtel_pbx_operation_audit: [], lemtel_pbx_cdr: [], lemtel_pbx_sync_state: [],
  };
  void extensionAad;
  const pbx = fakePbx();
  const sessions = { platform: U.platform, admin: U.admin, member: U.member, stranger: U.stranger };
  let rpcArgs: Row | null = null;
  const admin = fakeAdmin(tables, sessions, (_n, a) => { rpcArgs = a; return { total: 2 }; });
  const d: Deps = { admin, env, fetch: pbx.fetchFn, now: () => Date.parse("2026-10-20T00:00:00Z") };
  const call = async (who: keyof typeof sessions, body: Row) => {
    const res = await handle(new Request("https://x/functions/v1/lemtel-pbx", { method: "POST", headers: { Authorization: `Bearer ${who}` }, body: JSON.stringify({ organizationId: ORG, ...body }) }), d);
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, type, json: type.startsWith("application/json") ? await res.json() : null, raw: type.startsWith("application/json") ? null : res };
  };
  return { tables, pbx, call, rpcArgs: () => rpcArgs };
}

// ─── Tests ────────────────────────────────────────────────────────────────────────────────────────────────────
Deno.test("catalog: secrets are never read out, unknown or mistyped fields are refused", () => {
  const p = projectRow(RESOURCES.extensions, { extension_uuid: uuidN(1), extension: "1001", password: "x", directory_full_name: "A" });
  assertEquals(p.password, undefined); assertEquals(p.password_set, true); assertEquals(p.extension, "1001");
  assertEquals(validateValues(RESOURCES.extensions, { extension: "10a1" }, "create"), { error: "invalid_extension" });
  assertEquals(validateValues(RESOURCES.extensions, { extension: "1003", domain_uuid: OTHER }, "create"), { error: "field_not_writable_domain_uuid" });
  assertEquals(validateValues(RESOURCES.extensions, { enabled: "true" }, "update"), { error: "invalid_enabled" });
  assertEquals(validateValues(RESOURCES.extensions, { enabled: true, call_timeout: 30 }, "update"), { enabled: "true", call_timeout: "30" });
  assertEquals(validateValues(RESOURCES.destinations, { destination_number: "5145550000", destination_data: "1001 XML acme; rm -rf /" }, "create"), { error: "invalid_destination_data" });
  assertEquals(parseBody({ action: "eval", organizationId: ORG }), { error: "invalid_action" });
});

Deno.test("tenant isolation: lists, reads and writes never reach another FusionPBX domain", async () => {
  const { call, pbx } = await setup();
  const list = await call("admin", { action: "resource_list", resource: "extensions" });
  assertEquals(list.status, 200);
  assertEquals(list.json.items.map((x: Row) => x.extension), ["1001"]);
  assert(!JSON.stringify(list.json).includes("SecretSip123!"), "no SIP password in any response");
  assertEquals((await call("admin", { action: "resource_get", resource: "extensions", uuid: uuidN(2) })).status, 404);
  const writesBefore = pbx.calls.filter((c) => c.method !== "GET").length;
  assertEquals((await call("admin", { action: "resource_update", resource: "extensions", uuid: uuidN(2), values: { description: "pwned" } })).status, 404);
  assertEquals((await call("admin", { action: "resource_delete", resource: "extensions", uuid: uuidN(2), confirm: "DELETE" })).status, 404);
  assertEquals(pbx.calls.filter((c) => c.method !== "GET").length, writesBefore, "no write reached FusionPBX");
  assertEquals(pbx.db.extensions.find((e) => e.extension_uuid === uuidN(2))!.description, undefined);
});

Deno.test("create / update / delete: domain forced, reloadxml issued, every write audited, delete needs confirmation", async () => {
  const { call, pbx, tables } = await setup();
  const created = await call("admin", { action: "resource_create", resource: "extensions", values: { extension: "1003", effective_caller_id_name: "Bob", password: "NewSecret123!" } });
  assertEquals(created.status, 200);
  const row = pbx.db.extensions.find((e) => e.extension === "1003")!;
  assertEquals(row.domain_uuid, DOMAIN);
  assert(pbx.commands.includes("reloadxml"));
  assertEquals((await call("admin", { action: "resource_update", resource: "extensions", uuid: created.json.uuid, values: { enabled: false } })).status, 200);
  assertEquals(row.enabled, "false");
  assertEquals((await call("admin", { action: "resource_delete", resource: "extensions", uuid: created.json.uuid })).status, 400);
  assertEquals((await call("admin", { action: "resource_delete", resource: "extensions", uuid: created.json.uuid, confirm: "DELETE" })).status, 200);
  assertEquals(pbx.db.extensions.some((e) => e.extension === "1003"), false);
  const audit = tables.lemtel_pbx_operation_audit.map((a) => `${a.action}:${a.outcome}`);
  assertEquals(audit, ["resource_create:ok", "resource_update:ok", "resource_delete:ok"]);
  assert(!JSON.stringify(tables.lemtel_pbx_operation_audit).includes("NewSecret123!"), "audit never stores values");
});

Deno.test("child resources: the parent must belong to the domain", async () => {
  const { call, pbx } = await setup();
  pbx.db.ring_groups = [{ ring_group_uuid: uuidN(60), domain_uuid: OTHER, ring_group_name: "x" }];
  assertEquals((await call("admin", { action: "resource_create", resource: "ring_group_destinations", values: { ring_group_uuid: uuidN(60), destination_number: "1001" } })).status, 404);
  assertEquals((await call("admin", { action: "resource_list", resource: "ring_group_destinations" })).json.error, "parent_required");
});

Deno.test("roles: members get self-service only; global resources and the write switch are platform-only", async () => {
  const { call } = await setup();
  assertEquals((await call("member", { action: "resource_list", resource: "extensions" })).status, 403);
  assertEquals((await call("member", { action: "live_calls" })).status, 403);
  assertEquals((await call("admin", { action: "resource_list", resource: "gateways" })).status, 403);
  assertEquals((await call("admin", { action: "set_management_writes", enabled: false })).status, 403);
  assertEquals((await call("stranger", { action: "capabilities" })).status, 403);
  const gw = await call("platform", { action: "resource_list", resource: "gateways" });
  assertEquals(gw.status, 200); assertEquals(gw.json.items[0].password_set, true); assertEquals(gw.json.items[0].password, undefined);
  const caps = await call("member", { action: "capabilities" });
  assertEquals(caps.json.selfExtension, "1001"); assertEquals(caps.json.catalog, []);
});

Deno.test("writes stay off until the platform records the PBX owners' agreement after a successful test", async () => {
  const { call, tables } = await setup({ writes: false, verified: false });
  const r = await call("admin", { action: "resource_create", resource: "extensions", values: { extension: "1009" } });
  assertEquals(r.json.error, "management_writes_disabled");
  assertEquals(tables.lemtel_pbx_operation_audit.at(-1)!.outcome, "refused");
  assertEquals((await call("platform", { action: "set_management_writes", enabled: true, confirm: "PBX_OWNERS_AGREED" })).json.error, "test_management_first");
  const t = await call("admin", { action: "test_management" });
  assertEquals(t.json.domainName, "acme.lemtel.tel");
  assertEquals((await call("platform", { action: "set_management_writes", enabled: true })).status, 400, "confirmation phrase required");
  assertEquals((await call("platform", { action: "set_management_writes", enabled: true, confirm: "PBX_OWNERS_AGREED" })).json.writesEnabled, true);
  assertEquals((await call("admin", { action: "resource_create", resource: "extensions", values: { extension: "1009" } })).status, 200);
});

Deno.test("live operations: only this domain's calls are visible or controllable; transfer target is validated", async () => {
  const { call, pbx } = await setup();
  const live = await call("admin", { action: "live_calls" });
  assertEquals(live.json.calls.map((c: Row) => c.uuid), [uuidN(50)]);
  assertEquals((await call("admin", { action: "call_hangup", uuid: uuidN(51) })).status, 404);
  assert(!pbx.commands.some((c) => c.startsWith("uuid_kill")), "no kill sent for another tenant's call");
  assertEquals((await call("admin", { action: "call_transfer", uuid: uuidN(50), destination: "1001 XML other.lemtel.tel" })).json.error, "invalid_destination");
  assertEquals((await call("admin", { action: "call_transfer", uuid: uuidN(50), destination: "1002" })).status, 200);
  assert(pbx.commands.includes(`uuid_transfer ${uuidN(50)} 1002 XML acme.lemtel.tel`));
  assertEquals((await call("admin", { action: "call_hangup", uuid: uuidN(50) })).status, 200);
  const ev = await call("admin", { action: "call_eavesdrop", uuid: uuidN(50), mode: "whisper" });
  assertEquals(ev.json.ringing, "1002");
  assert(pbx.commands.some((c) => c.startsWith("originate {eavesdrop_whisper_aleg=true") && c.endsWith(`user/1002@acme.lemtel.tel &eavesdrop(${uuidN(50)})`)));
  const regs = await call("admin", { action: "registrations" });
  assertEquals(regs.json.registrations.map((r: Row) => r.user), ["1001"]);
});

Deno.test("voicemail: messages, delete, reset returns a new PIN once and purges on request", async () => {
  const { call, pbx, tables } = await setup();
  assertEquals((await call("admin", { action: "voicemail_messages", voicemailUuid: uuidN(10) })).json.messages.length, 2);
  const reset = await call("admin", { action: "voicemail_reset", voicemailUuid: uuidN(10), purge: true });
  assertEquals(reset.status, 200); assertEquals(reset.json.purged, 2);
  assert(/^\d{6}$/.test(reset.json.pin));
  assertEquals(pbx.db.voicemails[0].voicemail_password, reset.json.pin);
  assert(!JSON.stringify(tables.lemtel_pbx_operation_audit).includes(reset.json.pin), "the PIN is never audited");
  assertEquals(pbx.db.voicemail_messages.length, 0);
});

Deno.test("CDR: rolling sync into the local copy, filters, statistics, CSV export without formula injection", async () => {
  const { call, tables, rpcArgs } = await setup();
  const sync = await call("admin", { action: "cdr_sync" });
  assertEquals(sync.json.rowsSeen, 2, "the other domain's CDR is dropped");
  assertEquals(tables.lemtel_pbx_cdr.length, 2);
  assertEquals(tables.lemtel_pbx_sync_state[0].last_outcome, "complete_pass");
  const list = await call("admin", { action: "cdr_list", from: "2026-10-01T00:00:00Z", to: "2026-10-21T00:00:00Z" });
  assertEquals(list.json.total, 2);
  assertEquals(list.json.records[0].direction, "outbound", "newest first");
  assertEquals((await call("admin", { action: "cdr_list", from: "2026-10-01T00:00:00Z", to: "2026-10-21T00:00:00Z", direction: "inbound" })).json.total, 1);
  assertEquals((await call("admin", { action: "cdr_list", from: "2026-10-21T00:00:00Z", to: "2026-10-01T00:00:00Z" })).json.error, "invalid_period");
  const csv = await call("admin", { action: "cdr_export", from: "2026-10-01T00:00:00Z", to: "2026-10-21T00:00:00Z" });
  const text = await csv.raw!.text();
  assertStringIncludes(text, "'=HYPERLINK(1)");
  assertEquals((await call("admin", { action: "cdr_stats", from: "2026-10-01T00:00:00Z", to: "2026-10-21T00:00:00Z" })).json.stats.total, 2);
  assertEquals(rpcArgs()!.target_organization_id, ORG);
  // A member only ever sees calls of their own extension.
  const mine = await call("member", { action: "cdr_list", from: "2026-10-01T00:00:00Z", to: "2026-10-21T00:00:00Z" });
  assertEquals(mine.json.records.map((r: Row) => r.destination), ["1001"]);
  assertEquals((await call("member", { action: "cdr_stats" })).status, 403);
});

Deno.test("recordings: audio through the web session; a member may only play calls of their own extension", async () => {
  const { call } = await setup();
  await call("admin", { action: "cdr_sync" });
  const audio = await call("member", { action: "recording_audio", cdrId: uuidN(40) });
  assertEquals(audio.status, 200); assertEquals(audio.type, "audio/mpeg");
  assertEquals((await call("member", { action: "recording_audio", cdrId: uuidN(41) })).status, 404, "no recording on that call");
  assertEquals((await call("admin", { action: "recording_audio", cdrId: uuidN(42) })).status, 404, "other tenant's CDR is not in this organization's copy");
});

Deno.test("self-service: overview without secrets, forwarding only, own voicemail PIN, click-to-call from own extension", async () => {
  const { call, pbx } = await setup();
  const me = await call("member", { action: "self_overview" });
  assertEquals(me.json.extension, "1001"); assertEquals(me.json.voicemail.messages.length, 2);
  assert(!JSON.stringify(me.json).includes("SecretSip123!") && !JSON.stringify(me.json).includes("1234\""));
  assertEquals((await call("member", { action: "self_update_forwarding", values: { description: "x" } })).json.error, "field_not_writable_description");
  assertEquals((await call("member", { action: "self_update_forwarding", values: { forward_all_enabled: true, forward_all_destination: "5145551234" } })).status, 200);
  assertEquals(pbx.db.extensions[0].forward_all_destination, "5145551234");
  assertEquals((await call("member", { action: "self_voicemail_pin", pin: "12" })).json.error, "invalid_pin");
  assertEquals((await call("member", { action: "self_voicemail_pin", pin: "482913" })).status, 200);
  assertEquals((await call("member", { action: "self_click_to_call", destination: "5145550000" })).json.ringing, "1001");
  assert(pbx.commands.some((c) => c.includes("user/1001@acme.lemtel.tel 5145550000 XML acme.lemtel.tel")));
});

Deno.test("helpers: CDR normalization rejects foreign rows and unsafe names; CSV neutralizes formulas", () => {
  assertEquals(normalizeCdr(ORG, { xml_cdr_uuid: uuidN(1), domain_uuid: OTHER }, DOMAIN), null);
  const n = normalizeCdr(ORG, { xml_cdr_uuid: uuidN(1), domain_uuid: DOMAIN, record_name: "../../etc/passwd", start_epoch: "1792400000", hangup_cause: "bad cause" }, DOMAIN)!;
  assertEquals(n.record_name, "passwd"); assertEquals(n.hangup_cause, null); assertEquals(n.start_at, "2026-10-19T08:53:20.000Z");
  assertStringIncludes(cdrCsv([{ callerName: "+cmd|' /C calc'!A0" }]), "'+cmd");
});

Deno.test("extensions: creating with a password and a user binds the apps' provisioning; re-keying reseals; delete unbinds", async () => {
  const { call, tables, pbx } = await setup();
  tables.lemtel_organization_memberships.push({ organization_id: ORG, user_id: U.stranger, role: "member", status: "active" });
  const key = (await loadSecretKey(env))!;
  const r = await call("admin", { action: "resource_create", resource: "extensions", values: { extension: "1005", password: "Fresh-Secret-1" }, assignUserId: U.stranger });
  assertEquals(r.status, 200); assertEquals(r.json.boundUserId, U.stranger);
  const a = tables.lemtel_pbx_extension_assignments.find((x) => x.user_id === U.stranger)!;
  assertEquals(a.extension, "1005"); assertEquals(a.credential_revision, 1);
  assertEquals(await openSecret(key, String(a.sip_password_ciphertext), extensionAad(ORG, U.stranger, "1005")), "Fresh-Secret-1");
  // Taking an extension already bound to someone else is refused.
  assertEquals((await call("admin", { action: "resource_create", resource: "extensions", values: { extension: "1006" }, assignUserId: U.member })).status, 200, "member moves to 1006");
  assertEquals((await call("admin", { action: "resource_update", resource: "extensions", uuid: r.json.uuid, values: { description: "x" }, assignUserId: U.admin })).json.error, "extension_already_assigned");
  assertEquals(pbx.db.extensions.find((e) => e.extension === "1005")!.description, undefined, "refused before any FusionPBX write");
  // Re-keying the SIP password in FusionPBX re-seals it for the bound user.
  assertEquals((await call("admin", { action: "resource_update", resource: "extensions", uuid: r.json.uuid, values: { password: "Second-Secret-2" } })).status, 200);
  assertEquals(await openSecret(key, String(tables.lemtel_pbx_extension_assignments.find((x) => x.user_id === U.stranger)!.sip_password_ciphertext), extensionAad(ORG, U.stranger, "1005")), "Second-Secret-2");
  assertEquals(tables.lemtel_pbx_extension_assignments.find((x) => x.user_id === U.stranger)!.credential_revision, 2);
  assertEquals((await call("admin", { action: "resource_delete", resource: "extensions", uuid: r.json.uuid, confirm: "DELETE" })).status, 200);
  assertEquals(tables.lemtel_pbx_extension_assignments.some((x) => x.user_id === U.stranger), false);
  assertEquals(pbx.db.extensions.some((e) => e.extension === "1005"), false);
  assertEquals((await call("admin", { action: "resource_create", resource: "voicemails", values: { voicemail_id: "1005" }, assignUserId: U.member })).json.error, "invalid_assign_user");
});

Deno.test("voicemail audio: a member plays their own mailbox only; unknown messages are refused", async () => {
  const { call } = await setup();
  const ok = await call("member", { action: "voicemail_audio", messageUuid: uuidN(20) });
  assertEquals(ok.status, 200); assertEquals(ok.type, "audio/wav");
  assertEquals((await call("member", { action: "voicemail_audio", messageUuid: uuidN(99) })).status, 404);
  assertEquals((await call("admin", { action: "voicemail_audio", voicemailUuid: uuidN(10), messageUuid: uuidN(20) })).status, 200);
});
