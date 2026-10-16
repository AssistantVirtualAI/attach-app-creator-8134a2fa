import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { assembleActivationPackage, PACKAGE_FILES, SHELL_FILES } from './lemtel-traffic-activation-package.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = 'infra/lemtel-resilience/traffic-observability/';
const entry = `${directory}lemtel-ha-do-writer-traffic-activation-apply.sh`;
const source = readFileSync(resolve(root, entry), 'utf8');
const doc = readFileSync(resolve(root, 'docs/lemtel-ha/TRAFFIC_OBSERVABILITY_ACTIVATION_TRANSACTION.md'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, `${directory}activation-package-manifest.json`), 'utf8'));
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const prepare = slice('    def prepare(self):', '    def apply(self, secret):');
const apply = slice('    def apply(self, secret):', '    def restore_caddy(self):');
const rollback = slice('    def rollback(self):', 'def interrupted(');
const invariants = [
  'hostinger_contacted=false', 'cloudflare_or_dns_changed=false',
  'automatic_failover_enabled=false', 'fencing_executed=false',
  'telephony_contacted=false', 'credential_values_emitted=false',
];

test('new activation entry fails closed on independent operator gates before any mutation', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash\n/u);
  assert.match(source, /^set \+x\nset -euo pipefail\numask 077$/mu);
  assert.match(source, /\[\[ "\$EUID" -eq 0 \]\] \|\| fail root_required/u);
  assert.match(source, /\[\[ "\$#" -eq 0 \]\] \|\| fail invalid_arguments/u);
  const gates = [
    ['LEMTEL_HA_ROLE', 'digitalocean_writer'],
    ['LEMTEL_TRAFFIC_ACTIVATION_EXECUTE', 'activate_verified_do_writer_traffic_transaction'],
    ['LEMTEL_TRAFFIC_ACTIVATION_SNAPSHOT_ATTESTATION', 'FRESH_ENCRYPTED_DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED'],
    ['LEMTEL_TRAFFIC_ACTIVATION_BACKUP_ATTESTATION', 'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED'],
    ['LEMTEL_TRAFFIC_ACTIVATION_PACKAGE_REVIEW', 'REVIEWED_DO_WRITER_TRAFFIC_TRANSACTION'],
    ['LEMTEL_TRAFFIC_ACTIVATION_ROLLBACK_ATTESTATION', 'DO_WRITER_TRAFFIC_ROLLBACK_REVIEWED'],
    ['LEMTEL_TRAFFIC_EDGE_LOG_ATTESTATION', 'EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED'],
    ['LEMTEL_TRAFFIC_ACTIVATION_REVIEW_APPROVED', 'REVIEWED_LOCAL_COLLECTOR_ACTIVATION'],
    ['LEMTEL_TRAFFIC_ACTIVATION_SCHEMA_ATTESTATION', 'INACTIVE_TRAFFIC_SCHEMA_AND_RBAC_VERIFIED'],
  ];
  const entrySection = source.split("<<'PY'")[0];
  for (const [key, value] of gates) {
    assert.ok(entrySection.includes(`[[ "\${${key}:-}" = ${value} ]] || fail `), key);
    assert.ok(doc.includes(key) && doc.includes(value), key);
  }
  assert.doesNotMatch(entrySection, /(?:^|\n)\s*(?:install|touch|mkdir|rm|mv|cp|docker|systemctl)\b/mu);
  for (const token of ['activation_preflight_ready', 'traffic_runtime_preflight_status', 'collector_config', 'collector_timer', 'collector_service']) {
    assert.ok(prepare.includes(`fields.get('${token}')`), token);
  }
  assert.match(prepare, /command\(\['bash', str\(SOURCE \/ 'lemtel-ha-do-writer-traffic-runtime-preflight.sh'\)\]/u);
  assert.doesNotMatch(prepare, /self\.(?:create|mkdir)\(|\.unlink\(|\.rmdir\(|os\.(?:replace|mkdir)\(|O_CREAT/u);
  assert.match(source, /pending_secret = transaction.prepare\(\)[\s\S]*transaction.apply\(pending_secret\)/u);
  assert.ok(apply.indexOf('self.create(LOCK') < apply.indexOf('self.edge_attempted = True'));
  assert.match(prepare, /secrets.token_hex\(32\)/u);
});

test('embedded Python is parsed without executing the transaction', () => {
  const start = source.indexOf("<<'PY'\n");
  const end = source.lastIndexOf('\nPY\n');
  assert.ok(start >= 0 && end > start);
  const program = source.slice(start + "<<'PY'\n".length, end + 1);
  execFileSync('/usr/bin/python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
    input: program,
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'pipe'],
  });
});

test('credential handling is memory-only crypto then exactly two exclusive root-only files; no shell/argv value', () => {
  assert.match(prepare, /require\(re.fullmatch\(r'\[a-f0-9\]\{64\}', secret\) is not None\)/u);
  assert.equal((source.match(/secrets\.token_hex\(32\)/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /Math\.random|random\.random|uuid|openssl\s+rand|os\.urandom\(\s*(?!32\b)/u);
  assert.match(source, /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW, 0o600/u);
  for (const token of ['metadata.st_uid == 0', 'metadata.st_nlink == 1', 'stat.S_ISREG', 'stat.S_IMODE(metadata.st_mode) == mode', 'not metadata.st_mode & 0o022', 'identity(secure_file(path, 0o600']) {
    assert.ok(source.includes(token), token);
  }
  const secretWrites = apply.split('\n').filter((line) => line.includes('self.create(') && /\bsecret\b/u.test(line));
  assert.equal(secretWrites.length, 2);
  assert.match(secretWrites[0], /self.create\(CONFIG,/u);
  assert.match(secretWrites[1], /self.create\(self.docker_env,/u);
  const overrideWrite = apply.split('\n').find((line) => line.includes('self.create(self.override,'));
  assert.ok(overrideWrite.includes("': ${' + KEY + ':?required}"));
  assert.doesNotMatch(overrideWrite, /\bsecret\b|endpoint|ports|volumes|labels|command|image/u);
  assert.doesNotMatch(source, /os\.environ|putenv|printenv|(?:^|\n)\s*(?:source|eval|export|echo|set -x)\b/mu);
  assert.match(source, /require\(KEY not in extra\)/u);
  assert.match(source, /child_env = dict\(ENV\)/u);
  assert.match(source, /stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,[\s\S]*stderr=subprocess.PIPE, env=child_env, cwd='\/', start_new_session=True/u);
  assert.doesNotMatch(source, /shell=True|stderr=sys\.|stdout=sys\.|traceback|logging\.|check_output|subprocess\.run/u);
  assert.match(apply, /endpoint = 'https' \+ ':\/\/' \+ CANONICAL_HOST \+ INGRESS_PATH/u);
  assert.match(source, /EDGE_CONFIG = ROOT \/ 'edge-config'/u);
  assert.match(apply, /self\.mkdir\(EDGE_CONFIG\)[\s\S]*self\.docker_env = EDGE_CONFIG \/ 'edge-secret\.env'[\s\S]*self\.override = EDGE_CONFIG \/ 'edge-traffic\.override\.yaml'/u);
  assert.doesNotMatch(apply, /self\.unlink\(self\.docker_env\)|self\.unlink\(self\.override\)/u);
});

test('only exact unique Edge is recreated from actual compose labels, with original-hash safety and no dependencies', () => {
  for (const token of [
    "container_for('supabase-edge-functions')", "'name=^/' + name + '$'", "len(candidates) == 1",
    "docker_value('{{.Name}}', container) == '/' + name", 'com.docker.compose.project.config_files',
    'com.docker.compose.project.environment_file', 'com.docker.compose.project.working_dir',
    'com.docker.compose.config-hash', 'com.docker.compose.container-number', 'com.docker.compose.oneoff',
    "len(set(paths)) == len(paths)", "str(path) == value", "self.config_files = path_list(label(",
    "self.initial_hash() == self.original_hash", "stdout.splitlines() == [edge]", "edge != self.edge",
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /(?:docker-compose|compose)\.(?:yml|yaml)|docker-compose\s+|--remove-orphans|--scale|--build\b|--pull\s+always/u);
  const composeBuilder = slice('    def compose_command(', '    def initial_hash(');
  assert.match(composeBuilder, /\['--env-file', str\(self.docker_env\)\]/u);
  assert.match(composeBuilder, /for path in self.config_files:[\s\S]*\['-f', str\(path\)\]/u);
  assert.match(composeBuilder, /if additional:[\s\S]*\['-f', str\(self.override\)\]/u);
  const upLines = source.split('\n').filter((line) => line.includes("['up',"));
  assert.equal(upLines.length, 2);
  for (const line of upLines) {
    assert.ok(line.includes("['up', '--no-deps', '--force-recreate', '--no-build', '--pull', 'never', '-d', self.service]"));
    assert.doesNotMatch(line, /secret|endpoint|ALL|\*|down/u);
  }
  assert.match(upLines[0], /compose_command\(True\)/u);
  assert.match(upLines[1], /compose_command\(\)/u);
  assert.match(source, /DOCKER_HOST': 'unix:' \+ '\/\/\/var\/run\/docker.sock'/u);
  assert.doesNotMatch(source, /--host\b|DOCKER_CONTEXT|HOME.*\/root|docker\s+(?:run|restart|stop|kill|login)|\['docker', '(?:run|restart|stop|kill|login)'\]/u);
  const envInspectLines = source.split('\n').filter((line) => line.includes('.Config.Env'));
  assert.equal(envInspectLines.length, 1);
  assert.match(envInspectLines[0], /PRESENCE = .*\}\}present\{\{/u);
  assert.doesNotMatch(envInspectLines[0], /\{\{\.\}\}|json|println/u);
  assert.match(source, /EDGE_FORMAT_CHECK = 'set \+x;.*\[ "\$\{#v\}" -eq 64 \].*\*\[!0-9a-f\]\*/u);
  assert.match(source, /quiet\(\['docker', 'exec', edge, 'sh', '-eu', '-c', EDGE_FORMAT_CHECK\]\)/u);
});

test('Caddy is strictly wrapped, root-only backup verified, exact log_skip insertion and deterministic restore', () => {
  assert.match(apply, /self.create\(self.backup, self.caddy_before\)/u);
  assert.match(apply, /hashlib.sha256\(read_protected\(self.backup, 0o600\)\).digest\(\) == self.caddy_digest/u);
  assert.match(prepare, /self.caddy_expected_digest = hashlib.sha256\(anticipated_route\(/u);
  assert.match(apply, /hashlib.sha256\(read_protected\(self.caddyfile\)\).digest\(\) == self.caddy_expected_digest/u);
  assert.match(apply, /command\(\['bash', str\(SOURCE \/ 'lemtel-ha-do-writer-traffic-ingress-route-apply.sh'\)\]/u);
  for (const token of ['apply_verified_traffic_ingress_route', 'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED', 'REVIEWED_DO_WRITER_TRAFFIC_ROUTE', 'DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED', 'EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED']) assert.ok(apply.includes(token), token);
  assert.match(source, /'handle @lemtel_traffic_ingest \{', 'log_skip'/u);
  assert.match(source, /text.count\(INGRESS_PATH\) == 1/u);
  assert.match(prepare, /require\(not exists\(ROUTE_BACKUPS\)\)/u);
  const restore = slice('    def restore_caddy(', '    def remove_new_collector_files(');
  assert.match(restore, /read_protected\(self.backup, 0o600\)/u);
  assert.match(restore, /fcntl.flock\(lock_fd, fcntl.LOCK_EX \| fcntl.LOCK_NB\)/u);
  assert.match(restore, /os.replace\(name, self.caddyfile\)/u);
  assert.match(restore, /os.fchown\(stream.fileno\(\), self.caddy_metadata.st_uid, self.caddy_metadata.st_gid\)/u);
  for (const action of ['validate', 'reload']) assert.ok(restore.includes(`['docker', 'exec', self.caddy, 'caddy', '${action}'`));
  assert.doesNotMatch(source, /verify_jwt|JWT_SECRET|SUPABASE_SERVICE_ROLE_KEY|handle_path\s+\/functions\/v1\/lemtel-traffic-ingest/u);
});

test('collector configuration is checked, first baseline occurs once before timer, no extra collection or forced wait', () => {
  assert.equal((apply.match(/'lemtel-traffic-collect.sh'\)\]\)/gu) ?? []).length, 1);
  assert.ok(apply.indexOf("'--check-config'") < apply.indexOf('self.edge_attempted = True'));
  assert.ok(apply.indexOf('self.baseline_attempted = True') < apply.indexOf('self.timer_attempted = True'));
  assert.match(apply, /require\(not exists\(STATE\)\)[\s\S]*stdout == 'status=baseline_pending\\n'/u);
  assert.match(apply, /'lemtel-traffic-timer-enable.sh'\), 'enable-lemtel-traffic-collector'/u);
  for (const token of ['transactional-package-ready', 'REVIEWED_LOCAL_COLLECTOR_ACTIVATION', 'LOCAL_COLLECTOR_ROLLBACK_REVIEWED']) assert.ok(apply.includes(token), token);
  assert.doesNotMatch(source, /\bsleep\b|journalctl|\/proc\/net|curl|wget|\['systemctl', '(?:enable|start|restart|reload)'\]/u);
  assert.match(apply, /\['systemctl', 'is-enabled', 'lemtel-traffic-collector.timer'\]/u);
  assert.match(apply, /\['systemctl', 'is-active', 'lemtel-traffic-collector.timer'\]/u);
  assert.match(source, /first_baseline_status=baseline_pending\\nmetrics_visibility=not_verified/u);
  assert.match(source, /edge_compose_inputs_persisted=true\\nrollback_backup_verified=true/u);
});

test('rollback touches only new owned collector files, initial Caddy, initial Edge files and root-only run secrets', () => {
  assert.match(rollback, /if self.timer_attempted:[\s\S]*\['systemctl', 'disable', '--now', 'lemtel-traffic-collector.timer'\]/u);
  assert.match(rollback, /\['systemctl', 'stop', 'lemtel-traffic-collector.service'\]/u);
  assert.match(rollback, /if self.route_attempted:[\s\S]*attempt\(self.restore_caddy\)/u);
  assert.match(rollback, /if self.edge_attempted:[\s\S]*self.initial_files_unchanged\(\)[\s\S]*self.verify_edge\(False\)/u);
  assert.match(rollback, /if path not in \(self.backup, self.backup_metadata\)/u);
  assert.match(rollback, /return 'complete' if complete else 'manual_required'/u);
  assert.match(source, /identity\(secure_file\(path, 0o600, parents=\(path != ROUTE_LOCK\)\)\) == self.files\[path\]/u);
  assert.match(prepare, /for path in \(CONFIG, STATE, LIB, TIMER, SERVICE, WANTS, LOCK\):[\s\S]*require\(not exists\(path\)\)/u);
  assert.match(source, /except BaseException:[\s\S]*os.killpg\(process.pid, signal.SIGKILL\)/u);
  assert.doesNotMatch(source, /rm\s+-|rmtree|shutil|Path\('\/(?:opt|home|root)[^']*'\)\.unlink/u);
});

test('new source has no forbidden topology, business-data, network command or output-value leakage', () => {
  assert.doesNotMatch(source, /\b(?:ssh|scp|rsync|socat|nc|doctl|hcloud|nsupdate|psql|sqlcmd|pg_promote|pg_ctl|pg_dump)\b/iu);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE|DROP)\s+(?:TABLE|FROM|INTO|DATABASE)\b/iu);
  assert.doesNotMatch(source, /planipret|avastatistic|fusionpbx|\bpbx_|\bsip\b|api\.cloudflare|failover-agent|fence-execute/iu);
  assert.match(prepare, /secure_file\(SCHEMA_SOURCE, parents=False\).st_size > 0/u);
  assert.match(prepare, /secure_file\(functions \/ relative\).st_size > 0/u);
  assert.doesNotMatch(source, /read_protected\((?:SCHEMA_SOURCE|functions)|\.Config\.(?:Cmd|Entrypoint)|json \.Config|json \.Mounts/u);
  for (const text of [source, doc]) {
    assert.doesNotMatch(text, /https?:\/\/[^\s'"+]+|\b(?:\d{1,3}\.){3}\d{1,3}\b|secret\s+actual\s+values|BEGIN (?:RSA |EC )?PRIVATE KEY/iu);
    for (const line of text.split('\n').filter((line) => /\b(?:print|printf)\(/u.test(line))) {
      assert.doesNotMatch(line, /secret|endpoint|project|config_files|caddyfile|\.Config|stdout|stderr|metadata\.st_|os\.environ/iu);
    }
  }
  const dynamicPrints = source.split('\n').filter((line) => /^\s*print\(/u.test(line) && !/^\s*print\('/u.test(line));
  assert.deepEqual(dynamicPrints.map((line) => line.trim()), ['print(line)', 'print(line)']);
  for (const invariant of invariants) {
    assert.ok(source.includes(invariant));
    assert.ok(doc.includes(invariant));
  }
  assert.match(source, /print\('rollback_status=' \+ rollback_status\)/u);
  assert.match(source, /except BaseException:[\s\S]*rollback_status = transaction.rollback\(\) if transaction.files else 'not_required'/u);
});

test('separate source package allowlist and digests bind unchanged helpers without authorizing execution', () => {
  assert.equal(manifest.package_format, 'lemtel_do_writer_traffic_activation_source_v1');
  assert.equal(manifest.target_role, 'digitalocean_writer');
  assert.equal(manifest.source_only, true);
  assert.equal(manifest.operator_gated_transaction, true);
  for (const key of ['activation_authorized', 'deployment_authorized', 'secrets_in_package', 'database_mutation', 'hostinger_contacted', 'cloudflare_or_dns_changed', 'automatic_failover_enabled', 'fencing_executed', 'telephony_contacted', 'credential_values_emitted']) assert.equal(manifest[key], false, key);
  const expected = [entry, ...[
    'lemtel-ha-do-writer-traffic-runtime-preflight.sh', 'lemtel-ha-do-writer-traffic-ingress-route-apply.sh',
    'lemtel-traffic-collect.sh', 'lemtel-traffic-timer-enable.sh',
  ].map((name) => directory + name), 'docs/lemtel-ha/TRAFFIC_OBSERVABILITY_ACTIVATION_TRANSACTION.md',
  'scripts/lemtel-traffic-activation-transaction.test.mjs', 'scripts/lemtel-traffic-activation-package.mjs'].sort();
  assert.deepEqual(manifest.sources.map((item) => item.path).sort(), expected);
  assert.equal(new Set(manifest.sources.map((item) => item.path)).size, expected.length);
  for (const item of manifest.sources) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(item.sha256, createHash('sha256').update(readFileSync(resolve(root, item.path))).digest('hex'), item.path);
    if (item.path.endsWith('.sh') && item.path !== entry) assert.ok(source.includes(`'${item.path.slice(directory.length)}': '${item.sha256}'`));
    assert.doesNotMatch(item.path, /\.sql$|\.env$|portal|config\.toml|Caddyfile|backup|traffic\.json/u);
  }
  const testSource = readFileSync(new URL(import.meta.url), 'utf8');
  assert.match(testSource, /import \{ execFileSync \} from 'node:child_process'/u);
  assert.match(testSource, /execFileSync\('\/usr\/bin\/python3', \['-c', 'import ast, sys; ast\.parse\(sys\.stdin\.read\(\)\)'\]/u);
  assert.doesNotMatch(testSource, /\b(?:spawnSync|execSync|spawn|execFile)\s*\(/u);
  const staticHexLiterals = [...source.matchAll(/'([a-f0-9]{64})'/gu)].map((match) => match[1]);
  assert.deepEqual(staticHexLiterals.sort(), manifest.sources.filter((item) => item.path.endsWith('.sh') && item.path !== entry).map((item) => item.sha256).sort());
});

function tarEntries(archive) {
  const entries = [];
  for (let offset = 0; offset < archive.length - 1024;) {
    const header = archive.subarray(offset, offset + 512);
    assert.equal(header[156], '0'.charCodeAt(0));
    const field = (start, length) => header.subarray(start, start + length).toString('ascii').replace(/\0.*$/su, '').trim();
    const name = field(0, 100);
    assert.equal(field(345, 155), '');
    assert.equal(field(257, 6), 'ustar');
    const size = parseInt(field(124, 12), 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal(parseInt(field(148, 8), 8), [...checksumHeader].reduce((sum, byte) => sum + byte, 0));
    assert.equal(parseInt(field(108, 8), 8), 0);
    assert.equal(parseInt(field(116, 8), 8), 0);
    assert.equal(parseInt(field(136, 12), 8), 0);
    entries.push({ path: name, mode: parseInt(field(100, 8), 8), bytes: archive.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(archive.subarray(-1024).every((byte) => byte === 0));
  return entries;
}

test('offline source package is byte-deterministic, integrity-covered and root-only without invoking any source', () => {
  const first = assembleActivationPackage();
  const second = assembleActivationPackage();
  assert.deepEqual(first.archive, second.archive);
  const entries = tarEntries(first.archive);
  assert.equal(first.fileCount, 8);
  assert.deepEqual(entries.map((item) => item.path).sort(), PACKAGE_FILES);
  assert.equal(new Set(entries.map((item) => item.path)).size, entries.length);
  for (const item of entries) {
    assert.equal(item.mode, SHELL_FILES.includes(item.path) ? 0o700 : 0o600);
    assert.doesNotMatch(item.path, /\.env$|\.sql$|Caddyfile|portal|backup|\.yaml$|\.yml$|traffic\.json/u);
    if (SHELL_FILES.includes(item.path)) assert.deepEqual(item.bytes, readFileSync(resolve(root, directory + item.path)));
  }
  const hashes = entries.find((item) => item.path === 'manifest.sha256').bytes.toString('utf8').trim().split('\n');
  assert.equal(hashes.length, entries.length - 1);
  for (const line of hashes) {
    const [digest, path] = line.split('  ');
    const item = entries.find((entry) => entry.path === path);
    assert.ok(item);
    assert.equal(digest, createHash('sha256').update(item.bytes).digest('hex'));
  }
  const packagedManifest = JSON.parse(entries.find((item) => item.path === 'activation-package-manifest.json').bytes.toString('utf8'));
  assert.deepEqual(packagedManifest, manifest);
});

test('new source sealer reads only its allowlisted sources and cannot execute runtime, contact hosts or create credentials', () => {
  const generator = readFileSync(resolve(root, 'scripts/lemtel-traffic-activation-package.mjs'), 'utf8');
  assert.doesNotMatch(generator, /node:child_process|\b(?:fetch|spawn|execFileSync|execSync|spawnSync)\s*\(|\b(?:ssh|curl|wget|doctl|systemctl|nsupdate|psql|openssl)\b/u);
  assert.doesNotMatch(generator, /process\.env|randomBytes|randomFill|token_hex|LEMTEL_TRAFFIC_COLLECTOR_SECRET=|https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  assert.match(generator, /import \{ deterministicTar \} from '.\/lemtel-traffic-observability-deploy-package.mjs'/u);
  assert.match(generator, /FALSE_KEYS.every\(\(key\) => manifest\[key\] === false\)/u);
  assert.match(generator, /sha256\(bytes\) === item.sha256/u);
  assert.match(generator, /openSync\(path, 'wx', 0o600\)/u);
  assert.match(generator, /fromRoot.startsWith\(`\.\.\$\{sep\}`\)/u);
  assert.match(generator, /current.dev === item.device && current.ino === item.inode/u);
  assert.match(generator, /activation_executed: false, deployment_executed: false/u);
  assert.match(generator, /report\('blocked'\)/u);
});

test('new transaction has exhaustive local action and fixed-path allowlists, not just forbidden-word checks', () => {
  const dockerActions = [...source.matchAll(/\['docker', '([^']+)'/gu)].map((match) => match[1]).sort();
  assert.deepEqual(dockerActions, ['compose', 'exec', 'exec', 'exec', 'inspect', 'ps'].sort());
  const systemdCommands = [...source.matchAll(/\['systemctl', '[^\]\n]+\]/gu)].map((match) => match[0]).sort();
  assert.deepEqual(systemdCommands, [
    "['systemctl', 'is-enabled', 'lemtel-traffic-collector.timer']",
    "['systemctl', 'is-active', 'lemtel-traffic-collector.timer']",
    "['systemctl', 'disable', '--now', 'lemtel-traffic-collector.timer']",
    "['systemctl', 'stop', 'lemtel-traffic-collector.service']",
    "['systemctl', 'daemon-reload']",
  ].sort());
  const fixedPaths = [...source.matchAll(/Path\('([^']+)'\)/gu)].map((match) => match[1]).sort();
  assert.deepEqual(fixedPaths, [
    '/etc/lemtel-ha/traffic-collector.env', '/var/lib/lemtel-traffic-collector',
    '/usr/local/libexec/lemtel-traffic', '/etc/systemd/system/lemtel-traffic-collector.timer',
    '/etc/systemd/system/lemtel-traffic-collector.service',
    '/etc/systemd/system/timers.target.wants/lemtel-traffic-collector.timer',
    '/var/lib/lemtel-ha/traffic-observability', '/run/lemtel-traffic-activation.lock',
    '/run/lock/lemtel-traffic-ingress-route.lock', '/.env', '/run', '/var/lock',
    '/home/lemtelops/lemtel-traffic-observability-deployment/0017_lemtel_traffic_samples.sql',
  ].sort());
  const pythonImports = source.split('\n').filter((line) => /^(?:import |from \w+ import )/u.test(line));
  assert.deepEqual(pythonImports, [
    'import fcntl', 'import hashlib', 'import json', 'import os', 'from pathlib import Path',
    'import re', 'import secrets', 'import signal', 'import stat', 'import subprocess',
    'import sys', 'import tempfile',
  ]);
  assert.equal((source.match(/subprocess\.Popen\(/gu) ?? []).length, 1);
  const codeWithoutComments = source.replace(/^\s*#.*$/gmu, '');
  assert.doesNotMatch(codeWithoutComments, /(?:\bopen|\.read_text|\.read_bytes)\(['"]|\b(?:urllib|socket|requests|httpx|http\.client)\b/u);
});
