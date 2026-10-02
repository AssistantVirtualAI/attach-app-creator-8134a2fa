import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const load = async () => await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-planipret-isolation.mjs")).href);
const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });

// Genuine temporary Git repository via local plumbing (real commit objects, command-local identity).
// Base commit = one neutral file; end commit = base + the four Phase 15A files (+ optional extra paths).
const repo = (m: any, extra: string[] = []) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p15a-"));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  const put = (p: string, src?: string) => {
    fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true });
    if (src === undefined) fs.copyFileSync(path.join(root, p), path.join(tmp, p)); else fs.writeFileSync(path.join(tmp, p), src);
    g("update-index", "--add", p);
  };
  const commit = (msg: string, parent?: string) => { const c = g("commit-tree", g("write-tree"), ...(parent ? ["-p", parent] : []), "-m", msg); g("update-ref", "HEAD", c); expect(g("cat-file", "-t", c)).toBe("commit"); return c; };
  g("init", "-q");
  put("README.md", "base\n");
  const base = commit("base");
  for (const p of m.ALLOWED) put(p);
  for (const p of extra) put(p, "x\n");
  const end = commit("phase15a", base);
  return { tmp, base, end };
};
const run = async (extra: string[] = [], mutate?: (tmp: string) => void) => {
  const m = await load();
  const r = repo(m, extra);
  try { mutate?.(r.tmp); return m.verify([], r.tmp, { base: r.base }); }
  finally { fs.rmSync(r.tmp, { recursive: true, force: true }); }
};

describe("Lemtel Phase 15A — Planiprêt isolation", () => {
  it("exact four-file allowlist passes in a real Git repository", async () => {
    expect(await run()).toEqual({ code: 0, stdout: "LEMTEL_ISOLATION_PASSED\n" });
  });

  it("each canonical protected path and native plugin path fails", async () => {
    for (const p of ["apps/planipret-mobile/src/x.ts", "src/pages/planipret/X.tsx", "src/components/planipret/X.tsx", "src/lib/planipret/x.ts", "src/hooks/useMplanipretSoftphone.ts",
      "ios/Plugins/PpPjsip/A.swift", "other/PpSipKeepAlive/B.m", "x/ppvoipcall/C.m", "docs/Planipret/a.md", "misc/MyPLANIPRETthing.ts"]) {
      const r = await run([p]);
      expect(r.code, p).toBe(1);
      expect(r.stdout, p).toMatch(/PLANIPRET_PATH_CHANGED/);
    }
  });

  it("a Lemtel mobile app change fails during this isolation-only phase", async () => {
    const r = await run(["apps/ava-softphone-mobile/src/App.tsx"]);
    expect(r.stdout).toMatch(/OUTSIDE_ALLOWLIST/);
    expect(r.stdout).not.toMatch(/PLANIPRET_PATH_CHANGED/);
  });

  it("an untracked file fails", async () => {
    const r = await run([], (t) => fs.writeFileSync(path.join(t, "stray.txt"), "x\n"));
    expect(r.stdout).toMatch(/UNTRACKED_FILE/);
  });

  it("malformed, narrowed, broadened or extended policy fails", async () => {
    const m = await load();
    const p = JSON.parse(fs.readFileSync(path.join(root, m.POLICY), "utf8"));
    expect(m.checkPolicy(p)).toBe(true);
    const bad = [
      { ...p, protectedPathPrefixes: p.protectedPathPrefixes.slice(1) },
      { ...p, protectedPathPatterns: ["**/*"] },
      { ...p, protectedPathPatterns: p.protectedPathPatterns.slice(1) },
      { ...p, extra: true },
      { ...p, mode: "allow" },
      { ...p, lemtelAllowedRoots: [...p.lemtelAllowedRoots, "apps/"] },
    ];
    for (const b of bad) expect(m.checkPolicy(b)).toBe(false);
    for (const mutate of [(s: string) => s.slice(0, 20), (s: string) => JSON.stringify(bad[0])]) {
      const r = await run([], (t) => { const f = path.join(t, m.POLICY); fs.writeFileSync(f, mutate(fs.readFileSync(f, "utf8"))); });
      expect(r.stdout).toMatch(/POLICY_INVALID/);
    }
  });

  it("invalid CLI arguments return code 2 with the exact usage line", async () => {
    const m = await load();
    for (const a of [["--base=0000000"], ["x"], ["--base=a1bd41eba", "y"]]) expect(m.verify(a, root)).toEqual({ code: 2, stdout: "LEMTEL_ISOLATION_USAGE: [--base=a1bd41eba]\n" });
  });

  it("verifier uses only read-only Git and leaves the real repository unchanged", async () => {
    const m = await load();
    const before = status();
    m.verify([], root);
    await run(["apps/planipret-mobile/x"]);
    expect(status()).toBe(before);
    const src = fs.readFileSync(path.join(root, m.SELF), "utf8");
    expect(m.checkSelf(src)).toBe(true);
    expect(m.checkSelf(src + "\nwrite" + "FileSync(x)\n")).toBe(false);
  });
});
