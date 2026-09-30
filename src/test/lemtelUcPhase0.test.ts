import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { LucConfigError, requireSecret, verifyEdgeSignature } from "../../supabase/functions/_shared/luc_secrets";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const SECRET = "a".repeat(20) + "b".repeat(44);

describe("Lemtel UC phase 0", () => {
  it("missing or blank LUC_CRED_KEY fails closed", () => {
    for (const v of [undefined, "", "   ", "short", "changeme"]) expect(() => requireSecret("LUC_CRED_KEY", v)).toThrow(LucConfigError);
    expect(requireSecret("LUC_CRED_KEY", SECRET)).toBe(SECRET);
  });

  it("missing Edge secret fails closed and error hides the value", async () => {
    await expect(verifyEdgeSignature(undefined, "{}", "0".repeat(64))).rejects.toThrow(LucConfigError);
    await expect(verifyEdgeSignature("", "{}", "0".repeat(64))).rejects.toThrow("luc_config_missing:LUC_EDGE_SECRET");
  });

  it("accepts valid and rejects invalid Edge signatures", async () => {
    const body = '{"event":"registration_health"}';
    const good = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(await verifyEdgeSignature(SECRET, body, good)).toBe(true);
    expect(await verifyEdgeSignature(SECRET, body, good.toUpperCase())).toBe(true);
    expect(await verifyEdgeSignature(SECRET, body + " ", good)).toBe(false);
    expect(await verifyEdgeSignature(SECRET, body, "zz")).toBe(false);
    expect(await verifyEdgeSignature(SECRET, body, null)).toBe(false);
  });

  it("browser code has no plaintext PBX/SIP secret path", () => {
    for (const f of [...walk(path.join(root, "src/pages/lemtel-uc")), ...walk(path.join(root, "src/components/lemtel-uc"))]) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/sip_password|api_credential|ciphertext|type="password"[^>]*credential/i);
    }
    const prov = read("supabase/functions/luc-provision/index.ts");
    expect(prov).toMatch(/credentials_not_accepted/);
    expect(prov).not.toMatch(/encryptSecret\(/);
  });

  it("bootstrap is one-only and database-enforced", () => {
    const prov = read("supabase/functions/luc-provision/index.ts");
    expect(prov).toMatch(/rpc\("luc_bootstrap_platform_admin"/);
    expect(prov).not.toMatch(/count: "exact"/);
    const mig = walk(path.join(root, "supabase/migrations")).filter((f) => f.includes("luc_bootstrap")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect(mig).toMatch(/CREATE UNIQUE INDEX[\s\S]*WHERE role = 'platform_admin'/);
    expect(mig).toMatch(/pg_advisory_xact_lock/);
    expect(mig).toMatch(/ON CONFLICT DO NOTHING/);
    expect(mig).toMatch(/FROM PUBLIC, anon, authenticated/);
  });

  it("reconciliation doc names the canonical Lemtel objects", () => {
    const d = read("docs/lemtel-uc/reconciliation.md");
    for (const t of ["organizations", "pbx_extensions", "pbx_softphone_users", "pbx_user_devices", "pbx_call_records", "pbx_voicemails", "pbx_call_recordings", "fusionpbx-proxy", "mock-only"]) expect(d).toContain(t);
  });

  it("LUC migration uses explicit grants the security gate recognizes", () => {
    const out = execSync("node scripts/security-gate.mjs || true", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).not.toMatch(/luc_[a-z_]+ is created without any GRANT/);
    expect(read("supabase/migrations/20260930193449_db0fec5b-231f-420a-b259-615dd0faf59f.sql")).not.toMatch(/EXECUTE format\('GRANT/);
  });

  it("no Planipret or published Lemtel app files changed by LUC work", () => {
    let changed = "";
    try { changed = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }); } catch { return; }
    expect(changed).not.toMatch(/apps\/planipret-mobile|apps\/ava-softphone-(mobile|desktop)|shared\/planipret-design-tokens|docs\/planipret\//);
  });
});
