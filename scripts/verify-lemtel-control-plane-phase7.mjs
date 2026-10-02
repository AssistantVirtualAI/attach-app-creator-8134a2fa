import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const BASE = "338dfff53";
const USAGE = "CP7_USAGE: [--base=338dfff53]";
const PREFLIGHT_SHA = "30570405bc08eb9cc35daa82a0e8fd22069e4ff0f5353bc1a6bc33619d244864";
const MOD = "services/lemtel-control-plane/src/policy/cutover.ts";
const DOC = "docs/lemtel-control-plane/phase-7-cutover-policy.md";
const FILES = [MOD, "services/lemtel-control-plane/test/cutover-policy.test.ts", DOC, "scripts/verify-lemtel-control-plane-phase7.mjs", "src/test/lemtelControlPlanePhase7.test.ts"];
const CONSTS = {
  ROUTING_MODES: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"],
  REQUESTED_MODES: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"],
  REASON_CODES: ["existing_route_required", "phase1_runtime_pending", "edge_disabled", "device_not_authorized", "capability_invalid", "pilot_not_approved", "prerequisites_incomplete", "rollback_required"],
  PILOT_PREREQUISITES: ["phase1_runtime_passed", "edge_runtime_approved", "upstream_nonproduction_approved", "device_capability_approved", "pilot_approval_recorded", "existing_route_withdrawn", "rollback_path_verified"],
};
const INPUT_FIELDS = ["requestedMode", "currentActiveMode", "phase1Runtime", "edgeRuntime", "identityScope", "capability", "pilotApproval", "nonProductionApproval", "directRoute", "rollbackPath"];
const OUTPUT_FIELDS = ["decision", "effectiveMode", "reasonCode"];
const ORDER = [
  'mode === "existing_direct"', 'mode === "existing_direct_rollback"', 'input.currentActiveMode !== "edge_pilot"', 'input.rollbackPath !== "verified"',
  'input.phase1Runtime !== "passed"', 'input.edgeRuntime !== "approved"', 'input.identityScope !== "authorized"', 'input.capability !== "approved"',
  'input.pilotApproval !== "recorded"', 'input.nonProductionApproval !== "approved"', 'input.directRoute !== "withdrawn"', 'input.rollbackPath !== "verified"',
  'input.currentActiveMode !== "none"', 'return result("allow", mode, "existing_route_required")',
];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const walk = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];

const EVALUATOR_REL = ["src", "routes", "policy-evaluation.ts"];
const evaluatorSafe = (src) => {
  const bad = new RegExp(["audit", "\\bdb\\b", "redis", "logger", "config", "server", "migration", "fs\\b", "read" + "File", "wri" + "te" + "File", "child_" + "process", "fet" + "ch\\(", "node:", "\\bDate\\b", "Math\\.random", "random" + "UUID", "process\\.", "set" + "Timeout", "set" + "Interval", "import\\(", "require\\(", "cors", "access-control"].join("|"), "i");
  const routes = [...src.matchAll(/\.(get|post|put|patch|delete|all|route)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  return src.includes('execution: "non_executable"') && src.includes("makeServiceGuard(deps.token)") && !bad.test(src) && JSON.stringify(routes) === JSON.stringify(["post /v1/internal/policy/evaluate"]);
};

export function verifyPhase7(args, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  const fail = new Set();
  const rd = (p) => readFileSync(join(root, p), "utf8");
  if (args[0] && args[0] !== `--base=${BASE}`) fail.add("CP7_BASE_ATTESTATION");
  if (!FILES.every((f) => existsSync(join(root, f)))) { fail.add("CP7_FILES_PRESENT"); return out(fail, args); }
  const src = rd(MOD);
  const names = [...src.matchAll(/^export const (\w+) = \[([^\]]*)\] as const;$/gm)];
  if (!eq(names.map((m) => m[1]), Object.keys(CONSTS))) fail.add("CP7_CONSTANTS_EXACT");
  for (const m of names) { const vals = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => JSON.parse(`"${x[1]}"`)); if (!eq(vals, CONSTS[m[1]])) fail.add("CP7_CONSTANTS_EXACT"); }
  const block = (n) => { const m = src.match(new RegExp(`export type ${n} = \\{([\\s\\S]*?)\\};`)); return m ? [...m[1].matchAll(/readonly (\w+):/g)].map((x) => x[1]) : null; };
  if (!eq(block("CutoverPolicyInput"), INPUT_FIELDS) || !eq(block("PolicyDecision"), OUTPUT_FIELDS) || !/export type RoutingMode =/.test(src) || !/export type ReasonCode =/.test(src)) fail.add("CP7_TYPES_EXACT");
  const fns = [...src.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  if (!eq(fns, ["evaluateCutoverPolicy"]) || !/export function evaluateCutoverPolicy\(input: CutoverPolicyInput\): PolicyDecision/.test(src)) fail.add("CP7_FUNCTION_EXACT");
  let pos = -1;
  for (const t of ORDER) { const i = src.indexOf(t, pos + 1); if (i <= pos) { fail.add("CP7_PRECEDENCE_ORDER"); break; } pos = i; }
  const banned = ["process" + ".", "Da" + "te", "Math" + ".random", "random" + "UUID", "fet" + "ch(", "require" + "(", "import" + "(", "set" + "Timeout", "set" + "Interval", "node" + ":", "fast" + "ify", "red" + "is", "child_" + "process", "read" + "File", "write" + "File", "ev" + "al(", "Func" + "tion("];
  if (/^\s*import\s/m.test(src) || banned.some((b) => src.includes(b)) || /\.(get|post|put|patch|delete|route)\(/.test(src)) fail.add("CP7_MODULE_PURE");
  if (/fusion|\\u|\\x/i.test(src)) fail.add("CP7_NO_OBFUSCATED_PROVIDER_LABEL");
  const rt = rd("src/test/lemtelControlPlanePhase7.test.ts");
  const svcTest = rt.match(/it\("service cutover tests[\s\S]*?\n  \}\);/);
  if (/skipIf|it\.skip|\.skip\(|\.todo|\btodo\(/.test(rt) || !svcTest || /\breturn\b|catch|\bif\s*\(/.test(svcTest[0])) fail.add("CP7_SERVICE_TEST_REQUIRED");
  const d = rd(DOC);
  const labels = [...d.matchAll(/\|([^|]+)\|/g)].map((m) => m[1]);
  if (!/```mermaid/.test(d) || !labels.length || !labels.every((l) => l.includes("future / disabled")) || !["Safe Enum Input", "Offline Cutover Policy", "Safe Enum Decision", "Existing Direct Route", "Future Device Pilot"].every((x) => d.includes(x)) || !/not imported by the application, server or routes/.test(d) || !/Phase 1 Docker runtime validation/.test(d) || !/Phase 2 gate remains false/.test(d) || !/The policy is provider-neutral and contains no provider host, credential, endpoint or connectivity configuration\./.test(d) || /fusion/i.test(d) || /https?:\/\/|```(bash|sh|shell)/.test(d)) fail.add("CP7_DOCS_REQUIREMENTS");
  const vals = [...rd("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
  if (vals.length !== 10 || !vals.every((v) => v === "false")) fail.add("CP7_PHASE2_GATES_FALSE");
  if (createHash("sha256").update(readFileSync(join(root, "infra/lemtel-edge/preflight/edge-preflight.mjs"))).digest("hex") !== PREFLIGHT_SHA) fail.add("CP7_PHASE3_PREFLIGHT_UNCHANGED");
  const js = (p) => { try { return JSON.parse(rd(p)); } catch { return {}; } };
  const p4 = js("schemas/lemtel-edge/identity/identity-contract-policy.json");
  if (p4.runtime !== "not_started" || p4.phase1_docker_runtime !== "pending") fail.add("CP7_PHASE4_POLICY_STATIC");
  const p5 = js("schemas/lemtel-edge/pbx/pbx-adapter-policy.json");
  if (p5.runtime !== "not_started" || p5.current_observation_state !== "not_connected") fail.add("CP7_PHASE5_POLICY_STATIC");
  const p6 = js("schemas/lemtel-edge/cutover/cutover-policy.json");
  if (p6.runtime !== "not_started" || p6.phase1_docker_runtime !== "pending" || p6.current_default_routing_mode !== "existing_direct" || p6.current_evidence_state !== "not_started") fail.add("CP7_PHASE6_POLICY_STATIC");
  const svc = join(root, "services/lemtel-control-plane");
  const runtime = walk(join(svc, "src")).filter((f) => !f.endsWith(join("policy", "cutover.ts")));
  const evaluator = join(svc, ...EVALUATOR_REL);
  if (runtime.some((f) => f !== evaluator && /policy\/cutover/.test(readFileSync(f, "utf8"))) || !existsSync(evaluator) || !evaluatorSafe(readFileSync(evaluator, "utf8"))) fail.add("CP7_NOT_IMPORTED_BY_RUNTIME");
  const allowedRefs = new Set(FILES.map((f) => join(root, f)));
  for (const f of [...walk(join(root, "src")), ...walk(join(svc, "test")), ...walk(join(root, "scripts"))]) if (!allowedRefs.has(f) && /policy\/cutover/.test(readFileSync(f, "utf8"))) fail.add("CP7_NOT_IMPORTED_BY_RUNTIME");
  const self = rd("scripts/verify-lemtel-control-plane-phase7.mjs");
  const imports = [...self.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const forbidden = ["child_" + "process", "fet" + "ch(", "process" + ".env", "write" + "File", "append" + "File", "exec" + "Sync", "sp" + "awn(", "node:" + "net", "node:" + "http"];
  if (!imports.every((m) => ["node:fs", "node:path", "node:crypto", "node:url", "node:process"].includes(m)) || forbidden.some((f) => self.includes(f))) fail.add("CP7_VERIFIER_IMPORTS_SAFE");
  return out(fail, args);
}

function out(fail, args) {
  if (fail.size) return { code: 1, stdout: [...fail].sort().map((c) => `CP7_FAILED: ${c}`).join("\n") + "\n" };
  return { code: 0, stdout: args[0] ? `CP7_PASSED (attested base ${BASE})\n` : "CP7_PASSED\n" };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const r = verifyPhase7(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
