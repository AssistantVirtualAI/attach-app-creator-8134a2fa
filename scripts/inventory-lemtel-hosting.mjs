// Phase 31B — discovery only. Candidate names and counts are NOT a reviewed
// dependency graph, SQL export plan, function allowlist or deployment approval.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CANDIDATE_NAME = /^(?:lemtel-|mobile-|fusionpbx-|pbx-|get-turn-credentials$|ai-(?:transcribe|analyze)-call$)/;
const FOREIGN_MARKER = /planipret|(?:^|\W)pp_[a-z0-9_]+/i;
const entries = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
const count = (text, expression) => [...text.matchAll(expression)].length;

export function inventory(root = ROOT) {
  const functions = join(root, 'supabase/functions');
  const migrationDir = join(root, 'supabase/migrations');
  if (!existsSync(functions) || !existsSync(migrationDir)) throw new Error('INVENTORY_INPUTS_MISSING');

  const candidates = entries(functions).filter((item) => item.isDirectory() && CANDIDATE_NAME.test(item.name))
    .map((item) => {
      const file = join(functions, item.name, 'index.ts');
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      return {
        function: item.name,
        classification: 'manual_review',
        entrypoint_present: Boolean(text),
        direct_table_reference_count: count(text, /\.from\s*\(/g),
        direct_rpc_reference_count: count(text, /\.rpc\s*\(/g),
        direct_function_invoke_count: count(text, /\.invoke\s*\(/g),
        direct_environment_reference_count: count(text, /\b(?:Deno\.env\.get\s*\(|process\.env\s*\[)/g),
        relative_import_count: count(text, /\bfrom\s*['"`]\.{1,2}\//g),
        direct_foreign_marker_detected: FOREIGN_MARKER.test(text),
        indirect_dependencies_review_required: true,
      };
    }).sort((a, b) => a.function.localeCompare(b.function, 'en'));

  const migrations = entries(migrationDir).filter((item) => item.isFile() && item.name.endsWith('.sql'))
    .map((item) => {
      const text = readFileSync(join(migrationDir, item.name), 'utf8');
      const countDdl = count(text, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?(?:lemtel|pbx)_[a-zA-Z_0-9]+"?/gi);
      return countDdl ? {
        file: item.name,
        lemtel_or_pbx_table_declaration_count: countDdl,
        direct_foreign_marker_detected: FOREIGN_MARKER.test(text),
        ddl_dependencies_review_required: true,
      } : null;
    }).filter(Boolean).sort((a, b) => a.file.localeCompare(b.file, 'en'));

  return {
    status: 'discovery_only_manual_review_required',
    database_export_authorized: false,
    migration_replay_authorized: false,
    functions_deploy_authorized: false,
    candidates,
    ddl_candidates: migrations,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(inventory())}\n`); }
  catch { process.stderr.write('INVENTORY_INPUTS_MISSING\n'); process.exitCode = 1; }
}
