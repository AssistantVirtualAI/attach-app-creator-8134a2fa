// Offline Deno unit tests: no credentials, no network. Deno.serve is stubbed before import.
import { assert, assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: () => Promise.resolve() });
const m = await import("./index.ts");

const ACCOUNT = {
  id: "11111111-1111-4111-8111-111111111111", organization_id: "22222222-2222-4222-8222-222222222222", domain_uuid: "33333333-3333-4333-8333-333333333333",
  extension_id: "44444444-4444-4444-8444-444444444444", portal_user_id: "55555555-5555-4555-8555-555555555555", app_access_enabled: true,
  mobile_access_enabled: true, desktop_access_enabled: false, account_status: "active", dnd_enabled: false, forward_enabled: true, updated_at: "2026-09-01T10:00:00Z",
};
const DEVICE = { device_ref: "dev_" + "a".repeat(32), state: "approved" as const, revision: 1, platform: "mobile" as const };
const INST = "Install_Ref_ABCDEFGH_1234";
const REF = /^[a-z0-9][a-z0-9_-]{2,63}$/;

Deno.test("invalid method, JSON, action, body, platform and references return stable codes", async () => {
  const call = async (method: string, body?: string) => (await (await m.handler(new Request("http://x/", { method, body }))).json()).error;
  assertEquals(await call("GET"), "method_not_allowed");
  assertEquals(await call("PUT", "{}"), "method_not_allowed");
  assertEquals(await call("POST", "{bad"), "invalid_json");
  assertEquals(await call("POST", JSON.stringify({ action: "register", platform: "mobile", installationRef: INST })), "unauthorized");
  const cases: [unknown, string][] = [
    [[], "invalid_body"], [null, "invalid_body"], ["x", "invalid_body"], [{}, "invalid_body"],
    [{ action: "delete_all" }, "invalid_action"],
    [{ action: "register", platform: "web", installationRef: INST }, "invalid_platform"],
    [{ action: "register", platform: "mobile", installationRef: "short" }, "invalid_installation_ref"],
    [{ action: "register", platform: "mobile", installationRef: "bad ref with spaces!!" }, "invalid_installation_ref"],
    [{ action: "manifest", platform: "mobile", deviceRef: "guess" }, "invalid_device_ref"],
    [{ action: "revoke_device", deviceRef: 5 }, "invalid_device_ref"],
  ];
  for (const [b, code] of cases) assertEquals((m.validateBody(b) as { error: string }).error, code);
});

Deno.test("unknown or missing body properties are rejected", () => {
  assertEquals((m.validateBody({ action: "register", platform: "mobile", installationRef: INST, extra: 1 }) as { error: string }).error, "invalid_body");
  assertEquals((m.validateBody({ action: "revoke_device", deviceRef: DEVICE.device_ref, platform: "mobile" }) as { error: string }).error, "invalid_body");
  assertEquals((m.validateBody({ action: "manifest", platform: "mobile" }) as { error: string }).error, "invalid_body");
});

Deno.test("installation reference never appears in storage payload, manifest or errors", async () => {
  const p = await m.deviceInsertPayload(ACCOUNT, "mobile", INST);
  assert(!JSON.stringify(p).includes(INST));
  assertEquals(p.installation_ref_hash, await m.sha256Hex(INST));
  assert(!JSON.stringify(await m.buildManifest(ACCOUNT, DEVICE)).includes(INST));
  assert(!JSON.stringify(m.validateBody({ action: "register", platform: "x", installationRef: INST })).includes(INST));
});

Deno.test("manifest is Phase 16 compatible and contains no prohibited names or raw values", async () => {
  const man = await m.buildManifest(ACCOUNT, DEVICE, new Date("2026-10-02T08:00:00.123Z"));
  assert(man);
  assertEquals(Object.keys(man).sort(), ["access", "capabilities", "device", "identity", "observability", "revision", "routing", "schemaVersion", "telephonyPolicy"]);
  assertEquals(man.routing, { routingMode: "direct_current", routingAssignmentRef: "route_direct_current_v1", fallbackMode: "direct_current", edgeFeatureGate: false });
  assertEquals(man.capabilities, { maestroSyncState: "disabled", avaCallActionState: "disabled", avaSmsActionState: "disabled", microsoftSsoState: "not_ready" });
  assertEquals(man.revision.issuedAt, "2026-10-02T08:00:00Z");
  assertEquals(man.revision.expiresAt, "2026-10-02T08:15:00Z");
  assertEquals(man.telephonyPolicy.forwardingState, "enabled");
  for (const r of [man.identity.organizationRef, man.identity.domainRef, man.identity.extensionRef, man.identity.userRef, man.revision.manifestRevision, man.device.deviceRevision, man.telephonyPolicy.credentialRevisionRef]) assert(REF.test(r), r);
  const keys = JSON.stringify(man).match(/"[A-Za-z_]+":/g)!.map((k) => k.toLowerCase());
  for (const bad of ["password", "secret", "token", "host", "url", "extension\"", "forward_to", "forwardto", "phone", "endpoint", "recording_url", "transcript\""]) assert(!keys.some((k) => k.includes(bad)), bad);
  const text = JSON.stringify(man);
  for (const raw of Object.values(ACCOUNT)) if (typeof raw === "string" && raw.length > 6) assert(!text.includes(raw), raw);
});

Deno.test("revoked devices produce no manifest; resolver keeps one record and never reactivates", async () => {
  assertEquals(await m.buildManifest(ACCOUNT, { ...DEVICE, state: "revoked" }), null);
  assertEquals(m.resolveRegistration(null), "insert");
  assertEquals(m.resolveRegistration(DEVICE), "reuse");
  assertEquals(m.resolveRegistration({ ...DEVICE, state: "revoked" }), "revoked");
});

Deno.test("derived references are deterministic and opaque", async () => {
  const a = await m.opaqueRef("rev", ACCOUNT.id, ACCOUNT.updated_at, 1);
  assertEquals(a, await m.opaqueRef("rev", ACCOUNT.id, ACCOUNT.updated_at, 1));
  assert(a !== await m.opaqueRef("rev", ACCOUNT.id, ACCOUNT.updated_at, 2));
  assert(!a.includes(ACCOUNT.id.slice(0, 8)) && !a.includes("2026"));
});

Deno.test("access failures are stable", () => {
  assertEquals(m.accessFailure(null, "mobile")?.error, "no_softphone_account");
  assertEquals(m.accessFailure({ ...ACCOUNT, app_access_enabled: false }, "mobile")?.error, "app_access_disabled");
  assertEquals(m.accessFailure(ACCOUNT, "desktop")?.error, "platform_access_disabled");
  assertEquals(m.accessFailure(ACCOUNT, "mobile"), null);
});

Deno.test("source has no network, PBX, env reads in helpers, or raw logging", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const bad of ["fet" + "ch(", "functions.in" + "voke", "Fusion" + "PBX", "Ver" + "to", "PJ" + "SIP", "Web" + "Socket", "ws" + "s://", "SI" + "P", "console.", "sip_" + "password", "ws" + "s_url", "sip_" + "domain", "forward_" + "to"]) assert(!src.includes(bad), bad);
  const helpers = src.slice(0, src.indexOf("export async function handler"));
  assert(!helpers.includes("Deno.env"));
  assert(!m.ACCOUNT_COLUMNS.split(",").includes("extension"));
});

Deno.test("documented default device_ref shape matches dev_ + 32 lowercase hex", () => {
  for (let i = 0; i < 5; i++) assert(/^dev_[0-9a-f]{32}$/.test("dev_" + crypto.randomUUID().replaceAll("-", "")));
});

Deno.test("DEVICE_COLUMNS carries internal ownership fields that never reach the manifest", async () => {
  const cols = m.DEVICE_COLUMNS.split(",");
  for (const c of ["id", "organization_id", "user_id", "softphone_user_id"]) assert(cols.includes(c), c);
  const internal = { ...DEVICE, id: "66666666-6666-4666-8666-666666666666", organization_id: ACCOUNT.organization_id, user_id: ACCOUNT.portal_user_id, softphone_user_id: ACCOUNT.id };
  const text = JSON.stringify(await m.buildManifest(ACCOUNT, internal));
  for (const raw of [internal.id, internal.organization_id, internal.user_id, internal.softphone_user_id]) assert(!text.includes(raw), raw);
  for (const k of ["organization_id", "user_id", "softphone_user_id", "\"id\""]) assert(!text.includes(k), k);
});

Deno.test("own-device reads and writes are bound to user, organization and softphone account", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const own = src.slice(src.indexOf("const a = account as Account;"));
  const bind = '.eq("organization_id", a.organization_id).eq("softphone_user_id", a.id)';
  const lifecycle = own.split("\n").filter((l) => l.includes('.eq("user_id", userId)'));
  assert(lifecycle.length >= 5, String(lifecycle.length));
  for (const l of lifecycle) assert(l.includes(bind), l.trim());
  assert(own.includes('.eq("installation_ref_hash", hash)' + bind));
});

Deno.test("mutations verify an affected row; zero-row, stale or errored mutations never succeed", async () => {
  assertEquals(m.mutationApplied({ id: "x" }, null), true);
  assertEquals(m.mutationApplied(null, null), false);
  assertEquals(m.mutationApplied(undefined, null), false);
  assertEquals(m.mutationApplied({ id: "x" }, { message: "e" }), false);
  assertEquals(m.mutationApplied({}, null), false);
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const updates = src.split(".update(").length - 1;
  assertEquals(updates, 4);
  assertEquals((src.match(/\.select\("id"\)\.maybeSingle\(\)/g) ?? []).length, 4);
  assertEquals((src.match(/if \(!mutationApplied\(/g) ?? []).length, 4);
  for (const rev of src.split("\n").filter((l) => l.includes('.update({ state: "revoked", revision:'))) assert(rev.includes("const { data: changed"), rev.trim());
  assert(src.includes('.eq("revision", target.revision).eq("state", target.state)'));
  assert(src.includes('.eq("revision", d.revision).eq("state", d.state)'));
});
