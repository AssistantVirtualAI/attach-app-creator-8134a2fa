import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
const root=resolve(import.meta.dirname,'..');
const packagePath=resolve(root,'scripts/lemtel-do-writer-resource-observation-deploy-package.mjs');
const deployerPath=resolve(root,'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-resource-observation-deploy.sh');
const migrationPath=resolve(root,'infra/lemtel-self-hosted/migrations/0022_lemtel_do_writer_resource_current.sql');
const packageSource=readFileSync(packagePath,'utf8'), deployer=readFileSync(deployerPath,'utf8');
test('resource package is deterministic, offline and excludes publisher material',()=>{
  for(const required of ['deterministicTar','sourceAtRevision','resource_source_manifest_mismatch','lemtel-do-writer-resource-ingest.index.ts','0022_lemtel_do_writer_resource_current.sql']) assert.match(packageSource,new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const excluded of ['lemtel-do-writer-resource-publish.sh','systemctl','curl','wget','ssh','scp','rsync','doctl','hcloud','fetch(']) assert.ok(!packageSource.includes(excluded),excluded);
  assert.match(packageSource,/publisher_timer_enabled:false/); assert.match(packageSource,/automatic_failover_enabled:false/);
});
test('resource deployer is root-only, writer-only, attested and transactionally scoped',()=>{
  execFileSync('bash',['-n',deployerPath]);
  for(const required of ['LEMTEL_DO_WRITER_RESOURCE_OBSERVATION_EXECUTE','deploy_verified_do_writer_resource_observation','LEMTEL_DO_WRITER_RESOURCE_SNAPSHOT_ATTESTATION','FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED','0022_lemtel_do_writer_resource_current.sql','lemtel-do-writer-resource-ingest.index.ts','lemtel-do-writer-resource-deployment-manifest.json','lemtel_record_do_writer_resource_status','action: "get_do_writer_resources"','trap rollback EXIT','docker restart --time 30 "$edge_container"']) assert.ok(deployer.includes(required),required);
  assert.match(deployer,/WHEN count\(\*\) FILTER \(WHERE present\) = 2 THEN/);
  assert.doesNotMatch(deployer,/lemtel-do-writer-resource-publish\.sh|publisher\.service|publisher\.timer|LEMTEL_DO_WRITER_RESOURCE_SECRET|systemctl|curl|wget|ssh|scp|rsync|doctl|hcloud|nsupdate|pg_promote/iu);
  for(const field of ['publisher_configuration_written=false','publisher_installed=false','publisher_timer_enabled=false','standby_runtime_started=false','cloudflare_or_dns_changed=false','promotion_executed=false','fencing_executed=false','automatic_failover_enabled=false','telephony_contacted=false']) assert.ok(deployer.includes(field),field);
});

test('resource deployer verifies the exact SQL function signature instead of widening its schema preflight',()=>{
  const migration=readFileSync(migrationPath,'utf8');
  const signature='lemtel_record_do_writer_resource_status(timestamp with time zone,smallint,smallint,smallint,integer,integer,integer)';
  assert.match(migration,/p_cpu_percent smallint, p_memory_percent smallint, p_disk_percent smallint/);
  assert.ok(deployer.includes(signature), 'deployer must require the migration function signature');
  assert.ok(!deployer.includes('timestamp with time zone,integer,integer,integer,integer,integer,integer'), 'deployer must not accept an incompatible widened signature');
});
