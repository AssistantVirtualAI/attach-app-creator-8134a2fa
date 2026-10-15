import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const script=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-runtime-envelope-create.sh'),'utf8');
test('DO runtime envelope is encrypted, bounded and excludes replicated data',()=>{
  for (const expected of ['create_hostinger_runtime_envelope','digitalocean_writer','LEMTEL_HA_HOSTINGER_AGE_RECIPIENT','age -r "$age_recipient"','volumes/functions','volumes/proxy/caddy','database_data_included=false','storage_data_included=false','runtime_started=false']) assert.match(script,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(script,/^envelope_file=.*hostinger-runtime\.age/m);
  assert.match(script,/^manifest_file=.*hostinger-runtime\.manifest/m);
  assert.doesNotMatch(script,/docker\s+(?:compose\s+up|run|start)|pg_ctl promote|cloudflare\.request|nsupdate|fusionpbx|\bsip\b|\bwss\b|\bturn\b/i);
});
