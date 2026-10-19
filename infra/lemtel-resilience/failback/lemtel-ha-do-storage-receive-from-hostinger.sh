#!/usr/bin/env bash
# FAILBACK storage copy — on DigitalOcean. Receives on stdin a tar of the promoted Hostinger Storage
# (/home/lemtelstorage/storage-current, streamed by the operator's launcher) and applies it to the DigitalOcean
# Storage directory only if the received content matches, file for file, the manifest computed on Hostinger
# (LEMTEL_HA_EXPECTED_MANIFEST_SHA256). Hostinger's version of a file wins; nothing is ever deleted on DO.
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'do_storage_receive_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = receive_hostinger_storage_for_failback ] || fail execution_token_required
expected="${LEMTEL_HA_EXPECTED_MANIFEST_SHA256:-}"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail expected_manifest_required
target="$T/home/lemtelstorage/storage-current"
[ -d "$target" ] || fail storage_directory_missing
staging="$(mktemp -d "$T/var/tmp/lemtel-storage-failback.XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT
tar -C "$staging" --no-same-owner --no-same-permissions -xf - || fail archive_unreadable
# Refuse links or special files: Storage holds regular files only.
if find "$staging" -mindepth 1 ! -type f ! -type d -print -quit | grep -q .; then fail unexpected_file_type; fi
manifest="$(cd "$staging" && LC_ALL=C find . -type f -print0 | sort -z | xargs -0r sha256sum)"
actual="$(printf '%s\n' "$manifest" | sha256sum | awk '{print $1}')"
[ "$actual" = "$expected" ] || fail manifest_mismatch_nothing_applied
count="$(cd "$staging" && find . -type f | wc -l | tr -d ' ')"
owner="$(stat -c '%u:%g' "$target")"
cp -a --no-preserve=ownership "$staging/." "$target/"
chown -R "$owner" "$target"
printf 'do_storage_receive_format=lemtel_do_storage_receive_v1\nfiles_applied=%s\nmanifest_verified=true\ndeletions=none\ndo_storage_receive_status=complete\n' "$count"
