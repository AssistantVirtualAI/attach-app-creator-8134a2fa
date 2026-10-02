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

// Real temporary Git repository via local plumbing; the 15A verifier is part of the base commit.
const repo = (m: any, extra: string[] = []) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p15b-"));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  const put = (p: string, src?: string) => {
    fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true });
    if (src === undefined) fs.copyFileSync(path.join(root, p), path.join(tmp, p)); else fs.writeFileSync(path.join(tmp, p), src);
    g("update-index", "--add", p);
  };
  const commit = (msg: string, parent?: string) => { const c = g("commit-tree", g("write-tree"), ...(parent ? ["-p", parent] : []), "-m", msg); g("update-ref", "HEAD", c); expect(g("cat-file", "-t", c)).toBe("commit"); return c; };
  g("init", "-q");
  put(ISO);
  const base = commit("phase15a-end");
  for (const p of m.ALLOWED) put(p);
  for (const p of extra) put(p, "x\n");
  commit("phase15b", base);
  return { tmp, base };
};
const run = async (extra: string[] = [], mutate?: (t: string) => void) => {
  const m = await load();
  const r = repo(m, extra);
  try { mutate?.(r.tmp); return m.verify([], r.tmp, { base: r.base }); }
  finally { fs.rmSync(r.tmp, { recursive: true, force: true }); }
};

describe("Lemtel Phase 15B — historical delta inventory (review only)", () => {
  it("exact three-file scope passes", async () => {
    expect(await run()).toEqual({ code: 0, stdout: "LEMTEL_P15B_PASSED\n" });
  });

  it("a current Lemtel app file change fails", async () => {
    const r = await run(["apps/ava-softphone-mobile/src/hooks/useSoftphone.ts"]);
    expect(r.stdout).toMatch(/APP_OR_BACKEND_CHANGED/);
  });

  it("a backend change fails", async () => {
    expect((await run(["supabase/functions/x/index.ts"])).stdout).toMatch(/APP_OR_BACKEND_CHANGED/);
  });

  it("historical code copy paths fail", async () => {
    for (const p of ["lemtel_historical_attach_app_creator_main/apps/x.ts", "vendor/historical-mobile/a.ts", "imports/attach-app-creator-dd351dc5/b.ts"]) {
      expect((await run([p])).stdout, p).toMatch(/HISTORICAL_COPY/);
    }
  });

  it("any Planiprêt path fails", async () => {
    for (const p of ["apps/planipret-mobile/a.ts", "src/pages/planipret/A.tsx", "x/PpVoipCall/a.m"]) {
      expect((await run([p])).stdout, p).toMatch(/PLANIPRET_PATH_CHANGED/);
    }
  });

  it("an untracked file fails", async () => {
    expect((await run([], (t) => fs.writeFileSync(path.join(t, "stray.txt"), "x\n"))).stdout).toMatch(/UNTRACKED_FILE/);
  });

  it("an incomplete inventory fails", async () => {
    const m = await load();
    const r = await run([], (t) => fs.writeFileSync(path.join(t, m.DOC), "# empty\n"));
    expect(r.stdout).toMatch(/INVENTORY_INCOMPLETE/);
  });

  it("invalid CLI arguments return code 2 and the usage line", async () => {
    const m = await load();
    for (const a of [["x"], ["--base=0000000"], ["--base=87b6b8029", "y"]]) expect(m.verify(a, root)).toEqual({ code: 2, stdout: "LEMTEL_P15B_USAGE: [--base=87b6b8029]\n" });
  });

  it("real repository status is unchanged and verifier is read-only", async () => {
    const m = await load();
    const before = status();
    m.verify([], root);
    await run(["apps/ava-softphone-mobile/x"]);
    expect(status()).toBe(before);
    const src = fs.readFileSync(path.join(root, m.SELF), "utf8");
    expect(m.checkSelf(src)).toBe(true);
    expect(m.checkSelf(src + "\nwrite" + "FileSync(x)\n")).toBe(false);
  });
});
