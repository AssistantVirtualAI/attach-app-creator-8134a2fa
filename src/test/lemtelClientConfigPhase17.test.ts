import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const OFF = "docs/lemtel-client-config/phase-17-offline";
const SQL = `${OFF}/20261002040000_lemtel_client_config_lifecycle.sql`;
const FN = `${OFF}/lemtel-client-config/index.ts`;
const FN_TEST = `${OFF}/lemtel-client-config/index_test.ts`;
const DOC = "docs/lemtel-client-config/phase-17-configuration-lifecycle.md";
const THREAT = "docs/lemtel-client-config/phase-17-threat-model.md";
const FILES = [SQL, FN, FN_TEST, DOC, THREAT, "src/test/lemtelClientConfigPhase17.test.ts"];
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const guard = async () => await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-planipret-isolation.mjs")).href);
const scopeOk = (paths: string[], isProtected: (p: string) => boolean) => paths.every((p) => FILES.includes(p)) && !paths.some(isProtected);

describe("Lemtel Phase 17 — offline configuration lifecycle", () => {
  it("the six Phase 17 paths are not Planiprêt-protected and nothing is placed where it would apply or deploy", async () => {
    const { isProtected } = await guard();
    for (const p of FILES) expect(isProtected(p), p).toBe(false);
    expect(fs.existsSync(path.join(root, "supabase/functions/lemtel-client-config"))).toBe(false);
    expect(fs.existsSync(path.join(root, "supabase/migrations/20261002040000_lemtel_client_config_lifecycle.sql"))).toBe(false);
  });

  it("migration is table-only, additive, RLS on, service-role only", () => {
    const s = rd(SQL);
    const code = s.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.lemtel_client_config_devices/);
    expect(code.match(/CREATE TABLE/g)).toHaveLength(1);
    for (const r of [/ENABLE ROW LEVEL SECURITY/, /REVOKE ALL ON public\.lemtel_client_config_devices FROM anon/, /REVOKE ALL ON public\.lemtel_client_config_devices FROM authenticated/, /GRANT ALL ON public\.lemtel_client_config_devices TO service_role/,
      /UNIQUE \(device_ref\)/, /UNIQUE \(user_id, platform, installation_ref_hash\)/, /CHECK \(revision > 0\)/, /CHECK \(platform IN/, /CHECK \(state IN/, /\(user_id, platform\)/, /\(organization_id\)/, /lemtel_ccd_device_ref_idx/, /ON DELETE CASCADE/]) expect(code).toMatch(r);
    for (const bad of [/CREATE POLICY/i, /CREATE (OR REPLACE )?FUNCTION/i, /TRIGGER/i, /cron/i, /\bDROP\b/i, /ALTER TABLE (?!public\.lemtel_client_config_devices)/i, /pbx_user_devices/, /GRANT [^;]* TO (anon|authenticated)/i, /\bUPDATE\b|\bINSERT\b|\bDELETE\b/i]) expect(code).not.toMatch(bad);
    expect(s).toMatch(/Only the authenticated lemtel-client-config server function owns lifecycle operations/);
  });

  it("function has exactly four actions, strict validation, required codes and no forbidden coupling", () => {
    const s = rd(FN);
    expect(s).toMatch(/export const ACTIONS = \["register", "manifest", "revoke_self", "revoke_device"\] as const/);
    for (const c of ["unauthorized", "method_not_allowed", "invalid_json", "invalid_body", "invalid_action", "invalid_platform", "invalid_installation_ref", "invalid_device_ref", "no_softphone_account", "app_access_disabled", "platform_access_disabled", "device_not_found", "device_revoked", "forbidden"]) expect(s, c).toContain(`"${c}"`);
    expect(s).toContain("lemtel_client_config_manifest_v1");
    expect(s).toContain('edgeFeatureGate: false');
    for (const bad of ["fet" + "ch(", "functions.in" + "voke", "Fusion" + "PBX", "Ver" + "to", "PJ" + "SIP", "Web" + "Socket", "ws" + "s://", "SI" + "P", "pbx_user_devices", "console."]) expect(s, bad).not.toContain(bad);
    expect(s.indexOf("validateBody(raw)")).toBeLessThan(s.indexOf('from("'));
  });

  it("no prohibited fields are selected, returned or logged", () => {
    const s = rd(FN);
    const cols = s.match(/ACCOUNT_COLUMNS = "([^"]+)"/)![1].split(",");
    for (const bad of ["sip_password", "wss_url", "sip_domain", "extension", "forward_to", "raw_data"]) expect(cols).not.toContain(bad);
    expect(s).not.toMatch(/select\(\s*["'`]\*/);
    for (const bad of ["sip_" + "password", "ws" + "s_url", "sip_" + "domain", "forward_" + "to", "raw_" + "data"]) expect(s).not.toContain(bad);
  });

  it("docs state lifecycle, privacy, no-PBX/Edge, no-credential and deferred-integration rules", () => {
    const d = rd(DOC), t = rd(THREAT);
    for (const x of ["source-only and not deployed", "stay authoritative", "remains separate and unchanged", "not the old portal device record", "Revocation blocks future manifest responses", "Phase 19/20", "No direct PBX, Edge, Verto", "portal reconciliation phase"]) expect(d, x).toContain(x);
    for (const x of ["enumeration", "Guessed", "Cross-org", "reactivation", "Duplicate registration", "leakage", "replay", "denial bypass", "confusion", "unknown fields", "coupling"]) expect(t, x).toContain(x);
  });

  it("scope helper rejects Planiprêt and application paths in a real temporary Git repository", async () => {
    const { isProtected } = await guard();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p17-"));
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const put = (p: string) => { fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), "x\n"); };
    const changed = () => (g("diff", "--name-only", base) + "\n" + g("ls-files", "--others", "--exclude-standard")).split("\n").filter(Boolean);
    let base = "";
    try {
      g("init", "-q"); put("README.md"); g("update-index", "--add", "README.md");
      base = g("commit-tree", g("write-tree"), "-m", "base"); g("update-ref", "HEAD", base);
      for (const p of FILES) put(p);
      expect(scopeOk(changed(), isProtected)).toBe(true);
      put("src/pages/planipret/X.tsx");
      expect(changed().some(isProtected)).toBe(true);
      expect(scopeOk(changed(), isProtected)).toBe(false);
      fs.rmSync(path.join(tmp, "src/pages"), { recursive: true });
      put("apps/ava-softphone-mobile/src/App.tsx");
      expect(scopeOk(changed(), isProtected)).toBe(false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("real repository worktree is unchanged", () => {
    const st = () => execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    const before = st();
    rd(FN); rd(SQL);
    expect(st()).toBe(before);
  });
});
