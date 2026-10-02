import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "0b0d74f9d";
const PHASE8_END = "a76ac1d48";
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
const PHASE7_FROZEN = [
  `${SVC_REL}/src/${["policy", "cutover"].join("/")}.ts`,
  `${SVC_REL}/test/cutover-policy.test.ts`,
  "docs/lemtel-control-plane/phase-7-cutover-policy.md",
  "scripts/verify-lemtel-control-plane-phase7.mjs",
];

const EVALUATOR = ["src", "routes", "policy-evaluation.ts"];
const FORBIDDEN_EVALUATOR_DEPS = /from\s+"(?!fastify"|\.\.\/auth\.js"|\.\.\/policy\/(cutover|assignment-lifecycle)\.js")[^"]+"|\b(db|redis|audit|recordAudit|config|logger|server|migrations|readFile|writeFile|child_process|fetch|randomUUID|Date|setTimeout|setInterval)\b|Math\.random|process\.|node:/;

const secondImporterRun = (verifier: string, mod: string) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-second-importer-"));
  try {
    for (const rel of ["scripts", `${SVC_REL}/src`, `${SVC_REL}/test`, "docs/lemtel-control-plane", "infra/lemtel-edge", "schemas/lemtel-edge", "src/test"]) fs.cpSync(path.join(root, rel), path.join(tmp, rel), { recursive: true });
    fs.writeFileSync(path.join(tmp, SVC_REL, "src", "routes", "second-importer.ts"), `import "../${["policy", mod].join("/")}.js";\n`);
    return spawnSync("node", [path.join(tmp, "scripts", verifier)], { cwd: tmp, encoding: "utf8" });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};

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

  it("only the Phase 10 non-executable evaluator route references the lifecycle module", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const evaluator = path.join(SVC, ...EVALUATOR);
    const refs = walk(path.join(SVC, "src")).filter((f) => !f.endsWith(path.join("policy", "assignment-lifecycle.ts")) && /policy\/assignment-lifecycle/.test(fs.readFileSync(f, "utf8")));
    expect(refs).toEqual([evaluator]);
    const r = fs.readFileSync(evaluator, "utf8");
    expect(r).toContain('execution: "non_executable"');
    expect(r).not.toMatch(FORBIDDEN_EVALUATOR_DEPS);
  });

  it("a second runtime reference to the assignment-lifecycle module fails closed", () => {
    const r = secondImporterRun("verify-lemtel-control-plane-phase8.mjs", "assignment-lifecycle");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("CP8_NOT_REFERENCED_BY_RUNTIME");
  });

  it("all ten Phase 2 gates remain false", () => {
    const vals = [...read("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it("Phase 3–6 packages and frozen Phase 7 policy artifacts unchanged in the Phase 8 range", () => {
    for (const ref of [BASE, PHASE8_END]) expect(execFileSync("git", ["cat-file", "-t", ref], { cwd: root, encoding: "utf8" }).trim(), `historical ref ${ref} must exist locally`).toBe("commit");
    expect(git(["diff", "--name-only", `${BASE}..${PHASE8_END}`, "--", "infra/lemtel-edge", "schemas/lemtel-edge", "docs/lemtel-edge", ...PHASE7_FROZEN])).toEqual([]);
    expect(git(["diff", "--name-only", BASE, "--", "infra/lemtel-edge", "schemas/lemtel-edge", "docs/lemtel-edge"])).toEqual([]);
  });

  it("Phase 8 changed-file scope is limited to the five allowed paths", () => {
    for (const ref of [BASE, PHASE8_END]) expect(execFileSync("git", ["cat-file", "-t", ref], { cwd: root, encoding: "utf8" }).trim(), `historical ref ${ref} must exist locally`).toBe("commit");
    const changed = git(["diff", "--name-only", `${BASE}..${PHASE8_END}`]);
    expect(changed.length).toBeGreaterThan(0);
    for (const f of changed) expect(ALLOWED, f).toContain(f);
  });
});
