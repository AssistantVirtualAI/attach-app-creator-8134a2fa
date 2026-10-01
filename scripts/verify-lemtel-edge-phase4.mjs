// Static checks for the Lemtel Edge Phase 4 identity contract. Usage: node scripts/verify-lemtel-edge-phase4.mjs [--base=<commit>]
// Node built-ins only. Never runs git or any subprocess, never touches the network, never writes a file, never prints source content.
// Git diff hygiene is performed separately by the validation command; --base is an attestation string checked for equality only.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_BASE = "8e43c8407";
const ID = "schemas/lemtel-edge/identity";
const DOCS = ["phase-4-identity-contract.md", "credential-reference-lifecycle.md", "phase-4-threat-model.md", "phase-4-authorization-matrix.md"].map((f) => `docs/lemtel-edge/${f}`);
const CHECKS = ["P4_BASE_ATTESTATION", "P4_DOCS_NO_CLAIMS", "P4_DOCS_NO_COMMANDS", "P4_DOCS_PHASE1_PENDING", "P4_ENUMS_EXACT", "P4_FILES_PRESENT", "P4_NO_RUNTIME_ARTIFACTS", "P4_OPAQUE_REF_PATTERN", "P4_POLICY_STATIC", "P4_PROTECTED_PHASE2_3_UNCHANGED", "P4_REQUIRED_FIELDS_EXACT", "P4_SCHEMAS_CLOSED", "P4_SCHEMAS_DRAFT_2020_12", "P4_SENSITIVE_FIELDS_ABSENT", "P4_VERIFIER_IMPORTS_SAFE"];
const PROTECTED = {
  "infra/lemtel-edge/config/kamailio-local.cfg": "042e92d3030f4260cf4e5925dda09b38564f1f6b8ff6b322b6abb209cb412fae",
  "infra/lemtel-edge/config/kamailio-tls.cfg.example": "caf49d6462bef9c03d2fd4bc45c1bb4f0b2348ab5dbed1a7085c39c8dbce4d43",
  "infra/lemtel-edge/config/kamailio.cfg": "3197c89a2b349bdf71bdaca8369ae2c99941178953b2e20a1aef39de1195a2b8",
  "infra/lemtel-edge/config/rtpengine-local.conf": "f0028049aa801c6027e93fd61d69b0472fd8ee7e99bc4904ea0f4711dc4ed2a0",
  "infra/lemtel-edge/config/rtpengine.conf": "e66a1028f1ff6b21db515f31e4759dc23536ecb413e483068c8b4181f54ec8fa",
  "infra/lemtel-edge/policy/edge-feature-gates.yaml": "d5a8af05c63b7ec16dfa42b41a9f3b67f77de8cec5a030bec3a73c5c17b2f31c",
  "infra/lemtel-edge/policy/edge-network-policy.yaml": "d740f9c8320be500547b45a0b5b003d20c4058bb83376ddc2a19bd7f9d01dc74",
  "infra/lemtel-edge/edge.env.example": "119eb59e3e103d7000c900381d136fef91bc1291055d88a03568021b85d41df8",
  "infra/lemtel-edge/preflight/edge-preflight.mjs": "30570405bc08eb9cc35daa82a0e8fd22069e4ff0f5353bc1a6bc33619d244864",
  "infra/lemtel-edge/preflight/edge-preflight.test.mjs": "48c77af13b535ab58dbe386e7d926b275496f06575e989544439d58894549f3e",
  "infra/lemtel-edge/preflight/expected-policy.json": "9b518e8886db43870595af52eab04f7235df05830a7dabff129c315a2e5bfe72",
  "schemas/lemtel-edge/edge-event-envelope-v1.schema.json": "46b0cf4f17b7bf6d3504e295d0d743d6328ec0bdb0dad2d96972a22cdfb5e07e",
  "schemas/lemtel-edge/invite-push-v1.schema.json": "f07e95d29cdfc93ccbdaefcfe705f1c7097a7214fdd4c411b6b8c6d114d9f889",
  "schemas/lemtel-edge/registration-health-v1.schema.json": "a55ffc13da177d08a3b9d170679e278836969cbf710324ee46aedeb723916e9a",
  "scripts/verify-lemtel-edge-phase2.mjs": "472387bb92e51f473775c52566a5a3989f30aa800da0a00ff97e1280e2b3a0c4",
  "src/test/lemtelEdgePhase2.test.ts": "aa8e9a9b994f8ffcfdae4294a75d492946baef886f04f4e5780073415905fd0e",
};
const OPAQUE = "^[A-Za-z0-9_-]{8,64}$";
const TS_KEYS = ["created_at", "updated_at", "issued_at", "expires_at", "decided_at", "requested_at", "revoked_at"];
const SPEC = {
  "tenant-extension-device-binding-v1.schema.json": { fields: ["version", "tenant_ref", "extension_ref", "device_ref", "binding_state", "created_at", "updated_at"], enums: { binding_state: "binding_states" } },
  "edge-capability-reference-v1.schema.json": { fields: ["version", "capability_ref", "tenant_ref", "extension_ref", "device_ref", "edge_instance_ref", "capabilities", "issued_at", "expires_at", "state"], enums: { state: "capability_states" }, items: { capabilities: "capabilities" } },
  "edge-authorization-decision-v1.schema.json": { fields: ["version", "decision_ref", "tenant_ref", "extension_ref", "device_ref", "capability_ref", "decision", "reason_code", "decided_at"], enums: { decision: "decisions", reason_code: "reason_codes" } },
  "edge-credential-resolution-request-v1.schema.json": { fields: ["version", "request_ref", "edge_instance_ref", "tenant_ref", "extension_ref", "device_ref", "capability_ref", "requested_at"], enums: {} },
  "edge-credential-resolution-result-v1.schema.json": { fields: ["version", "resolution_ref", "credential_handle_ref", "edge_instance_ref", "tenant_ref", "extension_ref", "device_ref", "capability_ref", "state", "expires_at"], enums: { state: "resolution_states" }, allowFields: ["credential_handle_ref"] },
  "edge-revocation-notice-v1.schema.json": { fields: ["version", "revocation_ref", "tenant_ref", "extension_ref", "device_ref", "capability_ref", "revocation_scope", "revoked_at"], enums: { revocation_scope: "revocation_scopes" } },
};
const POLICY_ENUM_KEYS = ["capabilities", "binding_states", "capability_states", "decisions", "reason_codes", "resolution_states", "revocation_scopes"];

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const read = (root, p) => readFileSync(join(root, p), "utf8");

export function verifyPhase4(argv, root = ROOT) {
  const failed = new Set();
  const check = (id, fn) => { let ok = false; try { ok = fn() === true; } catch { ok = false; } if (!ok) failed.add(id); };
  const baseArg = argv.find((a) => a.startsWith("--base="));
  if (argv.some((a) => !a.startsWith("--base="))) return { code: 2, stdout: "P4_USAGE: [--base=<commit>]\n" };
  check("P4_BASE_ATTESTATION", () => !baseArg || baseArg === `--base=${EXPECTED_BASE}`);

  let policy = null;
  check("P4_FILES_PRESENT", () => {
    policy = JSON.parse(read(root, `${ID}/identity-contract-policy.json`));
    return Object.keys(SPEC).every((f) => existsSync(join(root, ID, f))) && DOCS.every((f) => existsSync(join(root, f)));
  });
  if (!policy) return { code: 1, stdout: [...failed].sort().map((i) => `P4_FAILED: ${i}`).join("\n") + "\n" };

  check("P4_POLICY_STATIC", () => policy.phase === 4 && policy.runtime === "not_started" && policy.phase1_docker_runtime === "pending"
    && same(policy.schemas, Object.keys(SPEC)) && policy.opaque_ref_pattern === OPAQUE && same(policy.checks, CHECKS)
    && ["password", "secret", "token", "jwt", "credential", "auth", "sip", "pbx", "host", "url", "uri", "ip", "caller", "callee", "number", "phone", "email", "name", "recording", "voicemail", "message", "push", "certificate", "key", "endpoint", "transport"].every((f) => policy.denied_property_fragments.includes(f))
    && Object.entries(policy).every(([k, v]) => typeof v !== "string" || !/https?:|@|\d+\.\d+\.\d+\.\d+|BEGIN/.test(v) || k === "opaque_ref_pattern"));

  const schemas = {};
  for (const f of Object.keys(SPEC)) { try { schemas[f] = JSON.parse(read(root, `${ID}/${f}`)); } catch { failed.add("P4_FILES_PRESENT"); } }
  const all = Object.values(schemas);
  check("P4_SCHEMAS_DRAFT_2020_12", () => all.length === 6 && all.every((s) => s.$schema === "https://json-schema.org/draft/2020-12/schema"));
  const closed = (n) => !n || typeof n !== "object" || ((n.type !== "object" && !n.properties) || n.additionalProperties === false) && Object.values(n).every((v) => typeof v !== "object" || closed(v));
  check("P4_SCHEMAS_CLOSED", () => all.length === 6 && all.every((s) => s.type === "object" && closed(s)));
  check("P4_REQUIRED_FIELDS_EXACT", () => Object.entries(SPEC).every(([f, sp]) => same(schemas[f].required, sp.fields) && same(Object.keys(schemas[f].properties), sp.fields)
    && schemas[f].properties.version.const === "v1"
    && TS_KEYS.filter((k) => sp.fields.includes(k)).every((k) => schemas[f].properties[k].type === "string" && /Z\$$/.test(schemas[f].properties[k].pattern))));
  check("P4_OPAQUE_REF_PATTERN", () => Object.entries(SPEC).every(([f, sp]) => sp.fields.filter((k) => k.endsWith("_ref")).every((k) => { const p = schemas[f].properties[k]; return p.type === "string" && p.pattern === OPAQUE && Object.keys(p).length === 2; })));
  check("P4_ENUMS_EXACT", () => {
    const cap = schemas["edge-capability-reference-v1.schema.json"].properties.capabilities;
    if (!(cap.type === "array" && cap.uniqueItems === true && cap.minItems === 1 && cap.maxItems === 4)) return false;
    const want = { capabilities: ["sip_register", "sip_call", "call_control", "device_status"], binding_states: ["active", "suspended", "revoked"], capability_states: ["active", "expired", "revoked"], decisions: ["allow", "deny"], reason_codes: ["binding_active", "binding_suspended", "binding_revoked", "capability_expired", "capability_revoked", "edge_not_authorized", "device_not_authorized", "tenant_mismatch"], resolution_states: ["granted", "denied", "expired", "revoked"], revocation_scopes: ["device", "capability", "binding"] };
    if (!POLICY_ENUM_KEYS.every((k) => JSON.stringify(policy[k]) === JSON.stringify(want[k]))) return false;
    return Object.entries(SPEC).every(([f, sp]) => Object.entries(sp.enums).every(([k, pk]) => JSON.stringify(schemas[f].properties[k].enum) === JSON.stringify(want[pk]))
      && Object.entries(sp.items ?? {}).every(([k, pk]) => JSON.stringify(schemas[f].properties[k].items.enum) === JSON.stringify(want[pk])));
  });
  check("P4_SENSITIVE_FIELDS_ABSENT", () => {
    const allowedEnum = new Set(POLICY_ENUM_KEYS.flatMap((k) => policy[k]));
    return Object.entries(SPEC).every(([f, sp]) => {
      const names = []; const enums = [];
      const walk = (n) => { if (n && typeof n === "object") { if (n.properties) names.push(...Object.keys(n.properties)); if (Array.isArray(n.enum)) enums.push(...n.enum); if ("const" in n) enums.push(n.const); for (const v of Object.values(n)) walk(v); } };
      walk(schemas[f]);
      const fieldOk = names.every((k) => (sp.allowFields ?? []).includes(k) || !policy.denied_property_fragments.some((d) => k.toLowerCase().split("_").some((part) => part === d || part.includes(d) && d.length > 3)));
      const enumOk = enums.every((v) => v === "v1" || allowedEnum.has(v));
      return fieldOk && enumOk;
    });
  });

  const docs = DOCS.map((f) => read(root, f));
  const readme = read(root, "infra/lemtel-edge/README.md");
  check("P4_DOCS_PHASE1_PENDING", () => [...docs, readme].every((s) => /Phase 1 Docker runtime (validation|test|gate)[^\n]*pending/i.test(s)));
  check("P4_DOCS_NO_CLAIMS", () => [...docs, readme].every((s) => !/\b(is|are|was|were)\s+(now\s+)?(deployed|running|live|integrated|connected)\b(?![^.]*\bnot\b)|production-ready|working call|certificate (was |is )?issued/i.test(s)));
  const SECRETLIKE = new RegExp(["-----" + "BEGIN", "\\beyJ[A-Za-z0-9_-]{10,}", "\\b[0-9a-f]{32,}\\b", "\\bgh[pousr]_[A-Za-z0-9]{20,}", "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"].join("|"));
  check("P4_DOCS_NO_COMMANDS", () => [...docs, readme].every((s) => !/```(sh|bash|shell|console|zsh)|\b(https?|wss?):\/\/|docker\s+(compose|run|build)\b|\bcurl\b|\bwget\b|\btelnet\b|\bsipp\b|\bsipsak\b|^\s*\$\s|`(node|npm|npx|git|docker|kamailio|rtpengine)\s/im.test(s) && !SECRETLIKE.test(s)));

  check("P4_NO_RUNTIME_ARTIFACTS", () => {
    const names = readdirSync(join(root, ID));
    return names.every((n) => n.endsWith(".json")) && !names.some((n) => /docker|compose|\.(sh|service|pem|key|crt|p12|pfx)$/i.test(n));
  });
  check("P4_VERIFIER_IMPORTS_SAFE", () => {
    const src = read(root, "scripts/verify-lemtel-edge-phase4.mjs");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    return imports.length > 0 && imports.every((m) => ["node:fs", "node:path", "node:crypto", "node:url", "node:process"].includes(m))
      && !new RegExp(["child" + "_process", "node:(net|dgram|http|https|tls)", "\\bfetch\\(", "write" + "File", "process\\.env", "\\bspawn\\(", "\\bexec(Sync)?\\("].join("|")).test(src);
  });
  check("P4_PROTECTED_PHASE2_3_UNCHANGED", () => Object.entries(PROTECTED).every(([p, h]) => createHash("sha256").update(readFileSync(join(root, p))).digest("hex") === h));

  if (failed.size) return { code: 1, stdout: [...failed].sort().map((i) => `P4_FAILED: ${i}`).join("\n") + "\n" };
  return { code: 0, stdout: `P4_PASSED${baseArg ? ` (attested base ${EXPECTED_BASE})` : ""}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, stdout } = verifyPhase4(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exitCode = code;
}
