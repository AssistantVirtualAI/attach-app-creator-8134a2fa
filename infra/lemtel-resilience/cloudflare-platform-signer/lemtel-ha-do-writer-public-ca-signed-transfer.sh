#!/usr/bin/env bash
# Transfers only the public Cloudflare Access CA after a nonce-bound P-256 proof.
set -euo pipefail
set +x

fail() {
  printf 'public_ca_transfer_status=blocked\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 78
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "$#" -eq 1 ] || fail receiver_url_required
receiver="$1"
case "$receiver" in https://*.manus.computer/ca) ;; *) fail receiver_url_not_allowlisted ;; esac

credential='/etc/credstore.encrypted/lemtel-node-platform-signer.cred'
pin='/etc/lemtel-node-platform-signer/public-pin.json'
ca='/etc/lemtel-platform-signer/cloudflare-access-root-ca.pem'
script="$(dirname "$0")/lemtel-public-ca-signed-transfer.py"
for path in "$credential" "$pin" "$ca" "$script"; do
  [ -f "$path" ] && [ ! -L "$path" ] || fail required_file_missing
  [ "$(stat -c '%u:%g' "$path")" = 0:0 ] || fail required_file_owner_invalid
done
[ "$(stat -c '%a' "$credential")" = 600 ] || fail credential_permissions_invalid
[ "$(stat -c '%a' "$pin")" = 600 ] || fail pin_permissions_invalid
[ "$(stat -c '%a' "$ca")" = 644 ] || fail ca_permissions_invalid
command -v systemd-creds >/dev/null 2>&1 || fail systemd_creds_missing
command -v python3 >/dev/null 2>&1 || fail python_missing

systemd-creds decrypt --name=platform-signing-jwk "$credential" - | python3 -I "$script" send "$receiver"
printf 'public_ca_transfer_launcher_status=complete\n'
