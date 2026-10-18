import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-operations-portal-static-refresh.sh'), 'utf8');
const transaction = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-portal-static-refresh-transaction.py'), 'utf8');
const zipHelper = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-verified-portal-zip.py'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-operations-portal-static-refresh-manifest.json'), 'utf8'));
const digest = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');

test('static Operations refresh is root-gated and accepts only a root-private release containing the signed proof material', () => {
  for (const expected of ['[ "$(id -u)" -eq 0 ]', 'refresh_verified_operations_portal_static', 'digitalocean_writer', 'REVIEWED_DO_WRITER_STATIC_PORTAL_REFRESH', 'release_sidecar=', 'secure_root_regular_file "$release_archive"', 'secure_root_regular_file "$release_sidecar"', 'release_digest_mismatch', 'lock_file="$work_root/refresh.lock"', 'portal-artifact.zip', 'portal-artifact.attestation.jsonl', 'trusted-root.jsonl', 'validate_release_metadata', 'validate_inner_manifest', 'verify_offline_attestation', 'github_native_attestation_offline_verification_failed', 'supabase-caddy', 'operations_portal_static_refresh_status=complete']) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /\/var\/lock\//u);
  assert.match(source, /exec 9>>"\$lock_file"/u);
  assert.doesNotMatch(source, /install -o root -g root -m 0600 \/dev\/null "\$lock_file"/u);
});

test('writer verifies the exact offline GitHub attestation policy and validates the existing Caddy route binding', () => {
  for (const expected of ['attestation verify', '--bundle', '--custom-trusted-root', '--signer-workflow AssistantVirtualAI/attach-app-creator-8134a2fa/.github/workflows/lemtel-operations-portal-build.yml', '--source-ref refs/heads/lemtel/integration', '--source-digest "$source_revision"', '--deny-self-hosted-runners', 'sourceRepositoryIdentifier', 'validate_existing_caddy_route', 'handle\\s+@lemtel_operations_portal', 'root\\s+\\*\\s+/etc/caddy/lemtel-portal', 'try_files\\s+\\{path\\}\\s+/lemtel-portal\\.html']) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('static Operations refresh uses a durable transaction journal to recover an interrupted exchange before touching live content', () => {
  for (const expected of ['active-transaction.json', '"$transaction_helper" recover "$transaction_journal" "$portal_dir"', '"$transaction_helper" prepare "$transaction_journal" "$portal_dir" "$portal_stage"', '"$transaction_helper" swap "$transaction_journal" "$portal_dir"', '"$transaction_helper" commit "$transaction_journal" "$portal_dir"', 'trap cleanup EXIT INT TERM', 'transaction_swap_failed', 'transaction_commit_failed']) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const expected of ['RENAME_EXCHANGE = 2', 'os.fsync(fd)', "if command == 'swap'", "if command == 'commit'", "if current == 'swapped'", 'transaction_recovery=complete']) assert.match(transaction, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('safe ZIP extraction refuses links, special paths and oversized expansions, then writes Caddy-readable modes', () => {
  for (const expected of ['MAX_FILES = 100', 'MAX_BYTES = 25 * 1024 * 1024', 'stat.S_IFLNK', 'os.O_NOFOLLOW', 'os.O_EXCL', 'os.chmod(output, 0o644)', 'os.chmod(parent, 0o755)']) assert.match(zipHelper, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const forbidden of [/\bpsql\b|pg_is_in_recovery|5432/iu, /edge-functions|lemtel-onboarding-admin|lemtel-traffic-ingest/iu, /caddy\s+(?:reload|validate|adapt)/iu, /docker\s+(?:exec|restart|start|stop|run)/iu, /\bsystemctl\b|lemtel-traffic-(?:collect|timer)/iu, /\b(?:curl|wget|ssh|scp|rsync|doctl|hcloud)\b/iu, /pg_promote|power_(?:on|off)|shutdown|reboot|fencing/iu]) assert.doesNotMatch(source, forbidden);
});

test('static Operations manifest pins each executable source and declares offline GitHub-native attestation requirements', () => {
  assert.equal(manifest.package_version, 'lemtel_operations_portal_static_refresh_v3');
  assert.equal(manifest.scope, 'offline_lemtel_operations_portal_static_refresh');
  assert.equal(manifest.deployment_authorized, false); assert.equal(manifest.activation_authorized, false);
  assert.equal(manifest.artifact_provenance.github_native_attestation_required, true);
  assert.equal(manifest.artifact_provenance.github_attestation_offline_bundle_required, true);
  assert.equal(manifest.artifact_provenance.github_trusted_root_required, true);
  assert.equal(manifest.artifact_provenance.github_repository_identifier_required, true);
  assert.equal(manifest.artifact_provenance.deny_self_hosted_runners, true);
  for (const entry of manifest.sources) assert.equal(entry.sha256, digest(entry.path), entry.path);
  for (const excluded of ['database_schema_or_business_data', 'edge_functions', 'caddyfile_or_route_configuration', 'traffic_collector_or_timer', 'cloudflare_dns_or_provider_action', 'hostinger_contact_or_runtime', 'promotion_fencing_or_automatic_failover', 'telephony_or_fusionpbx']) assert.ok(manifest.explicitly_excluded.includes(excluded), excluded);
});
