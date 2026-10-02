import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "f196aa614";
const PHASE10_END = "49e8d39bb";
const SVC_REL = ["services", "lemtel-control-plane"].join("/");
const SVC = path.join(root, SVC_REL);
const ROUTE = path.join(SVC, "src", "routes", "policy-evaluation.ts");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const run = (args: string[]) => spawnSync("node", ["scripts/verify-lemtel-control-plane-phase10.mjs", ...args], { cwd: root, encoding: "utf8" });
const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const ALLOWED = [
  `${SVC_REL}/src/app.ts`,
  `${SVC_REL}/src/${["policy", "cutover"].join("/")}.ts`,
  `${SVC_REL}/src/${["policy", "assignment-lifecycle"].join("/")}.ts`,
  `${SVC_REL}/src/routes/policy-evaluation.ts`,
  `${SVC_REL}/test/policy-evaluation.test.ts`,
  `${SVC_REL}/test/static-boundary.test.ts`,
  "src/test/lemtelControlPlanePhase7.test.ts",
  "src/test/lemtelControlPlanePhase8.test.ts",
  "docs/lemtel-control-plane/phase-10-authenticated-policy-api.md",
  "scripts/verify-lemtel-control-plane-phase10.mjs",
  "src/test/lemtelControlPlanePhase10.test.ts",
];

describe("Lemtel Control Plane phase 10 — authenticated non-executable policy evaluation", () => {
  it("verifier pass / no argument / wrong base / invalid argument", () => {
    expect(run([`--base=${BASE}`]).stdout).toBe(`CP10_PASSED (attested base ${BASE})\n`);
    expect(run([]).stdout).toBe("CP10_PASSED\n");
    expect(run(["--base=0000000"]).stdout).toBe("CP10_FAILED: CP10_BASE_ATTESTATION\n");
    for (const a of [["--oops"], ["--base=xyz"], [`--base=${BASE}`, "x"]]) {
      const r = run(a);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("CP10_USAGE: [--base=f196aa614]\n");
    }
  });

  it("service tests pass through the package test command", () => {
    expect(fs.existsSync(path.join(SVC, "node_modules/.bin/tsx")), "local service test dependencies are required").toBe(true);
    const r = spawnSync("npm", ["test"], { cwd: SVC, encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("evaluator route keeps the explicit non-executable safety contract", () => {
    const r = fs.readFileSync(ROUTE, "utf8");
    expect(r.match(/execution: "non_executable"/g)).toHaveLength(2);
    expect(r).toContain('app.post("/v1/internal/policy/evaluate"');
    expect(r).toContain("makeServiceGuard(deps.token)");
    expect(r).not.toMatch(/recordAudit|audit|\bdb\b|redis|fetch\(|node:|child_process|process\.|cors/i);
  });

  it("all ten Phase 2 gates remain false", () => {
    const vals = [...read("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it("Phase 2–6 packages remain frozen in the Phase 10 historical range", () => {
    for (const ref of [BASE, PHASE10_END]) expect(execFileSync("git", ["cat-file", "-t", ref], { cwd: root, encoding: "utf8" }).trim(), `historical ref ${ref} must exist locally`).toBe("commit");
    expect(git(["diff", "--name-only", `${BASE}..${PHASE10_END}`, "--", "infra/lemtel-edge", "schemas/lemtel-edge", "docs/lemtel-edge"])).toEqual([]);
  });

  it("historical Phase 10 range stays within the original eleven allowed files", () => {
    for (const ref of [BASE, PHASE10_END]) expect(execFileSync("git", ["cat-file", "-t", ref], { cwd: root, encoding: "utf8" }).trim(), `historical ref ${ref} must exist locally`).toBe("commit");
    const changed = git(["diff", "--name-only", `${BASE}..${PHASE10_END}`]);
    expect(changed.length).toBeGreaterThan(0);
    for (const f of changed) expect(ALLOWED, f).toContain(f);
  });
});
