import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const path = (name) => resolve(root, name);
const read = (name) => readFileSync(path(name), 'utf8');
const json = (name) => JSON.parse(read(name));
const digest = (name) => createHash('sha256').update(read(name)).digest('hex');

const migration = read('infra/lemtel-self-hosted/migrations/0017_lemtel_traffic_samples.sql');
const ingest = read('infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/index.ts');
const ingestManifest = json('infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/manifest.json');
const admin = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
const adminManifest = json('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json');
const trafficAdmin = admin.slice(admin.indexOf('type NodeRole'), admin.indexOf('export async function handler'));
const collector = read('infra/lemtel-resilience/traffic-observability/lemtel-traffic-collect.sh');
const timer = read('infra/lemtel-resilience/traffic-observability/lemtel-traffic-timer-enable.sh');
const readme = read('infra/lemtel-resilience/traffic-observability/README.md');
const schemaManifest = json('infra/lemtel-self-hosted/migrations/lemtel-traffic-manifest.json');
const deploymentManifest = json('infra/lemtel-resilience/traffic-observability/deployment-manifest.json');

function entries(manifest) {
  return Object.values(manifest)
    .filter((value) => Array.isArray(value))
    .flat()
    .filter((value) => value && typeof value === 'object' && typeof value.path === 'string' && typeof value.sha256 === 'string');
}

test('traffic data contract is bounded, aggregate-only and has no prohibited product, identity or source-network fields', () => {
  assert.match(migration, /node_role text NOT NULL CHECK \(node_role IN \('do_writer', 'hostinger_standby'\)\)/);
  assert.match(migration, /period_seconds integer NOT NULL CHECK \(period_seconds BETWEEN 30 AND 300\)/);
  assert.match(migration, /rx_bytes bigint NOT NULL CHECK \(rx_bytes BETWEEN 0 AND 1000000000000\)/);
  assert.match(migration, /tx_bytes bigint NOT NULL CHECK \(tx_bytes BETWEEN 0 AND 1000000000000\)/);
  assert.match(migration, /tcp_established integer NOT NULL CHECK \(tcp_established BETWEEN 0 AND 1000000\)/);
  assert.match(migration, /PRIMARY KEY \(node_role, observed_at\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.lemtel_traffic_samples FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.lemtel_traffic_samples TO service_role/);
  assert.match(ingest, /const MAX_BODY_BYTES = 512/);
  assert.match(ingest, /integer\(raw\.periodSeconds, 30, 300\)/);
  assert.match(ingest, /integer\(raw\.rxBytes, 0, 1_000_000_000_000\)/);
  assert.match(ingest, /integer\(raw\.tcpEstablished, 0, 1_000_000\)/);
  assert.equal(ingestManifest.bounds.max_body_bytes, 512);
  assert.deepEqual(ingestManifest.bounds.period_seconds, [30, 300]);
  assert.deepEqual(ingestManifest.bounds.byte_delta, [0, 1_000_000_000_000]);
  const dataPath = [migration, ingest, trafficAdmin].join('\n');
  assert.doesNotMatch(dataPath, /planipret|fusionpbx|\bpbx_|\bsip(?:_|\b)|ip_address|source_(?:url|ip)|client_ip|device_id|user_id|remote_addr/iu);
  assert.doesNotMatch(dataPath, /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|pg_promote|nsupdate|docker\s+(?:run|compose\s+up)|rm\s+-rf)\b/iu);
});

test('ingress is a route-local strict HMAC endpoint without CORS or browser access', () => {
  assert.equal(ingestManifest.deployment_authorized, false);
  assert.equal(ingestManifest.collector_activation_authorized, false);
  assert.equal(ingestManifest.verify_jwt, false);
  assert.match(ingest, /crypto\.subtle\.verify\("HMAC"/);
  assert.match(ingest, /X-Lemtel-Traffic-Signature/);
  assert.match(ingest, /if \(req\.headers\.has\("Origin"\)\) return empty\(403\)/);
  assert.doesNotMatch(ingest, /["']Access-Control-Allow-Origin["']\s*:/u);
  assert.doesNotMatch(ingest, /console\.log/u);
  assert.ok(ingestManifest.prerequisites.includes('route_specific_jwt_bypass_not_global'));
  assert.ok(ingestManifest.prerequisites.includes('gateway_access_logs_disabled_for_ingress'));
});

test('collector refuses non-root and unsafe configuration without shell evaluation or endpoint IP parsing', () => {
  assert.match(collector, /\[\[ "\$EUID" -ne 0 \]\]/);
  assert.match(collector, /metadata\.st_uid != 0/);
  assert.match(collector, /stat\.S_IMODE\(metadata\.st_mode\) != 0o600/);
  assert.match(collector, /os\.O_NOFOLLOW/);
  assert.match(collector, /allowed = \{'LEMTEL_TRAFFIC_ENDPOINT', 'LEMTEL_TRAFFIC_COLLECTOR_SECRET', 'LEMTEL_TRAFFIC_NODE_ROLE'\}/);
  assert.match(collector, /endpoint\.scheme != 'https'/);
  assert.match(collector, /endpoint\.path != '\/functions\/v1\/lemtel-traffic-ingest'/);
  assert.ok(collector.includes("if re.fullmatch(r'[0-9.]+', endpoint.hostname):"));
  assert.doesNotMatch(collector, /(?:^\s*source\s+|^\s*eval\s+|^\s*\.\s+)/mu);
  assert.doesNotMatch(collector, /\bipaddress\b|ip_address\(/u);
  assert.match(collector, /line\.split\(\)\[3\] == '01'/);
  assert.doesNotMatch(collector, /line\.split\(\)\[1\]|remote_address|local_address|source_ip|destination_ip/u);
});

test('collector signs and passes its exact payload to curl only through stdin, without verbose retries or proxy use', () => {
  assert.match(collector, /hmac\.new\(values\['LEMTEL_TRAFFIC_COLLECTOR_SECRET'\]\.encode\(\), payload\.encode\(\), hashlib\.sha256\)/);
  assert.match(collector, /\['curl', '--config', '-', '--silent', '--request', 'POST'/);
  assert.match(collector, /input=curl_config, text=True/);
  assert.match(collector, /'--noproxy', '\*'/);
  assert.match(collector, /'--proto', '=https'/);
  assert.doesNotMatch(collector, /--verbose|(?<![\w-])-v\b|--retry|--proxy|\bHTTPS?_PROXY\b/iu);
  assert.doesNotMatch(collector, /curl\s+https?:\/\//iu);
});

test('timer installation remains root-gated, explicit and non-automatic at a 60-second cadence with bounded jitter', () => {
  assert.match(timer, /\[\[ "\$EUID" -ne 0 \]\]/);
  assert.match(timer, /enable-lemtel-traffic-collector/);
  assert.match(timer, /LEMTEL_TRAFFIC_ACTIVATION_APPROVED:-\}.*transactional-package-ready/);
  assert.match(timer, /OnBootSec=60s/);
  assert.match(timer, /OnUnitActiveSec=60s/);
  assert.match(timer, /RandomizedDelaySec=10s/);
  assert.match(timer, /Persistent=false/);
  assert.doesNotMatch(collector, /timer-enable|systemctl\s+enable|systemctl\s+start/u);
  assert.match(readme, /ne peut être appelé que dans la phase séparée/i);
});

test('separate manifests have false deployment and activation flags, route-specific prerequisites, and current SHA-256 digests', () => {
  for (const manifest of [schemaManifest, deploymentManifest]) {
    assert.equal(manifest.deployment_authorized, false);
    assert.equal(manifest.activation_authorized, false);
    assert.ok(manifest.required_preconditions.includes('direct_caddy_edge_route_hmac_only_for_lemtel_traffic_ingest'));
    assert.ok(manifest.required_preconditions.includes('caddy_access_logs_disabled_for_lemtel_traffic_ingest'));
    assert.ok(manifest.required_preconditions.includes('gateway_absence_or_noninterference_attested'));
    for (const entry of entries(manifest)) {
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      assert.equal(entry.sha256, digest(entry.path), `stale digest for ${entry.path}`);
    }
  }
  assert.equal(deploymentManifest.external_router_configuration.managed_in_repository, true);
  assert.equal(deploymentManifest.external_router_configuration.topology, 'direct_caddy_to_edge_no_gateway');
  assert.equal(deploymentManifest.external_router_configuration.gateway_jwt_bypass, 'not_applicable_no_gateway');
  assert.equal(deploymentManifest.external_router_configuration.route, 'lemtel-traffic-ingest');
  assert.match(readme, /direct Caddy → Edge/i);
  assert.match(readme, /log_skip/);
  assert.doesNotMatch(read('supabase/config.toml'), /\[functions\.lemtel-traffic-ingest\]/u);
  assert.ok(adminManifest.capabilities.includes('authenticated_platform_traffic_trend_read'));
});
