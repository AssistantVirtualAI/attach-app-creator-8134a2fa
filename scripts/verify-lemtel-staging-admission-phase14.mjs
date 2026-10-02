import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

// Static, offline verifier. The only process run is local Git inspection.
export const BASE = "e224f5449";
const USAGE = "P14_USAGE: [--base=e224f5449]";
const DRAFT = "ht" + "tps://json-schema.org/draft/2020-12/schema";
const DIR = "schemas/lemtel-staging-admission";
export const REQUEST = `${DIR}/staging-admission-request-v1.schema.json`;
export const DECISION = `${DIR}/staging-admission-decision-v1.schema.json`;
export const EVIDENCE = `${DIR}/staging-admission-evidence-v1.schema.json`;
export const POLICY = `${DIR}/staging-admission-policy.json`;
export const DOC = "docs/lemtel-staging-admission/phase-14-0-offline-admission.md";
export const THREAT = "docs/lemtel-staging-admission/phase-14-0-threat-model.md";
export const SELF = "scripts/verify-lemtel-staging-admission-phase14.mjs";
export const TEST = "src/test/lemtelStagingAdmissionPhase14.test.ts";
export const ALLOWED = [REQUEST, DECISION, EVIDENCE, POLICY, DOC, THREAT, SELF, TEST];
export const NON_DOC = [REQUEST, DECISION, EVIDENCE, POLICY, SELF, TEST];
export const GATES_FILE = "infra/lemtel-edge/policy/edge-feature-gates.yaml";
export const GATES = ["edge_enabled", "sip_registration_enabled", "sip_proxy_enabled", "rtp_relay_enabled", "fusionpbx_upstream_enabled", "control_plane_events_enabled", "push_invite_events_enabled", "recording_enabled", "transcoding_enabled", "media_forking_enabled"];
export const PREREQS = ["dedicated_vps_hardened", "key_only_ssh_verified", "firewall_ssh_only_verified", "weekly_hostinger_backup_enabled", "fresh_prechange_snapshot_created", "external_encrypted_backup_approved", "offserver_restore_test_passed", "monitoring_owner_named", "logs_retention_approved", "secrets_owner_named", "private_dns_and_tls_approved", "pbx_integration_approved", "all_edge_gates_false"];
export const CURRENT = {
  dedicated_vps_hardened: true, key_only_ssh_verified: true, firewall_ssh_only_verified: true, weekly_hostinger_backup_enabled: true,
  fresh_prechange_snapshot_created: false, external_encrypted_backup_approved: true, offserver_restore_test_passed: true,
  monitoring_owner_named: false, logs_retention_approved: false, secrets_owner_named: false, private_dns_and_tls_approved: false,
  pbx_integration_approved: false, all_edge_gates_false: true,
};
export const FLAGS = ["deployment_allowed", "runtime_allowed", "persistent_data_allowed", "secrets_allowed", "network_allowed"];
export const REASON_CODES = PREREQS.map((p) => "unmet_" + p);
export const STATES = ["not_provided", "verified", "rejected"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Minimal Draft 2020-12 subset validator.
export function validate(s, v) {
  if (!isObj(s)) return false;
  if ("const" in s && !eq(s.const, v)) return false;
  if (s.enum && !s.enum.some((e) => eq(e, v))) return false;
  if (s.type === "object" && !isObj(v)) return false;
  if (s.type === "string" && typeof v !== "string") return false;
  if (s.type === "boolean" && typeof v !== "boolean") return false;
  if (s.type === "array" && !Array.isArray(v)) return false;
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) return false;
    if (s.maxLength !== undefined && v.length > s.maxLength) return false;
    if (s.pattern && !new RegExp(s.pattern).test(v)) return false;
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return false;
    if (s.maxItems !== undefined && v.length > s.maxItems) return false;
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) return false;
    if (s.items && !v.every((x) => validate(s.items, x))) return false;
  }
  if (isObj(v)) {
    for (const r of s.required || []) if (!(r in v)) return false;
    const props = s.properties || {};
    for (const k of Object.keys(v)) {
      if (k in props) { if (!validate(props[k], v[k])) return false; }
      else if (s.additionalProperties === false) return false;
    }
  }
  for (const sub of s.allOf || []) if (sub.if && validate(sub.if, v) && sub.then && !validate(sub.then, v)) return false;
  return true;
}

const OPAQUE = { type: "string", minLength: 8, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]{7,63}$" };
const strictObj = (s, keys) => isObj(s) && s.type === "object" && s.additionalProperties === false
  && eq(Object.keys(s.properties || {}).sort(), [...keys].sort()) && eq([...(s.required || [])].sort(), [...keys].sort());

export function checkRequestSchema(s) {
  return s.$schema === DRAFT && strictObj(s, ["kind", "request_id", "evidence_ref", "checks"])
    && eq(s.properties.kind, { const: "staging_admission" }) && eq(s.properties.request_id, OPAQUE) && eq(s.properties.evidence_ref, OPAQUE)
    && strictObj(s.properties.checks, PREREQS) && PREREQS.every((p) => eq(s.properties.checks.properties[p], { type: "boolean" }));
}
export function checkDecisionSchema(s) {
  const p = s.properties || {};
  return s.$schema === DRAFT && strictObj(s, ["kind", "request_id", "decision_ref", "decision", "reason_codes", ...FLAGS])
    && eq(p.kind, { const: "staging_admission_decision" }) && eq(p.request_id, OPAQUE) && eq(p.decision_ref, OPAQUE)
    && eq(p.decision, { enum: ["denied", "admitted"] })
    && eq(p.reason_codes, { type: "array", uniqueItems: true, minItems: 0, maxItems: 13, items: { enum: REASON_CODES } })
    && FLAGS.every((f) => eq(p[f], { const: false }))
    && eq(s.allOf, [
      { if: { properties: { decision: { const: "admitted" } }, required: ["decision"] }, then: { properties: { reason_codes: { maxItems: 0 } } } },
      { if: { properties: { decision: { const: "denied" } }, required: ["decision"] }, then: { properties: { reason_codes: { minItems: 1 } } } },
    ]);
}
export function checkEvidenceSchema(s) {
  return s.$schema === DRAFT && strictObj(s, ["kind", "request_id", "evidence_ref", "evidence"])
    && eq(s.properties.kind, { const: "staging_admission_evidence" }) && eq(s.properties.request_id, OPAQUE) && eq(s.properties.evidence_ref, OPAQUE)
    && strictObj(s.properties.evidence, PREREQS) && PREREQS.every((p) => eq(s.properties.evidence.properties[p], { enum: STATES }));
}

export const unmet = (checks) => PREREQS.filter((p) => checks[p] !== true).map((p) => "unmet_" + p);
// Pure, non-executing outcome derivation: admitted only when every prerequisite is true.
export const outcome = (checks) => (unmet(checks).length === 0 ? "admitted" : "denied");
// A decision is consistent only if it is schema-valid and matches the prerequisites exactly.
export function decisionConsistent(schema, decision, checks) {
  if (!validate(schema, decision)) return false;
  if (decision.decision !== outcome(checks)) return false;
  return eq(decision.reason_codes, unmet(checks));
}

export function checkPolicy(p) {
  const keys = ["policy_version", "offline_only", ...FLAGS, "allowed_decisions", "default_decision", "current_decision", "current_reason_codes", "prerequisites"];
  return isObj(p) && eq(Object.keys(p).sort(), keys.sort())
    && p.policy_version === "staging_admission_policy_v1" && p.offline_only === true && FLAGS.every((f) => p[f] === false)
    && eq(p.allowed_decisions, ["denied", "admitted"]) && p.default_decision === "denied" && p.current_decision === "denied"
    && isObj(p.prerequisites) && eq(p.prerequisites, CURRENT) && eq(Object.keys(p.prerequisites), PREREQS)
    && outcome(p.prerequisites) === "denied" && eq(p.current_reason_codes, unmet(p.prerequisites));
}

export function gatesAllFalse(y) {
  const m = y.match(/^gates:\n((?:[ \t]+.*\n?)*)/m);
  if (!m) return false;
  const lines = m[1].split("\n").filter((l) => l.trim());
  return lines.length === 10 && GATES.every((g) => lines.some((l) => l.trim() === `${g}: false`));
}

// Capability scan for executable/static data paths (documents are excluded).
const CAP = new RegExp([
  "node:(ht" + "tp|ht" + "tps|ne" + "t|dg" + "ram|dn" + "s|tl" + "s|http2|worker_threads|cluster|vm)", "\\bfet" + "ch\\s*\\(", "Web" + "Socket", "XMLHttp" + "Request",
  "\\.lis" + "ten\\s*\\(", "createSer" + "ver", "she" + "ll\\s*:\\s*true", "\\bexec" + "Sync\\s*\\(", "\\bexec\\s*\\(", "\\bspa" + "wn\\s*\\(", "\\bfo" + "rk\\s*\\(",
  "np" + "m (i|install|ci|add)\\b", "bu" + "n add", "pi" + "p install", "ap" + "t(-get)? install", "\\bcu" + "rl\\b", "\\bwg" + "et\\b", "\\bss" + "h\\s",
  "proc" + "ess\\.env", "sup" + "abase", "\\bpg\\b", "postg" + "res", "red" + "is", "mys" + "ql", "sqli" + "te", "\\bdo" + "cker\\b",
  "pass" + "word\\s*[:=]", "priv" + "ate[_ ]key", "BEGIN [A-Z ]*PRIV" + "ATE",
  "\\b(?!127\\.0\\.0\\.1\\b)\\d{1,3}(\\.\\d{1,3}){3}\\b", "(ws|wss|ftp|sftp|ht" + "tps?)://(?!json-schema\\.org/draft/2020-12/schema)",
].join("|"), "i");
export function checkCapabilities(file, text) {
  if (CAP.test(text)) return false;
  const procs = [...text.matchAll(/\b(execFileSync|spawnSync)\s*\(\s*([^,)]*)/g)].map((m) => m[2].trim());
  if (!procs.every((c) => c === '"git"')) return false;
  if (file === SELF) {
    if (new RegExp("write" + "File|append" + "File|mkd" + "ir|rmS" + "ync|\\brm\\(|cp" + "Sync|\\brena" + "me(Sync)?\\s*\\(|unl" + "ink|createWrite" + "Stream").test(text)) return false;
    const imports = [...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    if (!eq(imports, ["node:fs", "node:path", "node:url", "node:child_process", "node:process"])) return false;
  }
  return true;
}

// Documents may name operational concepts only to prohibit them; require the mandated statements.
export function checkDocs(doc, threat) {
  const d = [/offline admission package, not a deployment package/, /No server command, container, port, DNS record, TLS certificate, PBX connection or app route may be changed/,
    /current admission remains denied/i, /fresh pre-change snapshot, monitoring owner, log retention, secrets owner, private DNS\/TLS and PBX approval/,
    /do not make deployment permissible on their own/, /does not enable any service, route or Edge gate/, /separate written approval/, /Planiprêt remain unchanged/];
  const t = ["Accidental deployment", "Secret leakage", "Backup-bypass claims", "Policy tampering", "Premature PBX access", "Client cutover", "Denial-code information leakage", "Stale evidence"];
  return d.every((r) => r.test(doc)) && t.every((x) => threat.includes(x)) && /enables no live protection/.test(threat)
    && !new RegExp("(ht" + "tps?|wss?)://|\\b\\d{1,3}(\\.\\d{1,3}){3}\\b|BEGIN [A-Z ]*PRIV" + "ATE").test(doc + threat);
}

const realGit = (root, args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
export function changedPaths(root, base, git = realGit) {
  const d = git(root, ["diff", "--name-only", "--no-renames", base]);
  const u = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (d === null || u === null) return null;
  return [...new Set([...d.split("\n"), ...u.split("\n")].map((x) => x.trim()).filter(Boolean))].sort();
}

export function verify(args, root = process.cwd(), opts = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== `--base=${BASE}`)) return { code: 2, stdout: USAGE + "\n" };
  const base = opts.base ?? BASE;
  // opts.git lets tests substitute a read-only Git view of a temporary copy; the CLI always uses local Git.
  const git = opts.git ?? realGit;
  const f = [];
  const rd = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };
  const js = (p) => { try { return JSON.parse(rd(p)); } catch { return null; } };
  if (!ALLOWED.every((p) => existsSync(join(root, p)))) f.push("P14_PATHS_EXIST");
  if (git(root, ["cat-file", "-t", base]) === null) f.push("P14_BASE_MISSING");
  const ch = changedPaths(root, base, git);
  if (!ch || !eq(ch, [...ALLOWED].sort())) f.push("P14_SCOPE_EXACT");
  const rq = js(REQUEST), dc = js(DECISION), ev = js(EVIDENCE), po = js(POLICY);
  if (!rq || !checkRequestSchema(rq)) f.push("P14_REQUEST_SCHEMA");
  if (!dc || !checkDecisionSchema(dc)) f.push("P14_DECISION_SCHEMA");
  if (!ev || !checkEvidenceSchema(ev)) f.push("P14_EVIDENCE_SCHEMA");
  if (!po || !checkPolicy(po)) f.push("P14_POLICY_EXACT");
  if (po && dc) {
    const admitted = { kind: "staging_admission_decision", request_id: "req-00000001", decision_ref: "dec-00000001", decision: "admitted", reason_codes: [], ...Object.fromEntries(FLAGS.map((x) => [x, false])) };
    if (decisionConsistent(dc, admitted, po.prerequisites || {})) f.push("P14_ADMITTED_REJECTED");
  }
  const g = rd(GATES_FILE);
  const gd = git(root, ["diff", "--name-only", base, "--", GATES_FILE]);
  if (!g || !gatesAllFalse(g) || gd === null || gd.trim() !== "") f.push("P14_GATES_FALSE_UNCHANGED");
  for (const p of NON_DOC) { const t = rd(p); if (t === null || !checkCapabilities(p, t)) { f.push("P14_NO_RUNTIME_CAPABILITY"); break; } }
  const d1 = rd(DOC), d2 = rd(THREAT);
  if (!d1 || !d2 || !checkDocs(d1, d2)) f.push("P14_DOCS_REQUIRED");
  if (f.length) return { code: 1, stdout: f.map((x) => `P14_FAILED: ${x}`).join("\n") + "\n" };
  return { code: 0, stdout: args.length ? `P14_PASSED (attested base ${BASE})\n` : "P14_PASSED\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = verify(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
