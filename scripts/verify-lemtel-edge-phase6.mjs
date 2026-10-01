import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const BASE = "a633acd0c";
const USAGE = "P6_USAGE: [--base=a633acd0c]";
const REF = "^[A-Za-z0-9_-]{8,64}$";
const TS = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?Z$";
const PREFLIGHT_SHA = "30570405bc08eb9cc35daa82a0e8fd22069e4ff0f5353bc1a6bc33619d244864";
const DIR = "schemas/lemtel-edge/cutover";
const DOCS = ["phase-6-app-coexistence-and-routing.md", "phase-6-release-and-update-safety.md", "phase-6-pilot-and-rollback-plan.md", "phase-6-cutover-threat-model.md"].map((d) => `docs/lemtel-edge/${d}`);
const FIELDS = {
  "device-routing-assignment-v1": { version: null, assignment_ref: null, tenant_ref: null, extension_ref: null, device_ref: null, routing_mode: "routing_modes", assignment_state: "assignment_states", issued_at: null, expires_at: null },
  "device-routing-decision-v1": { version: null, decision_ref: null, tenant_ref: null, extension_ref: null, device_ref: null, assignment_ref: null, routing_mode: "routing_modes", decision: "decisions", reason_code: "reason_codes", decided_at: null },
  "device-migration-evidence-v1": { version: null, evidence_ref: null, tenant_ref: null, extension_ref: null, device_ref: null, assignment_ref: null, evidence_state: "evidence_states", validation_scope: "validation_scopes", observed_at: null },
  "device-rollback-notice-v1": { version: null, notice_ref: null, tenant_ref: null, extension_ref: null, device_ref: null, assignment_ref: null, rollback_scope: "rollback_scopes", rollback_state: "rollback_states", issued_at: null },
};
const ENUMS = {
  routing_modes: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"],
  assignment_states: ["pending", "active", "revoked", "expired"],
  decisions: ["allow", "deny"],
  reason_codes: ["phase1_runtime_pending", "edge_disabled", "existing_route_required", "device_not_authorized", "capability_invalid", "pilot_not_approved", "prerequisites_incomplete", "rollback_required"],
  evidence_states: ["not_started", "collected", "validated", "rejected"],
  validation_scopes: ["registration_control", "inbound_control", "outbound_control", "media_control", "rollback_control"],
  rollback_scopes: ["edge_pilot", "shadow_observe"],
  rollback_states: ["requested", "revoked", "restored", "unknown"],
};
const PREREQS = ["phase1_runtime_passed", "edge_runtime_approved", "fusionpbx_nonproduction_approved", "device_capability_approved", "pilot_approval_recorded", "existing_route_withdrawn", "rollback_path_verified"];
const DENIED_MIN = "password secret token jwt credential auth sip pbx host url uri ip port endpoint transport extension_number caller callee number phone email name recording voicemail message push cdr error debug response certificate key client_version build release platform device_name model os app".split(" ");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function verifyPhase6(args, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  const fail = new Set();
  const rd = (p) => readFileSync(join(root, p), "utf8");
  if (args[0] && args[0] !== `--base=${BASE}`) fail.add("P6_BASE_ATTESTATION");
  const files = [...Object.keys(FIELDS).map((n) => `${DIR}/${n}.schema.json`), `${DIR}/cutover-policy.json`, ...DOCS];
  if (!files.every((f) => existsSync(join(root, f)))) { fail.add("P6_FILES_PRESENT"); return out(fail, args); }
  let pol;
  try { pol = JSON.parse(rd(`${DIR}/cutover-policy.json`)); } catch { fail.add("P6_POLICY_STATIC"); return out(fail, args); }
  if (pol.phase !== 6 || pol.runtime !== "not_started" || pol.phase1_docker_runtime !== "pending" || pol.phase2_all_gates_false !== true || pol.one_active_assignment_per_device !== "future_required" || pol.opaque_ref_pattern !== REF || !eq(pol.schemas, Object.keys(FIELDS).map((n) => `${n}.schema.json`)) || !eq(pol.edge_pilot_prerequisites, PREREQS) || !Array.isArray(pol.checks) || !eq(pol.checks, [...pol.checks].sort())) fail.add("P6_POLICY_STATIC");
  for (const k of Object.keys(ENUMS)) if (!eq(pol[k], ENUMS[k])) fail.add("P6_ENUMS_EXACT");
  if (pol.current_default_routing_mode !== "existing_direct" || pol.current_evidence_state !== "not_started") fail.add("P6_CURRENT_DEFAULTS");
  const denied = Array.isArray(pol.denied_property_fragments) ? pol.denied_property_fragments : [];
  if (!DENIED_MIN.every((d) => denied.includes(d))) fail.add("P6_POLICY_STATIC");
  if (/https?:|\b\d{1,3}(\.\d{1,3}){3}\b|\b\d{3,}\b/.test(JSON.stringify({ ...pol, phase: 0 }))) fail.add("P6_POLICY_STATIC");
  for (const [n, fields] of Object.entries(FIELDS)) {
    let s; try { s = JSON.parse(rd(`${DIR}/${n}.schema.json`)); } catch { fail.add("P6_SCHEMAS_CLOSED"); continue; }
    if (s.$schema !== "https://json-schema.org/draft/2020-12/schema" || !/future contract only, no live app\/route\/PBX action in Phase 6/i.test(String(s.description))) fail.add("P6_SCHEMAS_DRAFT_2020_12");
    if (s.type !== "object" || s.additionalProperties !== false) fail.add("P6_SCHEMAS_CLOSED");
    const props = Object.keys(s.properties || {});
    if (!eq([...props].sort(), Object.keys(fields).sort()) || !eq([...(s.required || [])].sort(), Object.keys(fields).sort())) fail.add("P6_REQUIRED_FIELDS_EXACT");
    for (const p of props) {
      const v = s.properties[p];
      if (p === "version") { if (v.const !== "v1") fail.add("P6_REQUIRED_FIELDS_EXACT"); continue; }
      const lower = p.toLowerCase().replace(/_(ref|at|state|scope|code|mode)$/, "");
      if (denied.some((d) => lower.includes(d))) fail.add("P6_SENSITIVE_FIELDS_ABSENT");
      if (p.endsWith("_ref") && !(v.type === "string" && v.pattern === REF)) fail.add("P6_OPAQUE_REF_PATTERN");
      if (p.endsWith("_at") && !(v.type === "string" && v.pattern === TS)) fail.add("P6_TIMESTAMP_PATTERN");
    }
    for (const [p, e] of Object.entries(fields)) if (e && !eq(s.properties?.[p]?.enum, ENUMS[e])) fail.add("P6_ENUMS_EXACT");
  }
  for (const d of DOCS) {
    const t = rd(d);
    if (!/Phase 1 Docker runtime validation/.test(t) || /https?:\/\/|```(bash|sh|shell)|\$ |\b\d{1,3}(\.\d{1,3}){3}\b/.test(t)) fail.add("P6_DOCS_REQUIREMENTS");
  }
  const co = rd(DOCS[0]);
  const labels = [...co.matchAll(/\|([^|]+)\|/g)].map((m) => m[1]);
  if (!/```mermaid/.test(co) || !labels.length || !labels.every((l) => l.includes("future / disabled")) || !["Existing Lemtel Apps", "Existing Lemtel Route", "Control Plane", "Lemtel Edge", "FusionPBX"].every((x) => co.includes(x)) || !/shadow_observe/.test(co) || !/withdrawn/.test(co)) fail.add("P6_DOCS_REQUIREMENTS");
  if (!/revokes the Edge assignment before restoring/i.test(rd(DOCS[2]))) fail.add("P6_DOCS_REQUIREMENTS");
  if (readdirSync(join(root, DIR)).some((n) => /Dockerfile|compose|\.sh$|\.env/i.test(n))) fail.add("P6_NO_RUNTIME_ARTIFACTS");
  const vals = [...rd("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
  if (vals.length !== 10 || !vals.every((v) => v === "false")) fail.add("P6_PHASE2_GATES_FALSE");
  if (createHash("sha256").update(readFileSync(join(root, "infra/lemtel-edge/preflight/edge-preflight.mjs"))).digest("hex") !== PREFLIGHT_SHA) fail.add("P6_PHASE3_PREFLIGHT_UNCHANGED");
  try { const p4 = JSON.parse(rd("schemas/lemtel-edge/identity/identity-contract-policy.json")); if (p4.runtime !== "not_started" || p4.phase1_docker_runtime !== "pending") fail.add("P6_PHASE4_POLICY_STATIC"); } catch { fail.add("P6_PHASE4_POLICY_STATIC"); }
  try { const p5 = JSON.parse(rd("schemas/lemtel-edge/pbx/pbx-adapter-policy.json")); if (p5.runtime !== "not_started" || p5.current_observation_state !== "not_connected") fail.add("P6_PHASE5_POLICY_STATIC"); } catch { fail.add("P6_PHASE5_POLICY_STATIC"); }
  const self = rd("scripts/verify-lemtel-edge-phase6.mjs");
  const imports = [...self.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const forbidden = ["child_" + "process", "fet" + "ch(", "process" + ".env", "write" + "File", "append" + "File", "exec" + "Sync", "sp" + "awn(", "node:" + "net", "node:" + "http"];
  if (!imports.every((m) => ["node:fs", "node:path", "node:crypto", "node:url", "node:process"].includes(m)) || forbidden.some((f) => self.includes(f))) fail.add("P6_VERIFIER_IMPORTS_SAFE");
  return out(fail, args);
}

function out(fail, args) {
  if (fail.size) return { code: 1, stdout: [...fail].sort().map((c) => `P6_FAILED: ${c}`).join("\n") + "\n" };
  return { code: 0, stdout: args[0] ? `P6_PASSED (attested base ${BASE})\n` : "P6_PASSED\n" };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const r = verifyPhase6(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
