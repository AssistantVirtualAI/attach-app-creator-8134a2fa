import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/traffic-observability/lemtel-ha-do-writer-traffic-ingress-route-apply.sh'), 'utf8');

test('traffic ingress Caddy route is exact, HMAC-only, no-log and refuses unrelated topology changes', () => {
  for (const token of [
    'apply_verified_traffic_ingress_route',
    'digitalocean_writer',
    'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED',
    'REVIEWED_DO_WRITER_TRAFFIC_ROUTE',
    'DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED',
    'EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED',
    '# LEMTEL_TRAFFIC_INGRESS_V1',
    '@lemtel_traffic_ingest path /functions/v1/lemtel-traffic-ingest',
    'log_skip',
    'functions_proxy_upstream_unresolved',
    'caddy adapt',
    'caddy validate',
    'caddy reload',
    'traffic_collectors_enabled=false',
    'automatic_traffic_failover_enabled=false',
    'fencing_executed=false',
  ]) assert.ok(source.includes(token), `missing ${token}`);
  assert.doesNotMatch(source, /verify_jwt\s*=\s*false|systemctl\s+(?:enable|start)|LEMTEL_TRAFFIC_COLLECTOR_SECRET|pg_promote|docker\s+compose\s+up|nsupdate|planipret|fusionpbx|\bsip\b/iu);
  assert.match(source, /route_marker_ambiguous/);
  assert.match(source, /trap rollback ERR INT TERM/);
  assert.doesNotMatch(source, /printf[^\n]*(?:functions_upstream|caddy_mount|caddyfile)/u);
});
