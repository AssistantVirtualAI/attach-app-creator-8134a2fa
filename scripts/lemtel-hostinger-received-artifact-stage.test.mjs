import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const script=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-received-artifact-stage.sh'),'utf8');
test('Hostinger received artifact staging is encrypted, private and dormant',()=>{
  for (const expected of ['stage_hostinger_received_runtime_envelope','hostinger_standby','artifact_digest_mismatch','runtime_envelope_decryption_failed','envelope_content_unapproved','runtime_compose_invalid','runtime_started=false','automatic_traffic_failover_enabled=false']) assert.match(script,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(script,/age -d -i "\$age_identity"/);
  assert.match(script,/resolve_standby_postgres/);
  assert.match(script,/standby_postgres_unresolved/);
  assert.doesNotMatch(script,/postgres_container='lemtel-postgres-standby'/);
  assert.match(script,/docker compose --env-file/);
  assert.match(script,/work_tar=\"\$\(mktemp/);
  assert.match(script,/rm -f -- \"\$work_tar\"/);
  assert.match(script,/docker ps --filter label=com\.docker\.compose\.project=lemtel-ha-standby/);
  assert.doesNotMatch(script,/docker\s+(?:compose\s+up|run|start)|pg_ctl promote|cloudflare|dns|fusionpbx|\bsip\b|\bwss\b|\bturn\b/i);
});
