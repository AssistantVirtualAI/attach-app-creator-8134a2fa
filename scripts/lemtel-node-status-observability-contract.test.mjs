import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(repo, path), 'utf8');
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex');
const ingest = read('infra/lemtel-self-hosted/functions/lemtel-node-status-ingest/index.ts');
const migration = read('infra/lemtel-self-hosted/migrations/0020_lemtel_node_status_observations.sql');
const publisher = read('infra/lemtel-resilience/node-status-observability/lemtel-node-status-publish.sh');
const admin = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');

assert.match(ingest, /const MAX_BODY_BYTES = 384/);
assert.match(ingest, /LEMTEL_NODE_STATUS_DO_WRITER_SECRET/);
assert.match(ingest, /LEMTEL_NODE_STATUS_HOSTINGER_STANDBY_SECRET/);
assert.match(ingest, /X-Lemtel-Node-Status-Signature/);
assert.match(ingest, /req\.headers\.has\("Origin"\).*Sec-Fetch-Mode/s);
assert.match(ingest, /lemtel_record_node_status/);
assert.doesNotMatch(ingest, /console\.|Deno\.env\.toObject|fetch\(/);
for (const field of ['nodeRole', 'observedAt', 'agentState', 'runtimeState', 'replicationState', 'storageState']) assert.match(ingest, new RegExp(`"${field}"`));

assert.match(migration, /CREATE TABLE public\.lemtel_node_status_current/);
assert.match(migration, /CREATE TABLE public\.lemtel_node_status_history/);
assert.match(migration, /PRIMARY KEY \(node_role, observed_at\)/);
assert.match(migration, /interval '48 hours'/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
assert.match(migration, /REVOKE ALL ON TABLE public\.lemtel_node_status_current FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration, /GRANT SELECT ON TABLE public\.lemtel_node_status_current TO service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.lemtel_record_node_status/);
const schemaDefinition = migration.slice(0, migration.indexOf('COMMENT ON TABLE'));
assert.doesNotMatch(schemaDefinition, /jsonb|hostname|ip_address|container|metric|error_message/i);

assert.match(publisher, /os\.O_NOFOLLOW/);
assert.match(publisher, /stat\.S_IMODE\(metadata\.st_mode\) != 0o600/);
assert.match(publisher, /--check-config/);
assert.match(publisher, /--proto', '=https'/);
assert.match(publisher, /--noproxy', '\*'/);
for (const forbidden of ['systemctl', 'ssh', 'docker', 'pg_promote', 'cloudflare', 'failover', 'curl .*--retry']) assert.doesNotMatch(publisher, new RegExp(forbidden, 'i'));
execFileSync('bash', ['-n', resolve(repo, 'infra/lemtel-resilience/node-status-observability/lemtel-node-status-publish.sh')]);

assert.match(admin, /\{ action: "get_node_status" \}/);
assert.match(admin, /lemtel_node_status_current/);
assert.match(admin, /NODE_STATUS_READ_TIMEOUT_MS = 2_000/);
assert.match(admin, /if \(request\.action === "get_node_status"\)[\s\S]{0,250}platformAdmin/);
assert.doesNotMatch(admin.slice(admin.indexOf('export function redactedNodeStatus'), admin.indexOf('export async function nodeStatus')), /hostname|ip|error|metric|container/i);

for (const manifestPath of [
  'infra/lemtel-self-hosted/migrations/lemtel-node-status-manifest.json',
  'infra/lemtel-resilience/node-status-observability/deployment-manifest.json',
]) {
  const manifest = JSON.parse(read(manifestPath));
  assert.equal(manifest.deployment_authorized, false);
  assert.equal(manifest.activation_authorized, false);
  for (const entry of [...(manifest.sources ?? []), ...(manifest.migration_sources ?? []), ...(manifest.edge_sources ?? []), ...(manifest.validation_sources ?? [])]) {
    assert.equal(sha256(entry.path), entry.sha256, `${manifestPath}: ${entry.path}`);
  }
}
console.log('node_status_contract=ok');
