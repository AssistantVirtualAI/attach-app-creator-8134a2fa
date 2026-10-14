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
});
test('route is exact, transactional and does not activate Cloudflare routing',()=>{
  for (const expected of ['{$PROXY_DOMAIN}, lemtel.assistantvirtualai.com {','path /lemtel-lb-ready','root * /etc/caddy','rewrite * /lemtel-lb-ready','caddy reload','cloudflare_routing_changed=false','automatic_traffic_failover_enabled=false']) assert.match(deploy,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(deploy,/cloudflare\.request|pg_ctl promote|fencing_executed=true/i);
  assert.match(timer,/OnUnitActiveSec=60/);
});
