import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root=resolve(import.meta.dirname,'..');
const activePassive=resolve(root,'infra/lemtel-resilience/active-passive');
const refresh=readFileSync(resolve(activePassive,'lemtel-ha-do-writer-lb-ready-refresh.sh'),'utf8');
const timer=readFileSync(resolve(activePassive,'lemtel-ha-do-writer-lb-ready-timer-enable.sh'),'utf8');
const deployPath=resolve(activePassive,'lemtel-ha-do-writer-lb-ready-route-deploy.sh');
const deploy=readFileSync(deployPath,'utf8');
const packagePath=resolve(activePassive,'lemtel-ha-do-writer-l7-ready-package.sh');
const packager=readFileSync(packagePath,'utf8');
const escaped=(value)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

test('L7 readiness is writer-only and exposes only the minimal healthy JSON marker',()=>{
  for (const expected of ['digitalocean_promoted_writer','database_not_writer','database_streaming_absent','storage_attestation_stale','lemtel-ha-do-writer-storage-sync.timer',"marker_name='lemtel-lb-ready.json'","legacy_marker_name='lemtel-lb-ready'",'observed_at="$(date -u +%s)"','lemtel_do_writer_l7_ready_v1','"writer_role":"do_writer"','"definitive":true','"status":"healthy"','automatic_traffic_failover_enabled=false']) assert.match(refresh,new RegExp(escaped(expected)));
  assert.doesNotMatch(refresh,/printf 'ready\\n'/);
  assert.doesNotMatch(refresh,/FUSIONPBX|SIP_|WSS|TURN|POSTGRES_PASSWORD|SERVICE_ROLE|Bearer/i);
  assert.match(refresh,/resolve_runtime_container/);
  assert.match(refresh,/database_container_unresolved/);
  assert.match(refresh,/auth_container_unresolved/);
  assert.doesNotMatch(refresh,/db_container='supabase-db'/);
  assert.doesNotMatch(refresh,/auth_container='supabase-auth'/);
});

test('route is exact, archive-verified, transactional and does not activate Cloudflare routing',()=>{
  for (const expected of [
    "canonical_host='lemtel.assistantvirtualai.com'", 'index($0, canonical_host)', 'matches != 1',
    'path /lemtel-lb-ready', 'route_marker_count', 'existing_route_invalid', 'route_marker_ambiguous',
    'route_state', 'root * /etc/caddy', 'rewrite * /lemtel-lb-ready.json', 'obsolete_header_contract',
    'LEMTEL_L7_READY_ARCHIVE', 'LEMTEL_L7_READY_ARCHIVE_DIGESTS', 'archive_digest_mismatch',
    'archive_layout_invalid', 'manifest_digest_mismatch', 'sha256sum -c --status', 'tar -tzf',
    'caddy validate', 'caddy reload', 'backup_root', 'trap cleanup EXIT',
    'l7_http_attestation_failed', "--write-out '%{http_code}|%{content_type}'", "IFS='|' read -r http_code content_type", "[ \"$http_code\" = 200 ]", "[ \"$content_type\" = application/json ]",
    'lemtel_do_writer_l7_ready_v1', 'cloudflare_routing_changed=false', 'automatic_traffic_failover_enabled=false'
  ]) assert.match(deploy,new RegExp(escaped(expected)));
  assert.doesNotMatch(deploy,/IFS=\$'\\n' read -r http_code content_type/);
  assert.doesNotMatch(deploy,/caddy fmt(?:\s|$)/i);
  assert.doesNotMatch(deploy,/cloudflare\.request|pg_ctl promote|fencing_executed=true|authorization:|Bearer/i);
  assert.match(timer,/\[ -f "\$source_script" \] \|\| fail readiness_source_missing/);
  assert.match(timer,/install -o root -g root -m 0750/);
  assert.doesNotMatch(timer,/\[ -x "\$source_script" \]/);
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

test('strict attestation keeps HTTP status and Content-Type in one parseable record',()=>{
  const parsed=execFileSync('bash',['-c',"metadata='200|application/json'; IFS='|' read -r http_code content_type <<< \"$metadata\"; printf '%s|%s' \"$http_code\" \"$content_type\""],{encoding:'utf8'});
  assert.equal(parsed,'200|application/json');
  assert.match(deploy,/--write-out '%\{http_code\}\|%\{content_type\}'/);
  assert.match(deploy,/IFS='\|' read -r http_code content_type/);
});

test('a strictly recognized legacy marker block is reconciled to JSON while foreign blocks remain rejected',()=>{
  const match=deploy.match(/reconcile_existing_route\(\) \{\n  local destination="\$1"\n  python3 - "\$caddyfile" "\$site_line" "\$route_marker" "\$destination" <<'PY'\n([\s\S]*?)\nPY\n\}/);
  assert.ok(match,'route reconciliation program is present');
  const program=match[1];
  const sandbox=mkdtempSync(resolve(tmpdir(),'lemtel-l7-reconcile-'));
  const caddyfile=resolve(sandbox,'Caddyfile');
  const candidate=resolve(sandbox,'candidate');
  const canonical='lemtel.assistantvirtualai.com {';
  const marker='# LEMTEL_LOAD_BALANCER_READY_V1';
  const legacy=[
    canonical,
    `  ${marker}`,
    '  @lemtel_load_balancer_ready path /lemtel-lb-ready',
    '  handle @lemtel_load_balancer_ready {',
    '    root * /etc/caddy',
    '    rewrite * /lemtel-lb-ready',
    '    file_server',
    '  }',
    '  reverse_proxy /functions/* supabase-kong:8000',
    '}',
    '',
  ].join('\n');
  try {
    writeFileSync(caddyfile,legacy);
    const mode=execFileSync('python3',['-',caddyfile,canonical,marker,candidate],{input:program,encoding:'utf8'}).trim();
    assert.equal(mode,'legacy');
    const reconciled=readFileSync(candidate,'utf8');
    assert.match(reconciled,/rewrite \* \/lemtel-lb-ready\.json/);
    assert.doesNotMatch(reconciled,/header Content-Type application\/json/);
    assert.match(reconciled,/reverse_proxy \/functions\/\* supabase-kong:8000/);
    assert.equal((reconciled.match(/LEMTEL_LOAD_BALANCER_READY_V1/g)??[]).length,1);
    writeFileSync(caddyfile,reconciled);
    assert.equal(execFileSync('python3',['-',caddyfile,canonical,marker,'-'],{input:program,encoding:'utf8'}).trim(),'current');
    writeFileSync(caddyfile,legacy.replace('    file_server','    header Content-Type application/json\n    file_server'));
    assert.equal(execFileSync('python3',['-',caddyfile,canonical,marker,candidate],{input:program,encoding:'utf8'}).trim(),'legacy');
    assert.match(readFileSync(candidate,'utf8'),/rewrite \* \/lemtel-lb-ready\.json/);
    writeFileSync(caddyfile,legacy.replace('file_server','respond "unexpected"'));
    assert.throws(()=>execFileSync('python3',['-',caddyfile,canonical,marker,candidate],{input:program,encoding:'utf8'}));
  } finally {
    rmSync(sandbox,{recursive:true,force:true});
  }
});

test('bundle verification resolves every packaged source from the supplied bundle directory',()=>{
  assert.match(deploy,/for file in "\$\{bundle_sources\[@\]\}"; do\n    \[ -f "\$bundle\/\$file" \] && \[ ! -L "\$bundle\/\$file" \] \|\| fail bundle_file_missing\n  done/);
  assert.match(deploy,/\[ -f "\$manifest" \] && \[ ! -L "\$manifest" \] \|\| fail bundle_file_missing/);
  assert.doesNotMatch(deploy,/for file in "\$\{bundle_sources\[@\]\}" "\$manifest"; do\n    \[ -f "\$file" \]/);
});

test('package build is reproducible, digest-bound, L7-only, and emits a review-gated macOS launcher',()=>{
  const sandbox=mkdtempSync(resolve(tmpdir(),'lemtel-l7-ready-'));
  try {
    const first=resolve(sandbox,'first');
    const second=resolve(sandbox,'second');
    const env={...process.env,SOURCE_DATE_EPOCH:'1700000000'};
    execFileSync('bash',[packagePath,first],{env,stdio:'pipe'});
    execFileSync('bash',[packagePath,second],{env,stdio:'pipe'});
    const archive='lemtel-l7-ready-deployment.tar.gz';
    const digest=`${archive}.sha256`;
    assert.deepEqual(readFileSync(resolve(first,archive)),readFileSync(resolve(second,archive)));
    assert.deepEqual(readFileSync(resolve(first,digest),'utf8'),readFileSync(resolve(second,digest),'utf8'));
    const members=execFileSync('tar',['-tzf',resolve(first,archive)],{encoding:'utf8'}).trim().split('\n');
    assert.deepEqual(members,[
      'lemtel-ha-do-writer-lb-ready-refresh.sh',
      'lemtel-ha-do-writer-lb-ready-route-deploy.sh',
      'lemtel-ha-do-writer-lb-ready-timer-enable.sh',
      'manifest.sha256'
    ]);
    const manifest=execFileSync('tar',['-xOzf',resolve(first,archive),'manifest.sha256'],{encoding:'utf8'});
    assert.equal(manifest.trim().split('\n').length,3);
    for (const file of members.slice(0,3)) assert.match(manifest,new RegExp(` ${escaped(file)}$`,'m'));
    const launcher=readFileSync(resolve(first,'lemtel_deploy_l7_ready_json_mac.sh'),'utf8');
    assert.match(launcher,/LEMTEL_PARENT_REVIEW_APPROVED/);
    assert.match(launcher,/LEMTEL_L7_DEPLOY_SSH_TARGET/);
    assert.match(launcher,/BatchMode=yes/);
    assert.match(launcher,/ForwardAgent=no/);
    assert.match(launcher,/LEMTEL_L7_READY_ARCHIVE_DIGESTS/);
    assert.doesNotMatch(launcher,/lemtel\.assistantvirtualai\.com|https?:\/\/|Bearer|password|secret|token/i);
  } finally {
    rmSync(sandbox,{recursive:true,force:true});
  }
});

test('package generator remains local-only and refuses non-reproducible builds',()=>{
  for (const expected of ['SOURCE_DATE_EPOCH', 'transfer_executed=false', 'deployment_executed=false', 'automatic_traffic_failover_enabled=false', 'credential_values_emitted=false']) assert.match(packager,new RegExp(escaped(expected)));
  assert.doesNotMatch(packager,/scp |rsync |curl |wget |cloudflare|hostinger|pg_ctl promote/i);
  assert.match(packager,/tar --sort=name/);
  assert.match(packager,/gzip -n/);
});
