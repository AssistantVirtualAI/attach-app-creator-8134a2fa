import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-ha-do-writer-signer-mtls-relay-root-only-bootstrap.sh');
const contractPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/mtls-relay-contract.json');
const source = readFileSync(sourcePath, 'utf8');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const uncommented = source.replace(/^\s*#.*$/gmu, '');

const mode = (path) => lstatSync(path).mode & 0o777;
const privateCredentialNames = ['client-cert.pem.cred', 'client-key.pem.cred'];

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function makeMocks(bin) {
  writeExecutable(join(bin, 'id'), `#!/usr/bin/env bash
if [ "$1" = '-u' ]; then printf '0\\n'; exit 0; fi
exec /usr/bin/id "$@"
`);
  writeExecutable(join(bin, 'chown'), `#!/usr/bin/env bash
printf 'chown\\n' >> "$MOCK_LOG"
exit 0
`);
  writeExecutable(join(bin, 'stat'), `#!/usr/bin/env bash
for last; do :; done
actual_mode=$(/usr/bin/stat -c '%a' -- "$last") || exit 1
printf '%s:%s:%s' "\${MOCK_STAT_UID:-0}" "\${MOCK_STAT_GID:-0}" "$actual_mode"
if [ "$1" = '-c' ] && [ "$2" = '%u:%g:%a:%h' ]; then printf ':1'; fi
printf '\\n'
`);
  writeExecutable(join(bin, 'openssl'), `#!/usr/bin/env bash
printf 'openssl:' >> "$MOCK_LOG"
printf '%s,' "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
args=" $* "
if [ "\${MOCK_OPENSSL_FAIL:-}" = 'leaf-sign' ] && [[ "$args" == *' -req '* ]]; then exit 1; fi
out=''
in=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -out) out="$2"; shift 2 ;;
    -in) in="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ "$args" == *' -outform DER '* ]]; then
  printf 'mock-der:%s' "$(basename "$in")"
  exit 0
fi
[ -n "$out" ] || exit 1
printf 'mock-local-crypto-artifact\\n' > "$out"
chmod 0600 "$out"
`);
  writeExecutable(join(bin, 'systemd-creds'), `#!/usr/bin/env bash
printf 'systemd-creds:' >> "$MOCK_LOG"
printf '%s,' "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
name=''
for value in "$@"; do case "$value" in --name=*) name="\${value#--name=}" ;; esac; done
for output; do :; done
printf 'mock-encrypted-credential:%s\\n' "$name" > "$output"
chmod 0600 "$output"
`);
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'lemtel-mtls-bootstrap-test-'));
  const bin = join(base, 'bin');
  const etc = join(base, 'etc');
  const varLib = join(base, 'var-lib');
  const credentialsParent = join(etc, 'lemtel-platform-signer');
  const credentials = join(credentialsParent, 'credentials');
  const attestationParent = join(varLib, 'lemtel-platform-signer');
  const attestation = join(attestationParent, 'mtls-root-only-bootstrap.attestation');
  const log = join(base, 'calls.log');
  const script = join(base, 'bootstrap.sh');
  try {
    writeFileSync(log, '');
    for (const path of [bin, etc, varLib]) {
      rmSync(path, { recursive: true, force: true });
      // mkdirSync is intentionally late-bound to keep fixture setup compact below.
    }
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    mkdirSync(etc, { recursive: true, mode: 0o755 });
    mkdirSync(varLib, { recursive: true, mode: 0o755 });
    makeMocks(bin);
    const rewritten = source
      .replace("readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'", `readonly CREDENTIALS_PARENT='${credentialsParent}'`)
      .replace("readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'", `readonly CREDENTIALS_DIRECTORY='${credentials}'`)
      .replace("readonly CLIENT_CERTIFICATE_SOURCE='/etc/lemtel-platform-signer/credentials/client-cert.pem.cred'", `readonly CLIENT_CERTIFICATE_SOURCE='${join(credentials, 'client-cert.pem.cred')}'`)
      .replace("readonly CLIENT_KEY_SOURCE='/etc/lemtel-platform-signer/credentials/client-key.pem.cred'", `readonly CLIENT_KEY_SOURCE='${join(credentials, 'client-key.pem.cred')}'`)
      .replace("readonly ATTESTATION_PARENT='/var/lib/lemtel-platform-signer'", `readonly ATTESTATION_PARENT='${attestationParent}'`)
      .replace("readonly ATTESTATION_FILE='/var/lib/lemtel-platform-signer/mtls-root-only-bootstrap.attestation'", `readonly ATTESTATION_FILE='${attestation}'`)
      .replace("ensure_new_or_secure_directory '/etc' \"$CREDENTIALS_PARENT\"", `ensure_new_or_secure_directory '${etc}' \"$CREDENTIALS_PARENT\"`)
      .replace("ensure_new_or_secure_directory '/var/lib' \"$ATTESTATION_PARENT\"", `ensure_new_or_secure_directory '${varLib}' \"$ATTESTATION_PARENT\"`);
    writeFileSync(script, rewritten, { mode: 0o700 });
    chmodSync(script, 0o700);
    return { base, bin, script, log, credentialsParent, credentials, attestationParent, attestation };
  } catch (error) {
    rmSync(base, { recursive: true, force: true });
    throw error;
  }
}

function run(fix, execute, extra = {}) {
  return spawnSync('bash', [fix.script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fix.bin}:${process.env.PATH}`,
      MOCK_LOG: fix.log,
      LEMTEL_HA_ROLE: 'digitalocean_writer',
      LEMTEL_HA_EXECUTE: execute,
      ...extra,
    },
  });
}

function clean(fix) {
  rmSync(fix.base, { recursive: true, force: true });
}

test('root-only mTLS bootstrap creates only encrypted leaf sources and a public attestation with mocked local crypto', () => {
  const fix = fixture();
  try {
    const result = run(fix, 'bootstrap_do_signer_mtls_relay_root_only');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /credential_sources_written=true/);
    assert.match(result.stdout, /root_ca_private_key_destroyed=true/);
    assert.match(result.stdout, /temporary_files_destroyed=true/);
    assert.doesNotMatch(result.stdout + result.stderr, /(?:BEGIN|PRIVATE KEY|bootstrap_do_signer_mtls_relay_root_only|[0-9a-f]{64})/u);

    assert.equal(mode(fix.credentialsParent), 0o750);
    assert.equal(mode(fix.credentials), 0o700);
    assert.deepEqual(readdirSync(fix.credentialsParent), ['credentials']);
    assert.deepEqual(readdirSync(fix.credentials).sort(), privateCredentialNames);
    for (const name of privateCredentialNames) {
      const path = join(fix.credentials, name);
      assert.ok(lstatSync(path).isFile());
      assert.ok(!lstatSync(path).isSymbolicLink());
      assert.equal(mode(path), 0o600);
      assert.doesNotMatch(readFileSync(path, 'utf8'), /(?:BEGIN|PRIVATE KEY|CERTIFICATE)/u);
    }
    assert.ok(lstatSync(fix.attestation).isFile());
    assert.ok(!lstatSync(fix.attestation).isSymbolicLink());
    assert.equal(mode(fix.attestation), 0o644);
    const attestation = readFileSync(fix.attestation, 'utf8');
    assert.match(attestation, /^root_ca_certificate_sha256=sha256:[a-f0-9]{64}$/mu);
    assert.match(attestation, /^leaf_certificate_sha256=sha256:[a-f0-9]{64}$/mu);
    assert.match(attestation, /^leaf_common_name=lemtel-do-signer-mtls-relay$/mu);
    assert.doesNotMatch(attestation, /(?:BEGIN|PRIVATE KEY|mock-local-crypto-artifact)/u);
    assert.deepEqual(readdirSync(fix.attestationParent).sort(), [basename(fix.attestation)]);
    assert.ok(!readdirSync(fix.credentials, { withFileTypes: true }).some((entry) => entry.name.startsWith('.mtls-bootstrap.')));

    const calls = readFileSync(fix.log, 'utf8');
    assert.match(calls, /openssl:ecparam,-name,prime256v1,-genkey,/u);
    assert.match(calls, /openssl:req,-new,-x509,/u);
    assert.match(calls, /openssl:x509,-req,/u);
    assert.match(calls, /systemd-creds:encrypt,--name=client-cert\.pem,/u);
    assert.match(calls, /systemd-creds:encrypt,--name=client-key\.pem,/u);
  } finally {
    clean(fix);
  }
});

test('public-only diagnostic returns attested fingerprints and metadata states without reading credential contents', () => {
  const fix = fixture();
  try {
    assert.equal(run(fix, 'bootstrap_do_signer_mtls_relay_root_only').status, 0);
    writeFileSync(fix.log, '');
    const result = run(fix, 'diagnose_do_signer_mtls_relay_root_only');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^credential_directory_root_only=true$/mu);
    assert.match(result.stdout, /^client_certificate_source_root_only=true$/mu);
    assert.match(result.stdout, /^client_key_source_root_only=true$/mu);
    assert.match(result.stdout, /^public_attestation_valid=true$/mu);
    assert.match(result.stdout, /^root_ca_certificate_fingerprint=sha256:[a-f0-9]{64}$/mu);
    assert.match(result.stdout, /^leaf_certificate_fingerprint=sha256:[a-f0-9]{64}$/mu);
    assert.match(result.stdout, /^credential_contents_read=false$/mu);
    assert.match(result.stdout, /^private_key_content_returned=false$/mu);
    assert.doesNotMatch(result.stdout, /(?:BEGIN|mock-encrypted-credential|lemtel-do-signer-mtls-relay)/u);
    assert.equal(readFileSync(fix.log, 'utf8'), '');

    chmodSync(join(fix.credentials, 'client-key.pem.cred'), 0o644);
    const unsafe = run(fix, 'diagnose_do_signer_mtls_relay_root_only');
    assert.equal(unsafe.status, 0, unsafe.stderr);
    assert.match(unsafe.stdout, /^client_key_source_root_only=false$/mu);

    const wrongOwner = run(fix, 'diagnose_do_signer_mtls_relay_root_only', { MOCK_STAT_UID: '1000' });
    assert.equal(wrongOwner.status, 0, wrongOwner.stderr);
    assert.match(wrongOwner.stdout, /^credential_directory_root_only=false$/mu);
    assert.match(wrongOwner.stdout, /^public_attestation_valid=false$/mu);
  } finally {
    clean(fix);
  }
});

test('token gate, symlink rejection, and crypto failure leave no usable credential output or temporary CA material', () => {
  const denied = fixture();
  try {
    const result = run(denied, 'incorrect-token-value');
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /incorrect-token-value/u);
    assert.ok(!existsSync(denied.credentials));
    assert.ok(!existsSync(denied.attestation));
  } finally {
    clean(denied);
  }

  const linked = fixture();
  try {
    mkdirSync(linked.credentialsParent, { recursive: true, mode: 0o750 });
    const attacker = join(linked.base, 'attacker');
    mkdirSync(attacker, { recursive: true, mode: 0o700 });
    symlinkSync(attacker, linked.credentials);
    const result = run(linked, 'bootstrap_do_signer_mtls_relay_root_only');
    assert.notEqual(result.status, 0);
    assert.equal(readlinkSync(linked.credentials), attacker);
    assert.deepEqual(readdirSync(attacker), []);
  } finally {
    clean(linked);
  }

  const failed = fixture();
  try {
    const result = run(failed, 'bootstrap_do_signer_mtls_relay_root_only', { MOCK_OPENSSL_FAIL: 'leaf-sign' });
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(failed.credentials));
    assert.deepEqual(readdirSync(failed.credentials), []);
    assert.ok(!existsSync(failed.attestation));
    assert.deepEqual(readdirSync(failed.attestationParent), []);
    assert.doesNotMatch(result.stdout + result.stderr, /(?:BEGIN|PRIVATE KEY|mock-local-crypto-artifact)/u);
  } finally {
    clean(failed);
  }
});

test('bootstrap source has a fixed P-256 client identity and contains no network, upload, service activation, failover, or telephony command surface', () => {
  const syntax = spawnSync('bash', ['-n', sourcePath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  for (const expected of [
    "readonly WRITER_ROLE='digitalocean_writer'",
    "readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'",
    "readonly CLIENT_CERTIFICATE_SOURCE='/etc/lemtel-platform-signer/credentials/client-cert.pem.cred'",
    "readonly CLIENT_KEY_SOURCE='/etc/lemtel-platform-signer/credentials/client-key.pem.cred'",
    "readonly CLIENT_COMMON_NAME='lemtel-do-signer-mtls-relay'",
    "readonly ROOT_CA_COMMON_NAME='Lemtel DO ephemeral mTLS root CA'",
    "readonly BOOTSTRAP_TOKEN='bootstrap_do_signer_mtls_relay_root_only'",
    'openssl ecparam -name prime256v1 -genkey',
    'systemd-creds encrypt --name=client-cert.pem',
    'systemd-creds encrypt --name=client-key.pem',
    'trap cleanup EXIT',
    'root_ca_private_key_destroyed=true',
    'do_signer_mtls_relay_root_only_diagnostic_format=',
  ]) assert.ok(source.includes(expected), `missing ${expected}`);
  assert.equal(contract.root_only_credential_bootstrap.root_required, true);
  assert.equal(contract.root_only_credential_bootstrap.root_ca_ephemeral, true);
  assert.equal(contract.root_only_credential_bootstrap.client_key_algorithm, 'P-256');
  assert.equal(contract.root_only_credential_bootstrap.client_common_name_exact, 'lemtel-do-signer-mtls-relay');
  assert.deepEqual(contract.root_only_credential_bootstrap.credential_source_files, privateCredentialNames);
  for (const state of ['network_contacted', 'provider_contacted', 'cloudflare_contacted', 'ca_uploaded', 'systemd_daemon_reload', 'service_enablement', 'service_start', 'timer_enablement', 'routing_change', 'runtime_start', 'promotion', 'fencing', 'failover', 'telephony_contacted']) {
    assert.equal(contract.root_only_credential_bootstrap[state], false, `${state} must stay false`);
  }
  assert.doesNotMatch(source, /(?:\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|\bdoctl\b|\bcloudflared\b|\bnc\b|\btelnet\b|\bping\b)/iu);
  assert.doesNotMatch(uncommented, /(?:\bsystemctl\b|\bdaemon-reload\b|\bservice\s+(?:start|restart|enable)\b|\b(?:start|enable|reload)-unit\b)/iu);
  assert.doesNotMatch(uncommented, /(?:\bupload\b|\bfencing\b|\bpromotion\b|\bfailover\b|\btelephony\b|\bpbx\b|\bplanipret\b|\bfusionpbx\b)/iu);
});
