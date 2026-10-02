import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const TYPE_BASE = "5445522ee";
const TYPE_END = "96279c00b";
const TYPE_PATH = "src/integrations/supabase/types.ts";
const BLOCK_SHA = "9aaadff33bdd91fb133b6dbe5d04dbbfe1327ad24dec5c3f4490728ebb3425ef";

const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);

const extract = () => {
  const a = git("show", `${TYPE_BASE}:${TYPE_PATH}`).split("\n");
  const b = git("show", `${TYPE_END}:${TYPE_PATH}`).split("\n");
  let i = 0;
  while (a[i] === b[i]) i++;
  const n = b.length - a.length;
  return { a, b, i, n, block: b.slice(i, i + n) };
};

describe("Lemtel Phase 19B.3 — generated Supabase type attestation", () => {
  it("Planiprêt guard passes before", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));

  it("frozen interval exists and contains exactly the types file", () => {
    for (const c of [TYPE_BASE, TYPE_END]) expect(git("cat-file", "-t", c).trim(), c).toBe("commit");
    expect(() => git("merge-base", "--is-ancestor", TYPE_BASE, TYPE_END)).not.toThrow();
    const changed = git("diff", "--name-only", "--no-renames", `${TYPE_BASE}..${TYPE_END}`).split("\n").filter(Boolean);
    expect(changed).toEqual([TYPE_PATH]);
  });

  it("end content equals base plus one block between lemtel_cdrs_cache and lemtel_config", () => {
    const { a, b, i, n, block } = extract();
    expect(n).toBe(84);
    expect(b.slice(0, i).concat(b.slice(i + n))).toEqual(a);
    expect(block[0]).toBe("      lemtel_client_config_devices: {");
    expect(b[i + n]).toBe("      lemtel_config: {");
    expect(b.slice(0, i).some((l) => l === "      lemtel_cdrs_cache: {")).toBe(true);
    expect(b.filter((l) => /^\s*lemtel_client_config_devices:/.test(l)).length).toBe(1);
  });

  it("block is 84 lines with the attested SHA-256 and matches current HEAD", () => {
    const { block } = extract();
    const text = block.join("\n") + "\n";
    expect(crypto.createHash("sha256").update(text).digest("hex")).toBe(BLOCK_SHA);
    expect(fs.readFileSync(path.join(root, TYPE_PATH), "utf8").includes(text)).toBe(true);
  });

  it("block defines only expected fields and no sensitive or telephony data", () => {
    const { block } = extract();
    const text = block.join("\n");
    const fields = new Set([...text.matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]));
    expect([...fields].sort()).toEqual(["created_at", "device_ref", "id", "installation_ref_hash", "last_seen_at", "organization_id", "platform", "revision", "revoked_at", "softphone_user_id", "state", "updated_at", "user_id"]);
    expect(text).not.toMatch(/password|secret|token|endpoint|host|url|https?:|\bsip\b|verto|fusion|pjsip|websocket|wss?:/i);
  });

  it("types file unchanged after TYPE_END through HEAD", () => {
    expect(git("diff", "--name-only", "--no-renames", `${TYPE_END}..HEAD`, "--", TYPE_PATH).trim()).toBe("");
    expect(git("diff", "--name-only", "HEAD", "--", TYPE_PATH).trim()).toBe("");
  });

  it("Drizzle artefacts remain absent", () => {
    expect(fs.existsSync(path.join(root, "drizzle.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "drizzle"))).toBe(false);
    for (const f of ["package.json", "bun.lock"]) expect(fs.readFileSync(path.join(root, f), "utf8")).not.toMatch(/drizzle-kit|drizzle-orm|"postgres"/);
  });

  it("real temporary Git repository: types-only accepted; extra or Planiprêt path refused; real repo unchanged", () => {
    const before = git("status", "--porcelain");
    const scope = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p19b3-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [TYPE_PATH, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p19b3");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean);
        return JSON.stringify(list) === JSON.stringify([TYPE_PATH]) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(scope([])).toBe(true);
    expect(scope(["src/lib/other.ts"])).toBe(false);
    expect(scope(["src/lib/planipret/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(before);
  }, 30000);

  it("Planiprêt guard passes after", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));
});
