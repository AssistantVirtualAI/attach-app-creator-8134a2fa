import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/traffic-observability/lemtel-ha-do-writer-traffic-observability-deploy.sh'), 'utf8');
test('traffic observability deployment is DO-writer-only, transactional and does not activate collectors or route bypass', () => {
  for (const token of ['deploy_verified_traffic_observability','digitalocean_writer','FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED','REVIEWED_DO_WRITER_TRAFFIC_DEPLOY','DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED','EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED','0017_lemtel_traffic_samples.sql','lemtel-traffic-ingest.index.ts','lemtel-traffic-ingest.manifest.json','portal.tar','traffic_collectors_enabled=false','edge_route_specific_jwt_bypass_configured=false','automatic_traffic_failover_enabled=false','fencing_executed=false']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /systemctl\s+(?:enable|start)|LEMTEL_TRAFFIC_COLLECTOR_SECRET|verify_jwt\s*=\s*false|pg_promote|docker\s+compose\s+up|nsupdate|planipret|fusionpbx|\bsip\b/iu);
  assert.match(source, /trap rollback ERR INT TERM/);
  assert.match(source, /docker exec -i "\$db"/);
});
