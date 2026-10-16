import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const automaticFailover = resolve(root, 'infra/lemtel-resilience/automatic-failover');
const installer = readFileSync(resolve(automaticFailover, 'lemtel-ha-hostinger-failover-agent-installer.sh'), 'utf8');
const packagePath = resolve(automaticFailover, 'lemtel-ha-hostinger-failover-agent-installer-package.sh');
const packager = readFileSync(packagePath, 'utf8');
const service = readFileSync(resolve(automaticFailover, 'lemtel-ha-hostinger-failover-agent.service'), 'utf8');
const timer = readFileSync(resolve(automaticFailover, 'lemtel-ha-hostinger-failover-agent.timer'), 'utf8');
const documentation = readFileSync(resolve(root, 'docs/lemtel-ha/HOSTINGER_FAILOVER_AGENT_INSTALLER.md'), 'utf8');
const uncommented = (value) => value.replace(/^\s*#.*$/gmu, '');
const body = uncommented(installer);

const required = (value, expected) => assert.ok(value.includes(expected), `missing: ${expected}`);

test('installer is root-only, role-bound, rejects CLI input, and stages no HMAC material', () => {
  for (const expected of [
    '[ "$#" -eq 0 ] || fail cli_arguments_forbidden',
    '[ "$(id -u)" -eq 0 ] || fail root_required',
    "readonly STANDBY_ROLE='hostinger_standby'",
    '[ "${LEMTEL_HA_ROLE:-}" = "$STANDBY_ROLE" ] || fail invalid_role',
    "readonly INSTALL_TOKEN='install_hostinger_failover_agent_disabled'",
    '[ "${LEMTEL_HA_EXECUTE:-}" = "$INSTALL_TOKEN" ] || fail execution_token_required',
  ]) required(installer, expected);
  assert.doesNotMatch(installer, /(?:AGENT_SHARED_SECRET|HMAC_KEY|FAILOVER_AGENT_SECRET|failover-agent\.env)/u);
  assert.match(documentation, /fourniture HMAC doit rester \*\*hors bande\*\*/u);
  assert.match(documentation, /source, la ligne de commande, les logs ou un fichier/u);
});

test('installer requires a stopped private streaming standby and a fresh local Storage attestation', () => {
  for (const expected of [
    "readonly RUNTIME_PROJECT='lemtel-ha-hostinger-promoted'",
    'hostinger_runtime_already_running',
    "'SELECT pg_is_in_recovery()'",
    "'SELECT status FROM pg_stat_wal_receiver LIMIT 1'",
    'standby_not_in_recovery',
    'standby_not_streaming',
    'standby_postgres_port_published',
    'host_postgres_listener_detected',
    "readonly STORAGE_ATTESTATION='/home/lemtelstorage/storage-current/.lemtel-ha-manifest.current.sha256'",
    'readonly STORAGE_MAX_AGE_SECONDS=900',
    'storage_attestation_stale',
  ]) required(installer, expected);
});

test('installer writes a root-only durable installer ledger and keeps both systemd units disabled', () => {
  for (const expected of [
    "readonly STATE_DIR='/var/lib/lemtel-ha/failover-agent'",
    'prepare_root_directory "$STATE_DIR" \'0700\'',
    'installer-ledger',
    "= '0:0:600'",
    'sync -f "$LEDGER_FILE" "$STATE_DIR"',
    'assert_unit_inactive_and_disabled "$SERVICE_UNIT"',
    'assert_unit_inactive_and_disabled "$TIMER_UNIT"',
    'systemctl daemon-reload',
    'agent_service_enabled=false',
    'agent_timer_enabled=false',
  ]) required(installer, expected);
  assert.doesNotMatch(service, /^\s*\[Install\]/mu);
  assert.doesNotMatch(timer, /^\s*\[Install\]/mu);
  assert.doesNotMatch(`${service}\n${timer}`, /^\s*WantedBy=/mu);
});

test('installer never invokes activation, promotion, fencing, routing, telephony, network, or business-data operations', () => {
  assert.doesNotMatch(body, /(?:systemctl\s+(?:start|restart|try-restart|enable)\b|docker\s+(?:start|run)\b|docker\s+compose\b[^\n]*\bup\b|pg_ctl\s+promote|pg_promote\b)/iu);
  assert.doesNotMatch(body, /(?:\bcurl\b|\bwget\b|\bnc\b|\bssh\b|\bscp\b|\brsync\b|\bdoctl\b|\bhcloud\b)/iu);
  assert.doesNotMatch(body, /(?:cloudflare\s+(?:api|dns|route)|dns_records|fusionpbx\s|\bsip\s|telephony\s)/iu);
  assert.doesNotMatch(body, /(?:\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b|\bDROP\b|\bTRUNCATE\b|\bCREATE\s+(?:TABLE|DATABASE|SCHEMA)\b)/iu);
  for (const expected of [
    'runtime_started=false',
    'promotion_executed=false',
    'fencing_executed=false',
    'cloudflare_or_dns_changed=false',
    'telephony_contacted=false',
    'business_data_modified=false',
  ]) required(installer, expected);
});

test('installer package is deterministic, complete, local-only, and cannot activate the agent', () => {
  for (const expected of [
    'SOURCE_DATE_EPOCH',
    'lemtel-hostinger-failover-agent-installer.tar.gz',
    'lemtel-ha-hostinger-failover-agent-installer.sh',
    'lemtel-ha-hostinger-failover-agent.service',
    'lemtel-ha-hostinger-failover-agent.timer',
    'installer_service_enabled=false',
    'installer_timer_enabled=false',
    'hostinger_contacted=false',
    'runtime_started=false',
    'promotion_executed=false',
    'fencing_executed=false',
    'cloudflare_or_dns_changed=false',
  ]) required(packager, expected);
  assert.doesNotMatch(packager, /(?:\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|systemctl|docker|pg_ctl|pg_promote|cloudflare\s|fusionpbx|\bsip\b)/iu);
  const sandbox = mkdtempSync(resolve(tmpdir(), 'lemtel-hostinger-agent-package-'));
  try {
    const first = resolve(sandbox, 'first');
    const second = resolve(sandbox, 'second');
    const env = { ...process.env, SOURCE_DATE_EPOCH: '1700000000' };
    execFileSync('bash', [packagePath, first], { env, stdio: 'pipe' });
    execFileSync('bash', [packagePath, second], { env, stdio: 'pipe' });
    const archive = 'lemtel-hostinger-failover-agent-installer.tar.gz';
    assert.deepEqual(readFileSync(resolve(first, archive)), readFileSync(resolve(second, archive)));
    const members = execFileSync('tar', ['-tzf', resolve(first, archive)], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(members, [
      'lemtel-ha-hostinger-failover-agent-installer.sh',
      'lemtel-ha-hostinger-failover-agent.sh',
      'lemtel-ha-hostinger-current-topology-stage-attest.sh',
      'lemtel-ha-hostinger-current-topology-promote.sh',
      'lemtel-ha-hostinger-current-topology-runtime-start.sh',
      'lemtel-ha-hostinger-failover-agent.service',
      'lemtel-ha-hostinger-failover-agent.timer',
      'manifest.sha256',
    ]);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
