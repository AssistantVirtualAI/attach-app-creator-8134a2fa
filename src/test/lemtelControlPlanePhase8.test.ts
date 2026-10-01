import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "0b0d74f9d";
const SVC_REL = ["services", "lemtel-control-plane"].join("/");
const SVC = path.join(root, SVC_REL);
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const run = (args: string[]) => spawnSync("node", ["scripts/verify-lemtel-control-plane-phase8.mjs", ...args], { cwd: root, encoding: "utf8" });
const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const ALLOWED = [
  `${SVC_REL}/src/policy/assignment-lifecycle.ts`,
  `${SVC_REL}/test/assignment-lifecycle.test.ts`,
  "docs/lemtel-control-plane/phase-8-assignment-lifecycle.md",
  "scripts/verify-lemtel-control-plane-phase8.mjs",
  "src/test/lemtelControlPlanePhase8.test.ts",
];
const PHASE7 = [
  `${SVC_REL}/src/policy/cutover.ts`,
  `${SVC_REL}/test/cutover-policy.test.ts`,
  "docs/lemtel-control-plane/phase-7-cutover-policy.md",
  "scripts/verify-lemtel-control-plane-phase7.mjs",
  "src/test/lemtelControlPlanePhase7.test.ts",
];

describe("Lemtel Control Plane phase 8 — offline assignment lifecycle reducer", () => {
  it("verifier pass / wrong base / invalid argument", () => {
    expect(run([`--base=${BASE}`]).stdout).toBe(`CP8_PASSED (attested base ${BASE})\n`);
    expect(run([]).stdout).toBe("CP8_PASSED\n");
    expect(run(["--base=0000000"]).stdout).toBe("CP8_FAILED: CP8_BASE_ATTESTATION\n");
    for (const a of [["--oops"], ["--base=xyz"], [`--base=${BASE}`, "x"]]) {
      const r = run(a);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("CP8_USAGE: [--base=0b0d74f9d]\n");
    }
  });

  it("service lifecycle tests pass through the package test command", () => {
    expect(fs.existsSync(path.join(SVC, "node_modules/.bin/tsx")), "local service test dependencies are required").toBe(true);
    const r = spawnSync("npm", ["test"], { cwd: SVC, encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("no Control Plane runtime file references the lifecycle module", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(path.join(SVC, "src")).filter((f) => !f.endsWith(path.join("policy", "assignment-lifecycle.ts")))) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/policy\/assignment-lifecycle/);
  });

  it("all ten Phase 2 gates remain false", () => {
    const vals = [...read("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it("Phase 3–6 packages and Phase 7 files unchanged since base", () => {
    expect(git(["diff", "--name-only", BASE, "--", "infra/lemtel-edge", "schemas/lemtel-edge", "docs/lemtel-edge", ...PHASE7])).toEqual([]);
  });

  it("Phase 8 changed-file scope is limited to the five allowed paths", () => {
    const changed = [...git(["diff", "--name-only", BASE]), ...git(["ls-files", "--others", "--exclude-standard"])];
    for (const f of changed) expect(ALLOWED, f).toContain(f);
  });
});
