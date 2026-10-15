#!/usr/bin/env bash
# Usage: scripts/lemtel-transactional-email-deploy-macos.sh ssh-target package.tar
set -euo pipefail
[ "$#" -eq 2 ] || { printf 'usage: %s ssh-target package.tar\n' "$0" >&2; exit 64; }
target="$1"
package="$2"
[ -f "$package" ] && [ -f "$package.sha256" ] || { printf 'launcher_status=package_or_checksum_missing\n' >&2; exit 1; }
expected="$(awk 'NF == 2 { print $1 }' "$package.sha256")"
actual="$(shasum -a 256 "$package" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || { printf 'launcher_status=local_archive_digest_invalid\n' >&2; exit 1; }
read -r -p 'Type REVIEWED_WRITER_DEPLOYMENT to continue: ' review
[ "$review" = REVIEWED_WRITER_DEPLOYMENT ] || { printf 'launcher_status=review_gate_declined\n' >&2; exit 1; }
read -r -p 'Type FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED to attest the existing snapshot: ' snapshot
[ "$snapshot" = FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED ] || { printf 'launcher_status=snapshot_attestation_declined\n' >&2; exit 1; }
tag="${actual:0:16}"
remote_dir="/var/tmp/lemtel-transactional-email-${tag}"
ssh -o BatchMode=yes "$target" "install -d -m 0700 '$remote_dir/release'"
scp -q "$package" "$target:$remote_dir/package.tar"
ssh -o BatchMode=yes "$target" "printf '%s  package.tar\\n' '$actual' > '$remote_dir/package.tar.sha256'"
ssh -tt "$target" "cd '$remote_dir' && tar -xf package.tar -C release && sudo env LEMTEL_TRANSACTIONAL_EMAIL_EXECUTE=deploy_reviewed_transactional_email LEMTEL_HA_ROLE=digitalocean_writer LEMTEL_TRANSACTIONAL_EMAIL_SNAPSHOT_ATTESTATION='$snapshot' ./release/lemtel-transactional-email-do-writer-deploy.sh"
