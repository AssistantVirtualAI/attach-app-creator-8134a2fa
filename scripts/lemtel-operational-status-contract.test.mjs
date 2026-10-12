import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const publisher = read('infra/lemtel-resilience/active-passive/lemtel-ha-promoted-writer-status-publish.sh');
const timer = read('infra/lemtel-resilience/active-passive/lemtel-ha-promoted-writer-status-timer-enable.sh');
const migration = read('infra/lemtel-self-hosted/migrations/0006_lemtel_operational_status.sql');
const edge = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
const onboardingManifest = json('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json');
const deploymentManifest = json('infra/lemtel-resilience/active-passive/operational-status-deployment-manifest.json');

const prohibited = /(?:pg_promote|nsupdate|docker\s+(?:run|compose\s+up)|\bturn\b|\bwss\b|password|credential|connection_string)/imu;

test('operational status contract is redacted, platform-admin-only and does not authorize a topology change', () => {
  const contract = json('infra/lemtel-resilience/active-passive/operational-status-contract.json');
  assert.equal(contract.deployment.schema_apply_authorized, false);
  assert.equal(contract.deployment.writer_publisher_enable_authorized, false);
  assert.equal(contract.deployment.hostinger_rebuild_or_start_authorized, false);
  assert.equal(contract.deployment.automatic_failover_enabled, false);
  assert.equal(contract.access.viewer, 'authenticated_lemtel_platform_administrator_only');
  assert.match(contract.forbidden.join(' '), /ip_address/);
  assert.match(contract.forbidden.join(' '), /automatic_promotion/);
});

test('operational status has its own immutable offline deployment package', () => {
  assert.equal(deploymentManifest.deployment_authorized, false);
  assert.equal(deploymentManifest.hostinger_rebuild_or_start_authorized, false);
  assert.equal(deploymentManifest.automatic_failover_enabled, false);
  assert.deepEqual(deploymentManifest.sources.map((entry) => entry.path), [
    'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts',
    'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json',
    'infra/lemtel-self-hosted/migrations/0006_lemtel_operational_status.sql',
    'infra/lemtel-resilience/active-passive/lemtel-ha-promoted-writer-status-publish.sh',
    'infra/lemtel-resilience/active-passive/lemtel-ha-promoted-writer-status-timer-enable.sh',
  ]);
  for (const source of deploymentManifest.sources) {
    const digest = createHash('sha256').update(read(source.path)).digest('hex');
    assert.equal(source.sha256, digest, `stale digest for ${source.path}`);
  }
  assert.match(deploymentManifest.forbidden_actions.join(' '), /hostinger_start_or_rebuild/);
  assert.match(deploymentManifest.forbidden_actions.join(' '), /automatic_promotion/);
});

test('operational status schema is Lemtel-only and denies browser table access', () => {
  assert.match(migration, /lemtel_operational_status/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.lemtel_operational_status FROM anon, authenticated/);
  assert.match(migration, /no credentials, IP addresses/i);
  assert.doesNotMatch(migration, /planipret|pbx_/i);
});

test('writer publisher emits only locally verified redacted health and never controls failover', () => {
  assert.match(publisher, /publish_redacted_promoted_writer_status/);
  assert.match(publisher, /digitalocean_promoted_writer/);
  assert.match(publisher, /resolve_database_container/);
  assert.match(publisher, /supabase\\\/postgres\(:\|\$\)/);
  assert.match(publisher, /database_container_unresolved/);
  assert.match(publisher, /hostinger_streaming_standby/);
  assert.match(publisher, /"route": "canonical_digitalocean_live"/);
  assert.match(publisher, /pg_stat_replication/);
  assert.match(publisher, /storage-sync-manifests\/last-success/);
  assert.match(publisher, /integrity_verified/);
  assert.match(publisher, /redacted_snapshot_written=true/);
  assert.match(publisher, /2>\/dev\/null/);
  assert.match(publisher, /automatic_promotion_enabled=false/);
  assert.match(publisher, /dns_failover_enabled=false/);
  assert.doesNotMatch(publisher, prohibited);
});

test('writer status timer is root-gated and carries no Hostinger start, promotion or DNS action', () => {
  assert.match(timer, /enable_redacted_promoted_writer_status_timer/);
  assert.match(timer, /LEMTEL_HA_ROLE:-\}" = 'digitalocean_promoted_writer'/);
  assert.match(timer, /OnUnitActiveSec=2min/);
  assert.match(timer, /systemctl enable --now lemtel-ha-promoted-writer-status\.timer/);
  assert.match(timer, /hostinger_rebuild_or_start=false/);
  assert.doesNotMatch(timer, prohibited);
});

test('operational status is served only by the authoritative Lemtel edge function', () => {
  assert.match(edge, /get_operational_status/);
  assert.match(edge, /lemtel_operational_status/);
  assert.match(edge, /platformAdmin\(admin, actor\)/);
  assert.doesNotMatch(edge, /console\.log|planipret|pbx_/i);
  assert.equal(onboardingManifest.deployment_authorized, false);
  assert.ok(onboardingManifest.capabilities.includes('authenticated_platform_operational_status_read'));
  assert.ok(onboardingManifest.explicitly_excluded.includes('direct_browser_host_access'));
  assert.ok(onboardingManifest.explicitly_excluded.includes('automatic_failover'));
  assert.ok(onboardingManifest.deployment_prerequisites.includes('approved_lemtel_operational_status_migration'));
});
