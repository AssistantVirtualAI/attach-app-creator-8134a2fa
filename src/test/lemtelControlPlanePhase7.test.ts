import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "338dfff53";
const PHASE7_END = "0b0d74f9d";
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

describe("Lemtel Control Plane phase 7 — offline cutover policy", () => {
  it("verifier pass / wrong base / invalid argument", () => {
    expect(run([`--base=${BASE}`]).stdout).toBe(`CP7_PASSED (attested base ${BASE})\n`);
    expect(run([]).stdout).toBe("CP7_PASSED\n");
    expect(run(["--base=0000000"]).stdout).toBe("CP7_FAILED: CP7_BASE_ATTESTATION\n");
    for (const a of [["--oops"], ["--base=xyz"], [`--base=${BASE}`, "x"]]) {
      const r = run(a);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("CP7_USAGE: [--base=338dfff53]\n");
    }
  });

  it("service cutover tests pass through the package test command", () => {
    expect(fs.existsSync(path.join(SVC, "node_modules/.bin/tsx")), "local service test dependencies are required").toBe(true);
    const r = spawnSync("npm", ["test"], { cwd: SVC, encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("verifier enforces the transparency and required-test protections", () => {
    const v = read("scripts/verify-lemtel-control-plane-phase7.mjs");
    expect(v).toContain("CP7_NO_OBFUSCATED_PROVIDER_LABEL");
    expect(v).toContain("CP7_SERVICE_TEST_REQUIRED");
    const policy = fs.readFileSync(path.join(SVC, "src/policy/cutover.ts"), "utf8");
    expect(policy).toContain('"upstream_nonproduction_approved"');
    expect(policy).not.toMatch(/fusion|\\u|\\x/i);
  });

  it("only the Phase 10 non-executable evaluator route references the policy module", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const evaluator = path.join(SVC, ...EVALUATOR);
    const refs = walk(path.join(SVC, "src")).filter((f) => !f.endsWith(path.join("policy", "cutover.ts")) && /policy\/cutover/.test(fs.readFileSync(f, "utf8")));
    expect(refs).toEqual([evaluator]);
    const r = fs.readFileSync(evaluator, "utf8");
    expect(r).toContain('execution: "non_executable"');
    expect(r).not.toMatch(FORBIDDEN_EVALUATOR_DEPS);
  });

  it("a second runtime reference to the cutover module fails closed", () => {
    const r = secondImporterRun("verify-lemtel-control-plane-phase7.mjs", "cutover");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("CP7_NOT_IMPORTED_BY_RUNTIME");
  });

  it("all ten Phase 2 gates remain false", () => {
    const vals = [...read("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it("Phase 3–6 packages unchanged since base", () => {
    expect(hasBase, "base commit must be available locally").toBe(true);
    const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "infra/lemtel-edge", "schemas/lemtel-edge", "docs/lemtel-edge"], { cwd: root, encoding: "utf8" }).trim();
    expect(changed).toBe("");
  });

  it("Phase 7 changed-file scope is limited to the five allowed paths", () => {
    for (const ref of [BASE, PHASE7_END]) expect(execFileSync("git", ["cat-file", "-t", ref], { cwd: root, encoding: "utf8" }).trim(), `historical ref ${ref} must exist locally`).toBe("commit");
    const changed = execFileSync("git", ["diff", "--name-only", `${BASE}..${PHASE7_END}`], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(changed.length).toBeGreaterThan(0);
    for (const f of changed) expect(ALLOWED, f).toContain(f);
  });
});
