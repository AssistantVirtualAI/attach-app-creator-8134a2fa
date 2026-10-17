import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const relayDirectory = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer');
const installerPath = resolve(relayDirectory, 'lemtel-ha-do-writer-signer-mtls-relay-source-only-deploy.sh');
const unitPath = resolve(relayDirectory, 'systemd/lemtel-signer-mtls-relay.service');
const contractPath = resolve(relayDirectory, 'mtls-relay-contract.json');
const documentationPath = resolve(root, 'docs/lemtel-ha/CLOUDFLARE_SIGNER_MTLS_RELAY_THREAT_MODEL.md');
const installer = readFileSync(installerPath, 'utf8');
const unit = readFileSync(unitPath, 'utf8');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const documentation = readFileSync(documentationPath, 'utf8');
const uncommented = installer.replace(/^\s*#.*$/gmu, '');
const required = (value, expected) => assert.ok(value.includes(expected), `missing: ${expected}`);

test('DO source-only installer fails closed before writes and seals a root-owned source release', () => {
  execFileSync('bash', ['-n', installerPath], { cwd: root });
  for (const expected of [
    "export PATH='/usr/sbin:/usr/bin:/sbin:/bin'",
    'unset BASH_ENV CDPATH ENV',
    "IFS=$' \\t\\n'",
    'umask 077',
    '[ "$(/usr/bin/id -u)" -eq 0 ] || fail root_required',
    "readonly WRITER_ROLE='digitalocean_writer'",
    "readonly INSTALL_TOKEN='install_do_signer_mtls_relay_source_only'",
    "readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'",
    "readonly INSTALL_PARENT='/opt/lemtel-ha'",
    "readonly LOCK_DIRECTORY='/opt/lemtel-ha/.cloudflare-platform-signer-stage.lock'",
    "readonly RELAY_SHA256='",
    "readonly CONTRACT_SHA256='",
    "readonly UNIT_SHA256='",
    'secure_regular_root "${CREDENTIALS_DIRECTORY}/client-cert.pem.cred" \'600\'',
    'secure_regular_root "${CREDENTIALS_DIRECTORY}/client-key.pem.cred" \'600\'',
    'secure_source_file "$script_directory/$source"',
    '[ "$owner" = \'0\' ] && [ "$group" = \'0\' ] && [ "$links" = \'1\' ]',
    '(( (mode_value & 8#022) == 0 ))',
    'sha256_matches "$script_directory/$source" "$digest"',
    'assert_all_verified_sources',
    'mkdir -m 0700 -- "$LOCK_DIRECTORY"',
    'fail concurrent_or_stale_install_lock',
    'mktemp -d "$INSTALL_PARENT/.cloudflare-platform-signer.stage.XXXXXX"',
    'mv --no-target-directory -- "$staging_directory" "$INSTALL_DIRECTORY"',
    'assert_release_tree',
    'systemd_unit_staged_not_installed=true',
  ]) required(installer, expected);
  assert.doesNotMatch(installer, /__(?:RELAY|CONTRACT|UNIT)_SHA256__/u);
  assert.doesNotMatch(installer, /-----BEGIN (?:[A-Z ]+ )?(?:PRIVATE KEY|CERTIFICATE)-----/u);
  assert.doesNotMatch(uncommented, /(?:\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|\bdoctl\b|\bhcloud\b|\bdocker\b|\bpg_ctl\b|\bpg_promote\b)/iu);
  assert.doesNotMatch(uncommented, /(?:\bsystemctl\b|\bdaemon-reload\b|\bservice\s+(?:start|restart|enable)|\btimer\b.*\benable\b)/iu);
});

test('staged release has a strict allowlist and no activation path', () => {
  assert.match(installer, /readonly -a SOURCE_FILES=\(\n  "\$RELAY_SOURCE"\n  "\$CONTRACT_SOURCE"\n  "\$UNIT_SOURCE"\n\)/u);
  for (const expected of [
    "readonly RELAY_SOURCE='lemtel-signer-mtls-relay.py'",
    "readonly CONTRACT_SOURCE='mtls-relay-contract.json'",
    "readonly UNIT_SOURCE='systemd/lemtel-signer-mtls-relay.service'",
    "release_state='staged_atomically'",
    "release_state='already_staged_verified'",
    "printf 'release_state=%s",
    'relay_configuration_created=false',
    'relay_source_staged=true',
    'systemd_unit_staged_not_installed=true',
    'systemd_daemon_reloaded=false',
    'service_enabled=false',
    'service_started=false',
    'timer_enabled=false',
    'runtime_started=false',
    'routes_changed=false',
    'provider_contacted=false',
    'cloudflare_or_dns_changed=false',
    'promotion_executed=false',
    'fencing_executed=false',
    'automatic_failover_enabled=false',
    'telephony_contacted=false',
  ]) required(installer, expected);
  assert.doesNotMatch(uncommented, /(?:\bPlanipret\b|\bpbx\b|\blegacy\b|\bfusionpbx\b|\bsip\b|\btelephony\s+(?:api|client))/iu);
  assert.doesNotMatch(uncommented, /(?:\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b|\bDROP\b|\bTRUNCATE\b|\bCREATE\s+(?:TABLE|DATABASE|SCHEMA)\b)/iu);
});

test('contract and unit retain explicit non-deployment state', () => {
  assert.doesNotMatch(unit, /^\[Install\]$/mu);
  assert.equal(contract.source_only_deployment.do_writer_installer_available, true);
  assert.equal(contract.source_only_deployment.installation_authorized, false);
  assert.equal(contract.source_only_deployment.preexisting_root_only_encrypted_mtls_credentials_required, true);
  assert.equal(contract.source_only_deployment.credential_values_read, false);
  assert.equal(contract.source_only_deployment.credential_values_created, false);
  assert.equal(contract.source_only_deployment.systemd_daemon_reload, false);
  assert.equal(contract.source_only_deployment.service_enablement, false);
  assert.equal(contract.source_only_deployment.service_start, false);
  assert.equal(contract.local_relay.startup_preexisting_encrypted_credentials_required, true);
  assert.equal(contract.local_relay.startup_loaded_credentials_root_only_required, true);
  assert.ok(contract.explicitly_excluded.includes('legacy'));
  assert.match(documentation, /installateur DO source-only/u);
  assert.match(documentation, /sans lire leur contenu/u);
});
