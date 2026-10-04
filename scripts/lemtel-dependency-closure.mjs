// Phase 31C — discovery only. This is NOT a deploy allowlist or a proof of
// isolation: computed calls, comments, SQL dependencies and runtime behavior
// still require manual review. This module has no network or write capability.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './inventory-lemtel-hosting.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FOREIGN = /planipret|(?:^|\W)pp_[a-z0-9_]+/i;
const IDENTIFIER = /^[a-z][a-z0-9-]{2,79}$/;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const CALLS = [
  /\.functions\.invoke\s*\(\s*['"`]([a-z][a-z0-9-]{2,79})['"`]\s*(?=[,)])/g,
  /\/functions\/v1\/([a-z][a-z0-9-]{2,79})(?=[/?#'"`\s]|$)/g,
];
const INVOCATIONS = /\.functions\.invoke\s*\(/g;
const INTERPOLATED_PATHS = /\/functions\/v1\/[a-z0-9_-]*\$\{/g;
// Bounded scan permits valid multiline import/export declarations while
// excluding quoted literals and semicolon-separated statements.
const IMPORTS = /\b(?:import|export)\s+(?:[^;'"`]{0,300}?\s+from\s+)?['"](\.{1,2}\/[^'"\n]+)['"]/g;
const isFile = (file) => { try { return lstatSync(file).isFile(); } catch { return false; } };
const isInside = (path, dir) => path.startsWith(`${dir}${sep}`);
const count = (text, regex) => [...text.matchAll(regex)].length;

function sources(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (item.name === 'node_modules' || item.name === '__tests__' || item.name === 'dist') continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) found.push(...sources(path));
    else if (item.isFile() && SOURCE_EXTENSIONS.has(extname(path)) && !/\.(?:test|spec)\.[jt]sx?$/.test(path)) found.push(path);
  }
  return found;
}

function importsOf(text) {
  return [...text.matchAll(IMPORTS)].map((match) => match[1]);
}

function resolveImport(file, specifier, base) {
  const path = resolve(dirname(file), specifier);
  if (!isInside(path, base)) return null;
  const candidates = [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.mjs`, join(path, 'index.ts')];
  return candidates.find((item) => isInside(item, base) && SOURCE_EXTENSIONS.has(extname(item)) && isFile(item)) || null;
}

function inspectFunction(base, name) {
  const entry = join(base, name, 'index.ts');
  const pending = [entry];
  const seen = new Set();
  let unresolved = 0;
  let directForeign = false;
  let indirectForeign = false;
  let tableReferences = 0;
  let rpcReferences = 0;
  let storageReferences = 0;
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!isFile(file) || !isInside(file, base)) { unresolved++; continue; }
    const text = readFileSync(file, 'utf8');
    const foreign = FOREIGN.test(text);
    if (file === entry) directForeign = foreign;
    else indirectForeign ||= foreign;
    tableReferences += count(text, /\.from\s*\(/g);
    rpcReferences += count(text, /\.rpc\s*\(/g);
    storageReferences += count(text, /\.storage\.from\s*\(/g);
    for (const specifier of importsOf(text)) {
      const dependency = resolveImport(file, specifier, base);
      if (dependency) { if (!seen.has(dependency)) pending.push(dependency); }
      else unresolved++;
    }
  }
  return {
    function: name,
    classification: 'manual_review',
    transitive_source_file_count: seen.size,
    unresolved_relative_import_count: unresolved,
    direct_foreign_marker_detected: directForeign,
    indirect_foreign_marker_detected: indirectForeign,
    transitive_table_reference_count: tableReferences,
    transitive_rpc_reference_count: rpcReferences,
    transitive_storage_reference_count: storageReferences,
    dynamic_calls_and_sql_dependencies_review_required: true,
  };
}

export function audit(root = ROOT) {
  const base = resolve(root, 'supabase/functions');
  const candidates = inventory(root).candidates.filter((entry) => entry.entrypoint_present);
  const references = new Map();
  const clientCallsiteFindings = [];
  for (const app of ['ava-softphone-mobile', 'ava-softphone-desktop']) {
    let invocationCount = 0;
    let unattributedInvocationCount = 0;
    let interpolatedPathCount = 0;
    const reviewFiles = [];
    for (const file of sources(join(root, 'apps', app, 'src'))) {
      const text = readFileSync(file, 'utf8');
      const literals = count(text, CALLS[0]);
      const invocations = count(text, INVOCATIONS);
      const interpolated = count(text, INTERPOLATED_PATHS);
      invocationCount += invocations;
      unattributedInvocationCount += invocations - literals;
      interpolatedPathCount += interpolated;
      if (invocations > literals || interpolated > 0) {
        reviewFiles.push(relative(root, file).split(sep).join('/'));
      }
      for (const regex of CALLS) {
        for (const match of text.matchAll(regex)) {
          const name = match[1];
          if (IDENTIFIER.test(name)) {
            const ref = references.get(name) || new Set();
            ref.add(app);
            references.set(name, ref);
          }
        }
      }
    }
    clientCallsiteFindings.push({ client: app, invocation_callsite_count: invocationCount,
      unattributed_invocation_count: unattributedInvocationCount,
      interpolated_api_path_count: interpolatedPathCount,
      review_source_paths: reviewFiles.sort(),
      heuristic_manual_review_required: true });
  }
  const clientDependencies = [...references].map(([name, apps]) => ({
    function: name,
    clients: [...apps].sort(),
    entrypoint_present: isFile(join(base, name, 'index.ts')),
    cross_product_marker: /^(?:pp-|planipret-)/.test(name),
    classification: 'manual_review',
  })).sort((a, b) => a.function.localeCompare(b.function, 'en'));
  const names = new Set(candidates.map((item) => item.function));
  for (const entry of clientDependencies) if (entry.entrypoint_present) names.add(entry.function);
  return {
    status: 'incomplete_manual_review_required',
    source_analysis_only: true,
    database_export_authorized: false,
    migration_replay_authorized: false,
    functions_deploy_authorized: false,
    findings_are_not_allowlist: true,
    client_dependencies: clientDependencies,
    client_callsite_findings: clientCallsiteFindings,
    function_import_closures: [...names].sort().map((name) => inspectFunction(base, name)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(audit())}\n`); }
  catch { process.stderr.write('DEPENDENCY_AUDIT_INPUTS_MISSING\n'); process.exitCode = 1; }
}
