import assert from 'node:assert/strict';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-ha-do-writer-managed-mtls-storage-observation.sh');
const source = readFileSync(sourcePath, 'utf8');
const uncommented = source.replace(/^\s*#.*$/gmu, '');
const digest = 'a'.repeat(64);

function executable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'lemtel-mtls-storage-observation-'));
  const bin = join(base, 'bin');
  const etc = join(base, 'etc');
  const parent = join(etc, 'lemtel-platform-signer');
  const issuer = join(parent, 'managed-ca');
  const credential = join(issuer, 'root-ca-key.pem.cred');
  const certificate = join(parent, 'cloudflare-access-managed-root-ca.pem');
  const varDirectory = join(base, 'var');
  const varLib = join(varDirectory, 'lib');
  const attestationParent = join(varLib, 'lemtel-platform-signer');
  const attestation = join(attestationParent, 'managed-mtls-local-ca.attestation');
  const hostState = join(varLib, 'systemd');
  const hostKey = join(hostState, 'credential.secret');
  const script = join(base, 'observation.sh');
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  mkdirSync(issuer, { recursive: true, mode: 0o700 });
  mkdirSync(attestationParent, { recursive: true, mode: 0o755 });
  mkdirSync(hostState, { recursive: true, mode: 0o755 });
  chmodSync(etc, 0o755); chmodSync(parent, 0o750); chmodSync(issuer, 0o700);
  chmodSync(varDirectory, 0o755); chmodSync(varLib, 0o755); chmodSync(attestationParent, 0o755); chmodSync(hostState, 0o755);
  writeFileSync(credential, 'fixture-encrypted-credential-content\n', { mode: 0o600 });
  writeFileSync(certificate, 'fixture-public-certificate-content\n', { mode: 0o644 });
  writeFileSync(hostKey, 'fixture-systemd-host-key-content\n', { mode: 0o400 });
  writeFileSync(attestation, [
    'format=lemtel_do_managed_mtls_local_ca_bootstrap_attestation_v1',
    'issuer_type=local_root_only_encrypted_systemd_credential_host_bound',
    `root_ca_certificate_sha256=sha256:${digest}`,
    `root_ca_certificate_file=${certificate}`,
    'root_ca_certificate_persisted=true',
    'root_ca_certificate_mode=0644',
    'root_ca_certificate_root_owned=true',
    `root_ca_key_credential_file=${credential}`,
    'root_ca_key_credential_root_only=true',
    'root_ca_private_key_cleartext_persisted=false',
    'cloudflare_access_imported=false',
    'leaf_certificate_issued=false',
    'service_auth_policy_configured=false',
    'local_relay_activated=false',
    '',
  ].join('\n'), { mode: 0o644 });
  executable(join(bin, 'id'), '#!/bin/bash\nprintf "%s\\n" "${MOCK_UID:-0}"\n');
executable(join(bin, 'stat'), `#!/bin/bash
for last; do :; done
if [ "$1" = '-c' ] && [ "$2" = '%s' ]; then /usr/bin/stat -c '%s' -- "$last"; exit $?; fi
if [ "$1" = '-c' ] && [ "$2" = '%h' ]; then /usr/bin/stat -c '%h' -- "$last"; exit $?; fi
mode=$(/usr/bin/stat -c '%a' -- "$last") || exit 1
links=$(/usr/bin/stat -c '%h' -- "$last") || exit 1
printf '0:0:%s' "$mode"
if [ "$1" = '-c' ] && [ "$2" = '%u:%g:%a:%h' ]; then printf ':%s' "$links"; fi
printf '\\n'
`);
  executable(join(bin, 'findmnt'), `#!/bin/bash
[ "$5" = "${credential}" ] || exit 97
if [ "$3" = 'FSTYPE' ]; then printf '%s\\n' "\${MOCK_FS_TYPE:-ext4}"; else printf '%s\\n' "\${MOCK_MOUNT_SOURCE:-/dev/mockcrypt}"; fi
`);
  executable(join(bin, 'lsblk'), '#!/bin/bash\nprintf "%s\\n" "${MOCK_BLOCK_TYPE:-crypt}"\n');
  const rewritten = source
    .replace("readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'", `readonly TRUSTED_PATH='${bin}:/usr/sbin:/usr/bin:/sbin:/bin'`)
    .replace("readonly ETC_DIRECTORY='/etc'", `readonly ETC_DIRECTORY='${etc}'`)
    .replace("readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'", `readonly CREDENTIALS_PARENT='${parent}'`)
    .replace("readonly ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'", `readonly ISSUER_DIRECTORY='${issuer}'`)
    .replace("readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'", `readonly ROOT_CA_KEY_CREDENTIAL='${credential}'`)
    .replace("readonly ROOT_CA_CERTIFICATE_FILE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'", `readonly ROOT_CA_CERTIFICATE_FILE='${certificate}'`)
    .replace("readonly VAR_DIRECTORY='/var'", `readonly VAR_DIRECTORY='${varDirectory}'`)
    .replace("readonly VAR_LIB_DIRECTORY='/var/lib'", `readonly VAR_LIB_DIRECTORY='${varLib}'`)
    .replace("readonly ATTESTATION_PARENT='/var/lib/lemtel-platform-signer'", `readonly ATTESTATION_PARENT='${attestationParent}'`)
    .replace("readonly ATTESTATION_FILE='/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation'", `readonly ATTESTATION_FILE='${attestation}'`)
    .replace("readonly SYSTEMD_HOST_KEY_PARENT='/var/lib/systemd'", `readonly SYSTEMD_HOST_KEY_PARENT='${hostState}'`)
    .replace("readonly SYSTEMD_HOST_KEY_FILE='/var/lib/systemd/credential.secret'", `readonly SYSTEMD_HOST_KEY_FILE='${hostKey}'`);
  writeFileSync(script, rewritten, { mode: 0o700 }); chmodSync(script, 0o700);
  return { base, script, etc, parent, issuer, credential, certificate, varDirectory, varLib, attestationParent, attestation, hostState, hostKey };
}

function run(fix, extra = {}) {
  return spawnSync(fix.script, {
    encoding: 'utf8',
    env: { ...process.env, LEMTEL_HA_ROLE: 'digitalocean_writer', LEMTEL_HA_EXECUTE: 'observe_do_managed_mtls_credential_at_rest_root_only', ...extra },
  });
}

function clean(fix) { rmSync(fix.base, { recursive: true, force: true }); }

function assertNeverAuthorizes(output) {
  for (const expected of ['credential_contents_read=false', 'certificate_pem_read=false', 'private_key_material_returned=false', 'credential_encryption_format_verified=false', 'host_key_storage_protection=not_verified', 'provider_storage_encryption=not_assessable_from_guest', 'offline_attack_resistance=not_proven', 'network_contacted=false', 'cloudflare_contacted=false', 'activation_authorized=false', 'relay_authorized=false', 'ha_gate_satisfied=false']) assert.match(output, new RegExp(`^${expected}$`, 'mu'));
  assert.doesNotMatch(output, /^do_managed_mtls_storage_observation_status=complete$/mu);
}

function assertRedacted(output) {
  assert.doesNotMatch(output, /(?:fixture-encrypted-credential-content|fixture-public-certificate-content|fixture-systemd-host-key-content|sha256:[a-f0-9]{64}|managed-mtls-local-ca\.attestation|root-ca-key\.pem\.cred)/u);
}

function assertIncompleteParent(fix, directory, field) {
  chmodSync(directory, 0o777);
  const result = run(fix);
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stdout, new RegExp(`^${field}=false$`, 'mu'));
  assert.match(result.stdout, /^observation_status=local_evidence_incomplete$/mu);
  assert.match(result.stdout, /^do_managed_mtls_storage_observation_status=incomplete$/mu);
  assertNeverAuthorizes(result.stdout);
}

test('storage observer emits only redacted positive local evidence and exits as a non-authorizing gate refusal', () => {
  const fix = fixture();
  try {
    const result = run(fix);
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stdout, /^observation_status=local_evidence_positive_observation_only$/mu);
    assert.match(result.stdout, /^do_managed_mtls_storage_observation_status=observed_without_gate$/mu);
    assert.match(result.stdout, /^credential_containing_mount_dm_crypt_observed=true$/mu);
    assert.match(result.stdout, /^host_bound_claim_from_public_attestation=declared_unverified$/mu);
    assertNeverAuthorizes(result.stdout); assertRedacted(result.stdout + result.stderr);
  } finally { clean(fix); }
});

test('negative, indeterminate and malformed inputs always return distinct fail-closed statuses', () => {
  const negative = fixture();
  try {
    const result = run(negative, { MOCK_BLOCK_TYPE: 'disk' });
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stdout, /^observation_status=local_evidence_observed_negative$/mu);
    assert.match(result.stdout, /^do_managed_mtls_storage_observation_status=observed_negative$/mu);
    assert.match(result.stdout, /^credential_containing_mount_dm_crypt_observed=false$/mu);
    assertNeverAuthorizes(result.stdout);
  } finally { clean(negative); }

  const unknown = fixture();
  try {
    const result = run(unknown, { MOCK_BLOCK_TYPE: 'lvm' });
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stdout, /^observation_status=local_evidence_indeterminate$/mu);
    assert.match(result.stdout, /^do_managed_mtls_storage_observation_status=indeterminate$/mu);
    assertNeverAuthorizes(result.stdout);
  } finally { clean(unknown); }

  const overlong = fixture();
  try {
    writeFileSync(overlong.attestation, 'x'.repeat(4097), { mode: 0o644 });
    const result = run(overlong);
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stdout, /^bootstrap_public_attestation_syntax_valid=false$/mu);
    assert.match(result.stdout, /^observation_status=local_evidence_incomplete$/mu);
    assertNeverAuthorizes(result.stdout);
  } finally { clean(overlong); }

  for (const [prefix, name] of [[Buffer.from([0]), 'nul'], [Buffer.from('é'.repeat(3000)), 'utf8-overlong'], [Buffer.from([1]), 'binary-invalid']]) {
    const malformed = fixture();
    try {
      writeFileSync(malformed.attestation, Buffer.concat([prefix, readFileSync(malformed.attestation)]), { mode: 0o644 });
      const result = run(malformed);
      assert.equal(result.status, 78, `${name}: ${result.stderr}`);
      assert.match(result.stdout, /^bootstrap_public_attestation_syntax_valid=false$/mu, name);
      assert.match(result.stdout, /^observation_status=local_evidence_incomplete$/mu, name);
      assertNeverAuthorizes(result.stdout);
    } finally { clean(malformed); }
  }
});

test('observer refuses every claimed parent state and unexpected issuer entries', () => {
  for (const [property, field] of [['etc', 'etc_directory_root_owned_0755'], ['parent', 'credential_parent_root_owned_0750'], ['issuer', 'issuer_directory_root_owned_0700'], ['varDirectory', 'var_directory_root_owned_0755'], ['varLib', 'var_lib_directory_root_owned_0755'], ['attestationParent', 'attestation_parent_root_owned_0755'], ['hostState', 'systemd_host_key_parent_root_owned_0755']]) {
    const fix = fixture();
    try { assertIncompleteParent(fix, fix[property], field); } finally { clean(fix); }
  }
  const cleartext = fixture();
  try {
    writeFileSync(join(cleartext.issuer, 'unexpected-file'), 'not-a-key', { mode: 0o600 });
    const result = run(cleartext);
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stdout, /^issuer_directory_expected_contents_only=false$/mu);
    assert.match(result.stdout, /^observation_status=local_evidence_incomplete$/mu);
  } finally { clean(cleartext); }
});

test('hardlinks are reported separately from regularity and ownership before failing closed', () => {
  const hardLinked = fixture();
  try {
    linkSync(hardLinked.credential, join(hardLinked.base, 'extra-link'));
    const result = run(hardLinked);
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stdout, /^credential_regular_not_symlink=true$/mu);
    assert.match(result.stdout, /^credential_root_owned_0600=true$/mu);
    assert.match(result.stdout, /^credential_single_link=false$/mu);
    assert.match(result.stdout, /^credential_secure_metadata=false$/mu);
    assert.match(result.stdout, /^observation_status=local_evidence_incomplete$/mu);
    assertNeverAuthorizes(result.stdout);
  } finally { clean(hardLinked); }
});

test('source script itself refuses execution from a real non-root process before observation', () => {
  const result = spawnSync(sourcePath, { encoding: 'utf8', env: { ...process.env, LEMTEL_HA_ROLE: 'digitalocean_writer', LEMTEL_HA_EXECUTE: 'observe_do_managed_mtls_credential_at_rest_root_only' } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /reason=root_required/u);
});

test('storage observer refuses wrong role and token before any observation', () => {
  const fix = fixture();
  try {
    for (const [extra, reason] of [[{ LEMTEL_HA_ROLE: 'hostinger_standby' }, 'writer_role_required'], [{ LEMTEL_HA_EXECUTE: 'wrong' }, 'execution_token_required'], [{ MOCK_UID: '1000' }, 'root_required']]) {
      const result = run(fix, extra);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(reason, 'u'));
      assert.equal(result.stdout, '');
    }
  } finally { clean(fix); }
});

test('observer source has a closed read-only command surface and never reads private credential or certificate paths', () => {
  const syntax = spawnSync('/bin/bash', ['-n', sourcePath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.ok((lstatSync(sourcePath).mode & 0o111) !== 0, 'source must be executable');
  for (const expected of [
    '#!/bin/bash -p',
    "readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'",
    'unset BASH_ENV CDPATH ENV GLOBIGNORE OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES RANDFILE',
    "readonly WRITER_ROLE='digitalocean_writer'",
    "readonly OBSERVATION_TOKEN='observe_do_managed_mtls_credential_at_rest_root_only'",
    'findmnt -n -o FSTYPE --target "$ROOT_CA_KEY_CREDENTIAL"',
    'LC_ALL=C wc -c < "$ATTESTATION_FILE"',
    'LC_ALL=C od -An -v -tx1 -- "$ATTESTATION_FILE"',
    'case "$attestation_hex" in *00*) return 1 ;; esac',
    'MAX_ATTESTATION_BYTES=4096',
    'issuer_directory_contents_valid',
    'host_bound_claim=\'declared_unverified\'',
    'credential_contents_read=false',
    'host_key_storage_protection=not_verified',
    'provider_storage_encryption=not_assessable_from_guest',
    'ha_gate_satisfied=false',
    'exit 78',
  ]) assert.ok(source.includes(expected), `missing ${expected}`);
  assert.doesNotMatch(uncommented, /(?:\b(?:curl|wget|ssh|scp|rsync|doctl|cloudflared|nc|telnet|ping|openssl|systemd-creds|systemctl|umount|mkdir|touch|rm|chmod|chown|cp|mv|install|tee|dd|truncate|cat|head|tail|awk|sed|perl|python)\b|\/dev\/(?:tcp|udp)|access\/(?:certificates|apps)|load.?balancer|pg_promote|power_(?:on|off)|shutdown)/iu);
  assert.doesNotMatch(uncommented, /(?:<\s*"?\$ROOT_CA_KEY_CREDENTIAL|<\s*"?\$ROOT_CA_CERTIFICATE_FILE|\$\(<\s*"?\$ROOT_CA_KEY_CREDENTIAL|\$\(<\s*"?\$ROOT_CA_CERTIFICATE_FILE)/u);
});
