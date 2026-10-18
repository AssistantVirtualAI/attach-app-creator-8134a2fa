import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assembleDoWriterResourcePublisherActivationPackage } from './lemtel-do-writer-resource-publisher-activation-package.mjs';
const root=resolve(import.meta.dirname,'..');
const source=readFileSync(resolve(root,'infra/lemtel-resilience/do-writer-resource-observability/lemtel-ha-do-writer-resource-publisher-activation-apply.sh'),'utf8');
const manifest=JSON.parse(readFileSync(resolve(root,'infra/lemtel-resilience/do-writer-resource-observability/publisher-activation-manifest.json'),'utf8'));
const service=readFileSync(resolve(root,'infra/lemtel-resilience/do-writer-resource-observability/systemd/lemtel-do-writer-resource-publisher.service'),'utf8');
const timer=readFileSync(resolve(root,'infra/lemtel-resilience/do-writer-resource-observability/systemd/lemtel-do-writer-resource-publisher.timer'),'utf8');
const sha=(path)=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
test('activation remains an explicit, root-only DO writer transaction',()=>{
  for(const [key,value] of [['LEMTEL_HA_ROLE','digitalocean_writer'],['LEMTEL_DO_WRITER_RESOURCE_PUBLISHER_EXECUTE','activate_verified_do_writer_resource_publisher'],['LEMTEL_DO_WRITER_RESOURCE_PUBLISHER_SNAPSHOT_ATTESTATION','FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED'],['LEMTEL_DO_WRITER_RESOURCE_PUBLISHER_PACKAGE_REVIEW','REVIEWED_DO_WRITER_RESOURCE_PUBLISHER']]) assert.ok(source.includes(key)&&source.includes(value),key);
  assert.match(source,/\[\[ "\$#" -eq 0 \]\] \|\| fail invalid_arguments/u); assert.match(source,/secrets\.token_hex\(32\)/u);
  for(const invariant of ['hostinger_contacted=false','cloudflare_or_dns_changed=false','automatic_failover_enabled=false','fencing_executed=false','telephony_contacted=false','credential_values_emitted=false']) assert.ok(source.includes(invariant),invariant);
  assert.doesNotMatch(source.replaceAll('hostinger_contacted=false',''),/planipret|hostinger|fusionpbx|\bsip\b|api\.cloudflare|pg_promote|nsupdate|fence-execute/iu);
});
test('secret stays bounded and root-only while Edge is recreated before the smoke test',()=>{
  for(const token of ['os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW','LEMTEL_DO_WRITER_RESOURCE_SECRET','read_protected','--no-deps','--force-recreate','--no-build','--pull','never','status=published','systemctl','enable','--now']) assert.ok(source.includes(token),token);
  assert.ok(source.indexOf("self.phase='edge_recreate'")<source.indexOf("self.phase='smoke_test'")&&source.indexOf("self.phase='smoke_test'")<source.indexOf("self.phase='timer'"));
  assert.doesNotMatch(source,/console\.|printenv|Deno\.env\.toObject|EnvironmentFile=|Environment=.*(?:SECRET|TOKEN|KEY)/iu);
  assert.match(source,/if self\.timer_attempted: subprocess\.run\(\['systemctl','disable','--now'/u);
  assert.match(source,/self\.compose\(False\).*force-recreate/u);
});
test('Python refusal reports only a bounded phase and guard category',()=>{
  assert.match(source,/reason=f'\{transaction\.phase\}_\{transaction\.guard\}'/u);
  assert.match(source,/re\.fullmatch\(r'\[a-z_\]\{1,96\}',reason\)/u);
  assert.match(source,/print\('reason='\+reason\)/u);
  assert.doesNotMatch(source,/str\((?:error|exception)\)|repr\(|traceback|exc_info/iu);
  const guards=[...source.matchAll(/self\.guard='([a-z_]+)'/gu)].map((match)=>match[1]);
  assert.deepEqual([...new Set(guards)].sort(),['entry','initial_absence','runtime_identity','secret_generation','source_component_hashes','source_directory','source_ingest_hash','source_manifest_read','source_manifest_shape']);
  assert.ok(source.indexOf("self.guard='source_directory'")<source.indexOf("self.guard='source_manifest_read'"));
  assert.ok(source.indexOf("self.guard='source_manifest_read'")<source.indexOf("self.guard='source_manifest_shape'"));
  assert.ok(source.indexOf("self.guard='source_manifest_shape'")<source.indexOf("self.guard='source_component_hashes'"));
  assert.ok(source.indexOf("self.guard='source_component_hashes'")<source.indexOf("self.guard='source_ingest_hash'"));
});
test('embedded Python parses and manifest pins every installed source',()=>{
  const start=source.indexOf("<<'PY'\n"), end=source.lastIndexOf('\nPY\n'); assert.ok(start>=0&&end>start);
  execFileSync('/usr/bin/python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:source.slice(start+7,end+1),stdio:['pipe','ignore','pipe']});
  assert.equal(manifest.package_format,'lemtel_do_writer_resource_publisher_activation_v1'); assert.equal(manifest.target_role,'digitalocean_writer');
  assert.equal(manifest.deployment_authorized,false); assert.equal(manifest.publisher_install_authorized,false); assert.equal(manifest.publisher_timer_enable_authorized,false);
  assert.equal(manifest.sha256.publisher,sha('infra/lemtel-resilience/do-writer-resource-observability/lemtel-do-writer-resource-publish.sh'));
  assert.equal(manifest.sha256.service,sha('infra/lemtel-resilience/do-writer-resource-observability/systemd/lemtel-do-writer-resource-publisher.service'));
  assert.equal(manifest.sha256.timer,sha('infra/lemtel-resilience/do-writer-resource-observability/systemd/lemtel-do-writer-resource-publisher.timer'));
  assert.equal(manifest.ingest_sha256,sha('infra/lemtel-self-hosted/functions/lemtel-do-writer-resource-ingest/index.ts'));
});
test('systemd schedule is bounded and carries no credential',()=>{
  assert.match(service,/^User=root$/mu); assert.match(service,/^UMask=0077$/mu); assert.match(service,/^ExecStart=\/usr\/local\/libexec\/lemtel-do-writer-resource-publisher\/publish\.sh$/mu);
  assert.doesNotMatch(service,/Environment|SECRET|TOKEN|KEY|password/iu); assert.match(timer,/^OnUnitActiveSec=2min$/mu); assert.match(timer,/^RandomizedDelaySec=20s$/mu); assert.match(timer,/^Persistent=true$/mu);
});
test('package is deterministic and excludes all runtime configuration',()=>{
  const temp=mkdtempSync(join(tmpdir(),'lemtel-resource-publisher-test-')); try { const a=join(temp,'a.tar'), b=join(temp,'b.tar'), rev='b570841b77f8f283f38828fb140a429cdb969298'; assembleDoWriterResourcePublisherActivationPackage({sourceRevision:rev,output:a}); assembleDoWriterResourcePublisherActivationPackage({sourceRevision:rev,output:b}); assert.equal(sha(a),sha(b)); const entries=execFileSync('/usr/bin/tar',['-tf',a],{encoding:'utf8'}); for(const forbidden of ['.env','secret','hostinger','traffic','cloudflare','telephony']) assert.doesNotMatch(entries,new RegExp(forbidden,'iu')); } finally { rmSync(temp,{recursive:true,force:true}); } });
test('package CLI creates exactly one attestable archive',()=>{
  const temp=mkdtempSync(join(tmpdir(),'lemtel-resource-publisher-cli-')); try { const output=join(temp,'release.tar'); const result=execFileSync(process.execPath,[resolve(root,'scripts/lemtel-do-writer-resource-publisher-activation-package.mjs'),'--source-revision','2f21c400e9043ed8775a9d5c5dc6788187348cee','--output',output],{encoding:'utf8'}); assert.match(result,/"package_status":"created"/u); assert.equal(sha(output).length,64); } finally { rmSync(temp,{recursive:true,force:true}); } });
