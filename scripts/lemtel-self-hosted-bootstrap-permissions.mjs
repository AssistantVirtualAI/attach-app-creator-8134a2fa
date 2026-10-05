// Phase 32C — offline filesystem-permission review only.
// This script never reads .env contents, changes permissions, launches a process, or contacts a host.
import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DATABASE_SQL_FILES = Object.freeze([
  '_supabase.sql',
  'jwt.sql',
  'logs.sql',
  'pooler.sql',
  'realtime.sql',
  'roles.sql',
  'webhooks.sql',
]);

const FILE_MODE = 0o777;
const ENV_MODE = 0o600;

const modeOf = (stat) => stat.mode & FILE_MODE;
const inspect = (path, stat) => {
  try { return stat(path); }
  catch { return null; }
};

export function reviewBootstrapPermissions(directory, stat = lstatSync, list = readdirSync) {
  const root = resolve(directory);
  const reasons = [];
  const env = inspect(join(root, '.env'), stat);
  if (!env || !env.isFile() || modeOf(env) !== ENV_MODE) reasons.push('env_mode_must_be_0600');

  const sqlDirectory = join(root, 'volumes', 'db');
  let entries;
  try { entries = new Set(list(sqlDirectory)); }
  catch { entries = null; reasons.push('db_sql_directory_unreadable'); }

  if (entries) {
    for (const filename of DATABASE_SQL_FILES) {
      if (!entries.has(filename)) {
        reasons.push(`db_sql_missing_${filename}`);
        continue;
      }
      const sql = inspect(join(sqlDirectory, filename), stat);
      if (!sql || !sql.isFile()) {
        reasons.push(`db_sql_not_regular_${filename}`);
        continue;
      }
      const mode = modeOf(sql);
      if ((mode & 0o004) === 0) reasons.push(`db_sql_not_container_readable_${filename}`);
      if ((mode & 0o022) !== 0) reasons.push(`db_sql_group_or_other_writable_${filename}`);
    }
  }

  return {
    status: reasons.length ? 'bootstrap_permissions_blocked' : 'bootstrap_permissions_ready',
    authorization: false,
    reasons: reasons.length ? [...reasons, 'POLICY_REVIEW_REQUIRED'] : ['POLICY_REVIEW_REQUIRED'],
  };
}

export function run(args, cwd = process.cwd()) {
  if (args.length !== 1 || !args[0].startsWith('--root=')) {
    return { code: 2, stdout: 'USAGE: node scripts/lemtel-self-hosted-bootstrap-permissions.mjs --root=<staging-directory>\n' };
  }
  const result = reviewBootstrapPermissions(resolve(cwd, args[0].slice('--root='.length)));
  // Paths and file contents remain local; only generic findings are emitted.
  return { code: 78, stdout: `${JSON.stringify(result)}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
