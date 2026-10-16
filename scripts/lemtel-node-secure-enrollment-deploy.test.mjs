import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const deployerPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-node-secure-enrollment-deploy.sh');
const docsPath = resolve(root, 'docs/lemtel-ha/NODE_SECURE_ENROLLMENT_DEPLOYMENT.md');
const deployer = readFileSync(deployerPath, 'utf8');
const docs = readFileSync(docsPath, 'utf8');

test('node-enrollment deployer is syntactically valid and has all root/DO-writer gates', () => {
  const check = spawnSync('bash', ['-n', deployerPath], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  for (const required of [
    '[ "$(id -u)" -eq 0 ] || fail root_required',
    'LEMTEL_HA_ROLE:-}" = digitalocean_writer',
    'LEMTEL_NODE_ENROLLMENT_DEPLOY_EXECUTE',
    'deploy_verified_node_enrollment',
    'LEMTEL_NODE_ENROLLMENT_SNAPSHOT_ATTESTATION',
    'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED',
    'SELECT pg_is_in_recovery()::text',
    "edge_container='supabase-edge-functions'",
    'archive_digest_mismatch',
    'verify_stage_manifest',
    'verify_source_manifest',
  ]) assert.ok(deployer.includes(required), `missing ${required}`);
});

test('deployer verifies 0020 as a complete prerequisite but never applies it, and applies 0021 only from absent', () => {
  for (const required of [
    'node_status_schema_state()',
    'node_status_0020_not_fully_installed',
    "WHEN count(*) FILTER (WHERE present) = 6 THEN '\\''complete'\\''",
    'enrollment_schema_state()',
    "WHEN count(*) FILTER (WHERE present) = 18 THEN '\\''complete'\\''",
    'absent)',
    '< "$stage/0021_lemtel_node_secure_enrollment.sql"',
    'complete) migration_result=already_present',
    'partial) fail enrollment_schema_state_ambiguous',
    'enrollment_schema_state_unreadable',
  ]) assert.ok(deployer.includes(required), `missing ${required}`);
  assert.doesNotMatch(deployer, /< "\$stage\/0020_lemtel_node_status_observations\.sql"/u);
  assert.doesNotMatch(deployer, /docker exec -i[^\n]*0020_lemtel_node_status_observations/u);
});

test('deployer admits only manifest.sha256 plus exact enrollment sources and replaces only their Edge targets', () => {
  for (const required of [
    "'0021_lemtel_node_secure_enrollment.sql'",
    "'lemtelNodeEnrollment.ts'",
    "'lemtelNodeEnrollmentBackend.ts'",
    "'lemtel-node-enrollment.index.ts'",
    "'lemtel-node-enrollment-admin.index.ts'",
    "'lemtel-node-status-signed-ingest.index.ts'",
    "'lemtel-onboarding-admin.manifest.json'",
    "'manifest.sha256'",
    "'_shared/lemtelNodeEnrollment.ts'",
    "'lemtel-node-enrollment/index.ts'",
    "'lemtel-node-enrollment-admin/index.ts'",
    "'lemtel-node-status-signed-ingest/index.ts'",
    "'lemtel-onboarding-admin/index.ts'",
  ]) assert.ok(deployer.includes(required), `missing ${required}`);
  assert.match(deployer, /archive_entries=\([\s\S]*'manifest\.sha256'[\s\S]*\)/u);
  assert.match(deployer, /\$\{#entries\[@\]\}.*\$\{#archive_entries\[@\]\}/u);
  assert.match(deployer, /for index in "\$\{!archive_entries\[@\]\}"/u);
  assert.doesNotMatch(deployer, /FROM\s+public\.lemtel_node_status_(?:current|history)\b/iu, 'must not read node observation rows');
  assert.doesNotMatch(deployer, /SELECT\s+\*/iu, 'must not read arbitrary database content');
  assert.doesNotMatch(deployer, /(?:Caddyfile|docker-compose\.yml|node-status-publisher\.env|lemtel-node-publication-agent\.ts)/iu, 'assets outside source allowlist are forbidden');
});

test('deployer excludes secrets, configuration/publisher activation, routes, remote calls and unrelated provider actions', () => {
  assert.doesNotMatch(deployer, /LEMTEL_[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY)\b/iu);
  assert.doesNotMatch(deployer, /\b(?:systemctl|curl|wget|ssh|scp|rsync|doctl|hcloud|nsupdate|pg_promote)\b/iu);
  assert.doesNotMatch(deployer, /docker\s+(?:start|compose|run)\b/iu);
  for (const required of ['secret_configuration_written=false', 'publisher_configuration_written=false', 'publisher_timer_enabled=false', 'agent_installed=false', 'service_activated=false', 'timer_activated=false', 'routes_changed=false', 'business_data_read=false', 'credential_values_emitted=false']) assert.ok(deployer.includes(required), `missing exclusion outcome ${required}`);
});

test('rollback restores only replaced sources and does not claim additive schema rollback', () => {
  for (const required of [
    'trap rollback EXIT',
    'if [ "${replaced[$index]:-false}" = true ]; then',
    'if [ "${preexisting[$index]:-false}" = true ]; then cp -- "${backup_paths[$index]}" "$target" || true',
    'else rm -f -- "$target" || true',
    'docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true',
    'node_secure_enrollment_sources_rollback=attempted',
    'node_secure_enrollment_migration_rollback=not_attempted_additive_migration_remains',
  ]) assert.ok(deployer.includes(required), `missing rollback guard ${required}`);
  assert.match(docs, /migration `0021` est \*\*additive\*\* et n’est pas annulée/);
  assert.match(docs, /redémarre uniquement le runtime Edge \*\*déjà actif\*\*/);
});

test('fake local docker fixture proves non-root refusal occurs before any runtime access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-node-enrollment-fake-'));
  try {
    const id = join(directory, 'id');
    const docker = join(directory, 'docker');
    const marker = join(directory, 'docker-was-called');
    writeFileSync(id, '#!/usr/bin/env sh\nprintf "1000\\n"\n');
    writeFileSync(docker, `#!/usr/bin/env sh\nprintf called > ${JSON.stringify(marker)}\nexit 88\n`);
    chmodSync(id, 0o755);
    chmodSync(docker, 0o755);
    const result = spawnSync('bash', [deployerPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        LEMTEL_HA_ROLE: 'digitalocean_writer',
        LEMTEL_NODE_ENROLLMENT_DEPLOY_EXECUTE: 'deploy_verified_node_enrollment',
        LEMTEL_NODE_ENROLLMENT_SNAPSHOT_ATTESTATION: 'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reason=root_required/u);
    assert.equal(existsSync(marker), false, 'fake docker must not be reached before root gate');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('operator documentation records source provenance, manifest exception, gates and exclusions', () => {
  for (const required of [
    'cb9c175568530ccaee8be9ea6cf44c3cc355feaa',
    'manifest.sha256',
    'ne se signe pas lui-même',
    'LEMTEL_NODE_ENROLLMENT_DEPLOY_EXECUTE=deploy_verified_node_enrollment',
    'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED',
    'pg_is_in_recovery()',
    'jamais appliqué',
    'Cloudflare, DigitalOcean API, Hostinger, DNS ou téléphonie',
    'aucun appel HTTP',
  ]) assert.ok(docs.includes(required), `docs missing ${required}`);
});
