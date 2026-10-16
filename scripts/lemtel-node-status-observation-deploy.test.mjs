import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const deployerPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-node-status-observation-deploy.sh');
const docsPath = resolve(root, 'docs/lemtel-ha/NODE_STATUS_OBSERVATION_DEPLOYMENT.md');
const deployer = readFileSync(deployerPath, 'utf8');
const docs = readFileSync(docsPath, 'utf8');

test('node-status deployer is syntactically valid and gated to root on the active DO writer', () => {
  execFileSync('bash', ['-n', deployerPath]);
  for (const required of [
    '[ "$(id -u)" -eq 0 ] || fail root_required',
    'LEMTEL_NODE_STATUS_OBSERVATION_EXECUTE',
    'deploy_verified_node_status_observation',
    'LEMTEL_HA_ROLE:-}" = digitalocean_writer',
    'LEMTEL_NODE_STATUS_SNAPSHOT_ATTESTATION',
    'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED',
    'SELECT pg_is_in_recovery()::text',
    "edge_container='supabase-edge-functions'",
    'archive_digest_mismatch',
    'verify_stage_manifest',
    'schema_state_ambiguous',
  ]) assert.ok(deployer.includes(required), `missing ${required}`);
  assert.match(deployer, /WHEN count\(\*\) FILTER \(WHERE present\) = 0 THEN/);
  assert.match(deployer, /WHEN count\(\*\) FILTER \(WHERE present\) = 6 THEN/);
  assert.match(deployer, /migration_result=already_present/);
  assert.match(deployer, /docker restart --time 30 "\$edge_container"/);
});

test('deployer allows only the explicit migration and two static Edge source replacements', () => {
 for (const required of [
   '0020_lemtel_node_status_observations.sql',
   'lemtel-node-status-ingest.index.ts',
   'lemtel-node-status-ingest.manifest.json',
   'lemtel-node-status-manifest.json',
   'lemtel-onboarding-admin.index.ts',
   'lemtel-onboarding-admin.manifest.json',
   "admin_target=\"$functions_source/lemtel-onboarding-admin/index.ts\"",
   "ingest_target=\"$ingest_dir/index.ts\"",
   "grep -Fq 'action === \"get_node_status\"'",
   "grep -Fq 'lemtel_record_node_status'",
 ]) assert.ok(deployer.includes(required), `missing ${required}`);
 assert.match(deployer, /archive_entries=\([\s\S]*'manifest\.sha256'[\s\S]*\)/u);
 assert.match(deployer, /\$\{#entries\[@\]\}.*\$\{#archive_entries\[@\]\}/u);
 assert.match(deployer, /for index in "\$\{!archive_entries\[@\]\}"/u);
 assert.doesNotMatch(deployer, /FROM\s+public\.lemtel_node_status_(?:current|history)\b/iu, 'must not read observation rows');
  assert.doesNotMatch(deployer, /SELECT\s+\*/iu, 'must not read arbitrary database content');
  assert.doesNotMatch(deployer, /LEMTEL_NODE_STATUS_[A-Z_]*SECRET/iu, 'must not read a node-status secret');
  assert.doesNotMatch(deployer, /node-status-publisher\.env|lemtel-node-status-publish\.sh|publisher\.service|publisher\.timer/iu, 'publisher assets are out of scope');
});

test('deployer excludes forbidden activation, network, routing, standby, provider and telephony actions', () => {
  assert.doesNotMatch(deployer, /\b(?:systemctl|curl|wget|ssh|scp|rsync|doctl|hcloud|nsupdate|pg_promote)\b/iu);
  assert.doesNotMatch(deployer, /docker\s+(?:start|compose)\b/iu);
  assert.match(deployer, /publisher_configuration_written=false/);
  assert.match(deployer, /business_data_read=false/);
  assert.match(deployer, /credential_values_emitted=false/);
});

test('rollback restores replaced Edge sources and never claims an additive schema rollback', () => {
  for (const required of [
    'trap rollback EXIT',
    'if [ "$admin_replaced" = true ]; then cp -- "$admin_backup" "$admin_target" || true; fi',
    'if [ "$ingest_preexisting" = true ]; then cp -- "$backup_dir/lemtel-node-status-ingest.index.ts" "$ingest_target" || true',
    'else rm -f -- "$ingest_target" || true; fi',
    'docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true',
    'node_status_observation_sources_rollback=attempted',
    'node_status_observation_migration_rollback=not_attempted_additive_migration_remains',
  ]) assert.ok(deployer.includes(required), `missing rollback guard ${required}`);
  assert.match(docs, /migration `0020` est \*\*additive\*\* et n’est pas annulée/);
  assert.match(docs, /publications restent non configurées/);
});

test('operator documentation records the archive provenance, gates and non-sensitive smoke checks', () => {
  for (const required of [
    'lemtel-node-status-observation.tar.sha256',
    'manifest.sha256',
    'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED',
    'pg_is_in_recovery()',
    'redémarre uniquement le runtime Edge déjà actif',
    'ne lisent aucune observation, table métier, payload',
    'Caddy', 'Hostinger/Cloudflare/DNS', 'téléphonie',
  ]) assert.ok(docs.includes(required), `docs missing ${required}`);
});
