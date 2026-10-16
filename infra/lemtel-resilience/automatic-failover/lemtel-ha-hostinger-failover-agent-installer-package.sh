#!/usr/bin/env bash
# Builds a deterministic, inactive-only Hostinger failover-agent installer package.
# This generator creates local files only; it never contacts or alters any server.
set -euo pipefail

fail() { printf 'hostinger_failover_agent_package_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
usage() {
  printf 'Usage: SOURCE_DATE_EPOCH=<unix-epoch> %s <output-directory>\n' "$(basename -- "$0")" >&2
  exit 64
}

[ "$#" -eq 1 ] || usage
case "${SOURCE_DATE_EPOCH:-}" in ''|*[!0-9]*) fail source_date_epoch_required ;; esac
[ "${SOURCE_DATE_EPOCH}" -ge 1 ] || fail source_date_epoch_invalid

source_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
output_dir="$1"
archive_name='lemtel-hostinger-failover-agent-installer.tar.gz'
archive="$output_dir/$archive_name"
digest_file="$archive.sha256"
source_files=(
  lemtel-ha-hostinger-failover-agent-installer.sh
  lemtel-ha-hostinger-failover-agent.sh
  lemtel-ha-hostinger-current-topology-stage-attest.sh
  lemtel-ha-hostinger-current-topology-promote.sh
  lemtel-ha-hostinger-current-topology-runtime-start.sh
  lemtel-ha-hostinger-failover-agent.service
  lemtel-ha-hostinger-failover-agent.timer
)

[ ! -e "$output_dir" ] || [ -d "$output_dir" ] || fail output_directory_invalid
install -d -m 0700 "$output_dir"
staging="$(mktemp -d "${TMPDIR:-/tmp}/lemtel-hostinger-agent-package.XXXXXX")"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT INT TERM

for file in "${source_files[@]}"; do
  [ -f "$source_dir/$file" ] && [ ! -L "$source_dir/$file" ] || fail source_file_missing_or_unsafe
  case "$file" in
    *.sh) install -m 0750 "$source_dir/$file" "$staging/$file" ;;
    *.service|*.timer) install -m 0644 "$source_dir/$file" "$staging/$file" ;;
    *) fail source_file_extension_invalid ;;
  esac
done

(
  cd "$staging"
  sha256sum "${source_files[@]}" > manifest.sha256
  chmod 0640 manifest.sha256
  tar --sort=name --mtime="@${SOURCE_DATE_EPOCH}" --owner=0 --group=0 --numeric-owner \
    --pax-option=delete=atime,delete=ctime \
    -cf - "${source_files[@]}" manifest.sha256 | gzip -n > "$archive"
)
printf '%s  %s\n' "$(sha256sum "$archive" | awk '{print $1}')" "$archive_name" > "$digest_file"
chmod 0640 "$digest_file"

printf 'hostinger_failover_agent_package_format=lemtel_hostinger_failover_agent_package_v1\n'
printf 'archive_created=true\n'
printf 'archive_digests_created=true\n'
printf 'installer_service_enabled=false\n'
printf 'installer_timer_enabled=false\n'
printf 'hostinger_contacted=false\n'
printf 'runtime_started=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_failover_agent_package_status=complete\n'
