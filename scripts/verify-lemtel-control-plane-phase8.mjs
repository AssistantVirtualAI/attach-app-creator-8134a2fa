import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const BASE = "0b0d74f9d";
const USAGE = "CP8_USAGE: [--base=0b0d74f9d]";
const PREFLIGHT_SHA = "30570405bc08eb9cc35daa82a0e8fd22069e4ff0f5353bc1a6bc33619d244864";
const SVC_REL = "services/lemtel-control-plane";
const MOD = `${SVC_REL}/src/policy/assignment-lifecycle.ts`;
const DOC = "docs/lemtel-control-plane/phase-8-assignment-lifecycle.md";
const FILES = [MOD, `${SVC_REL}/test/assignment-lifecycle.test.ts`, DOC, "scripts/verify-lemtel-control-plane-phase8.mjs", "src/test/lemtelControlPlanePhase8.test.ts"];
const CONSTS = {
  ROUTING_MODES: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"],
  ASSIGNMENT_STATES: ["pending", "active", "revoked", "expired"],
  LIFECYCLE_EVENTS: ["policy_evaluated", "activation_confirmed", "revocation_confirmed", "direct_restore_confirmed", "expiry_observed"],
  LIFECYCLE_ACTIONS: ["hold", "issue_pending", "activate", "request_revocation", "revoke", "restore_direct", "expire"],
  LIFECYCLE_REASONS: ["policy_denied", "existing_direct_default", "issued", "activated", "revocation_requested", "revoked", "direct_restored", "expired", "invalid_transition"],
};
const TYPES = ["LifecycleRoutingMode", "AssignmentState", "LifecycleEvent", "LifecycleAction", "LifecycleReason", "AssignmentLifecycleInput", "AssignmentLifecycleResult"];
const INPUT_FIELDS = ["requestedMode", "currentMode", "currentState", "policyDecision", "event"];
const OUTPUT_FIELDS = ["nextMode", "nextState", "action", "reasonCode"];
const ORDER = [
  'input.policyDecision === "deny"', '"policy_denied"',
  'input.event === "expiry_observed"', 'reasonCode: "expired"',
  'input.event === "direct_restore_confirmed"', 'reasonCode: "direct_restored"',
  'input.event === "revocation_confirmed"', 'reasonCode: "revoked"',
  'input.event === "activation_confirmed"', 'reasonCode: "activated"',
  'input.event === "policy_evaluated"', '"existing_direct_default"', 'reasonCode: "issued"', 'reasonCode: "revocation_requested"',
  'return hold(input, "invalid_transition");\n}',
];
const DOC_LABELS = ["Existing Direct", "Future Pending", "Future Active", "Future Revoked", "Future Expired", "Offline Reducer"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const walk = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name === "dist" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];

export function verifyPhase8(args, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  const fail = new Set();
  const rd = (p) => readFileSync(join(root, p), "utf8");
  if (args[0] && args[0] !== `--base=${BASE}`) fail.add("CP8_BASE_ATTESTATION");
  if (!FILES.every((f) => existsSync(join(root, f)))) { fail.add("CP8_FILES_PRESENT"); return out(fail, args); }
  const src = rd(MOD);
  const names = [...src.matchAll(/^export const (\w+) = \[([^\]]*)\] as const;$/gm)];
  if (!eq(names.map((m) => m[1]), Object.keys(CONSTS))) fail.add("CP8_CONSTANTS_EXACT");
  for (const m of names) { const vals = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]); if (!eq(vals, CONSTS[m[1]])) fail.add("CP8_CONSTANTS_EXACT"); }
  const types = [...src.matchAll(/^export type (\w+)/gm)].map((m) => m[1]);
  const block = (n) => { const m = src.match(new RegExp(`export type ${n} = \\{([\\s\\S]*?)\\};`)); return m ? [...m[1].matchAll(/readonly (\w+):/g)].map((x) => x[1]) : null; };
  if (!eq(types, TYPES) || !eq(block("AssignmentLifecycleInput"), INPUT_FIELDS) || !eq(block("AssignmentLifecycleResult"), OUTPUT_FIELDS)) fail.add("CP8_TYPES_EXACT");
  const fns = [...src.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  if (!eq(fns, ["reduceAssignmentLifecycle"]) || !/export function reduceAssignmentLifecycle\(input: AssignmentLifecycleInput\): AssignmentLifecycleResult/.test(src)) fail.add("CP8_FUNCTION_EXACT");
  let pos = -1;
  for (const t of ORDER) { const i = src.indexOf(t, pos + 1); if (i <= pos) { fail.add("CP8_RULE_ORDER"); break; } pos = i; }
  const banned = ["process" + ".", "Da" + "te", "Math" + ".random", "random" + "UUID", "fet" + "ch(", "require" + "(", "import" + "(", "set" + "Timeout", "set" + "Interval", "node" + ":", "fast" + "ify", "red" + "is", "child_" + "process", "read" + "File", "write" + "File", "ev" + "al(", "Func" + "tion(", "http", "socket", "pg."];
  if (/^\s*import\s/m.test(src) || banned.some((b) => src.includes(b)) || /\.(get|post|put|patch|delete|route)\(/.test(src)) fail.add("CP8_MODULE_PURE");
  if (/fusion|\\u|\\x/i.test(src)) fail.add("CP8_NO_PROVIDER_LABEL_OR_ESCAPE");
  const d = rd(DOC);
  const conn = [...d.matchAll(/-->\s*\w+:\s*(.+)$/gm)].map((m) => m[1]);
  if (!/```mermaid/.test(d) || !DOC_LABELS.every((l) => d.includes(`"${l}"`)) || !conn.length || !conn.every((l) => l.includes("future / disabled"))
    || !/not imported by the application, server or routes and cannot receive a request/.test(d)
    || !/does not store an assignment, call a service, update a client or control registration or media/.test(d)
    || !/begins only as pending, then becomes active only with explicit confirmation/.test(d)
    || !/Rollback is two-step: edge assignment revocation confirmation first, direct restoration confirmation second/.test(d)
    || !/Existing direct remains the current default/.test(d) || !/All Phase 2 gates remain false/.test(d) || !/Phase 1 Docker runtime validation remains pending/.test(d)
    || /fusion/i.test(d) || /https?:\/\/|```(bash|sh|shell)/.test(d)) fail.add("CP8_DOCS_REQUIREMENTS");
  const vals = [...rd("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
  if (vals.length !== 10 || !vals.every((v) => v === "false")) fail.add("CP8_PHASE2_GATES_FALSE");
  if (createHash("sha256").update(readFileSync(join(root, "infra/lemtel-edge/preflight/edge-preflight.mjs"))).digest("hex") !== PREFLIGHT_SHA) fail.add("CP8_PHASE3_PREFLIGHT_UNCHANGED");
  const js = (p) => { try { return JSON.parse(rd(p)); } catch { return {}; } };
  const p4 = js("schemas/lemtel-edge/identity/identity-contract-policy.json");
  if (p4.runtime !== "not_started" || p4.phase1_docker_runtime !== "pending") fail.add("CP8_PHASE4_POLICY_STATIC");
  const p5 = js("schemas/lemtel-edge/pbx/pbx-adapter-policy.json");
  if (p5.runtime !== "not_started" || p5.current_observation_state !== "not_connected") fail.add("CP8_PHASE5_POLICY_STATIC");
  const p6 = js("schemas/lemtel-edge/cutover/cutover-policy.json");
  if (p6.runtime !== "not_started" || p6.phase1_docker_runtime !== "pending" || p6.current_default_routing_mode !== "existing_direct" || p6.current_evidence_state !== "not_started") fail.add("CP8_PHASE6_POLICY_STATIC");
  const p7v = rd("scripts/verify-lemtel-control-plane-phase7.mjs");
  const p7m = rd(`${SVC_REL}/src/policy/cutover.ts`);
  const p7t = rd("src/test/lemtelControlPlanePhase7.test.ts");
  if (!p7v.includes('const BASE = "338dfff53"') || !p7v.includes("CP7_NO_OBFUSCATED_PROVIDER_LABEL") || !p7v.includes("CP7_SERVICE_TEST_REQUIRED")
    || !p7m.includes('"upstream_nonproduction_approved"') || /fusion|\\u|\\x/i.test(p7m) || /skipIf|it\.skip|\.skip\(|\.todo|\btodo\(/.test(p7t)) fail.add("CP8_PHASE7_STATE");
  const svc = join(root, SVC_REL);
  const ref = /policy\/assignment-lifecycle/;
  if (walk(join(svc, "src")).some((f) => !f.endsWith(join("policy", "assignment-lifecycle.ts")) && ref.test(readFileSync(f, "utf8")))) fail.add("CP8_NOT_REFERENCED_BY_RUNTIME");
  const allowed = new Set(FILES.map((f) => join(root, f)));
  for (const f of [...walk(join(root, "src")), ...walk(join(svc, "test")), ...walk(join(root, "scripts"))]) if (!allowed.has(f) && ref.test(readFileSync(f, "utf8"))) fail.add("CP8_NOT_REFERENCED_BY_RUNTIME");
  const self = rd("scripts/verify-lemtel-control-plane-phase8.mjs");
  const imports = [...self.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const forbidden = ["child_" + "process", "fet" + "ch(", "process" + ".env", "write" + "File", "append" + "File", "exec" + "Sync", "sp" + "awn(", "node:" + "net", "node:" + "http"];
  if (!imports.every((m) => ["node:fs", "node:path", "node:crypto", "node:url", "node:process"].includes(m)) || forbidden.some((f) => self.includes(f))) fail.add("CP8_VERIFIER_IMPORTS_SAFE");
  return out(fail, args);
}

function out(fail, args) {
  if (fail.size) return { code: 1, stdout: [...fail].sort().map((c) => `CP8_FAILED: ${c}`).join("\n") + "\n" };
  return { code: 0, stdout: args[0] ? `CP8_PASSED (attested base ${BASE})\n` : "CP8_PASSED\n" };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const r = verifyPhase8(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
