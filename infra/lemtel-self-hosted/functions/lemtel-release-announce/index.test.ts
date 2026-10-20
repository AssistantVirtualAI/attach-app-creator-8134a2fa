import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { handle, type Deps } from "./index.ts";
import { compareVersions, latestDesktopRelease, parseLatestRelease, PINNED_DESKTOP_RELEASE, releaseFor, resetDesktopReleaseCache } from "../_shared/lemtelDesktopRelease.ts";
import { distributionUrls } from "../_shared/lemtelTransactionalEmail.ts";

// Minimal in-memory stand-in for the supabase-js query builder (only what the function uses).
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>, users: Record<string, Row>, sessions: Record<string, string> = {}) {
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row = {};
    let conflict: string[] = [];
    let limit = Infinity;
    const run = () => {
      const t = tables[name];
      if (op === "insert") {
        const pk = name === "lemtel_desktop_release_announcements" ? ["version"] : ["version", "user_id"];
        if (t.some((r) => pk.every((k) => r[k] === payload[k]))) return { data: null, error: { code: "23505" } };
        t.push({ ...payload }); return { data: [payload], error: null };
      }
      if (op === "upsert") {
        const hit = t.find((r) => conflict.every((k) => r[k] === payload[k]));
        if (hit) Object.assign(hit, payload); else t.push({ ...payload });
        return { data: [payload], error: null };
      }
      const rows = t.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op === "update") { rows.forEach((r) => Object.assign(r, payload)); return { data: rows.map((r) => ({ ...r })), error: null }; }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b, eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      limit: (n: number) => { limit = n; return b; },
      insert: (p: Row) => { op = "insert"; payload = p; return b; },
      update: (p: Row) => { op = "update"; payload = p; return b; },
      upsert: (p: Row, o: { onConflict: string }) => { op = "upsert"; payload = p; conflict = o.onConflict.split(","); return b; },
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return {
    from,
    auth: {
      getUser: (token: string) => Promise.resolve(sessions[token] ? { data: { user: { id: sessions[token] } }, error: null } : { data: { user: null }, error: { message: "bad" } }),
      admin: { getUserById: (id: string) => Promise.resolve({ data: { user: users[id] ?? null }, error: null }) },
    },
  };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const u = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
function setup() {
  const tables: Record<string, Row[]> = {
    lemtel_organizations: [{ id: ORG, status: "active" }, { id: "gone", status: "archived" }],
    lemtel_organization_memberships: [
      { organization_id: ORG, user_id: u(1), status: "active" }, { organization_id: ORG, user_id: u(2), status: "active" },
      { organization_id: ORG, user_id: u(3), status: "suspended" }, { organization_id: "gone", user_id: u(4), status: "active" },
      { organization_id: ORG, user_id: u(5), status: "active" },
    ],
    lemtel_platform_administrators: [{ user_id: u(9), status: "active" }],
    lemtel_desktop_release_announcements: [{ version: "2.5.22", state: "baseline", claimed_at: new Date(0).toISOString() }],
    lemtel_desktop_release_deliveries: [],
  };
  const users: Record<string, Row> = {
    [u(1)]: { email: "a@example.com", user_metadata: { full_name: "Ana", locale: "fr" } },
    [u(2)]: { email: "b@example.com", user_metadata: { full_name: "Bob", locale: "en" } },
    [u(3)]: { email: "c@example.com", user_metadata: {} },
    [u(4)]: { email: "d@example.com", user_metadata: {} },
    [u(5)]: { email: "e@example.com", user_metadata: {}, banned_until: "2999-01-01T00:00:00Z" },
  };
  return { tables, users };
}
const email = { apiKey: "re_testkey_0123456789abcdef", from: "Lemtel <noreply@example.com>", downloadUrls: { ios: "https://x.example/a", android: "https://x.example/b", windows: "https://x.example/c", macosApple: "https://x.example/d", macosIntel: "https://x.example/e" } };
function deps(admin: unknown, version: string | null, sent: Array<{ to: string; subject: string; html: string }>, over: Partial<Deps> = {}): Deps {
  let clock = 1_800_000_000_000;
  return {
    admin, email: () => email, now: () => clock, sleep: (ms) => { clock += ms; return Promise.resolve(); }, budgetMs: 100_000, spacingMs: 600,
    release: () => Promise.resolve(version ? releaseFor(version, null, "github_latest") : PINNED_DESKTOP_RELEASE),
    send: (_c, to, m) => { sent.push({ to, ...m }); return Promise.resolve({ accepted: true, providerMessageId: `id-${sent.length}` }); },
    ...over,
  };
}
const post = (token?: string, body?: unknown) => new Request("https://x/functions/v1/lemtel-release-announce", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });

Deno.test("release parse: only a published vX.Y.Z with all three uploaded installers", () => {
  const assets = (v: string) => [`Lemtel-Telecom-Setup-${v}.exe`, `Lemtel-Telecom-${v}-arm64.dmg`, `Lemtel-Telecom-${v}-x64.dmg`].map((name) => ({ name, state: "uploaded", size: 90_000_000 }));
  const ok = parseLatestRelease({ tag_name: "v2.5.23", draft: false, prerelease: false, published_at: "2026-10-21T00:00:00Z", assets: assets("2.5.23") })!;
  assertEquals(ok.version, "2.5.23");
  assertEquals(ok.windows, "https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases/download/v2.5.23/Lemtel-Telecom-Setup-2.5.23.exe");
  assertEquals(parseLatestRelease({ tag_name: "v2.5.23", draft: false, prerelease: false, assets: assets("2.5.23").slice(0, 2) }), null, "an incomplete upload is not used");
  assertEquals(parseLatestRelease({ tag_name: "v2.5.23", draft: false, prerelease: true, assets: assets("2.5.23") }), null);
  assertEquals(parseLatestRelease({ tag_name: "lemtel-ios-v1", draft: false, prerelease: false, assets: [] }), null);
  assertEquals(parseLatestRelease({ tag_name: "v2.5.023", draft: false, prerelease: false, assets: assets("2.5.23") }), null);
  assert(compareVersions("2.5.10", "2.5.9") > 0);
});

Deno.test("resolver: newest release flows into the email links; failures keep the last good value or the pin", async () => {
  resetDesktopReleaseCache();
  const assets = ["Lemtel-Telecom-Setup-2.6.0.exe", "Lemtel-Telecom-2.6.0-arm64.dmg", "Lemtel-Telecom-2.6.0-x64.dmg"].map((name) => ({ name, state: "uploaded", size: 90_000_000 }));
  let calls = 0;
  const good = (() => { calls++; return Promise.resolve(new Response(JSON.stringify({ tag_name: "v2.6.0", draft: false, prerelease: false, assets }))); }) as typeof fetch;
  const bad = (() => { calls++; return Promise.reject(new Error("offline")); }) as typeof fetch;
  assertEquals((await latestDesktopRelease(bad, 1000)).source, "pinned");
  assertEquals((await latestDesktopRelease(good, 2000)).version, "2.5.22", "failure back-off: no refetch within a minute");
  assertEquals((await latestDesktopRelease(good, 70_000)).version, "2.6.0");
  assertEquals((await latestDesktopRelease(bad, 80_000)).version, "2.6.0", "cached");
  assertEquals((await latestDesktopRelease(bad, 80_000, true)).version, "2.6.0", "a failed refresh keeps the last good value");
  const urls = distributionUrls({ get: () => "https://testflight.apple.com" })!;
  assertStringIncludes(urls.windows, "/v2.6.0/Lemtel-Telecom-Setup-2.6.0.exe");
  assertEquals(urls.ios, "https://apps.apple.com/ca/app/lemtel-softphone/id6786177551?l=fr-CA", "legacy env pins are ignored");
  assertEquals(urls.android, "https://play.google.com/store/apps/details?id=com.lemtel.softphone&pcampaignid=web_share");
  assert(calls >= 3);
  resetDesktopReleaseCache();
});

Deno.test("announce: each active user once, in their language; banned, suspended and archived-org users skipped", async () => {
  const { tables, users } = setup();
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const r = await handle(post(), deps(fakeAdmin(tables, users), "2.5.23", sent));
  const body = await r.json();
  assertEquals(body.status, "sent"); assertEquals(body.recipients, 2);
  assertEquals(sent.map((s) => s.to).sort(), ["a@example.com", "b@example.com"]);
  assertStringIncludes(sent.find((s) => s.to === "a@example.com")!.subject, "nouvelle version");
  assertStringIncludes(sent.find((s) => s.to === "b@example.com")!.subject, "new desktop version");
  assertStringIncludes(sent[0].html, "/v2.5.23/Lemtel-Telecom-2.5.23-arm64.dmg");
  assert(!JSON.stringify(body).includes("@"), "no address in the response");
  // Second trigger (workflow retry, another admin click): nothing is sent again.
  const again = await (await handle(post(), deps(fakeAdmin(tables, users), "2.5.23", sent))).json();
  assertEquals(again.status, "already_announced"); assertEquals(sent.length, 2);
});

Deno.test("announce: baseline and older versions are never sent; no complete release means nothing", async () => {
  const { tables, users } = setup();
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  assertEquals((await (await handle(post(), deps(fakeAdmin(tables, users), "2.5.22", sent))).json()).status, "already_announced");
  assertEquals((await (await handle(post(), deps(fakeAdmin(tables, users), "2.5.21", sent))).json()).status, "older_than_announced");
  assertEquals((await (await handle(post(), deps(fakeAdmin(tables, users), null, sent))).json()).status, "no_complete_release");
  assertEquals(sent.length, 0);
});

Deno.test("announce: a run over its time budget is partial and the next call resumes without duplicates", async () => {
  const { tables, users } = setup();
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const first = await (await handle(post(), deps(fakeAdmin(tables, users), "2.5.23", sent, { budgetMs: 500 }))).json();
  assertEquals(first.status, "partial"); assertEquals(first.remaining, 1); assertEquals(sent.length, 1);
  // Make the claim stale-proof: a partial run is resumable immediately.
  const second = await (await handle(post(), deps(fakeAdmin(tables, users), "2.5.23", sent))).json();
  assertEquals(second.status, "sent"); assertEquals(second.resumed, true);
  assertEquals(sent.map((s) => s.to).sort(), ["a@example.com", "b@example.com"]);
});

Deno.test("announce: a signed-in non-administrator is refused; a platform administrator may trigger", async () => {
  const { tables, users } = setup();
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const admin = fakeAdmin(tables, users, { member: u(1), admin: u(9) });
  assertEquals((await handle(post("member"), deps(admin, "2.5.23", sent))).status, 403);
  assertEquals((await (await handle(post("admin"), deps(admin, "2.5.23", sent))).json()).status, "sent");
  assertEquals(tables.lemtel_desktop_release_announcements.find((r) => r.version === "2.5.23")!.triggered_by, "platform_admin");
  assertEquals((await handle(new Request("https://x", { method: "GET" }), deps(admin, "2.5.23", sent))).status, 405);
});

Deno.test("status: platform administrators only, counts and versions only; unknown bodies refused", async () => {
  const { tables, users } = setup();
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const admin = fakeAdmin(tables, users, { member: u(1), admin: u(9) });
  assertEquals((await handle(post(undefined, { action: "status" }), deps(admin, "2.5.23", sent))).status, 401);
  assertEquals((await handle(post("member", { action: "status" }), deps(admin, "2.5.23", sent))).status, 403);
  assertEquals((await handle(post(undefined, { version: "9.9.9" }), deps(admin, "2.5.23", sent))).status, 400, "a caller cannot choose a version");
  const s = await (await handle(post("admin", { action: "status" }), deps(admin, "2.5.23", sent))).json();
  assertEquals(s.latest.version, "2.5.23"); assertEquals(s.history[0].version, "2.5.22"); assertEquals(s.history[0].state, "baseline");
  assertEquals(sent.length, 0);
});
