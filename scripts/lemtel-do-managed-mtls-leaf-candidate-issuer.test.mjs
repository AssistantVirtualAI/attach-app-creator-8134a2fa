import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-ha-do-writer-managed-mtls-leaf-candidate-issuer.sh');
const source = readFileSync(sourcePath, 'utf8');
const uncommented = source.replace(/^\s*#.*$/gmu, '');
const mode = (path) => lstatSync(path).mode & 0o777;
const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function executable(path, contents) { writeFileSync(path, contents, { mode: 0o700 }); chmodSync(path, 0o700); }

function mocks(bin) {
  executable(join(bin, 'id'), '#!/bin/bash\n[ "$1" = "-u" ] && { printf "%s\\n" "${MOCK_UID:-0}"; exit 0; }; exec /usr/bin/id "$@"\n');
  executable(join(bin, 'stat'), '#!/bin/bash\nfor last; do :; done\nmode=$(/usr/bin/stat -c %a -- "$last") || exit 1\nlinks=$(/usr/bin/stat -c %h -- "$last") || exit 1\nprintf "0:0:%s" "$mode"\n[ "$2" = "%u:%g:%a:%h" ] && printf ":%s" "$links"\nprintf "\\n"\n');
  executable(join(bin, 'chown'), '#!/bin/bash\nexit 0\n');
  executable(join(bin, 'findmnt'), '#!/bin/bash\nprintf "%s\\n" "${MOCK_RUN_FILESYSTEM:-tmpfs}"\n');
  executable(join(bin, 'systemd-creds'), `#!/bin/bash
	if [ "$1" = decrypt ]; then
	  [ "\${MOCK_CREDENTIAL_FAIL:-false}" != true ] || exit 1
	  printf 'opaque-root-material\n' > "$3"; chmod 0600 "$3"; exit 0
	fi
	[ "\${MOCK_CREDENTIAL_FAIL:-false}" != true ] || exit 1
	name=''; for value in "$@"; do case "$value" in --name=*) name="\${value#--name=}";; esac; done
for output; do :; done
printf 'opaque-credential:%s\\n' "$name" > "$output"; chmod 0600 "$output"
`);
  executable(join(bin, 'openssl'), `#!/bin/bash
args=" $* "
if [[ "$args" == *' -outform DER '* ]]; then
  if [[ "$args" == *' pkey '* ]]; then
    if [[ "$args" == *' -pubin '* ]]; then cat; else printf 'mock-root-public-key'; fi
    exit 0
  fi
  in=''; while [ "$#" -gt 0 ]; do case "$1" in -in) in="$2"; shift 2;; *) shift;; esac; done
  printf 'mock-der:%s' "$(basename "$in")"; exit 0
fi
if [[ "$args" == *' -pubkey -noout '* ]]; then [ "\${MOCK_KEY_MATCH:-true}" = true ] || exit 1; printf 'mock-root-public-key'; exit 0; fi
	if [[ "$args" == *' -noout -serial '* ]]; then printf 'serial=%s\n' 'aabbccddeeff00112233445566778899'; exit 0; fi
	[ "\${MOCK_OPENSSL_FAIL:-false}" != true ] || exit 1
out=''; while [ "$#" -gt 0 ]; do case "$1" in -out) out="$2"; shift 2;; *) shift;; esac; done
[ -n "$out" ] || exit 1
printf 'opaque-crypto:%s\\n' "$(basename "$out")" > "$out"; chmod 0600 "$out"
`);
}

function fixture({ authorize = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'lemtel-leaf-candidate-test-'));
  const bin = join(base, 'bin'); const etc = join(base, 'etc'); const state = join(base, 'state'); const run = join(base, 'run');
  const parent = join(etc, 'lemtel-platform-signer'); const managed = join(parent, 'managed-ca'); const candidates = join(parent, 'managed-mtls-leaf-candidates');
  const credential = join(managed, 'root-ca-key.pem.cred'); const certificate = join(parent, 'cloudflare-access-managed-root-ca.pem'); const rootAttestation = join(state, 'managed-mtls-local-ca.attestation'); const lock = join(state, 'managed-mtls-leaf-candidate.lock'); const script = join(base, 'issuer.sh');
  try {
    for (const path of [bin, etc, state, run]) mkdirSync(path, { recursive: true, mode: 0o755 });
    mocks(bin); mkdirSync(parent, { mode: 0o750 }); mkdirSync(managed, { mode: 0o700 });
    writeFileSync(credential, 'opaque-root-credential\n', { mode: 0o600 }); chmodSync(credential, 0o600);
    writeFileSync(certificate, 'opaque-root-public\n', { mode: 0o644 }); chmodSync(certificate, 0o644);
    const rootFingerprint = sha('mock-der:cloudflare-access-managed-root-ca.pem');
    writeFileSync(rootAttestation, [
      'format=lemtel_do_managed_mtls_local_ca_bootstrap_attestation_v1',
      'issuer_type=local_root_only_encrypted_systemd_credential_host_bound',
      `root_ca_certificate_sha256=${rootFingerprint}`,
      `root_ca_certificate_file=${certificate}`,
      'root_ca_certificate_persisted=true', 'root_ca_certificate_mode=0644', 'root_ca_certificate_root_owned=true',
      `root_ca_key_credential_file=${credential}`, 'root_ca_key_credential_root_only=true', 'root_ca_private_key_cleartext_persisted=false',
      'cloudflare_access_imported=false', 'leaf_certificate_issued=false', 'service_auth_policy_configured=false', 'local_relay_activated=false',
    ].join('\n') + '\n', { mode: 0o644 }); chmodSync(rootAttestation, 0o644);
    let rewritten = source
      .replace("readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'", `readonly TRUSTED_PATH='${bin}:/usr/sbin:/usr/bin:/sbin:/bin'`)
      .replace("readonly CANDIDATE_ISSUANCE_AUTHORIZED='false'", `readonly CANDIDATE_ISSUANCE_AUTHORIZED='${authorize ? 'true' : 'false'}'`)
      .replace("readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'", `readonly CREDENTIALS_PARENT='${parent}'`)
      .replace("readonly ROOT_ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'", `readonly ROOT_ISSUER_DIRECTORY='${managed}'`)
      .replace("readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'", `readonly ROOT_CA_KEY_CREDENTIAL='${credential}'`)
      .replace("readonly ROOT_CA_CERTIFICATE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'", `readonly ROOT_CA_CERTIFICATE='${certificate}'`)
      .replace("readonly ROOT_CA_ATTESTATION='/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation'", `readonly ROOT_CA_ATTESTATION='${rootAttestation}'`)
      .replace("readonly CANDIDATES_DIRECTORY='/etc/lemtel-platform-signer/managed-mtls-leaf-candidates'", `readonly CANDIDATES_DIRECTORY='${candidates}'`)
      .replace("readonly STATE_PARENT='/var/lib/lemtel-platform-signer'", `readonly STATE_PARENT='${state}'`)
      .replace("readonly LOCK_FILE='/var/lib/lemtel-platform-signer/managed-mtls-leaf-candidate.lock'", `readonly LOCK_FILE='${lock}'`)
      .replace("readonly PRIVATE_TMPFS_PARENT='/run'", `readonly PRIVATE_TMPFS_PARENT='${run}'`)
      .replace("ensure_new_or_secure_directory \"$CREDENTIALS_PARENT\" \"$CANDIDATES_DIRECTORY\"", `ensure_new_or_secure_directory '${parent}' \"$CANDIDATES_DIRECTORY\"`);
    writeFileSync(script, rewritten, { mode: 0o700 }); chmodSync(script, 0o700);
    return { base, bin, state, run, parent, managed, candidates, credential, certificate, rootAttestation, lock, script };
  } catch (error) { rmSync(base, { recursive: true, force: true }); throw error; }
}

function run(fix, extra = {}) {
  return spawnSync(fix.script, { encoding: 'utf8', env: { ...process.env, PATH: `${fix.bin}:${process.env.PATH}`, LEMTEL_HA_ROLE: 'digitalocean_writer', LEMTEL_HA_EXECUTE: 'prepare_do_managed_mtls_leaf_candidate', LEMTEL_MTLS_CANDIDATE_GENERATION: '1', ...extra } });
}
const clean = (fix) => rmSync(fix.base, { recursive: true, force: true });

test('candidate issuer is compiled disabled in production source', () => {
  assert.match(source, /readonly CANDIDATE_ISSUANCE_AUTHORIZED='false'/u);
  const fix = fixture({ authorize: false });
  try {
    const result = run(fix);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /external_at_rest_and_lifecycle_gates_required/u);
    assert.equal(existsSync(fix.candidates), false);
  } finally { clean(fix); }
});

test('future reviewed path prepares only separated encrypted candidate credentials and a redacted attestation', () => {
  const fix = fixture();
  try {
    const result = run(fix);
    assert.equal(result.status, 0, result.stderr);
    for (const state of ['candidate_state=prepared', 'candidate_credentials_written=true', 'candidate_credentials_relay_consumable=false', 'root_ca_credential_contents_returned=false', 'private_key_content_returned=false', 'network_contacted=false', 'cloudflare_contacted=false', 'access_policy_configured=false', 'local_relay_activated=false', 'node_enrollment_configured=false', 'automatic_failover_enabled=false']) assert.match(result.stdout, new RegExp(`^${state}$`, 'mu'));
    assert.doesNotMatch(result.stdout + result.stderr, /(?:BEGIN|PRIVATE KEY|opaque-root|opaque-crypto|opaque-credential|aabbccddeeff00112233445566778899|[a-f0-9]{64})/u);
    const target = join(fix.candidates, 'generation-1');
    assert.deepEqual(readdirSync(target).sort(), ['candidate-client-cert.pem.cred', 'candidate-client-key.pem.cred', 'candidate.attestation']);
    assert.equal(mode(fix.candidates), 0o700); assert.equal(mode(target), 0o700);
    assert.equal(mode(join(target, 'candidate-client-cert.pem.cred')), 0o600);
    assert.equal(mode(join(target, 'candidate-client-key.pem.cred')), 0o600);
    assert.equal(mode(join(target, 'candidate.attestation')), 0o644);
    const attestation = readFileSync(join(target, 'candidate.attestation'), 'utf8');
    for (const value of ['state=candidate_prepared', 'credential_pair_host_bound_root_only=true', 'cleartext_private_material_persisted=false', 'relay_activation_authorized=false', 'access_policy_activation_authorized=false', 'automatic_failover_authorized=false']) assert.match(attestation, new RegExp(`^${value}$`, 'mu'));
    assert.match(attestation, /^trust_anchor_fingerprint=sha256:[a-f0-9]{64}$/mu);
    assert.match(attestation, /^intermediate_fingerprint=sha256:[a-f0-9]{64}$/mu);
    assert.match(attestation, /^leaf_fingerprint=sha256:[a-f0-9]{64}$/mu);
    assert.match(attestation, /^leaf_serial=[a-f0-9]{32,64}$/mu);
    assert.doesNotMatch(attestation, /(?:opaque|BEGIN|PRIVATE KEY)/u);
    assert.deepEqual(readdirSync(fix.run), []);
    assert.deepEqual(readdirSync(fix.managed), ['root-ca-key.pem.cred']);
  } finally { clean(fix); }
});

test('candidate issuer rejects absent tmpfs, root mismatch, corrupt root state, reused generation and failed encryption without creating a usable candidate', () => {
  for (const extra of [{ MOCK_RUN_FILESYSTEM: 'ext4' }, { MOCK_KEY_MATCH: 'false' }, { MOCK_CREDENTIAL_FAIL: 'true' }, { LEMTEL_HA_ROLE: 'hostinger_standby' }, { LEMTEL_MTLS_CANDIDATE_GENERATION: '0' }]) {
    const fix = fixture();
    try {
      const result = run(fix, extra);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(fix.candidates, 'generation-1')), false);
      assert.deepEqual(readdirSync(fix.managed), ['root-ca-key.pem.cred']);
      assert.deepEqual(readdirSync(fix.run), []);
    } finally { clean(fix); }
  }
  const corrupt = fixture();
  try {
    writeFileSync(corrupt.rootAttestation, 'corrupt\n');
    assert.notEqual(run(corrupt).status, 0);
    assert.equal(existsSync(corrupt.candidates), false);
  } finally { clean(corrupt); }
  const reused = fixture();
  try {
    assert.equal(run(reused).status, 0);
    const again = run(reused);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /candidate_generation_exists/u);
  } finally { clean(reused); }
});

test('source has a fixed trusted environment and no relay, systemd, network, provider or failover execution surface', () => {
  const syntax = spawnSync('/bin/bash', ['-n', sourcePath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.ok((lstatSync(sourcePath).mode & 0o111) !== 0);
  for (const expected of [
    '#!/bin/bash -p', "readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'", "readonly CANDIDATE_ISSUANCE_AUTHORIZED='false'", "readonly ROOT_ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'", "readonly CANDIDATES_DIRECTORY='/etc/lemtel-platform-signer/managed-mtls-leaf-candidates'", 'basicConstraints=critical,CA:TRUE,pathlen:0', 'extendedKeyUsage=clientAuth', 'candidate_credentials_relay_consumable=false', 'automatic_failover_enabled=false',
  ]) assert.ok(source.includes(expected), expected);
  assert.doesNotMatch(source, /(?:\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|\bdoctl\b|\bcloudflared\b|\bnc\b|\btelnet\b|\bping\b)/iu);
  assert.doesNotMatch(uncommented, /(?:\bsystemctl\b|daemon-reload|service\s+(?:start|restart|enable)|access\/certificates|access\/apps|client-certificates|load.?balancer|fusionpbx|planipret|automatic_failover\s*=\s*true)/iu);
  assert.doesNotMatch(source, /\/etc\/lemtel-platform-signer\/credentials\/(?:client-cert|client-key)\.pem\.cred/u);
});
