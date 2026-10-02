import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const src = walk(join(root, "src")).map((f) => [f, readFileSync(f, "utf8")] as const);

test("no browser, Supabase, FusionPBX, SIP or Edge connectivity code", () => {
  for (const [f, s] of src) {
    assert.doesNotMatch(s, /from ["'](react|@capacitor|@supabase|sip\.js|jssip|@\/)/, f);
    assert.doesNotMatch(s, /supabase|fusionpbx-proxy|wss:\/\/|apns|fcm|firebase/i, f);
    assert.doesNotMatch(s, /@fastify\/cors|access-control-allow-origin/i, f);
  }
});

test("process.env only used in config.ts", () => {
  for (const [f, s] of src) if (!f.endsWith("config.ts")) assert.doesNotMatch(s, /process\.env/, f);
});

test("only the five approved local Control Plane routes exist", () => {
  const routes = src.flatMap(([, s]) => [...s.matchAll(/app\.(get|post|put|patch|delete|all|route)\(\s*"([^"]+)"/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`)).sort();
  assert.deepEqual(routes, ["GET /health/live", "GET /health/ready", "GET /v1/internal/status", "POST /v1/internal/audit", "POST /v1/internal/policy/evaluate"]);
});

test("policy evaluator route keeps its strict non-executable boundary", () => {
  const r = readFileSync(join(root, "src/routes/policy-evaluation.ts"), "utf8");
  const imports = [...r.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["../auth.js", "../policy/assignment-lifecycle.js", "../policy/cutover.js", "fastify"]);
  assert.match(r, /^import type \{[^}]+\} from "fastify";$/m);
  assert.equal((r.match(/execution: "non_executable"/g) ?? []).length, 2);
  assert.doesNotMatch(r, /recordAudit|audit|\bdb\b|redis|fetch\(|node:|child_process|readFile|writeFile|Date|Math\.random|randomUUID|process\.|setTimeout|setInterval|import\(|require\(/);
  assert.doesNotMatch(r, /cors|access-control/i);
  assert.deepEqual([...r.matchAll(/app\.(get|post|put|patch|delete|all|route)\(/g)].map((m) => m[1]), ["post"]);
  assert.doesNotMatch(r, /\b(user|organization|tenant|extension|device|credential|password|secret|phone|sip|pbx|host|url|ip|recording|voicemail|message|cdr|call|contact|push|apns|fcm)\w*/i);
  for (const m of r.matchAll(/send\((\{[^}]*\})\)/g)) assert.match(m[1], /^\{ error: "[a-z_]+" \}$/);
});

test("migration only creates the two allowed tables and no unsafe grants", () => {
  const sql = readFileSync(join(root, "migrations/0001_control_plane_foundation.sql"), "utf8");
  const tables = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(tables, ["control_plane_audit_events", "schema_migrations"]);
  assert.doesNotMatch(sql, /SECURITY DEFINER|GRANT ALL|TO PUBLIC|EXECUTE format|tenant|extension|sip|pbx|device|call|recording|voicemail|message|phone|email/i);
});

test("Dockerfile final stage is non-root with pinned tags", () => {
  const d = readFileSync(join(root, "Dockerfile"), "utf8");
  assert.doesNotMatch(d, /:latest/); assert.match(d.split(/^FROM /m).pop()!, /^USER node$/m);
});
