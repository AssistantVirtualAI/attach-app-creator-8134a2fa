import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const script=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-direct-envelope-receipt.sh'),'utf8');
test('Hostinger direct envelope receipt is verified, idempotent and dormant',()=>{
  for (const expected of ['record_hostinger_direct_runtime_envelope_receipt','hostinger_standby','/tmp/lemtel-hostinger-runtime.age','runtime_stage_existing_verified=true','artifact_receipt_conflict','artifact_receipt_digest_mismatch','runtime_started=false','automatic_traffic_failover_enabled=false']) assert.match(script,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(script,/docker compose --env-file/);
  assert.match(script,/receipt_state='already_registered'/);
  assert.match(script,/receipt_state='registered'/);
  assert.doesNotMatch(script,/age\s+-d|docker\s+(?:compose\s+up|run|start)|pg_ctl promote|cloudflare|dns|fusionpbx|\bsip\b|\bwss\b|\bturn\b/i);
});
