import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

// Phase 10 static verifier. Read-only: local file inspection plus local Git inspection only.
const BASE = "f196aa614";
const USAGE = "CP10_USAGE: [--base=f196aa614]";
const PREFLIGHT_SHA = "30570405bc08eb9cc35daa82a0e8fd22069e4ff0f5353bc1a6bc33619d244864";
const SVC = "services/lemtel-control-plane";
const POL = (n) => `${SVC}/src/${["policy", n].join("/")}.ts`;
const ROUTE = `${SVC}/src/routes/policy-evaluation.ts`;
const DOC = "docs/lemtel-control-plane/phase-10-authenticated-policy-api.md";
const ALLOWED = [
  `${SVC}/src/app.ts`, POL("cutover"), POL("assignment-lifecycle"), ROUTE,
  `${SVC}/test/policy-evaluation.test.ts`, `${SVC}/test/static-boundary.test.ts`,
  "src/test/lemtelControlPlanePhase7.test.ts", "src/test/lemtelControlPlanePhase8.test.ts",
  DOC, "scripts/verify-lemtel-control-plane-phase10.mjs", "src/test/lemtelControlPlanePhase10.test.ts",
];
const FROZEN_PREFIXES = ["infra/", "schemas/lemtel-edge/", "docs/lemtel-edge/", "apps/", "supabase/", "shared/", "docs/planipret/"];
const MODES = ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"];
const CUTOVER = {
  requestedMode: MODES, currentActiveMode: [...MODES, "none"], phase1Runtime: ["pending", "passed"], edgeRuntime: ["disabled", "approved"],
  identityScope: ["denied", "authorized"], capability: ["invalid", "approved"], pilotApproval: ["missing", "recorded"],
  nonProductionApproval: ["missing", "approved"], directRoute: ["active", "withdrawn"], rollbackPath: ["unverified", "verified"],
};
const LIFECYCLE = {
  requestedMode: MODES, currentMode: [...MODES, "none"], currentState: ["pending", "active", "revoked", "expired", "none"],
  policyDecision: ["allow", "deny"], event: ["policy_evaluated", "activation_confirmed", "revocation_confirmed", "direct_restore_confirmed", "expiry_observed"],
};
const ROUTES = ["GET /health/live", "GET /health/ready", "GET /v1/internal/status", "POST /v1/internal/audit", "POST /v1/internal/policy/evaluate"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const walk = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name === "dist" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];

export function verifyPhase10(args, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  const fail = new Set();
  const rd = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
  const git = (a) => { try { return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); } catch { return null; } };
  if (args[0] && args[0] !== `--base=${BASE}`) fail.add("CP10_BASE_ATTESTATION");
  if (!ALLOWED.every((f) => existsSync(join(root, f)))) { fail.add("CP10_FILES_PRESENT"); return out(fail, args); }

  const changed = git(["diff", "--name-only", BASE]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (!changed || !untracked) fail.add("CP10_BASE_AVAILABLE");
  else {
    if (changed.some((f) => !ALLOWED.includes(f))) fail.add("CP10_CHANGED_PATHS");
    if (untracked.length) fail.add("CP10_NO_UNTRACKED");
    if (changed.some((f) => FROZEN_PREFIXES.some((p) => f.startsWith(p)))) fail.add("CP10_FROZEN_UNCHANGED");
    for (const p of [POL("cutover"), POL("assignment-lifecycle")]) {
      const before = git(["show", `${BASE}:${p}`]);
      const strip = (lines) => lines.filter((l) => !l.startsWith("//")).join("\n");
      if (!before || strip(before) !== strip(rd(p).split("\n").filter(Boolean))) fail.add("CP10_PURE_POLICY_UNCHANGED");
    }
  }
  for (const p of [POL("cutover"), POL("assignment-lifecycle")]) {
    const head = rd(p).split("\n").slice(0, 2).join("\n");
    if (!/Pure deterministic policy library/.test(head) || !/Phase 10 imports it only through the non-executable authenticated evaluator/.test(head) || !/proposal with no side effect/.test(head) || /^\s*import\s/m.test(rd(p))) fail.add("CP10_PURE_POLICY_COMMENTS");
  }

  const r = rd(ROUTE);
  const imports = [...r.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  if (!eq(imports, ["../auth.js", `../${["policy", "assignment-lifecycle"].join("/")}.js`, `../${["policy", "cutover"].join("/")}.js`, "fastify"]) || !/^import type \{[^}]+\} from "fastify";$/m.test(r)) fail.add("CP10_ROUTE_IMPORTS");
  const posts = [...r.matchAll(/app\.(get|post|put|patch|delete|all|route)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  if (!eq(posts, ["post /v1/internal/policy/evaluate"]) || !/makeServiceGuard\(deps\.token\)/.test(r) || (r.match(/execution: "non_executable"/g) ?? []).length !== 2
    || !/export async function policyEvaluationRoutes\(app: FastifyInstance, deps: \{ token: string \}\)/.test(r)) fail.add("CP10_ROUTE_CONTRACT");
  const block = (name) => { const m = r.match(new RegExp(`const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`)); return m ? m[1] : ""; };
  const parse = (txt) => Object.fromEntries([...txt.matchAll(/(\w+): (\[[^\]]*\]|MODES)/g)].map(([, k, v]) => [k, v === "MODES" ? MODES : v.startsWith("[...MODES") ? [...MODES, ...[...v.matchAll(/"([^"]+)"/g)].map((x) => x[1])] : [...v.matchAll(/"([^"]+)"/g)].map((x) => x[1])]));
  if (!eq(parse(block("CUTOVER_FIELDS")), CUTOVER) || !eq(parse(block("LIFECYCLE_FIELDS")), LIFECYCLE) || !r.includes(`const MODES = ${JSON.stringify(MODES).replace(/,/g, ", ")} as const;`)) fail.add("CP10_INPUT_ENUMS_EXACT");
  const errs = [...r.matchAll(/send\((\{[^}]*\})\)/g)].map((m) => m[1]);
  if (!errs.length || !errs.every((e) => /^\{ error: "(unsupported_media_type|invalid_body|invalid_fields|invalid_kind|invalid_input)" \}$/.test(e))) fail.add("CP10_STABLE_ERRORS");
  const sideEffect = new RegExp(["audit", "\\bdb\\b", "redis", "fet" + "ch\\(", "node:", "child_" + "process", "read" + "File", "wri" + "te" + "File", "\\bDate\\b", "Math\\.random", "randomUUID", "process\\.", "setTimeout", "setInterval", "import\\(", "require\\("].join("|"), "i");
  if (sideEffect.test(r)) fail.add("CP10_NO_SIDE_EFFECT_DEPS");
  if (/cors|access-control|fusion|kamailio|freeswitch|rtpengine/i.test(r) || /\b(user|organization|tenant|extension|device|credential|password|secret|phone|sip|pbx|host|url|ip|recording|voicemail|message|cdr|call|contact|push|apns|fcm)\w*/i.test(r)) fail.add("CP10_NO_IDENTITY_OR_PROVIDER_FIELDS");

  const app = rd(`${SVC}/src/app.ts`);
  if (!/app\.register\(async \(s\) => policyEvaluationRoutes\(s, \{ token: deps\.token \}\)\);\n  return app;/.test(app) || app.indexOf("internalRoutes(s") > app.indexOf("policyEvaluationRoutes(s")) fail.add("CP10_APP_REGISTRATION");
  const routes = walk(join(root, SVC, "src")).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/app\.(get|post|put|patch|delete|all|route)\(\s*"([^"]+)"/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`)).sort();
  const sb = rd(`${SVC}/test/static-boundary.test.ts`);
  if (!eq(routes, ROUTES) || !sb.includes('test("only the five approved local Control Plane routes exist"') || !sb.includes(JSON.stringify(ROUTES).replace(/","/g, '", "'))) fail.add("CP10_FIVE_ROUTES");

  const evaluatorRel = join(root, ROUTE);
  for (const n of ["cutover", "assignment-lifecycle"]) {
    const ref = new RegExp(`policy/${n}`);
    const refs = walk(join(root, SVC, "src")).filter((f) => !f.endsWith(join("policy", `${n}.ts`)) && ref.test(readFileSync(f, "utf8")));
    if (!eq(refs, [evaluatorRel])) fail.add("CP10_SINGLE_EVALUATOR_IMPORT");
  }
  const t7 = rd("src/test/lemtelControlPlanePhase7.test.ts"), t8 = rd("src/test/lemtelControlPlanePhase8.test.ts");
  if (!t7.includes('const BASE = "338dfff53"') || !t7.includes('const PHASE7_END = "0b0d74f9d"') || !t8.includes('const BASE = "0b0d74f9d"') || !t8.includes('const PHASE8_END = "a76ac1d48"')
    || ![t7, t8].every((t) => t.includes('"policy-evaluation.ts"') && t.includes("non_executable") && t.includes("node_modules/.bin/tsx") && !/skipIf|it\.skip|\.skip\(|\.todo|\btodo\(/.test(t))
    || /no Control Plane runtime file references/.test(t7 + t8)) fail.add("CP10_PHASE7_8_TESTS");

  const vals = [...rd("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
  if (vals.length !== 10 || !vals.every((v) => v === "false")) fail.add("CP10_PHASE2_GATES_FALSE");
  let sha = ""; try { sha = createHash("sha256").update(readFileSync(join(root, "infra/lemtel-edge/preflight/edge-preflight.mjs"))).digest("hex"); } catch { /* missing */ }
  if (sha !== PREFLIGHT_SHA) fail.add("CP10_PHASE3_PREFLIGHT_UNCHANGED");
  const js = (p) => { try { return JSON.parse(rd(p)); } catch { return {}; } };
  if (js("schemas/lemtel-edge/cutover/cutover-policy.json").runtime !== "not_started" || js("schemas/lemtel-edge/identity/identity-contract-policy.json").runtime !== "not_started" || js("schemas/lemtel-edge/pbx/pbx-adapter-policy.json").runtime !== "not_started") fail.add("CP10_PHASE4_6_STATIC");

  const d = rd(DOC);
  if (!d.includes("`POST /v1/internal/policy/evaluate`") || !d.includes('"execution":"non_executable"') || !/No value identifies a person, organization, extension, device, endpoint or phone system/.test(d)
    || !/No persistence, no audit write, no queue or task, no device action, no routing change and no external call/.test(d) || !/No CORS and no browser use/.test(d)
    || !/Phase 1 local Docker runtime validation has passed/.test(d) || !/All Edge gates remain false/.test(d) || !/separate approved phase/.test(d)
    || /https?:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b|:\d{2,5}\b|```(bash|sh|shell)/.test(d)) fail.add("CP10_DOCS_REQUIREMENTS");
  const runtimeTxt = walk(join(root, SVC, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
  if (/docker runtime (validation )?(has )?passed/i.test(runtimeTxt)) fail.add("CP10_RUNTIME_NOT_AUTHORIZATION");

  const t10 = rd("src/test/lemtelControlPlanePhase10.test.ts");
  if (/skipIf|it\.skip|\.skip\(|\.todo|\btodo\(/.test(t10) || !t10.includes("node_modules/.bin/tsx")) fail.add("CP10_ROOT_TEST_REQUIRED");
  const self = rd("scripts/verify-lemtel-control-plane-phase10.mjs");
  const selfImports = [...self.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const forbidden = ["fet" + "ch(", "process" + ".env", "write" + "File", "append" + "File", "sp" + "awn(", "node:" + "net", "node:" + "http", "exec" + "Sync("];
  if (!selfImports.every((m) => ["node:fs", "node:path", "node:crypto", "node:child_process", "node:url", "node:process"].includes(m)) || forbidden.some((f) => self.includes(f)) || [...self.matchAll(/execFileSync\("([^"]+)"/g)].some((m) => m[1] !== "git")) fail.add("CP10_VERIFIER_SAFE");
  return out(fail, args);
}

function out(fail, args) {
  if (fail.size) return { code: 1, stdout: [...fail].sort().map((c) => `CP10_FAILED: ${c}`).join("\n") + "\n" };
  return { code: 0, stdout: args[0] ? `CP10_PASSED (attested base ${BASE})\n` : "CP10_PASSED\n" };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const r = verifyPhase10(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
