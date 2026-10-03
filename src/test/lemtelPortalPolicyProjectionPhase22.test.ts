import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "1467ed489";
const PHASE22A_END = "25cf91bd2";
const CFG = "supabase/functions/lemtel-client-config/index.ts";
const PROXY = "supabase/functions/fusionpbx-proxy/index.ts";
const FILES = [
  CFG,
  "supabase/functions/lemtel-client-config/index_test.ts",
  PROXY,
  "docs/lemtel-client-config/phase-22a-portal-policy-projection.md",
  "docs/lemtel-client-config/phase-22a-threat-model.md",
  "src/test/lemtelPortalPolicyProjectionPhase22.test.ts",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = (...a: string[]) => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs", ...a], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const V = "Ver" + "to";

// Pure re-implementation check: the exported projection is mirrored by source inspection of the exact rules.
describe("Lemtel Phase 22A — portal policy projection", () => {
  const statusBefore = git("status", "--porcelain");

  it("guards pass before", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("six exact files exist, none protected, delivery range stays within them", () => {
    expect(FILES.length).toBe(6);
    expect(FILES.filter(isProtected)).toEqual([]);
    for (const f of FILES) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE22A_END], { cwd: root });
    const changed = git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE22A_END}`).split("\n").filter(Boolean).sort();
    expect(changed.filter(isProtected)).toEqual([]);
    expect(changed).toEqual(FILES);
  });

  it("reads only pbx_extensions with five strict columns, bound to extension_id and organization_id", () => {
    const s = rd(CFG);
    expect(s).toContain('export const EXTENSION_POLICY_COLUMNS = "do_not_disturb,forward_all_enabled,call_recording,voicemail_enabled,updated_at";');
    expect(s.match(/from\("pbx_extensions"\)/g)?.length).toBe(1);
    expect(s).toContain('.from("pbx_extensions").select(EXTENSION_POLICY_COLUMNS).eq("id", a.extension_id).eq("organization_id", a.organization_id).limit(1).maybeSingle()');
    for (const bad of ["forward_all_destination", "raw_data", "voicemail_password"]) expect(s).not.toContain(bad);
  });

  it("legacy dnd_enabled / forward_enabled removed from Account and ACCOUNT_COLUMNS", () => {
    const s = rd(CFG);
    expect(s).not.toContain("dnd_enabled");
    expect(s).not.toContain("forward_enabled");
    expect(between(s, "export const ACCOUNT_COLUMNS", "\n")).toBe('export const ACCOUNT_COLUMNS = "id,organization_id,domain_uuid,extension_id,portal_user_id,app_access_enabled,mobile_access_enabled,desktop_access_enabled,account_status,updated_at";');
  });

  it("manifest keeps the Phase 16 contract and projects the four states by the matrix", () => {
    const s = rd(CFG);
    const proj = between(s, "export function projectPolicy", "\n}\n");
    expect(proj).toContain('if (!p) return { dndState: "disabled", forwardingState: "disabled", recordingPolicy: "not_allowed", voicemailPolicy: "disabled" }');
    expect(proj).toContain('p.do_not_disturb === true ? "enabled" : "disabled"');
    expect(proj).toContain('p.forward_all_enabled === true ? "enabled" : "disabled"');
    expect(proj).toContain('RECORDING_MANAGED.includes(p.call_recording) ? "portal_managed" : "not_allowed"');
    expect(proj).toContain('p.voicemail_enabled === true ? "enabled" : "disabled"');
    expect(s).toContain('const RECORDING_MANAGED = ["inbound", "outbound", "all"];');
    expect(s).toContain('routing: { routingMode: "direct_current", routingAssignmentRef: "route_direct_current_v1", fallbackMode: "direct_current", edgeFeatureGate: false }');
    expect(s).toContain('capabilities: { maestroSyncState: "disabled", avaCallActionState: "disabled", avaSmsActionState: "disabled", microsoftSsoState: "not_ready" }');
    expect(s).toContain("callsPrivacyScope: OWN, recordingsPrivacyScope: OWN, voicemailPrivacyScope: OWN, transcriptsPrivacyScope: OWN");
    const tp = between(s, "telephonyPolicy: {", "},");
    for (const bad of ["policy.", "destination", "password", "url", "raw_data"]) expect(tp).not.toContain(bad);
    expect(s).toContain("buildManifest(a, device as Device, new Date(), policy)");
    expect(s).toContain("buildManifest(a, d, new Date(), policy)");
  });

  it("manifestRevision incorporates policy revision through an opaque digest", () => {
    const s = rd(CFG);
    const rev = between(s, "manifestRevision:", "\n");
    expect(rev).toContain('await opaqueRef("rev"');
    expect(rev).toContain("policy?.updated_at");
  });

  it("mapExtension handles forward_all_enabled", () => {
    const fn = between(rd(PROXY), "function mapExtension(e: any)", "pbx_source:");
    expect(fn).toContain('forward_all_enabled: e.forward_all_enabled === "true" || e.forward_all_enabled === true,');
  });

  it("update-extension mirrors only after PBX success, by organization_id + extension_uuid, four fields only", () => {
    const b = between(rd(PROXY), 'if (action === "update-extension") {', '\n    }\n');
    expect(b).toContain('const pbxResult: any = await writeCollection("extensions", "extensions", params);');
    expect(b.indexOf("if (!pbxResult?.ok) return json(pbxResult, 200);")).toBeLessThan(b.indexOf(".update(mirror)"));
    expect(b).toContain('.from("pbx_extensions").update(mirror).eq("organization_id", organization_id).eq("pbx_uuid", extUuid)');
    const keys = [...b.matchAll(/mirror\.([a-z_]+) =/g)].map((x) => x[1]).sort();
    expect(keys).toEqual(["call_recording", "do_not_disturb", "forward_all_enabled", "voicemail_enabled"]);
    expect(b).toContain('["none", "inbound", "outbound", "all"]');
    expect(b).toContain("Object.keys(mirror).length === 0");
    for (const bad of ["forward_all_destination", "password", "raw_data", "retry", "fetch(", "mirrorErr.message"]) expect(b).not.toContain(bad);
    expect(b).toContain('.update(mirror).eq("organization_id", organization_id).eq("pbx_uuid", extUuid).select("id").maybeSingle()');
    expect(b).toContain('policyMirror: !mirrorErr && mirrorRow ? "updated" : "pending_sync"');
    expect(b.match(/"updated"/g)?.length).toBe(1);
    expect(b).toContain('policyMirror: "pending_sync"');
    expect(b).not.toContain(V);
  });

  it("no migration, types, drizzle, package/lockfile or new SIP/PBX mechanism", () => {
    const changed = git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE22A_END}`).split("\n").filter(Boolean);
    for (const f of changed) expect(f).not.toMatch(/supabase\/migrations\/|integrations\/supabase\/types\.ts|drizzle|package(-lock)?\.json|bun\.lockb?|pnpm-lock|yarn\.lock|config\.toml/);
    const baseProxy = git("show", `${BASE}:${PROXY}`);
    const cur = rd(PROXY);
    expect(cur.split(V).length).toBe(baseProxy.split(V).length);
    expect(cur.split("pbxWrite(").length).toBe(baseProxy.split("pbxWrite(").length);
    expect(cur.split("fetch(").length).toBe(baseProxy.split("fetch(").length);
    for (const bad of ["fet" + "ch(", "Web" + "Socket", V, "functions.in" + "voke"]) expect(rd(CFG)).not.toContain(bad);
  });

  it("real temporary Git repository: six files pass, seventh or Planiprêt path fails; real repo unchanged", () => {
    const check = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p22a-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p22a");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(check([])).toBe(true);
    expect(check(["supabase/functions/pbx-write/index.ts"])).toBe(false);
    expect(check(["src/pages/planipret/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(statusBefore);
  }, 30000);

  it("guards pass after", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
