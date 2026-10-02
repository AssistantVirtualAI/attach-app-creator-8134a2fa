import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const load = async () => await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-historical-delta-phase15b.mjs")).href);
const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const ISO = "scripts/verify-lemtel-planipret-isolation.mjs";
const P15A1 = [ISO, "src/test/lemtelPlanipretIsolationPhase15.test.ts", "docs/lemtel-isolation/phase-15a-planipret-freeze.md"];

type Opts = { hist?: string[]; later?: string[]; mutate?: (t: string) => void; refs?: (r: { base: string; end: string }) => { base: string; end: string } };

// Real temporary Git repository via local plumbing: base (15A verifier) -> frozen 15B end -> optional later commit.
const run = async (o: Opts = {}) => {
  const m = await load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p15b-"));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  const put = (p: string, src?: string) => {
    fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true });
    if (src === undefined) fs.copyFileSync(path.join(root, p), path.join(tmp, p)); else fs.writeFileSync(path.join(tmp, p), src);
    g("update-index", "--add", p);
  };
  const commit = (msg: string, parent?: string) => { const c = g("commit-tree", g("write-tree"), ...(parent ? ["-p", parent] : []), "-m", msg); g("update-ref", "HEAD", c); expect(g("cat-file", "-t", c)).toBe("commit"); return c; };
  try {
    g("init", "-q");
    put(ISO);
    const base = commit("phase15a-end");
    for (const p of m.ALLOWED) put(p);
    for (const p of o.hist ?? []) put(p, "x\n");
    const end = commit("phase15b", base);
    if (o.later) { for (const p of o.later) put(p, "later\n"); commit("later", end); }
    o.mutate?.(tmp);
    return m.verify([], tmp, o.refs ? o.refs({ base, end }) : { base, end });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};
const PASS = { code: 0, stdout: "LEMTEL_P15B_PASSED\n" };

describe("Lemtel Phase 15B.1 — frozen historical inventory verifier", () => {
  it("exports the frozen end and the real repository passes", async () => {
    const m = await load();
    expect(m.PHASE15B_END).toBe("d3b6b687f");
    expect(m.verify(["--base=87b6b8029"], root)).toEqual(PASS);
  });

  it("exact frozen three-file interval passes", async () => {
    expect(await run()).toEqual(PASS);
  });

  it("a later Phase 15A.1-style commit passes", async () => {
    expect(await run({ later: P15A1 })).toEqual(PASS);
  });

  it("later non-Planiprêt Lemtel client/backend/doc files and untracked files pass", async () => {
    expect(await run({ later: ["apps/ava-softphone-mobile/src/App.tsx", "supabase/functions/luc-x/index.ts", "docs/lemtel-x/a.md"], mutate: (t) => fs.writeFileSync(path.join(t, "stray.txt"), "x\n") })).toEqual(PASS);
  });

  it("a Planiprêt path inside the frozen range fails", async () => {
    for (const p of ["src/pages/planipret/A.tsx", "x/PpVoipCall/a.m"]) {
      const r = await run({ hist: [p] });
      expect(r.stdout, p).toMatch(/PLANIPRET_PATH_CHANGED/);
      expect(r.stdout, p).toMatch(/HISTORICAL_SCOPE_EXACT/);
    }
  });

  it("app, backend or historical-copy paths inside the frozen range fail", async () => {
    for (const [p, code] of [["apps/ava-softphone-mobile/x.ts", /APP_OR_BACKEND_CHANGED/], ["supabase/functions/x/index.ts", /APP_OR_BACKEND_CHANGED/], ["vendor/historical-mobile/a.ts", /HISTORICAL_COPY/], ["imports/attach-app-creator-dd351dc5/b.ts", /HISTORICAL_COPY/]] as const) {
      const r = await run({ hist: [p] });
      expect(r.stdout, p).toMatch(code);
      expect(r.stdout, p).toMatch(/HISTORICAL_SCOPE_EXACT/);
    }
  });

  it("missing commits, reversed ancestry and incomplete inventory fail", async () => {
    const m = await load();
    expect((await run({ refs: (r) => ({ ...r, base: "0".repeat(40) }) })).stdout).toMatch(/BASE_MISSING/);
    expect((await run({ refs: (r) => ({ ...r, end: "0".repeat(40) }) })).stdout).toMatch(/END_MISSING/);
    expect((await run({ refs: (r) => ({ base: r.end, end: r.base }) })).stdout).toMatch(/BASE_NOT_ANCESTOR/);
    expect((await run({ mutate: (t) => fs.writeFileSync(path.join(t, m.DOC), "# empty\n") })).stdout).toMatch(/INVENTORY_INCOMPLETE/);
  });

  it("invalid CLI arguments return code 2 and the usage line", async () => {
    const m = await load();
    for (const a of [["x"], ["--base=0000000"], ["--base=87b6b8029", "y"]]) expect(m.verify(a, root)).toEqual({ code: 2, stdout: "LEMTEL_P15B_USAGE: [--base=87b6b8029]\n" });
  });

  it("unsafe capabilities fail and the real repository is unchanged", async () => {
    const m = await load();
    const before = status();
    m.verify([], root);
    await run({ later: ["apps/ava-softphone-mobile/x"] });
    expect(status()).toBe(before);
    const src = fs.readFileSync(path.join(root, m.SELF), "utf8");
    expect(m.checkSelf(src)).toBe(true);
    for (const bad of ["write" + "FileSync(x)", "fet" + "ch(u)", "proc" + "ess.env.X"]) expect(m.checkSelf(src + "\n" + bad + "\n"), bad).toBe(false);
    expect((await run({ mutate: (t) => fs.appendFileSync(path.join(t, m.SELF), "\nfet" + "ch(u)\n") })).stdout).toMatch(/VERIFIER_CAPABILITY/);
  });
});
