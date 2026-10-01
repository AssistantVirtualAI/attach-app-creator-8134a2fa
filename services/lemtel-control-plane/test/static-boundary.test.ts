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

test("only the four Phase 1 routes exist", () => {
  const routes = src.flatMap(([, s]) => [...s.matchAll(/app\.(get|post|put|patch|delete|all|route)\(\s*"([^"]+)"/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`)).sort();
  assert.deepEqual(routes, ["GET /health/live", "GET /health/ready", "GET /v1/internal/status", "POST /v1/internal/audit"]);
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
