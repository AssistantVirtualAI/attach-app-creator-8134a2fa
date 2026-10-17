#!/usr/bin/env bash
# Root-only creation of an encrypted systemd credential for the Lemtel platform signer.
# The private JWK flows only through an anonymous pipe into systemd-creds encrypt.
# No plaintext private key is written to disk, emitted, configured in Edge, or published.
set -euo pipefail
set +x

fail() {
  printf 'platform_signer_credential_init_status=blocked\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 78
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_PLATFORM_SIGNER_CREDENTIAL_EXECUTE:-}" = initialize_encrypted_platform_signer ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_PLATFORM_SIGNER_SNAPSHOT_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED ] || fail fresh_snapshot_attestation_required

credential_dir='/etc/credstore.encrypted'
credential_name='platform-signing-jwk'
credential_path="$credential_dir/lemtel-node-platform-signer.cred"
public_dir='/etc/lemtel-node-platform-signer'
public_path="$public_dir/public-pin.json"
stage=''

secure_parent() {
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

command -v python3 >/dev/null 2>&1 || fail python_missing
command -v openssl >/dev/null 2>&1 || fail openssl_missing
command -v systemd-creds >/dev/null 2>&1 || fail systemd_creds_missing
PYTHON_BIN="$(command -v python3)"
OPENSSL_BIN="$(command -v openssl)"
CREDS_BIN="$(command -v systemd-creds)"
[ -x "$PYTHON_BIN" ] && [ -x "$OPENSSL_BIN" ] && [ -x "$CREDS_BIN" ] || fail required_binary_invalid
python_version="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null)" || fail python_version_unavailable
[[ "$python_version" =~ ^3\.(8|9|1[0-9]|[2-9][0-9])$ ]] || fail python_version_unsupported
creds_version="$($CREDS_BIN --version 2>/dev/null | awk 'NR == 1 {print $2}')" || fail systemd_creds_version_unavailable
[[ "$creds_version" =~ ^[0-9]+$ ]] && [ "$creds_version" -ge 250 ] || fail systemd_creds_version_unsupported
"$OPENSSL_BIN" version >/dev/null 2>&1 || fail openssl_unavailable

[ ! -e "$credential_path" ] || fail encrypted_credential_exists_requires_rotation
[ ! -e "$public_dir" ] || fail public_pin_directory_exists_requires_rotation
for parent in /etc /var /var/lib; do secure_parent "$parent" || fail parent_security_invalid; done
if [ -e "$credential_dir" ]; then
  [ -d "$credential_dir" ] && [ ! -L "$credential_dir" ] || fail credential_directory_invalid
  [ "$(stat -c '%u:%g' "$credential_dir")" = 0:0 ] || fail credential_directory_security_invalid
  [ $((8#$(stat -c '%a' "$credential_dir") & 022)) -eq 0 ] || fail credential_directory_security_invalid
else
  install -d -o root -g root -m 0755 "$credential_dir"
fi

stage="$(mktemp -d /var/lib/.lemtel-platform-signer.XXXXXX)"
chown root:root "$stage"; chmod 0700 "$stage"
public_tmp="$stage/public-pin.json"
credential_tmp="$stage/lemtel-node-platform-signer.cred"
env -i PATH="$(dirname "$PYTHON_BIN"):$(dirname "$OPENSSL_BIN"):$(dirname "$CREDS_BIN"):/usr/bin:/bin" "$PYTHON_BIN" -I "$(dirname "$0")/lemtel-platform-signer-credential-init.py" "$public_tmp" \
  | "$CREDS_BIN" encrypt --name="$credential_name" - "$credential_tmp" >/dev/null \
  || fail encrypted_credential_generation_failed
[ -s "$credential_tmp" ] && [ ! -L "$credential_tmp" ] || fail encrypted_credential_missing
chown root:root "$credential_tmp" "$public_tmp"; chmod 0600 "$credential_tmp" "$public_tmp"
"$PYTHON_BIN" -I - "$public_tmp" <<'PY' || fail public_pin_invalid
import json
import re
import sys
try:
    value = json.load(open(sys.argv[1], encoding='utf-8'))
    if (set(value) != {'format', 'platformSigningKey', 'fingerprint'}
            or value['format'] != 'lemtel-platform-signing-public-v1'
            or not isinstance(value['platformSigningKey'], str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{87}', value['platformSigningKey'])
            or not isinstance(value['fingerprint'], str)
            or not re.fullmatch(r'sha256:[a-f0-9]{64}', value['fingerprint'])):
        raise ValueError('public pin')
except Exception:
    raise SystemExit(1)
PY
install -d -o root -g root -m 0700 "$public_dir"
mv -f -- "$credential_tmp" "$credential_path"
mv -f -- "$public_tmp" "$public_path"
[ -f "$credential_path" ] && [ ! -L "$credential_path" ] && [ "$(stat -c '%u:%g:%a' "$credential_path")" = 0:0:600 ] || fail encrypted_credential_security_invalid
[ -f "$public_path" ] && [ ! -L "$public_path" ] && [ "$(stat -c '%u:%g:%a' "$public_path")" = 0:0:600 ] || fail public_pin_security_invalid
fingerprint="$("$PYTHON_BIN" -I - "$public_path" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['fingerprint'])
PY
)" || fail public_pin_readback_failed

printf 'platform_signer_credential_init_format=lemtel_platform_signer_credential_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'credential_state=created_encrypted_root_only\n'
printf 'public_pin_state=created_root_only\n'
printf 'public_fingerprint=%s\n' "$fingerprint"
printf 'edge_runtime_changed=false\n'
printf 'enrollment_enabled=false\n'
printf 'node_binding_written=false\n'
printf 'publisher_configuration_written=false\n'
printf 'publisher_timer_enabled=false\n'
printf 'service_installed=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'platform_signer_credential_init_status=complete\n'
