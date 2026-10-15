import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const script=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-runtime-parity-preflight.sh'),'utf8');
test('Hostinger parity preflight stays private, read-only and dormant',()=>{
  for (const expected of ['hostinger_standby','artifact_digest_mismatch','runtime_compose_invalid','standby_runtime_running','standby_not_in_recovery','wal_receiver_not_streaming','runtime_started=false','automatic_traffic_failover_enabled=false']) assert.match(script,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(script,/resolve_standby_postgres/);
  assert.match(script,/standby_postgres_unresolved/);
  assert.doesNotMatch(script,/postgres_container='lemtel-postgres-standby'/);
  assert.doesNotMatch(script,/docker\s+(?:compose\s+up|run|start)|pg_ctl promote|power_off|shutdown|cloudflare|dns|fusionpbx|\bsip\b|\bwss\b|\bturn\b/i);
});
