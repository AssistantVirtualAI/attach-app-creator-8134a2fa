import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const load = async () => await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-planipret-isolation.mjs")).href);
const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });

type Refs = { base: string; end: string; compat: string };
type Opts = { hist?: string[]; compatPaths?: string[]; later?: string[]; scoped?: string[]; args?: (r: Refs & { scope?: string }) => string[]; mutate?: (tmp: string, g: (...a: string[]) => string) => void; refs?: (r: Refs) => Refs };

// Genuine temporary Git repository via local plumbing (real commit objects, command-local identity).
// base = neutral file; end = base + four Phase 15A files (+ hist extras);
// compat = end + compatibility paths (default: the seven approved); optional later commit (+ later paths).
const run = async (o: Opts = {}) => {
  const m = await load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p15a-"));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  const put = (p: string, src?: string) => {
    fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true });
    if (src === undefined) fs.copyFileSync(path.join(root, p), path.join(tmp, p)); else fs.writeFileSync(path.join(tmp, p), src);
    g("update-index", "--add", p);
  };
  const commit = (msg: string, parent?: string) => { const c = g("commit-tree", g("write-tree"), ...(parent ? ["-p", parent] : []), "-m", msg); g("update-ref", "HEAD", c); expect(g("cat-file", "-t", c)).toBe("commit"); return c; };
  try {
    g("init", "-q");
    put("README.md", "base\n");
    const base = commit("base");
    for (const p of m.ALLOWED) put(p);
    for (const p of o.hist ?? []) put(p, "x\n");
    const end = commit("phase15a", base);
    for (const p of o.compatPaths ?? m.APPROVED_COMPATIBILITY_PLANIPRET_PATHS) put(p, "c\n");
    put("docs/lemtel-isolation/compat-note.md", "n\n");
    const compat = commit("compat", end);
    let tip = compat;
    if (o.later) { for (const p of o.later) put(p, "y\n"); tip = commit("later", compat); }
    // Phase 15D: `scope` = start of a Lemtel phase; `scoped` paths are committed inside scope..HEAD.
    put("docs/lemtel-isolation/scope-start.md", "s\n");
    const scope = commit("scope-start", tip);
    if (o.scoped) { for (const p of o.scoped) put(p, "z\n"); commit("scoped", scope); }
    o.mutate?.(tmp, g);
    const refs = o.refs ? o.refs({ base, end, compat }) : { base, end, compat };
    return m.verify(o.args ? o.args({ ...refs, scope }) : [], tmp, refs);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};
const PASS = { code: 0, stdout: "LEMTEL_ISOLATION_PASSED\n" };

describe("Lemtel Phase 15A.1 — frozen scope + permanent Planiprêt guard", () => {
  it("exports the frozen end and the real repository passes", async () => {
    const m = await load();
    expect(m.PHASE15A_END).toBe("87b6b8029");
    expect(m.verify(["--base=a1bd41eba"], root)).toEqual(PASS);
  });

  it("the exact four-file historical interval passes", async () => {
    expect(await run()).toEqual(PASS);
  });

  it("later Lemtel-only commits do not make Phase 15A fail", async () => {
    expect(await run({ later: ["docs/lemtel-isolation/phase-15b-x.md", "scripts/verify-lemtel-x.mjs", "src/test/lemtelX.test.ts", "apps/ava-softphone-mobile/src/App.tsx"] })).toEqual(PASS);
  });

  it("Phase 15D: a committed Planiprêt path before the Lemtel scope no longer fails (no-arg and --scope)", async () => {
    expect(await run({ later: ["src/pages/planipret/X.tsx"] })).toEqual(PASS);
    expect(await run({ later: ["src/pages/planipret/X.tsx"], args: (r) => [`--scope=${r.scope}`] })).toEqual(PASS);
  });

  it("Phase 15D: a Planiprêt path inside scope..HEAD fails with PLANIPRET_SCOPE_CHANGED", async () => {
    for (const p of ["apps/planipret-mobile/src/x.ts", "src/pages/planipret/X.tsx", "src/components/planipret/X.tsx", "src/lib/planipret/x.ts", "src/hooks/useMplanipretSoftphone.ts",
      "ios/Plugins/PpPjsip/A.swift", "other/PpSipKeepAlive/B.m", "x/ppvoipcall/C.m", "docs/Planipret/a.md", "misc/MyPLANIPRETthing.ts"]) {
      const r = await run({ scoped: [p], args: (x) => [`--scope=${x.scope}`] });
      expect(r.code, p).toBe(1);
      expect(r.stdout, p).toMatch(/PLANIPRET_SCOPE_CHANGED/);
    }
  }, 30000);

  it("Phase 15D: a non-protected Lemtel path inside scope..HEAD passes", async () => {
    expect(await run({ scoped: ["apps/ava-softphone-desktop/src/App.tsx", "docs/lemtel-x/a.md"], args: (x) => [`--scope=${x.scope}`] })).toEqual(PASS);
  });

  it("Phase 15D: missing, non-commit or reversed scope fails; --base and --scope never combine", async () => {
    expect((await run({ args: () => ["--scope=" + "0".repeat(40)] })).stdout).toMatch(/SCOPE_MISSING/);
    expect((await run({ mutate: (_t, g) => { (globalThis as any).__blob = g("hash-object", "-w", "README.md"); }, args: () => ["--scope=" + (globalThis as any).__blob] })).stdout).toMatch(/SCOPE_MISSING/);
    const m = await load();
    expect(m.verify(["--base=a1bd41eba", "--scope=98eee7107"], root).code).toBe(2);
    expect(m.verify(["--scope=xyz"], root).code).toBe(2);
    expect(m.verify(["--scope="], root).code).toBe(2);
  });

  it("Phase 15D: reversed scope (descendant of HEAD) fails with SCOPE_NOT_ANCESTOR", async () => {
    let tip = "";
    const r = await run({ scoped: ["docs/lemtel-x/c.md"], mutate: (_t, g) => { tip = g("rev-parse", "HEAD"); g("update-ref", "HEAD", g("rev-parse", "HEAD~1")); }, args: () => [`--scope=${tip}`] });
    expect(r.stdout).toMatch(/SCOPE_NOT_ANCESTOR/);
  });

  it("Phase 15D: the real repository passes with --scope=98eee7107", async () => {
    const m = await load();
    expect(m.verify(["--scope=98eee7107"], root)).toEqual(PASS);
  });

  it("staged, unstaged or untracked Planiprêt worktree paths fail", async () => {
    const p = "src/lib/planipret/x.ts";
    const cases: Opts["mutate"][] = [
      (t) => { fs.mkdirSync(path.join(t, "src/lib/planipret"), { recursive: true }); fs.writeFileSync(path.join(t, p), "u\n"); },
      (t, g) => { fs.mkdirSync(path.join(t, "src/lib/planipret"), { recursive: true }); fs.writeFileSync(path.join(t, p), "s\n"); g("update-index", "--add", p); },
    ];
    for (const mutate of cases) expect((await run({ mutate })).stdout).toMatch(/PLANIPRET_WORKTREE_CHANGED/);
    const unstaged = await run({ later: [p], mutate: (t) => fs.writeFileSync(path.join(t, p), "changed\n") });
    expect(unstaged.stdout).toMatch(/PLANIPRET_WORKTREE_CHANGED/);
  });

  it("a non-Planiprêt untracked file does not fail", async () => {
    expect(await run({ mutate: (t) => fs.writeFileSync(path.join(t, "stray.txt"), "x\n") })).toEqual(PASS);
  });

  it("a protected or extra path inside the historical range fails", async () => {
    const r = await run({ hist: ["src/pages/planipret/X.tsx"] });
    expect(r.stdout).toMatch(/PLANIPRET_PATH_CHANGED/);
    expect(r.stdout).toMatch(/HISTORICAL_SCOPE_EXACT/);
    expect((await run({ hist: ["apps/ava-softphone-mobile/x.ts"] })).stdout).toMatch(/HISTORICAL_SCOPE_EXACT/);
  });

  it("missing commits and reversed ancestry fail", async () => {
    expect((await run({ refs: (r) => ({ ...r, base: "0".repeat(40) }) })).stdout).toMatch(/BASE_MISSING/);
    expect((await run({ refs: (r) => ({ ...r, end: "0".repeat(40) }) })).stdout).toMatch(/END_MISSING/);
    expect((await run({ refs: (r) => ({ ...r, base: r.end, end: r.base }) })).stdout).toMatch(/BASE_NOT_ANCESTOR/);
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
    for (const mut of [(s: string) => s.slice(0, 20), () => JSON.stringify(bad[0])]) {
      const r = await run({ mutate: (t) => { const f = path.join(t, m.POLICY); fs.writeFileSync(f, mut(fs.readFileSync(f, "utf8"))); } });
      expect(r.stdout).toMatch(/POLICY_INVALID/);
    }
  });

  it("invalid CLI arguments return code 2 with the exact usage line", async () => {
    const m = await load();
    for (const a of [["--base=0000000"], ["x"], ["--base=a1bd41eba", "y"], ["--scope=ZZ"], ["--scope=98eee7107", "--x"]]) expect(m.verify(a, root)).toEqual({ code: 2, stdout: "LEMTEL_ISOLATION_USAGE: [--base=a1bd41eba] [--scope=<commit>]\n" });
  });

  it("unsafe capabilities fail and the real repository is unchanged", async () => {
    const m = await load();
    const before = status();
    m.verify([], root);
    await run({ later: ["apps/planipret-mobile/x"] });
    expect(status()).toBe(before);
    const src = fs.readFileSync(path.join(root, m.SELF), "utf8");
    expect(m.checkSelf(src)).toBe(true);
    for (const bad of ["write" + "FileSync(x)", "fet" + "ch(u)", "proc" + "ess.env.X", 'execFileSync("s' + 'h", [])', 'import x from "node:h' + 'ttp";'])
      expect(m.checkSelf(src + "\n" + bad + "\n"), bad).toBe(false);
    const r = await run({ mutate: (t) => { const f = path.join(t, m.SELF); fs.writeFileSync(f, fs.readFileSync(f, "utf8") + "\nfet" + "ch(u)\n"); } });
    expect(r.stdout).toMatch(/VERIFIER_CAPABILITY/);
  });
});

describe("Lemtel Phase 15C — one-time historical Planiprêt compatibility baseline", () => {
  it("exports the exact, sorted seven-path list and the frozen cutoff", async () => {
    const m = await load();
    expect(m.PLANIPRET_COMPATIBILITY_END).toBe("2d933df2f");
    const l = m.APPROVED_COMPATIBILITY_PLANIPRET_PATHS as string[];
    expect(l).toHaveLength(7);
    expect([...l].sort()).toEqual(l);
    for (const p of l) { expect(p).not.toMatch(/[*?]|\/$/); expect(m.isProtected(p)).toBe(true); }
  });

  it("the real repository passes and its status is unchanged", async () => {
    const m = await load();
    const before = status();
    expect(m.verify([], root)).toEqual(PASS);
    expect(status()).toBe(before);
  });

  it("exactly the seven approved paths in the compatibility interval pass", async () => {
    expect(await run()).toEqual(PASS);
  });

  it("an extra protected path in the compatibility interval fails", async () => {
    const m = await load();
    const r = await run({ compatPaths: [...m.APPROVED_COMPATIBILITY_PLANIPRET_PATHS, "src/lib/planipret/extra.ts"] });
    expect(r.stdout).toMatch(/PLANIPRET_COMPATIBILITY_SCOPE_EXACT/);
  });

  it("a missing approved path in the compatibility interval fails", async () => {
    const m = await load();
    const r = await run({ compatPaths: m.APPROVED_COMPATIBILITY_PLANIPRET_PATHS.slice(1) });
    expect(r.stdout).toMatch(/PLANIPRET_COMPATIBILITY_SCOPE_EXACT/);
  });

  it("re-changing an approved path inside a Lemtel scope fails", async () => {
    const r = await run({ scoped: ["src/pages/planipret/mobile/MCalls.tsx"], args: (x) => [`--scope=${x.scope}`] });
    expect(r.stdout).toMatch(/PLANIPRET_SCOPE_CHANGED/);
  });

  it("a later non-Planiprêt Lemtel change passes", async () => {
    expect(await run({ later: ["apps/ava-softphone-mobile/src/hooks/x.ts"] })).toEqual(PASS);
  });

  it("missing or reversed compatibility cutoff fails", async () => {
    expect((await run({ refs: (r) => ({ ...r, compat: "0".repeat(40) }) })).stdout).toMatch(/COMPATIBILITY_END_MISSING/);
    expect((await run({ refs: (r) => ({ ...r, compat: r.base }) })).stdout).toMatch(/COMPATIBILITY_NOT_ANCESTOR/);
  });
});
