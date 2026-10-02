import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const BASE = "f549747ff";
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const load = async () => import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-edge-phase11.mjs")).href);

const ADM = {
  schemaVersion: "closed_local_edge_runtime_admission_v1", intent: "closed_local_validation", runtimeState: "not_started",
  featureGates: "all_false", exposure: "loopback_only", networkPolicy: "default_deny", signallingBehavior: "static_503_only",
  mediaBehavior: "not_started", upstreamBehavior: "disabled", controlPlaneBehavior: "disabled", clientBehavior: "unchanged",
  cleanupRequirement: "mandatory", approvalState: "not_approved",
};
const STATUS = ["configSyntax", "closedResponse", "externalEgress", "upstreamConnection", "controlPlaneConnection", "mediaRelay", "cleanup"];
const NR = Object.fromEntries(STATUS.map((k) => [k, "not_run"]));
const REP = { schemaVersion: "closed_local_edge_runtime_report_v1", featureGates: "all_false", ...NR, result: "not_run", failureCode: "none" };

describe("Lemtel Edge phase 11 — closed local runtime admission", () => {
  it("admission schema accepts only the exact constants", async () => {
    const m = await load();
    const s = JSON.parse(read(m.ADMISSION));
    expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(s.additionalProperties).toBe(false);
    expect(m.checkAdmissionSchema(s)).toEqual([]);
    expect(m.validate(s, ADM)).toBe(true);
    for (const k of Object.keys(ADM)) {
      expect(m.validate(s, { ...ADM, [k]: "other" })).toBe(false);
      const { [k]: _drop, ...rest } = ADM as Record<string, string>;
      expect(m.validate(s, rest)).toBe(false);
    }
    expect(m.validate(s, { ...ADM, approvalState: "approved" })).toBe(false);
    expect(m.validate(s, { ...ADM, exposure: "public" })).toBe(false);
    expect(m.validate(s, { ...ADM, extra: "x" })).toBe(false);
    expect(m.checkAdmissionSchema({ ...s, additionalProperties: true })).toContain("P11_SCHEMA_STRICT");
    expect(m.checkAdmissionSchema({ ...s, $schema: "draft-07" })).toContain("P11_SCHEMA_DRAFT");
  });

  it("report schema enforces result/failureCode relationships", async () => {
    const m = await load();
    const s = JSON.parse(read(m.REPORT));
    expect(m.checkReportSchema(s)).toEqual([]);
    expect(m.validate(s, REP)).toBe(true);
    expect(m.validate(s, { ...REP, failureCode: "local_validation_failed" })).toBe(false);
    expect(m.validate(s, { ...REP, failureCode: "cleanup_failed" })).toBe(false);
    for (const k of STATUS) expect(m.validate(s, { ...REP, [k]: k === "cleanup" || /Response|Syntax/.test(k) ? "passed" : "blocked" })).toBe(false);
    const passed = { ...REP, result: "passed", configSyntax: "passed", closedResponse: "passed", externalEgress: "blocked", upstreamConnection: "blocked", controlPlaneConnection: "blocked", mediaRelay: "blocked", cleanup: "passed" };
    expect(m.validate(s, passed)).toBe(true);
    expect(m.validate(s, { ...passed, failureCode: "local_validation_failed" })).toBe(false);
    expect(m.validate(s, { ...passed, failureCode: "cleanup_failed" })).toBe(false);
    const failed = { ...passed, result: "failed", cleanup: "failed" };
    expect(m.validate(s, { ...failed, failureCode: "cleanup_failed" })).toBe(true);
    expect(m.validate(s, { ...failed, failureCode: "local_validation_failed" })).toBe(true);
    expect(m.validate(s, { ...failed, failureCode: "none" })).toBe(false);
    expect(m.validate(s, { ...passed, featureGates: "some_true" })).toBe(false);
    expect(m.validate(s, { ...passed, rawLog: "x" })).toBe(false);
    expect(m.validate(s, { ...passed, externalEgress: "anything" })).toBe(false);
    const free = JSON.parse(JSON.stringify(s)); free.properties.result = { type: "string" };
    expect(m.checkReportSchema(free)).toContain("P11_SCHEMA_FREE_FORM");
    const noCond = { ...s, allOf: [] };
    expect(m.checkReportSchema(noCond)).toContain("P11_REPORT_CONDITIONALS");
  });

  it("verifier output: normal, attested, wrong base, invalid args", async () => {
    const { verifyPhase11 } = await load();
    expect(verifyPhase11([])).toEqual({ code: 0, stdout: "P11_PASSED\n" });
    expect(verifyPhase11([`--base=${BASE}`])).toEqual({ code: 0, stdout: `P11_PASSED (attested base ${BASE})\n` });
    expect(verifyPhase11(["--base=abcdef1"])).toEqual({ code: 1, stdout: "P11_FAILED: P11_BASE_ATTESTATION\n" });
    for (const a of [["--nope"], ["--base=zz"], [`--base=${BASE}`, "x"]]) expect(verifyPhase11(a)).toEqual({ code: 2, stdout: "P11_USAGE: [--base=f549747ff]\n" });
  });

  it("all ten gates remain literal false", async () => {
    const m = await load();
    const y = read("infra/lemtel-edge/policy/edge-feature-gates.yaml");
    expect(m.gatesAllFalse(y)).toBe(true);
    for (const g of m.GATES) expect(y).toMatch(new RegExp(`^\\s+${g}: false$`, "m"));
    expect(m.gatesAllFalse(y.replace("edge_enabled: false", "edge_enabled: true"))).toBe(false);
  });

  it("scope: only six Phase 11 paths; Edge 2–6, Control Plane and protected paths frozen", async () => {
    const m = await load();
    expect(m.ALLOWED).toHaveLength(6);
    expect(m.classify(m.ALLOWED)).toEqual([]);
    expect(m.classify(["schemas/lemtel-edge/cutover/cutover-policy.json"])).toContain("P11_EDGE_FROZEN");
    expect(m.classify(["scripts/verify-lemtel-edge-phase6.mjs"])).toContain("P11_EDGE_FROZEN");
    expect(m.classify(["services/lemtel-control-plane/src/routes/policy-evaluation.ts"])).toContain("P11_CONTROL_PLANE_FROZEN");
    expect(m.classify(["scripts/verify-lemtel-control-plane-phase10.mjs"])).toContain("P11_CONTROL_PLANE_FROZEN");
    for (const p of ["apps/planipret-mobile/x.ts", "src/pages/planipret/a.tsx", "supabase/functions/x/index.ts", "src/pages/lemtel-uc/a.tsx", "package.json"]) expect(m.classify([p])).toContain("P11_PROTECTED_PATHS");
  });

  it("rejects forbidden content in docs and sources", async () => {
    const m = await load();
    for (const d of m.DOCS) expect(m.scanDoc(read(d))).toBe(false);
    for (const s of [m.SELF, m.TEST]) expect(m.scanSource(read(s))).toBe(false);
    const fence = "`".repeat(3);
    const badDocs = [fence + "ba" + "sh\nx\n" + fence, "h" + "ttps://a.b", "10.0" + ".0.1", "lo" + "calhost", "po" + "rt 5060", "edge:50" + "60", "si" + "p:100@x", "repo/img" + ":latest", "docker " + "run x", "pass" + "word=abc", "-----BEGIN KEY", "ext" + " 201", "pbx.ex" + "ample.com"];
    for (const b of badDocs) expect(m.scanDoc(b)).toBe(true);
    const badSrc = ["fet" + "ch(u)", "import n from 'node:ne" + "t'", "new Web" + "Socket(u)", "sp" + "awn('x')", "srv.lis" + "ten(1)", "app.po" + "st('/x', h)", "process.e" + "nv.X", "write" + "FileSync(p)", "docker " + "compose up"];
    for (const b of badSrc) expect(m.scanSource(b)).toBe(true);
  });
});
