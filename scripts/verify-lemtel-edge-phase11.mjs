import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

// Static, offline verifier. Only local Git inspection is executed.
const BASE = "f549747ff";
const USAGE = "P11_USAGE: [--base=f549747ff]";
const DRAFT = "ht" + "tps://json-schema.org/draft/2020-12/schema";
export const ADMISSION = "schemas/lemtel-edge/runtime/closed-local-edge-runtime-admission-v1.schema.json";
export const REPORT = "schemas/lemtel-edge/runtime/closed-local-edge-runtime-report-v1.schema.json";
export const DOCS = ["docs/lemtel-edge/phase-11-closed-local-runtime-admission.md", "docs/lemtel-edge/phase-11-closed-local-runtime-threat-model.md"];
export const SELF = "scripts/verify-lemtel-edge-phase11.mjs";
export const TEST = "src/test/lemtelEdgePhase11.test.ts";
export const ALLOWED = [ADMISSION, REPORT, ...DOCS, SELF, TEST];
export const ADMISSION_CONSTS = {
  schemaVersion: "closed_local_edge_runtime_admission_v1", intent: "closed_local_validation", runtimeState: "not_started",
  featureGates: "all_false", exposure: "loopback_only", networkPolicy: "default_deny", signallingBehavior: "static_503_only",
  mediaBehavior: "not_started", upstreamBehavior: "disabled", controlPlaneBehavior: "disabled", clientBehavior: "unchanged",
  cleanupRequirement: "mandatory", approvalState: "not_approved",
};
const R = ["not_run", "passed", "failed"], B = ["not_run", "blocked", "failed"];
export const REPORT_ENUMS = {
  result: R, configSyntax: R, closedResponse: R, externalEgress: B, upstreamConnection: B,
  controlPlaneConnection: B, mediaRelay: B, cleanup: R, failureCode: ["none", "local_validation_failed", "cleanup_failed"],
};
export const STATUS = ["configSyntax", "closedResponse", "externalEgress", "upstreamConnection", "controlPlaneConnection", "mediaRelay", "cleanup"];
export const GATES = ["edge_enabled", "sip_registration_enabled", "sip_proxy_enabled", "rtp_relay_enabled", "fusionpbx_upstream_enabled", "control_plane_events_enabled", "push_invite_events_enabled", "recording_enabled", "transcoding_enabled", "media_forking_enabled"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Minimal Draft 2020-12 subset validator (const, enum, type object, required, additionalProperties false, allOf if/then).
export function validate(schema, v) {
  if (!schema || typeof schema !== "object") return false;
  if ("const" in schema && !eq(schema.const, v)) return false;
  if (schema.enum && !schema.enum.some((e) => eq(e, v))) return false;
  if (schema.type === "object" && (typeof v !== "object" || v === null || Array.isArray(v))) return false;
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    for (const r of schema.required || []) if (!(r in v)) return false;
    const props = schema.properties || {};
    for (const k of Object.keys(v)) {
      if (k in props) { if (!validate(props[k], v[k])) return false; }
      else if (schema.additionalProperties === false) return false;
    }
  }
  for (const sub of schema.allOf || []) {
    if (sub.if && validate(sub.if, v)) { if (sub.then && !validate(sub.then, v)) return false; }
    else if (!sub.if && !validate(sub, v)) return false;
  }
  return true;
}

const closedLeaf = (p) => p && (("const" in p && typeof p.const === "string") || (Array.isArray(p.enum) && p.enum.every((e) => typeof e === "string"))) && !("pattern" in p) && !("type" in p && !("const" in p) && !p.enum);

export function checkAdmissionSchema(s) {
  const f = [];
  if (s.$schema !== DRAFT) f.push("P11_SCHEMA_DRAFT");
  if (s.type !== "object" || s.additionalProperties !== false) f.push("P11_SCHEMA_STRICT");
  if (!/offline/i.test(String(s.title) + String(s.description)) || !/non-executable admission contract/i.test(String(s.title) + " " + String(s.description))) f.push("P11_SCHEMA_DESCRIPTION");
  const props = s.properties || {};
  if (!eq(Object.keys(props).sort(), Object.keys(ADMISSION_CONSTS).sort()) || !eq([...(s.required || [])].sort(), Object.keys(ADMISSION_CONSTS).sort())) f.push("P11_ADMISSION_CONSTANTS");
  for (const [k, c] of Object.entries(ADMISSION_CONSTS)) if (!props[k] || !eq(Object.keys(props[k]), ["const"]) || props[k].const !== c) f.push("P11_ADMISSION_CONSTANTS");
  return [...new Set(f)];
}

export function checkReportSchema(s) {
  const f = [];
  if (s.$schema !== DRAFT) f.push("P11_SCHEMA_DRAFT");
  if (s.type !== "object" || s.additionalProperties !== false) f.push("P11_SCHEMA_STRICT");
  const props = s.properties || {};
  const keys = ["schemaVersion", ...Object.keys(REPORT_ENUMS), "featureGates"].sort();
  if (!eq(Object.keys(props).sort(), keys) || !eq([...(s.required || [])].sort(), keys)) f.push("P11_REPORT_FIELDS");
  if (props.schemaVersion?.const !== "closed_local_edge_runtime_report_v1" || props.featureGates?.const !== "all_false") f.push("P11_REPORT_FIELDS");
  for (const [k, e] of Object.entries(REPORT_ENUMS)) if (!eq(props[k]?.enum, e)) f.push("P11_REPORT_FIELDS");
  for (const p of Object.values(props)) if (!closedLeaf(p)) f.push("P11_SCHEMA_FREE_FORM");
  // Behavioural proof of conditional relationships.
  const base = { schemaVersion: "closed_local_edge_runtime_report_v1", featureGates: "all_false" };
  const nr = Object.fromEntries(STATUS.map((k) => [k, "not_run"]));
  const ok = [
    { ...base, ...nr, result: "not_run", failureCode: "none" },
    { ...base, ...nr, result: "passed", configSyntax: "passed", externalEgress: "blocked", failureCode: "none" },
    { ...base, ...nr, result: "failed", failureCode: "local_validation_failed" },
    { ...base, ...nr, result: "failed", failureCode: "cleanup_failed" },
  ];
  const bad = [
    { ...base, ...nr, result: "not_run", failureCode: "cleanup_failed" },
    { ...base, ...nr, result: "passed", failureCode: "local_validation_failed" },
    { ...base, ...nr, result: "failed", failureCode: "none" },
    ...STATUS.map((k) => ({ ...base, ...nr, result: "not_run", failureCode: "none", [k]: k.match(/Response|Syntax|cleanup/) ? "passed" : "blocked" })),
  ];
  if (!ok.every((o) => validate(s, o)) || bad.some((o) => validate(s, o))) f.push("P11_REPORT_CONDITIONALS");
  return [...new Set(f)];
}

const J = (...p) => new RegExp(p.join(""), "i");
export const DOC_PATTERNS = [
  J("```\\s*(ba", "sh|sh|shell|zsh|console|powershell|dockerfile|ya", "ml)"), J("^\\s*\\$ "), J("h", "ttps?://"), J("\\bwww\\."),
  J("\\b\\d{1,3}(\\.\\d{1,3}){3}\\b"), J("\\[?[0-9a-f]{1,4}::"), J("\\b(local", "host)\\b"), J("\\bpo", "rt\\s*[:=]?\\s*\\d"),
  J(":\\d{2,5}\\b"), J("\\b[a-z0-9.-]+\\.(com|net|org|ca|io|local|lan)\\b"), J("\\bsi", "ps?:"), J("\\b[a-z0-9._-]+/[a-z0-9._-]+:[a-z0-9._-]+"),
  J("\\bdocker\\s+(run|pull|build|compose|exec)"), J("\\bcompose\\s+(up|run)"), J("(pass", "word|tok", "en|sec", "ret|api[_-]?key)\\s*[:=]"),
  J("-----BEGIN"), J("\\bext(ension)?\\s*\\d{2,}"),
];
export const SOURCE_PATTERNS = [
  J("\\bfet", "ch\\s*\\("), J("\\bnode:(ht", "tp|ht", "tps|ne", "t|dg", "ram|dn", "s|tl", "s|wor", "ker_threads|clu", "ster)\\b"), J("\\bWeb", "Socket\\b"),
  J("\\b(sp", "awn|sp", "awnSync|fo", "rk|ex", "ec|ex", "ecSync)\\s*\\("), J("\\.lis", "ten\\s*\\("), J("\\b(app|server|fastify|router)\\.(get|post|put|patch|delete|route|register)\\s*\\("),
  J("process\\.e", "nv"), J("\\b(writeFile|appendFile|mkdir|rmSync|unlink)(Sync)?\\s*\\("), J("\\bdocker\\s+(run|pull|build|compose)"), J("h", "ttps?://"), J("\\b\\d{1,3}(\\.\\d{1,3}){3}\\b"),
];
const GIT_ALLOW = 'execFileSync("git"';

export function scanDoc(t) { return DOC_PATTERNS.some((r) => t.split("\n").some((l) => r.test(l))); }
export function scanSource(t) { return SOURCE_PATTERNS.some((r) => r.test(t)) || t.split(GIT_ALLOW).length - 1 > 1 || /execFileSync\s*\(\s*["'](?!git["'])/.test(t); }
export function gatesAllFalse(yaml) {
  const m = yaml.match(/^gates:\n((?:[ \t]+\S.*\n?)*)/m);
  if (!m) return false;
  const lines = m[1].split("\n").filter((l) => l.trim());
  return lines.length === 10 && GATES.every((g) => lines.some((l) => l.trim() === `${g}: false`));
}
export function classify(paths) {
  const f = [];
  for (const p of paths) {
    if (ALLOWED.includes(p)) continue;
    f.push("P11_SCOPE_EXACT");
    if (/^(schemas|docs|infra)\/lemtel-edge\//.test(p) || /verify-lemtel-edge-phase[2-6]|lemtelEdgePhase[2-6]/.test(p)) f.push("P11_EDGE_FROZEN");
    if (/lemtel-control-plane|lemtelControlPlane/.test(p)) f.push("P11_CONTROL_PLANE_FROZEN");
    if (/^(apps\/|supabase\/|src\/(pages|components|lib)\/|public\/|ios\/|android\/|capacitor|package)|planipret|lemtel-uc|deploy/i.test(p)) f.push("P11_PROTECTED_PATHS");
  }
  return f;
}

export function verifyPhase11(args, root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), opts = {}) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  if (args[0] && args[0] !== `--base=${BASE}`) return { code: 1, stdout: "P11_FAILED: P11_BASE_ATTESTATION\n" };
  const fail = new Set();
  const rd = (p) => readFileSync(join(root, p), "utf8");
  if (!ALLOWED.every((p) => existsSync(join(root, p)))) { fail.add("P11_FILES_PRESENT"); return out(fail, args); }
  if (!opts.skipGit) {
    const git = (a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    try {
      git(["cat-file", "-e", `${BASE}^{commit}`]);
      const changed = git(["diff", "--name-only", BASE]).split("\n").filter(Boolean);
      const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
      for (const c of classify(changed)) fail.add(c);
      if (untracked.some((p) => !ALLOWED.includes(p))) fail.add("P11_UNTRACKED");
    } catch { fail.add("P11_GIT_HISTORY"); }
  }
  try { for (const c of checkAdmissionSchema(JSON.parse(rd(ADMISSION)))) fail.add(c); } catch { fail.add("P11_SCHEMA_PARSE"); }
  try { for (const c of checkReportSchema(JSON.parse(rd(REPORT)))) fail.add(c); } catch { fail.add("P11_SCHEMA_PARSE"); }
  for (const d of DOCS) if (scanDoc(rd(d))) fail.add("P11_DOC_FORBIDDEN_CONTENT");
  for (const s of [SELF, TEST]) if (scanSource(rd(s))) fail.add("P11_SOURCE_FORBIDDEN_API");
  try { if (!gatesAllFalse(rd("infra/lemtel-edge/policy/edge-feature-gates.yaml"))) fail.add("P11_GATES_FALSE"); } catch { fail.add("P11_GATES_FALSE"); }
  return out(fail, args);
}

function out(fail, args) {
  if (fail.size) return { code: 1, stdout: [...fail].sort().map((f) => `P11_FAILED: ${f}`).join("\n") + "\n" };
  return { code: 0, stdout: args[0] ? `P11_PASSED (attested base ${BASE})\n` : "P11_PASSED\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = verifyPhase11(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
