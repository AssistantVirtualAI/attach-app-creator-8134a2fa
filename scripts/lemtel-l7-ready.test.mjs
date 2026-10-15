import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const refresh=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-lb-ready-refresh.sh'),'utf8');
const timer=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-lb-ready-timer-enable.sh'),'utf8');
const deploy=readFileSync(resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-lb-ready-route-deploy.sh'),'utf8');
test('L7 readiness is writer-only and content-free',()=>{
  for (const expected of ['digitalocean_promoted_writer','database_not_writer','database_streaming_absent','storage_attestation_stale','lemtel-ha-do-writer-storage-sync.timer','printf \'ready\\n\'','automatic_traffic_failover_enabled=false']) assert.match(refresh,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(refresh,/FUSIONPBX|SIP_|WSS|TURN|POSTGRES_PASSWORD|SERVICE_ROLE|Bearer/i);
  assert.match(refresh,/resolve_runtime_container/);
  assert.match(refresh,/database_container_unresolved/);
  assert.match(refresh,/auth_container_unresolved/);
  assert.doesNotMatch(refresh,/db_container='supabase-db'/);
  assert.doesNotMatch(refresh,/auth_container='supabase-auth'/);
});
test('route is exact, transactional and does not activate Cloudflare routing',()=>{
  for (const expected of ["canonical_host='lemtel.assistantvirtualai.com'", 'index($0, canonical_host)', 'matches != 1','path /lemtel-lb-ready','root * /etc/caddy','rewrite * /lemtel-lb-ready','caddy reload','cloudflare_routing_changed=false','automatic_traffic_failover_enabled=false']) assert.match(deploy,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(deploy,/cloudflare\.request|pg_ctl promote|fencing_executed=true/i);
  assert.match(timer,/\[ -f \"\$source_script\" \] \|\| fail readiness_source_missing/);
  assert.match(timer,/install -o root -g root -m 0750/);
  assert.doesNotMatch(timer,/\[ -x \"\$source_script\" \]/);
  assert.match(timer,/OnUnitActiveSec=60/);
});

test('Caddy anchor accepts only one non-comment canonical site declaration',()=>{
  const route=deploy.match(/site_line="\$\(awk -v canonical_host="\$canonical_host" '([\s\S]*?)' "\$caddyfile"\)"/);
  assert.ok(route, 'canonical anchor awk is present');
  const program=route[1];
  assert.match(program,/\/\^\[\[:space:\]\]\*#\//);
  assert.match(program,/index\(\$0, canonical_host\)/);
  assert.match(program,/matches != 1/);
});
