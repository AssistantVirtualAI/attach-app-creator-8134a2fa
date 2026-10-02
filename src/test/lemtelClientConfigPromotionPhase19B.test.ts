import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "ddd7211f2";
const PHASE19B_END = "dc111644a";
const OFF = "docs/lemtel-client-config/phase-17-offline";
const MIG = "supabase/migrations/20261002220000_lemtel_client_config_lifecycle.sql";
const FN = "supabase/functions/lemtel-client-config/index.ts";
const FN_TEST = "supabase/functions/lemtel-client-config/index_test.ts";
const FILES = [MIG, FN, FN_TEST, "supabase/config.toml", "docs/lemtel-client-config/phase-17-configuration-lifecycle.md", "src/test/lemtelClientConfigPhase17.test.ts", "docs/lemtel-client-config/phase-19b-backend-promotion.md", "src/test/lemtelClientConfigPromotionPhase19B.test.ts"].sort();
const HASHES: Record<string, string> = {
  [`${OFF}/20261002040000_lemtel_client_config_lifecycle.sql`]: "1ef44fe6c5c5a78a1680ec721222cd86697e3cab55f87b9c1d04210070a1c3f3",
  [`${OFF}/lemtel-client-config/index.ts`]: "8a9b0fecd52e36440feed41add54e05ec5a43b220f28b36f3c69977c9acd88a3",
  [`${OFF}/lemtel-client-config/index_test.ts`]: "e492ed3993f5911783451529e60a878fd393763040f05b1ca37bbe436b8d3de8",
};
const OLD_FRAGMENT = `        const { data: m } = await admin.from("org_members").select("role").eq("user_id", userId).eq("org_id", target.organization_id).maybeSingle();
        allowed = !!m && ["owner", "admin", "org_admin"].includes(String(m.role));`;
const NEW_FRAGMENT = `        const { data: r } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("organization_id", target.organization_id).in("role", ["org_admin", "super_admin"]).limit(1);
        allowed = Array.isArray(r) && r.length === 1;`;

const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const execSql = (t: string) => t.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();

describe("Lemtel Phase 19B — controlled backend promotion", () => {
  it("Planiprêt guard passes before", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));

  it("frozen Phase 19B interval contains exactly the eight original files; no Planiprêt path", () => {
    for (const c of [BASE, PHASE19B_END]) expect(git("cat-file", "-t", c).trim(), c).toBe("commit");
    expect(() => git("merge-base", "--is-ancestor", BASE, PHASE19B_END)).not.toThrow();
    const changed = [...new Set(git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE19B_END}`).split("\n").filter(Boolean))].sort();
    expect(changed).toEqual(FILES);
    expect(changed.filter(isProtected)).toEqual([]);
  });

  it("real migration executable SQL is identical to the offline source and has no policy, function, trigger or data change", () => {
    const m = rd(MIG);
    expect(execSql(m)).toBe(execSql(rd(`${OFF}/20261002040000_lemtel_client_config_lifecycle.sql`)));
    const code = execSql(m.replace(/'[^']*'/g, "''"));
    expect(code).not.toMatch(/CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|cron|\bDROP\b|pbx_user_devices|\bINSERT\b|\bUPDATE\b|(?<!ON )\bDELETE\b/i);
    expect((code.match(/GRANT /g) ?? []).length).toBe(1);
  });

  it("historical Phase 19B function (dc111644a) equals the offline source except the authorized admin fallback fragment", () => {
    const off = rd(`${OFF}/lemtel-client-config/index.ts`);
    expect(off.split(OLD_FRAGMENT).length).toBe(2);
    expect(git("show", `${PHASE19B_END}:${FN}`)).toBe(off.replace(OLD_FRAGMENT, NEW_FRAGMENT));
  });

  it("real function avoids forbidden dependencies and outputs", () => {
    const s = rd(FN);
    expect(s).not.toMatch(/org_members|pbx_user_devices|fusion|verto|pjsip|websocket|wss?:\/\/|\bfetch\(|functions\.invoke|\bsip:/i);
    expect(s).not.toMatch(/console\.(log|info|warn|error)\([^)]*(pass|secret|token)/i);
    expect(s).not.toMatch(/respond\(\{[^}]*(password|secret|token)\s*:/i);
  });

  it("config.toml has exactly one lemtel-client-config entry with verify_jwt = true and no other change", () => {
    const now = rd("supabase/config.toml");
    expect(now.match(/\[functions\.lemtel-client-config\]/g)?.length).toBe(1);
    const before = git("show", `${BASE}:supabase/config.toml`);
    expect(now).toBe(before + "\n[functions.lemtel-client-config]\nverify_jwt = true\n");
  });

  it("offline historical sources keep their hashes", () => {
    for (const [p, h] of Object.entries(HASHES)) expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex"), p).toBe(h);
  });

  it("real temporary Git repository: eight files pass; ninth file or Planiprêt path fails; real repo unchanged", () => {
    const before = git("status", "--porcelain");
    const scope = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p19b-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p19b");
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
