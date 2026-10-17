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
const uncommented = (value) => value.replace(/^\s*#.*$/gmu, '');
const body = uncommented(installer);
const required = (value, expected) => assert.ok(value.includes(expected), `missing: ${expected}`);

test('DO source-only relay installer is root-only, role-bound, argument-free, and gates all writes on pre-existing root-only mTLS sources', () => {
  execFileSync('bash', ['-n', installerPath], { cwd: root });
  for (const expected of [
    '[ "$#" -eq 0 ] || fail cli_arguments_forbidden',
    '[ "$(id -u)" -eq 0 ] || fail root_required',
    "readonly WRITER_ROLE='digitalocean_writer'",
    "readonly INSTALL_TOKEN='install_do_signer_mtls_relay_source_only'",
    '[ "${LEMTEL_HA_ROLE:-}" = "$WRITER_ROLE" ] || fail writer_role_required',
    '[ "${LEMTEL_HA_EXECUTE:-}" = "$INSTALL_TOKEN" ] || fail execution_token_required',
    "readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'",
    'assert_preexisting_mtls_credential_sources',
    'secure_directory "$CREDENTIALS_DIRECTORY" \'700\'',
    'secure_regular_root "${CREDENTIALS_DIRECTORY}/client-cert.pem.cred" \'600\'',
    'secure_regular_root "${CREDENTIALS_DIRECTORY}/client-key.pem.cred" \'600\'',
    'assert_source_files',
    'assert_same_or_absent',
    '[ -e "$target" ] || [ -L "$target" ]',
    '[ ! -e "$INSTALL_DIRECTORY/$RELAY_SOURCE" ] && [ ! -L "$INSTALL_DIRECTORY/$RELAY_SOURCE" ]',
  ]) required(installer, expected);
  assert.doesNotMatch(installer, /-----BEGIN (?:[A-Z ]+ )?(?:PRIVATE KEY|CERTIFICATE)-----/u);
  assert.doesNotMatch(installer, /(?:LEMTEL_[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY)|client-(?:cert|key)\.pem\s*=)/u);
});

test('DO source-only relay installer has an exact relay/unit allowlist and leaves every activation surface false', () => {
  assert.match(installer, /readonly -a SOURCE_FILES=\(\n  "\$RELAY_SOURCE"\n  "\$CONTRACT_SOURCE"\n  "\$UNIT_SOURCE"\n\)/u);
  for (const expected of [
    'readonly RELAY_SOURCE=\'lemtel-signer-mtls-relay.py\'',
    'readonly CONTRACT_SOURCE=\'mtls-relay-contract.json\'',
    'readonly UNIT_SOURCE=\'systemd/lemtel-signer-mtls-relay.service\'',
    'relay_source_installed=true',
    'systemd_unit_installed=true',
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
    'business_data_read=false',
  ]) required(installer, expected);
  assert.doesNotMatch(body, /(?:\bsystemctl\b|\bservice\b\s+(?:start|restart|enable)|\bdaemon-reload\b|\btimer\b.*\benable\b)/iu);
  assert.doesNotMatch(body, /(?:\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|\bdoctl\b|\bhcloud\b|\bdocker\b|\bpg_ctl\b|\bpg_promote\b)/iu);
  assert.doesNotMatch(body, /(?:\bPlanipret\b|\bpbx\b|\blegacy\b|\bfusionpbx\b|\bsip\b|\btelephony\s+(?:api|client))/iu);
  assert.doesNotMatch(body, /(?:\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b|\bDROP\b|\bTRUNCATE\b|\bCREATE\s+(?:TABLE|DATABASE|SCHEMA)\b)/iu);
});

test('unit and contracts independently refuse a start without root-only encrypted mTLS credential sources', () => {
  for (const expected of [
    'ConditionPathIsDirectory=/etc/lemtel-platform-signer/credentials',
    'ConditionPathExists=/etc/lemtel-platform-signer/credentials/client-cert.pem.cred',
    'ConditionPathExists=/etc/lemtel-platform-signer/credentials/client-key.pem.cred',
    'LoadCredentialEncrypted=client-cert.pem:/etc/lemtel-platform-signer/credentials/client-cert.pem.cred',
    'LoadCredentialEncrypted=client-key.pem:/etc/lemtel-platform-signer/credentials/client-key.pem.cred',
  ]) required(unit, expected);
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
