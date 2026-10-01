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
const PBX = "schemas/lemtel-edge/pbx";
const DOCS = ["phase-5-pbx-adapter-contract.md", "phase-5-provisioning-state-machine.md", "phase-5-fusionpbx-prerequisites.md", "phase-5-pbx-adapter-threat-model.md"].map((d) => `docs/lemtel-edge/${d}`);
const FIELDS = {
  "pbx-tenant-binding-v1": { version: null, tenant_ref: null, upstream_ref: null, binding_state: "binding_states", created_at: null, updated_at: null },
  "pbx-extension-desired-state-v1": { version: null, operation_ref: null, tenant_ref: null, extension_ref: null, desired_state: "desired_states", requested_at: null },
  "pbx-extension-observed-state-v1": { version: null, observation_ref: null, tenant_ref: null, extension_ref: null, observed_state: "observed_states", observation_state: "observation_states", observed_at: null },
  "pbx-provisioning-request-v1": { version: null, operation_ref: null, tenant_ref: null, extension_ref: null, device_ref: null, capability_ref: null, change_kind: "change_kinds", requested_at: null },
  "pbx-provisioning-result-v1": { version: null, operation_ref: null, tenant_ref: null, extension_ref: null, device_ref: null, result_state: "result_states", reason_code: "reason_codes", resolved_at: null },
};
const ENUMS = {
  binding_states: ["active", "suspended", "revoked"], desired_states: ["active", "suspended", "revoked"],
  observed_states: ["active", "suspended", "revoked", "unknown"], observation_states: ["not_connected", "stale", "current"],
  change_kinds: ["provision_extension", "suspend_extension", "revoke_device", "refresh_binding"],
  result_states: ["queued", "applied", "rejected", "unknown"],
  reason_codes: ["adapter_not_connected", "tenant_binding_inactive", "extension_state_mismatch", "device_not_authorized", "capability_invalid", "upstream_not_authorized", "operation_not_supported"],
};
const DENIED_MIN = "password secret token jwt credential auth sip pbx_uuid host url uri ip port endpoint transport extension_number caller callee number phone email name recording voicemail message push cdr error debug response certificate key".split(" ");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function verifyPhase6(args, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  const fail = new Set();
  const rd = (p) => readFileSync(join(root, p), "utf8");
  if (args[0] && args[0] !== `--base=${BASE}`) fail.add("P6_BASE_ATTESTATION");
  const files = [...Object.keys(FIELDS).map((n) => `${PBX}/${n}.schema.json`), `${PBX}/pbx-adapter-policy.json`, ...DOCS];
  if (!files.every((f) => existsSync(join(root, f)))) { fail.add("P6_FILES_PRESENT"); return out(fail, args); }
  let pol;
  try { pol = JSON.parse(rd(`${PBX}/pbx-adapter-policy.json`)); } catch { fail.add("P6_POLICY_STATIC"); return out(fail, args); }
  if (pol.phase !== 5 || pol.runtime !== "not_started" || pol.phase1_docker_runtime !== "pending" || pol.opaque_ref_pattern !== REF || !eq(pol.schemas, Object.keys(FIELDS).map((n) => `${n}.schema.json`)) || !Array.isArray(pol.checks) || !eq(pol.checks, [...pol.checks].sort())) fail.add("P6_POLICY_STATIC");
  for (const k of Object.keys(ENUMS)) if (!eq(pol[k], ENUMS[k])) fail.add("P6_ENUMS_EXACT");
  if (pol.current_observation_state !== "not_connected") fail.add("P6_CURRENT_NOT_CONNECTED");
  const denied = Array.isArray(pol.denied_property_fragments) ? pol.denied_property_fragments : [];
  if (!DENIED_MIN.every((d) => denied.includes(d))) fail.add("P6_POLICY_STATIC");
  if (/https?:|\b\d{1,3}(\.\d{1,3}){3}\b|\b\d{3,}\b/.test(JSON.stringify({ ...pol, phase: 0 }))) fail.add("P6_POLICY_STATIC");
  for (const [n, fields] of Object.entries(FIELDS)) {
    let s; try { s = JSON.parse(rd(`${PBX}/${n}.schema.json`)); } catch { fail.add("P6_SCHEMAS_CLOSED"); continue; }
    if (s.$schema !== "https://json-schema.org/draft/2020-12/schema" || !/future contract only, not implemented in Phase 5/i.test(String(s.description))) fail.add("P6_SCHEMAS_DRAFT_2020_12");
    if (s.type !== "object" || s.additionalProperties !== false) fail.add("P6_SCHEMAS_CLOSED");
    const props = Object.keys(s.properties || {});
    if (!eq([...props].sort(), Object.keys(fields).sort()) || !eq([...(s.required || [])].sort(), Object.keys(fields).sort())) fail.add("P6_REQUIRED_FIELDS_EXACT");
    for (const p of props) {
      const lower = p.toLowerCase().replace(/_(ref|at|state|kind|code)$/, "");
      if (denied.some((d) => lower.includes(d))) fail.add("P6_SENSITIVE_FIELDS_ABSENT");
      const v = s.properties[p];
      if (p.endsWith("_ref") && !(v.type === "string" && v.pattern === REF)) fail.add("P6_OPAQUE_REF_PATTERN");
      if (p.endsWith("_at") && !(v.type === "string" && v.pattern === TS)) fail.add("P6_TIMESTAMP_PATTERN");
      if (p === "version" && v.const !== "v1") fail.add("P6_REQUIRED_FIELDS_EXACT");
    }
    for (const [p, e] of Object.entries(fields)) if (e && !eq(s.properties?.[p]?.enum, ENUMS[e])) fail.add("P6_ENUMS_EXACT");
  }
  for (const d of DOCS) {
    const t = rd(d);
    if (!/Phase 1 Docker runtime validation/.test(t) || /https?:\/\/|```(bash|sh|shell)|\$ |\b\d{1,3}(\.\d{1,3}){3}\b/.test(t)) fail.add("P6_DOCS_REQUIREMENTS");
  }
  const contract = rd(DOCS[0]);
  const labels = [...contract.matchAll(/\|([^|]+)\|/g)].map((m) => m[1]);
  if (!/```mermaid/.test(contract) || !labels.length || !labels.every((l) => l.includes("future / disabled")) || !["Client App", "Control Plane", "PBX Adapter", "Lemtel Edge", "FusionPBX"].every((x) => contract.includes(x))) fail.add("P6_DOCS_REQUIREMENTS");
  if (!/not_connected/.test(rd(DOCS[1])) || !/Revocation takes priority/.test(rd(DOCS[1]))) fail.add("P6_DOCS_REQUIREMENTS");
  if (readdirSync(join(root, PBX)).some((n) => /Dockerfile|compose|\.sh$|\.env/i.test(n))) fail.add("P6_NO_RUNTIME_ARTIFACTS");
  const gates = rd("infra/lemtel-edge/policy/edge-feature-gates.yaml");
  const vals = [...gates.matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
  if (vals.length !== 10 || !vals.every((v) => v === "false")) fail.add("P6_PHASE2_GATES_FALSE");
  const pre = readFileSync(join(root, "infra/lemtel-edge/preflight/edge-preflight.mjs"));
  if (createHash("sha256").update(pre).digest("hex") !== PREFLIGHT_SHA) fail.add("P6_PHASE3_PREFLIGHT_UNCHANGED");
  try { const p4 = JSON.parse(rd("schemas/lemtel-edge/identity/identity-contract-policy.json")); if (p4.runtime !== "not_started" || p4.phase1_docker_runtime !== "pending") fail.add("P6_PHASE4_POLICY_STATIC"); } catch { fail.add("P6_PHASE4_POLICY_STATIC"); }
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
