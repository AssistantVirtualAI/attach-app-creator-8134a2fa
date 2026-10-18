import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-ha-do-writer-managed-mtls-local-ca-bootstrap.sh');
const source = readFileSync(sourcePath, 'utf8');
const uncommented = source.replace(/^\s*#.*$/gmu, '');
const mode = (path) => lstatSync(path).mode & 0o777;

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function makeMocks(bin) {
  writeExecutable(join(bin, 'id'), `#!/bin/bash
if [ "$1" = '-u' ]; then printf '%s\\n' "\${MOCK_UID:-0}"; exit 0; fi
exec /usr/bin/id "$@"
`);
  writeExecutable(join(bin, 'chown'), `#!/bin/bash
printf 'chown:' >> "$MOCK_LOG"
printf '%s,' "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
[ "\${MOCK_CHOWN_FAIL:-false}" != 'true' ]
`);
  writeExecutable(join(bin, 'stat'), `#!/bin/bash
for last; do :; done
actual_mode=$(/usr/bin/stat -c '%a' -- "$last") || exit 1
actual_links=$(/usr/bin/stat -c '%h' -- "$last") || exit 1
printf '%s:%s:%s' "\${MOCK_STAT_UID:-0}" "\${MOCK_STAT_GID:-0}" "$actual_mode"
if [ "$1" = '-c' ] && [ "$2" = '%u:%g:%a:%h' ]; then printf ':%s' "$actual_links"; fi
printf '\\n'
`);
  writeExecutable(join(bin, 'openssl'), `#!/bin/bash
printf 'openssl:' >> "$MOCK_LOG"
printf '%s,' "$@" >> "$MOCK_LOG"
printf ':conf=%s:modules=%s:engines=%s:rand=%s\\n' "\${OPENSSL_CONF:-}" "\${OPENSSL_MODULES:-}" "\${OPENSSL_ENGINES:-}" "\${RANDFILE:-}" >> "$MOCK_LOG"
args=" $* "
if [ "\${MOCK_OPENSSL_FAIL:-}" = 'certificate' ] && [[ "$args" == *' -new -x509 '* ]]; then exit 1; fi
out=''
in=''
key=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -out) out="$2"; shift 2 ;;
    -in) in="$2"; shift 2 ;;
    -key) key="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ "$args" == *' -check_privatekey '* ]]; then
  [ "$(/bin/cat "$key")" = "\${MOCK_CERTIFICATE_PRIVATE_KEY_VALUE:-mock-managed-root-private-key}" ]
  exit $?
fi
if [[ "$args" == *' -outform DER '* ]]; then
  printf 'mock-der:managed-root-ca-certificate'
  exit 0
fi
[ -n "$out" ] || exit 1
case "$(basename "$out")" in
  root-ca-key.pem) artifact='mock-managed-root-private-key' ;;
  root-ca-cert.pem) artifact='mock-managed-root-public-certificate' ;;
  *) artifact='mock-local-crypto-artifact' ;;
esac
printf '%s\\n' "$artifact" > "$out"
chmod 0600 "$out"
`);
  writeExecutable(join(bin, 'systemd-creds'), `#!/bin/bash
printf 'systemd-creds:' >> "$MOCK_LOG"
printf '%s,' "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
if [ "$1" = 'decrypt' ]; then
  [ "$#" -eq 3 ] || exit 1
  [ "$(/bin/cat "$2")" = 'mock-encrypted-credential:root-ca-key.pem.cred' ] || exit 1
  printf '%s\\n' "\${MOCK_CREDENTIAL_DECRYPT_VALUE:-mock-managed-root-private-key}" > "$3"
  chmod 0600 "$3"
  exit 0
fi
if [ "\${MOCK_CREDENTIAL_FAIL:-}" = 'true' ]; then exit 1; fi
name=''
for value in "$@"; do case "$value" in --name=*) name="\${value#--name=}" ;; esac; done
for output; do :; done
printf 'mock-encrypted-credential:%s\\n' "$name" > "$output"
chmod 0600 "$output"
`);
  writeExecutable(join(bin, 'ln'), `#!/bin/bash
for last; do :; done
if [ "\${MOCK_LN_FAIL_TARGET:-}" = "$last" ]; then
  printf 'ln-failed:%s\\n' "$last" >> "$MOCK_LOG"
  exit 1
fi
exec /usr/bin/ln "$@"
`);
  writeExecutable(join(bin, 'rm'), `#!/bin/bash
for last; do :; done
if [ "\${MOCK_RM_FAIL_TARGET:-}" = "$last" ]; then
  printf 'rm-failed:%s\\n' "$last" >> "$MOCK_LOG"
  exit 1
fi
exec /bin/rm "$@"
`);
  writeExecutable(join(bin, 'findmnt'), `#!/bin/bash
printf '%s\\n' "\${MOCK_RUN_FILESYSTEM:-tmpfs}"
`);
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'lemtel-managed-ca-bootstrap-test-'));
  const bin = join(base, 'bin');
  const etc = join(base, 'etc');
  const varLib = join(base, 'var-lib');
  const run = join(base, 'run');
  const parent = join(etc, 'lemtel-platform-signer');
  const issuer = join(parent, 'managed-ca');
  const credential = join(issuer, 'root-ca-key.pem.cred');
  const certificate = join(parent, 'cloudflare-access-managed-root-ca.pem');
  const attestationParent = join(varLib, 'lemtel-platform-signer');
  const attestation = join(attestationParent, 'managed-mtls-local-ca.attestation');
  const log = join(base, 'calls.log');
  const script = join(base, 'bootstrap.sh');
  const attacker = join(base, 'attacker');
  try {
    writeFileSync(log, '');
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    mkdirSync(attacker, { recursive: true, mode: 0o700 });
    mkdirSync(etc, { recursive: true, mode: 0o755 });
    mkdirSync(varLib, { recursive: true, mode: 0o755 });
    mkdirSync(run, { recursive: true, mode: 0o755 });
    makeMocks(bin);
    const rewritten = source
      .replace("readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'", `readonly TRUSTED_PATH='${bin}:/usr/sbin:/usr/bin:/sbin:/bin'`)
      .replace("readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'", `readonly CREDENTIALS_PARENT='${parent}'`)
      .replace("readonly ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'", `readonly ISSUER_DIRECTORY='${issuer}'`)
      .replace("readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'", `readonly ROOT_CA_KEY_CREDENTIAL='${credential}'`)
      .replace("readonly ROOT_CA_CERTIFICATE_FILE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'", `readonly ROOT_CA_CERTIFICATE_FILE='${certificate}'`)
      .replace("readonly ATTESTATION_PARENT='/var/lib/lemtel-platform-signer'", `readonly ATTESTATION_PARENT='${attestationParent}'`)
      .replace("readonly ATTESTATION_FILE='/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation'", `readonly ATTESTATION_FILE='${attestation}'`)
      .replace("readonly PRIVATE_KEY_TMPFS_PARENT='/run'", `readonly PRIVATE_KEY_TMPFS_PARENT='${run}'`)
      .replace("readonly VERIFICATION_TMPFS_PARENT='/run'", `readonly VERIFICATION_TMPFS_PARENT='${run}'`)
      .replace("ensure_new_or_secure_directory '/etc' \"$CREDENTIALS_PARENT\"", `ensure_new_or_secure_directory '${etc}' \"$CREDENTIALS_PARENT\"`)
      .replace("ensure_new_or_secure_directory '/var/lib' \"$ATTESTATION_PARENT\"", `ensure_new_or_secure_directory '${varLib}' \"$ATTESTATION_PARENT\"`);
    writeFileSync(script, rewritten, { mode: 0o700 });
    chmodSync(script, 0o700);
    return { base, bin, script, log, attacker, parent, issuer, credential, certificate, attestationParent, attestation, run };
  } catch (error) {
    rmSync(base, { recursive: true, force: true });
    throw error;
  }
}

function run(fix, execute, extra = {}) {
  return spawnSync(fix.script, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fix.attacker}:${fix.bin}:${process.env.PATH}`,
      MOCK_LOG: fix.log,
      LEMTEL_HA_ROLE: 'digitalocean_writer',
      LEMTEL_HA_EXECUTE: execute,
      ...extra,
    },
  });
}

function clean(fix) { rmSync(fix.base, { recursive: true, force: true }); }
function regularSingleLink(path) { return lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).nlink === 1; }

test('durable local CA bootstrap persists only an encrypted host-bound root key, public certificate, and public attestation', () => {
  const fix = fixture();
  try {
    const bashEnvironment = join(fix.attacker, 'bash-environment');
    const poisonMarker = join(fix.attacker, 'bash-environment-executed');
    writeFileSync(bashEnvironment, 'case "$0" in *bootstrap.sh) printf hostile > "$POISON_MARKER" ;; esac\n', { mode: 0o600 });
    const result = run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only', { OPENSSL_CONF: 'hostile', OPENSSL_MODULES: 'hostile', OPENSSL_ENGINES: 'hostile', RANDFILE: 'hostile', BASH_ENV: bashEnvironment, POISON_MARKER: poisonMarker, 'BASH_FUNC_openssl%%': '() { exit 99; }' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(poisonMarker), false);
    for (const state of ['root_ca_key_credential_encrypted_root_only', 'root_ca_key_credential_host_bound', 'root_ca_public_certificate_available', 'public_attestation_valid']) assert.match(result.stdout, new RegExp(`^${state}=true$`, 'mu'));
    assert.match(result.stdout, /^bootstrap_action=created$/mu);
    assert.match(result.stdout, /^root_ca_private_key_cleartext_persisted=false$/mu);
    for (const state of ['network_contacted', 'provider_contacted', 'cloudflare_contacted', 'cloudflare_access_imported', 'leaf_certificate_issued', 'service_auth_policy_configured', 'systemd_daemon_reloaded', 'service_enabled', 'service_started', 'timer_enabled', 'routes_changed', 'runtime_started', 'promotion_executed', 'fencing_executed', 'failover_executed', 'telephony_contacted']) assert.match(result.stdout, new RegExp(`^${state}=false$`, 'mu'));
    assert.doesNotMatch(result.stdout + result.stderr, /(?:BEGIN|PRIVATE KEY|mock-managed-root-private-key|[0-9a-f]{64})/u);
    assert.equal(mode(fix.parent), 0o750);
    assert.equal(mode(fix.issuer), 0o700);
    assert.deepEqual(readdirSync(fix.parent).sort(), [basename(fix.certificate), basename(fix.issuer)].sort());
    assert.deepEqual(readdirSync(fix.issuer), [basename(fix.credential)]);
    for (const path of [fix.credential, fix.certificate, fix.attestation]) assert.ok(regularSingleLink(path), path);
    assert.equal(mode(fix.credential), 0o600);
    assert.match(readFileSync(fix.credential, 'utf8'), /^mock-encrypted-credential:root-ca-key\.pem\.cred\n$/u);
    assert.doesNotMatch(readFileSync(fix.credential, 'utf8'), /(?:PRIVATE KEY|mock-managed-root-private-key)/u);
    assert.equal(mode(fix.certificate), 0o644);
    assert.equal(readFileSync(fix.certificate, 'utf8'), 'mock-managed-root-public-certificate\n');
    const attestation = readFileSync(fix.attestation, 'utf8');
    assert.match(attestation, /^format=lemtel_do_managed_mtls_local_ca_bootstrap_attestation_v1$/mu);
    assert.match(attestation, /^issuer_type=local_root_only_encrypted_systemd_credential_host_bound$/mu);
    assert.match(attestation, /^root_ca_certificate_sha256=sha256:[a-f0-9]{64}$/mu);
    assert.match(attestation, /^root_ca_private_key_cleartext_persisted=false$/mu);
    assert.match(attestation, /^cloudflare_access_imported=false$/mu);
    assert.match(attestation, /^leaf_certificate_issued=false$/mu);
    assert.match(attestation, /^service_auth_policy_configured=false$/mu);
    assert.doesNotMatch(attestation, /(?:BEGIN|PRIVATE KEY|mock-managed-root-private-key|mock-managed-root-public-certificate|mock-encrypted-credential)/u);
    const calls = readFileSync(fix.log, 'utf8');
    assert.match(calls, /chown:root:root,--,/u);
    assert.match(calls, /openssl:ecparam,-name,prime256v1,-genkey,/u);
    assert.match(calls, /openssl:req,-new,-x509,/u);
    assert.match(calls, /systemd-creds:encrypt,--with-key=host,--name=root-ca-key\.pem\.cred,/u);
    assert.match(calls, /systemd-creds:decrypt,/u);
    assert.match(calls, /openssl:x509,-in,.*-check_privatekey,-noout,-key,/u);
    assert.deepEqual(readdirSync(fix.run), []);
    assert.doesNotMatch(calls, /(?:conf=hostile|modules=hostile|engines=hostile|rand=hostile)/u);
  } finally { clean(fix); }
});

test('re-execution is a validated no-op while partial, corrupt, linked, symlinked, wrong-role, and non-root states fail closed', () => {
  const fix = fixture();
  try {
    assert.equal(run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only').status, 0);
    const before = [readFileSync(fix.credential, 'utf8'), readFileSync(fix.certificate, 'utf8'), readFileSync(fix.attestation, 'utf8')];
    writeFileSync(fix.log, '');
    const again = run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^bootstrap_action=already_complete$/mu);
    assert.deepEqual([readFileSync(fix.credential, 'utf8'), readFileSync(fix.certificate, 'utf8'), readFileSync(fix.attestation, 'utf8')], before);
    const noOpCalls = readFileSync(fix.log, 'utf8');
    assert.match(noOpCalls, /openssl:x509,-in,/u);
    assert.match(noOpCalls, /systemd-creds:decrypt,/u);
    assert.doesNotMatch(noOpCalls, /(?:systemd-creds:encrypt|openssl:ecparam|openssl:req,-new,-x509)/u);
    assert.deepEqual(readdirSync(fix.run), []);
    writeFileSync(fix.credential, 'arbitrary-root-only-file\n'); chmodSync(fix.credential, 0o600);
    const arbitrary = run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only');
    assert.notEqual(arbitrary.status, 0);
    assert.match(arbitrary.stderr, /existing_state_incomplete_or_corrupt/u);
    assert.doesNotMatch(arbitrary.stdout, /(?:bootstrap_action=already_complete|do_managed_mtls_local_ca_bootstrap_status=complete)/u);
    assert.deepEqual(readdirSync(fix.run), []);
    writeFileSync(fix.credential, before[0]); chmodSync(fix.credential, 0o600);
    const mismatched = run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only', { MOCK_CREDENTIAL_DECRYPT_VALUE: 'mock-different-private-key' });
    assert.notEqual(mismatched.status, 0);
    assert.match(mismatched.stderr, /existing_state_incomplete_or_corrupt/u);
    assert.doesNotMatch(mismatched.stdout, /(?:bootstrap_action=already_complete|do_managed_mtls_local_ca_bootstrap_status=complete)/u);
    assert.deepEqual(readdirSync(fix.run), []);
    const nonTmpfs = run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only', { MOCK_RUN_FILESYSTEM: 'ext4' });
    assert.notEqual(nonTmpfs.status, 0);
    assert.match(nonTmpfs.stderr, /existing_state_incomplete_or_corrupt/u);
    assert.doesNotMatch(nonTmpfs.stdout, /(?:bootstrap_action=already_complete|do_managed_mtls_local_ca_bootstrap_status=complete)/u);
    assert.deepEqual(readdirSync(fix.run), []);
    writeFileSync(fix.attestation, 'corrupt\n');
    const corrupt = run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only');
    assert.notEqual(corrupt.status, 0);
    assert.match(corrupt.stderr, /existing_state_incomplete_or_corrupt/u);
  } finally { clean(fix); }

  for (const kind of ['certificate', 'attestation']) {
    const linked = fixture();
    try {
      mkdirSync(linked.parent, { recursive: true, mode: 0o750 });
      mkdirSync(linked.attestationParent, { recursive: true, mode: 0o755 });
      const target = kind === 'certificate' ? linked.certificate : linked.attestation;
      const attacker = join(linked.base, `${kind}-attacker`);
      writeFileSync(attacker, 'attacker');
      symlinkSync(attacker, target);
      const result = run(linked, 'bootstrap_do_managed_mtls_local_ca_root_only');
      assert.notEqual(result.status, 0);
      assert.equal(readlinkSync(target), attacker);
    } finally { clean(linked); }
  }

  const partial = fixture();
  try {
    mkdirSync(partial.parent, { recursive: true, mode: 0o750 });
    writeFileSync(partial.certificate, 'partial'); chmodSync(partial.certificate, 0o644);
    const result = run(partial, 'bootstrap_do_managed_mtls_local_ca_root_only');
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(partial.certificate, 'utf8'), 'partial');
  } finally { clean(partial); }

  const gate = fixture();
  try {
    for (const extra of [{ LEMTEL_HA_ROLE: 'hostinger_standby' }, { MOCK_UID: '1000' }, { LEMTEL_HA_EXECUTE: 'wrong' }]) {
      const result = run(gate, extra.LEMTEL_HA_EXECUTE ?? 'bootstrap_do_managed_mtls_local_ca_root_only', extra);
      assert.notEqual(result.status, 0);
      assert.ok(!existsSync(gate.certificate));
    }
  } finally { clean(gate); }
});

test('diagnostic returns only metadata and neither reads the credential nor the public certificate', () => {
  const fix = fixture();
  try {
    assert.equal(run(fix, 'bootstrap_do_managed_mtls_local_ca_root_only').status, 0);
    writeFileSync(fix.log, '');
    const result = run(fix, 'diagnose_do_managed_mtls_local_ca_root_only');
    assert.equal(result.status, 0, result.stderr);
    for (const state of ['issuer_directory_root_only', 'root_ca_key_credential_root_only', 'root_ca_public_certificate_root_owned_0644', 'public_attestation_valid']) assert.match(result.stdout, new RegExp(`^${state}=true$`, 'mu'));
    for (const state of ['root_ca_certificate_pem_read', 'root_ca_certificate_pem_returned', 'root_ca_key_credential_contents_read', 'private_key_content_returned', 'network_contacted', 'provider_contacted', 'cloudflare_contacted', 'service_state_read']) assert.match(result.stdout, new RegExp(`^${state}=false$`, 'mu'));
    assert.doesNotMatch(result.stdout, /(?:BEGIN|PRIVATE KEY|mock-managed-root-private-key|mock-managed-root-public-certificate|mock-encrypted-credential|[0-9a-f]{64})/u);
    assert.equal(readFileSync(fix.log, 'utf8'), '');
    const diagnosticSource = source.slice(source.indexOf('diagnose() {'), source.indexOf('\ntrap cleanup EXIT'));
    assert.doesNotMatch(diagnosticSource, /(?:\bopenssl\b|\bsystemd-creds\b|<\s*"\$ROOT_CA_CERTIFICATE_FILE"|<\s*"\$ROOT_CA_KEY_CREDENTIAL")/u);
  } finally { clean(fix); }
});

test('credential failure and late link failure leave no usable CA material; rollback failure is explicit and never successful', () => {
  const failed = fixture();
  try {
    const result = run(failed, 'bootstrap_do_managed_mtls_local_ca_root_only', { MOCK_CREDENTIAL_FAIL: 'true' });
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(failed.issuer));
    assert.ok(!existsSync(failed.certificate));
    assert.ok(!existsSync(failed.attestation));
  } finally { clean(failed); }

  const late = fixture();
  try {
    const result = run(late, 'bootstrap_do_managed_mtls_local_ca_root_only', { MOCK_LN_FAIL_TARGET: late.attestation });
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(late.credential));
    assert.ok(!existsSync(late.certificate));
    assert.ok(!existsSync(late.attestation));
    assert.ok(!existsSync(late.issuer));
    assert.ok(!existsSync(late.attestationParent));
  } finally { clean(late); }

  const incomplete = fixture();
  try {
    const result = run(incomplete, 'bootstrap_do_managed_mtls_local_ca_root_only', { MOCK_LN_FAIL_TARGET: incomplete.attestation, MOCK_RM_FAIL_TARGET: incomplete.certificate });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^rollback_cleanup_incomplete=true$/mu);
    assert.match(result.stderr, /^rollback_step=root_ca_certificate_output$/mu);
    assert.doesNotMatch(result.stdout, /^do_managed_mtls_local_ca_bootstrap_status=complete$/mu);
    assert.ok(existsSync(incomplete.certificate));
  } finally { clean(incomplete); }
});

test('source uses a trusted environment and has no network, Access mutation, leaf issuance, service, routing, or failover command surface', () => {
  const syntax = spawnSync('/bin/bash', ['-n', sourcePath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.ok((lstatSync(sourcePath).mode & 0o111) !== 0, 'source must be executable');
  for (const expected of [
    '#!/bin/bash -p',
    "readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'",
    "readonly PRIVATE_KEY_TMPFS_PARENT='/run'",
    'secure_tmpfs_parent "$PRIVATE_KEY_TMPFS_PARENT" || fail private_key_tmpfs_required',
    'mktemp -d "$PRIVATE_KEY_TMPFS_PARENT/lemtel-managed-mtls-ca-bootstrap.XXXXXX"',
    'export PATH="$TRUSTED_PATH"',
    'unset BASH_ENV CDPATH ENV GLOBIGNORE OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES RANDFILE',
    "readonly WRITER_ROLE='digitalocean_writer'",
    "readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'",
    "readonly ROOT_CA_CERTIFICATE_FILE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'",
    'systemd-creds encrypt --with-key=host --name=root-ca-key.pem.cred',
    'systemd-creds decrypt "$ROOT_CA_KEY_CREDENTIAL" "$VERIFICATION_PRIVATE_KEY_FILE"',
    'openssl x509 -in "$ROOT_CA_CERTIFICATE_FILE" -check_privatekey -noout -key "$VERIFICATION_PRIVATE_KEY_FILE"',
    'findmnt -n -o FSTYPE --target "$path"',
    'report_bootstrap_state already_complete',
    'rollback_cleanup_incomplete=true',
    'cloudflare_access_imported=false',
    'leaf_certificate_issued=false',
    'service_auth_policy_configured=false',
  ]) assert.ok(source.includes(expected), `missing ${expected}`);
  assert.doesNotMatch(source, /(?:\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|\bdoctl\b|\bcloudflared\b|\bnc\b|\btelnet\b|\bping\b)/iu);
  assert.doesNotMatch(uncommented, /(?:\bsystemctl\b|\bdaemon-reload\b|\bservice\s+(?:start|restart|enable)\b|\baccess\/certificates\b|\baccess\/apps\b|\bclient-certificates\b|\bissue[_ -]?leaf\b|\bopenssl\s+x509\s+-req\b|\bload.?balancer\b|\btelephony\b|\bplanipret\b|\bfusionpbx\b)/iu);
});
