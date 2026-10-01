import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "7e534de46";
const SVC_REL = ["services", "lemtel-control-plane"].join("/");
const SVC = path.join(root, SVC_REL);
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const run = (args: string[]) => spawnSync("node", ["scripts/verify-lemtel-control-plane-phase7.mjs", ...args], { cwd: root, encoding: "utf8" });
const hasBase = (() => { try { execFileSync("git", ["cat-file", "-t", BASE], { cwd: root, stdio: "ignore" }); return true; } catch { return false; } })();
const ALLOWED = [
  `${SVC_REL}/src/policy/cutover.ts`,
  `${SVC_REL}/test/cutover-policy.test.ts`,
  "docs/lemtel-control-plane/phase-7-cutover-policy.md",
  "scripts/verify-lemtel-control-plane-phase7.mjs",
  "src/test/lemtelControlPlanePhase7.test.ts",
];

describe("Lemtel Control Plane phase 7 — offline cutover policy", () => {
  it("verifier pass / wrong base / invalid argument", () => {
    expect(run([`--base=${BASE}`]).stdout).toBe(`CP7_PASSED (attested base ${BASE})\n`);
    expect(run([]).stdout).toBe("CP7_PASSED\n");
    expect(run(["--base=0000000"]).stdout).toBe("CP7_FAILED: CP7_BASE_ATTESTATION\n");
    for (const a of [["--oops"], ["--base=xyz"], [`--base=${BASE}`, "x"]]) {
      const r = run(a);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("CP7_USAGE: [--base=7e534de46]\n");
    }
  });

  it.skipIf(!fs.existsSync(path.join(SVC, "node_modules/.bin/tsx")))("service cutover tests pass through the package test command", () => {
    const r = spawnSync("npm", ["test"], { cwd: SVC, encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("no Control Plane runtime file references the policy module", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(path.join(SVC, "src")).filter((f) => !f.endsWith(path.join("policy", "cutover.ts")))) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/policy\/cutover/);
  });

  it("all ten Phase 2 gates remain false", () => {
    const vals = [...read("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it.skipIf(!hasBase)("Phase 3–6 packages unchanged since base", () => {
    const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "infra/lemtel-edge", "schemas/lemtel-edge", "docs/lemtel-edge"], { cwd: root, encoding: "utf8" }).trim();
    expect(changed).toBe("");
  });

  it.skipIf(!hasBase)("Phase 7 changed-file scope is limited to the five allowed paths", () => {
    const changed = execFileSync("git", ["diff", "--name-only", BASE], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    for (const f of [...changed, ...untracked]) expect(ALLOWED, f).toContain(f);
  });
});
