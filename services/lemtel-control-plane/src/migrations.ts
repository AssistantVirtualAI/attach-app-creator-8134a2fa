import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "./config.js";
import { ConfigError } from "./lib/errors.js";

const LOCK_KEY = 732190451;

export type Migration = { name: string; sql: string; checksum: string };

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
    .map((name) => { const sql = readFileSync(join(dir, name), "utf8"); return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") }; });
}

export function planMigrations(all: Migration[], applied: Map<string, string>): Migration[] {
  for (const [name, sum] of applied) {
    const m = all.find((x) => x.name === name);
    if (!m) throw new Error(`migration_missing:${name}`);
    if (m.checksum !== sum) throw new Error(`migration_changed:${name}`);
  }
  return all.filter((m) => !applied.has(m.name));
}

export async function runMigrations(client: pg.Client, dir: string): Promise<string[]> {
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows } = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
    const todo = planMigrations(loadMigrations(dir), new Map(rows.map((r) => [r.name, r.checksum])));
    for (const m of todo) {
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [m.name, m.checksum]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw new Error(`migration_failed:${m.name}`); }
    }
    return todo.map((m) => m.name);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

async function main() {
  let cfg;
  try { cfg = loadConfig(); } catch (e) { process.stderr.write(`${e instanceof ConfigError ? e.message : "config_invalid"}\n`); process.exit(1); }
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
  const client = new pg.Client({ connectionString: cfg.databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const applied = await runMigrations(client, dir);
    process.stdout.write(`migrations_applied:${applied.length}\n`);
  } catch (e) {
    const msg = e instanceof Error && /^migration_/.test(e.message) ? e.message : "migration_error";
    process.stderr.write(`${msg}\n`); process.exitCode = 1;
  } finally { await client.end().catch(() => undefined); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
