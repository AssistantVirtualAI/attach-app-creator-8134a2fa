import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const FN = "supabase/functions/lemtel-client-config/index.ts";
const UI = "src/components/lemtel/LemtelClientDeviceControls.tsx";
const PAGE = "src/pages/lemtel/CustomerSettings.tsx";
const FILES = [
  FN,
  "supabase/functions/lemtel-client-config/index_test.ts",
  "src/test/lemtelClientConfigPromotionPhase19B.test.ts",
  UI,
  PAGE,
  "docs/lemtel-client-config/phase-20a-portal-device-controls.md",
  "docs/lemtel-client-config/phase-20a-threat-model.md",
  "src/test/lemtelPortalDeviceControlsPhase20.test.ts",
].sort();

const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const listBlock = () => { const s = rd(FN); return s.slice(s.indexOf('if (v.action === "list_devices")'), s.indexOf('if (v.action === "revoke_device")')); };

describe("Lemtel Phase 20A — portal device controls", () => {
  it("Planiprêt guard passes before", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));

  it("declares exactly eight Phase 20A files, none protected", () => {
    expect(FILES.length).toBe(8);
    expect(FILES.filter(isProtected)).toEqual([]);
    for (const f of FILES) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });

  it("list_devices requires a UUID and rejects extra keys", () => {
    const s = rd(FN);
    expect(s).toContain('list_devices: ["action", "organizationId"]');
    expect(s).toMatch(/UUID_RE\.test\(b\.organizationId\)\) return fail\("invalid_organization_id", 400\)/);
    expect(s).toContain('keys.some((k) => !FIELDS[action].includes(k))');
  });

  it("requires JWT and Lemtel/org-admin authorization, filtered by organizationId", () => {
    const s = rd(FN);
    expect(s.indexOf("auth.getUser()")).toBeLessThan(s.indexOf('if (v.action === "list_devices")'));
    expect(rd("supabase/config.toml")).toMatch(/\[functions\.lemtel-client-config\]\nverify_jwt = true/);
    const b = listBlock();
    expect(b).toContain('admin.rpc("is_lemtel_admin"');
    expect(b).toContain('.eq("user_id", userId).eq("organization_id", v.organizationId).in("role", ["org_admin", "super_admin"])');
    expect(b).toContain('respond({ error: "forbidden" }, 403)');
    expect(b).toContain('.select(LIST_COLUMNS).eq("organization_id", v.organizationId)');
    expect(b).toContain(".limit(LIST_LIMIT)");
    expect(s).toContain("export const LIST_LIMIT = 200;");
  });

  it("list selection and response expose only allowed metadata", () => {
    const s = rd(FN);
    expect(s).toContain('export const LIST_COLUMNS = "device_ref,platform,state,revision,created_at,updated_at,last_seen_at,revoked_at";');
    const map = s.slice(s.indexOf("export function toListResponse"), s.indexOf("// Optimistic concurrency"));
    expect(map).not.toMatch(/\bid\b|user_id|organization_id|softphone_user_id|installation_ref_hash|password|secret|token|endpoint|recording|voicemail|cdr/i);
    expect(listBlock()).not.toMatch(/DEVICE_COLUMNS|installation_ref_hash|softphone_user_id/);
  });

  it("revocation stays single-device by deviceRef with optimistic concurrency; no bulk/revive/delete", () => {
    const s = rd(FN);
    expect(s).toContain('.eq("revision", target.revision).eq("state", target.state)');
    expect(s).toContain('revoke_device: ["action", "deviceRef"]');
    expect(s).not.toMatch(/\.delete\(|state: "approved" \}|revive|reactivate|bulk|\.in\("device_ref"/i);
  });

  it("portal component only calls adminInvoke on lemtel-client-config, no table/PBX/credential access", () => {
    const u = rd(UI);
    expect(u).toContain('from "@/lib/adminInvoke"');
    expect(u).toContain('const FN = "lemtel-client-config"');
    expect(u).toContain('{ action: "list_devices", organizationId }');
    expect(u).toContain('{ action: "revoke_device", deviceRef }');
    expect(u).not.toMatch(/supabase\.from|lemtel_client_config_devices|functions\.invoke|\bfetch\(|fusion|pbx|verto|pjsip|jssip|websocket|wss?:\/\/|sip:|password\s*[:=]|token|secret/i);
    const p = rd(PAGE);
    expect(p).toContain('import { LemtelClientDeviceControls } from "@/components/lemtel/LemtelClientDeviceControls";');
    expect(p).toContain("<LemtelClientDeviceControls organizationId={org.id} />");
  });

  it("UI requires confirmation, has no approve/re-enable/delete and explains the limitation", () => {
    const u = rd(UI);
    expect(u).toContain("AlertDialog");
    expect(u).toContain("Confirm revoke");
    expect(u).toContain("irreversible in this phase");
    expect(u).toContain("does not change the phone-line password, the extension, other devices or current calls");
    expect(u).toContain("do not consume this lifecycle yet");
    expect(u).not.toMatch(/>\s*(Approve|Re-?enable|Delete|Reactivate)\b/i);
    expect(u).toMatch(/d\.state !== "revoked" &&/);
  });

  it("real temporary Git repository: eight files accepted; ninth or Planiprêt path refused; real repo unchanged", () => {
    const before = git("status", "--porcelain");
    const scope = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p20a-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p20a");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(scope([])).toBe(true);
    expect(scope(["supabase/functions/other/index.ts"])).toBe(false);
    expect(scope(["src/lib/planipret/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(before);
  }, 30000);

  it("Planiprêt guard passes after", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));
});
