#!/usr/bin/env bash
# Root-only, local-only generation of a node publication key pair.
# No network request, secret configuration, publication, service, timer,
# provider action, promotion, fencing, routing or telephony action occurs.
set -euo pipefail
set +x

fail() {
  printf 'node_publication_key_init_status=blocked\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 78
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_NODE_KEY_INIT_EXECUTE:-}" = generate_publication_keys_only ] || fail execution_token_required
case "${LEMTEL_NODE_KEY_INIT_ROLE:-}" in do_writer|hostinger_standby) ;; *) fail node_role_required ;; esac

archive="${LEMTEL_NODE_KEY_INIT_ARCHIVE:-/home/lemtelops/lemtel-node-publication-key-init.tar}"
archive_digest="${archive}.sha256"
config='/etc/lemtel-node-publication'
state='/var/lib/lemtel-node-publication'
stage=''

secure_regular_file() {
  local path="$1" mode
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  [ "$(stat -c '%u:%g' "$path")" = 0:0 ] || return 1
  mode="$(stat -c '%a' "$path")"
  [ $((8#$mode & 022)) -eq 0 ]
}
secure_directory_parent() {
  local path="$1" part=''
  IFS='/' read -r -a pieces <<< "${path#/}"
  for item in "${pieces[@]}"; do
    part="${part}/${item}"
    [ -d "$part" ] && [ ! -L "$part" ] || return 1
    [ "$(stat -c '%u:%g' "$part")" = 0:0 ] || return 1
    [ $((8#$(stat -c '%a' "$part") & 022)) -eq 0 ] || return 1
  done
}
cleanup() { [ -z "$stage" ] || rm -rf -- "$stage"; }
trap cleanup EXIT

[[ "$archive" = /* && "$archive" != *$'\n'* ]] || fail archive_path_invalid
secure_regular_file "$archive" || fail archive_security_invalid
secure_regular_file "$archive_digest" || fail archive_digest_security_invalid
[ "$(stat -c '%s' "$archive")" -gt 0 ] && [ "$(stat -c '%s' "$archive")" -le $((1024 * 1024)) ] || fail archive_size_invalid
actual="$(sha256sum "$archive" | awk '{print $1}')"
expected="$(awk 'NR == 1 {print $1}' "$archive_digest")"
recorded="$(cat "$archive_digest")"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] && [ "$recorded" = "$expected  $(basename "$archive")" ] && [ "$actual" = "$expected" ] || fail archive_digest_mismatch

required=(
  'deployment-metadata.json'
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts'
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs'
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.py'
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.sh'
  'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts'
  'manifest.sha256'
)
mapfile -t entries < <(tar -tf "$archive")
[ "${#entries[@]}" -eq "${#required[@]}" ] || fail archive_layout_invalid
for index in "${!required[@]}"; do [ "${entries[$index]}" = "${required[$index]}" ] || fail archive_layout_invalid; done
[ "$(tar -tvf "$archive" | awk '{print substr($1, 1, 1)}' | sort -u)" = - ] || fail archive_member_type_invalid

stage="$(mktemp -d /var/lib/.lemtel-node-key-init.XXXXXX)"
chown root:root "$stage"; chmod 0700 "$stage"
tar -xf "$archive" -C "$stage" --no-same-owner --no-same-permissions
for file in "${required[@]}"; do [ -s "$stage/$file" ] && [ ! -L "$stage/$file" ] || fail bundle_file_missing; done
if ! python3 - "$stage" <<'PY'
import hashlib
import json
import os
import sys
root = sys.argv[1]
required = [
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.py',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.sh',
    'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts',
]
try:
    rows = open(os.path.join(root, 'manifest.sha256'), encoding='utf-8').read().splitlines()
    expected = {}
    for row in rows:
        digest, name = row.split('  ', 1)
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest) or name in expected:
            raise ValueError('manifest')
        expected[name] = digest
    if set(expected) != set(['deployment-metadata.json', *required]):
        raise ValueError('manifest')
    for name, digest in expected.items():
        value = hashlib.sha256(open(os.path.join(root, name), 'rb').read()).hexdigest()
        if value != digest:
            raise ValueError('digest')
    metadata = json.load(open(os.path.join(root, 'deployment-metadata.json'), encoding='utf-8'))
    required_metadata = {
        'package_format': 'lemtel_node_publication_key_init_v1',
        'scope': 'root_only_local_public_key_generation',
        'allowed_roles': ['do_writer', 'hostinger_standby'],
        'runtime_key_generation_requires_explicit_local_gate': True,
        'runtime_key_generation_authorized_by_package': False,
        'local_crypto_runtimes': ['deno_2', 'node_webcrypto_18_or_newer', 'python3_openssl_p256'],
        'network_access': False,
        'package_install_persistent': False,
        'secrets_configured': False,
        'publication_configured': False,
        'publication_executed': False,
        'service_installed': False,
        'timer_enabled': False,
        'provider_contacted': False,
        'cloudflare_or_dns_changed': False,
        'promotion_executed': False,
        'fencing_executed': False,
        'automatic_failover_enabled': False,
        'telephony_contacted': False,
    }
    if any(metadata.get(key) != value for key, value in required_metadata.items()):
        raise ValueError('metadata')
except Exception:
    raise SystemExit(1)
PY
then
  fail package_metadata_invalid
fi

# No runtime is installed. A pre-existing directory is ambiguous and is never reused.
[ ! -e "$config" ] && [ ! -e "$state" ] || fail local_state_exists_requires_review
for parent in /etc /var /var/lib; do secure_directory_parent "$parent" || fail parent_security_invalid; done
runtime=''
if command -v deno >/dev/null 2>&1; then
  DENO_BIN="$(command -v deno)"
  [ -x "$DENO_BIN" ] || fail deno_invalid
  version="$($DENO_BIN --version 2>/dev/null | awk 'NR == 1 {print $2}')" || fail deno_version_unavailable
  [[ "$version" =~ ^2\.[0-9]+\.[0-9]+$ ]] || fail deno_version_unsupported
  runtime='deno'
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  [ -x "$NODE_BIN" ] || fail node_invalid
  version="$($NODE_BIN --version 2>/dev/null)" || fail node_version_unavailable
  [[ "$version" =~ ^v(1[89]|[2-9][0-9])\.[0-9]+\.[0-9]+$ ]] || fail node_version_unsupported
  runtime='node'
elif command -v python3 >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
  OPENSSL_BIN="$(command -v openssl)"
  [ -x "$PYTHON_BIN" ] && [ -x "$OPENSSL_BIN" ] || fail python_openssl_invalid
  version="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null)" || fail python_version_unavailable
  [[ "$version" =~ ^3\.(8|9|1[0-9]|[2-9][0-9])$ ]] || fail python_version_unsupported
  "$OPENSSL_BIN" version >/dev/null 2>&1 || fail openssl_unavailable
  runtime='python_openssl'
else
  fail secure_runtime_missing
fi
install -d -o root -g root -m 0700 "$config" "$state"
secure_directory_parent "$config" || fail config_directory_security_invalid
secure_directory_parent "$state" || fail state_directory_security_invalid
if [ "$runtime" = deno ]; then
  result="$(env LEMTEL_NODE_LOCAL_APPROVAL=generate_publication_keys_only "$DENO_BIN" run --quiet --no-prompt --no-config --no-lock --deny-net --allow-env=LEMTEL_NODE_LOCAL_APPROVAL --allow-read="$config","$state" --allow-write="$config","$state" --allow-sys=uid "$stage/infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts" init 2>&1)" || fail local_key_generation_failed
elif [ "$runtime" = node ]; then
  result="$(env LEMTEL_NODE_LOCAL_APPROVAL=generate_publication_keys_only "$NODE_BIN" "$stage/infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs" init 2>&1)" || fail local_key_generation_failed
else
  result="$(env -i PATH="$(dirname "$PYTHON_BIN"):$(dirname "$OPENSSL_BIN"):/usr/bin:/bin" LEMTEL_NODE_LOCAL_APPROVAL=generate_publication_keys_only "$PYTHON_BIN" -I "$stage/infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.py" init 2>&1)" || fail local_key_generation_failed
fi
fingerprint="$(printf '%s\n' "$result" | sed -n 's/^status=initialized fingerprint=\(sha256:[a-f0-9]\{64\}\)$/\1/p')"
[ "$(printf '%s\n' "$result" | wc -l | tr -d ' ')" = 1 ] && [[ "$fingerprint" =~ ^sha256:[a-f0-9]{64}$ ]] || fail local_key_generation_output_invalid
secure_regular_file "$config/keys.json" || fail key_file_security_invalid

printf 'node_publication_key_init_format=lemtel_node_publication_key_init_v1\n'
printf 'node_role=%s\n' "$LEMTEL_NODE_KEY_INIT_ROLE"
printf 'key_state=created_root_only\n'
printf 'public_fingerprint=%s\n' "$fingerprint"
printf 'network_access=false\n'
printf 'secrets_configured=false\n'
printf 'publication_configured=false\n'
printf 'publication_executed=false\n'
printf 'service_installed=false\n'
printf 'timer_enabled=false\n'
printf 'provider_contacted=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'node_publication_key_init_status=complete\n'
