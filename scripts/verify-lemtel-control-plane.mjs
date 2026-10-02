#!/usr/bin/env node
// Static safety checks for the Lemtel Control Plane (Phase 1). Usage: node scripts/verify-lemtel-control-plane.mjs [baseRef] [--audit]
import { execSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const base = process.argv.slice(2).find((a) => !a.startsWith("--"));
const fail = [];
const walk = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name === "dist" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];
const SVC = join(root, "services/lemtel-control-plane");
const src = walk(join(SVC, "src")).map((f) => [f, readFileSync(f, "utf8")]);
if (!src.length) fail.push("service source missing");

const PHASE1_BASE = "6e512e962";
const PHASE1_END = "224da47b7";
if (base) {
  const PROTECTED = /^(apps\/planipret-mobile\/|shared\/planipret-design-tokens\/|docs\/planipret\/|apps\/ava-softphone-mobile\/|apps\/ava-softphone-desktop\/|src\/pages\/lemtel-uc\/|src\/components\/lemtel-uc\/|supabase\/functions\/luc-|supabase\/functions\/_shared\/luc|supabase\/migrations\/)/;
  const git = (args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
  if (base !== PHASE1_BASE) fail.push("historical base validation failed");
  else if (git(["cat-file", "-t", PHASE1_BASE])?.trim() !== "commit" || git(["cat-file", "-t", PHASE1_END])?.trim() !== "commit" || git(["merge-base", "--is-ancestor", PHASE1_BASE, PHASE1_END]) === null) fail.push("historical range validation failed");
  else {
    const changed = (git(["diff", "--name-only", `${PHASE1_BASE}..${PHASE1_END}`]) ?? "").split("\n").filter(Boolean);
    for (const f of changed) if (PROTECTED.test(f)) fail.push(`protected path changed: ${f}`);
  }
}

for (const [f, s] of src) {
  if (/from ["'](react|react-dom|@capacitor\/[^"']+|@supabase\/[^"']+|sip\.js|jssip|@\/[^"']*)["']/.test(s)) fail.push(`forbidden import in ${f}`);
  if (/supabase|fusionpbx[-_./]|wss:\/\/|\bapns\b|\bfcm\b|firebase/i.test(s)) fail.push(`external connectivity reference in ${f}`);
  if (/@fastify\/cors|access-control-allow-origin|origin:\s*["']\*["']/i.test(s)) fail.push(`CORS in ${f}`);
  if (!f.endsWith("config.ts") && /process\.env/.test(s)) fail.push(`process.env outside config.ts: ${f}`);
}
const ALLOWED = new Set(["GET /health/live", "GET /health/ready", "GET /v1/internal/status", "POST /v1/internal/audit", "POST /v1/internal/policy/evaluate"]);
for (const [f, s] of src) for (const m of s.matchAll(/\.(get|post|put|patch|delete|all|route)\(\s*["'`]([^"'`]+)["'`]/g)) {
  const r = `${m[1].toUpperCase()} ${m[2]}`; if (!ALLOWED.has(r)) fail.push(`route not allowed: ${r} in ${f}`);
}
for (const f of walk(join(root, "src"))) if (/\.(t|j)sx?$/.test(f) && /services\/lemtel-control-plane/.test(readFileSync(f, "utf8")) && !f.endsWith("lemtelControlPlanePhase1.test.ts")) fail.push(`frontend imports control plane: ${f}`);

for (const f of [join(SVC, ".env.example"), join(root, "infra/lemtel-control-plane/.env.example")]) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const [k, ...rest] = line.split("="); const v = rest.join("=").trim();
    if (/TOKEN|PASSWORD|SECRET|URL/.test(k ?? "") && v) fail.push(`${f}: ${k} must be empty`);
  }
}

const compose = readFileSync(join(root, "infra/lemtel-control-plane/docker-compose.dev.yml"), "utf8");
const blocks = Object.fromEntries(compose.split(/\n  (?=[a-z-]+:\n)/).map((b) => [b.split(":")[0].trim(), b]));
for (const svc of ["postgres", "redis"]) if (/\n\s+ports:/.test(blocks[svc] ?? "")) fail.push(`compose exposes ${svc}`);
for (const m of compose.matchAll(/-\s*"([^"]+)"/g)) if (/^\S*:\d+:\d+$/.test(m[1]) && !m[1].startsWith("127.0.0.1:")) fail.push(`non-loopback port ${m[1]}`);
if (/network_mode:\s*host|privileged:\s*true|docker\.sock/.test(compose)) fail.push("unsafe compose option");
if (/:latest\b/.test(compose)) fail.push("compose uses latest tag");

if (!blocks["config-guard"]) fail.push("compose missing config-guard");
else {
  const g = blocks["config-guard"];
  if (!/image:\s*\S+:\d[\w.-]*/.test(g)) fail.push("config-guard image not pinned");
  for (const opt of [/restart:\s*"no"/, /no-new-privileges:true/, /cap_drop:\s*\["ALL"\]/, /read_only:\s*true/, /user:\s*"\d+:\d+"/, /network_mode:\s*none/]) if (!opt.test(g)) fail.push(`config-guard missing hardening ${opt}`);
  if (/ports:|volumes:/.test(g)) fail.push("config-guard must have no ports or volumes");
}
for (const svc of ["control-plane", "postgres", "redis"]) {
  const b = blocks[svc] ?? "";
  if (!/depends_on:[\s\S]*\*after-guard/.test(b)) fail.push(`${svc} does not wait for config-guard`);
  if (!/no-new-privileges|<<: \*hardening/.test(b)) fail.push(`${svc} missing hardening`);
}
if (!/x-after-guard:[^\n]*\n\s+config-guard:\s*\{\s*condition:\s*service_completed_successfully\s*\}/.test(compose)) fail.push("after-guard anchor must require service_completed_successfully");
if (/\$\{[A-Z_]+:\?/.test(compose)) fail.push("compose uses ${VAR:?} which breaks config with the blank example");
for (const m of compose.matchAll(/\$\{(CONTROL_PLANE_(?:SERVICE_TOKEN|DB_PASSWORD|REDIS_PASSWORD))(:?-)([^}]*)\}/g)) if (m[3]) fail.push(`fallback value for ${m[1]}`);

if (process.argv.includes("--audit")) {
  try { execSync("npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org", { cwd: SVC, stdio: "pipe" }); }
  catch { fail.push("npm audit reports a high/critical production vulnerability (or audit unavailable)"); }
}

const docker = readFileSync(join(SVC, "Dockerfile"), "utf8");
if (/:latest\b/.test(docker)) fail.push("Dockerfile uses latest tag");
const last = docker.split(/^FROM /m).pop() ?? "";
if (!/^USER (?!root\b)\S+$/m.test(last)) fail.push("Dockerfile final stage runs as root");

if (fail.length) { console.error(`✗ Lemtel Control Plane verification failed (${fail.length}):`); for (const f of fail) console.error(`  - ${f}`); process.exit(1); }
console.log(`✓ Lemtel Control Plane verification passed${base ? ` (base ${base})` : ""}`);
