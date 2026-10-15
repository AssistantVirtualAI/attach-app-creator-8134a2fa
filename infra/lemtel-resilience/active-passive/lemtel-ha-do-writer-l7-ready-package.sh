#!/usr/bin/env bash
# Builds a deterministic L7-only payload and a review-gated macOS launcher; it never transfers or deploys it.
set -euo pipefail

fail() { printf 'do_writer_l7_ready_package_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
usage() {
  cat >&2 <<'USAGE'
Usage: SOURCE_DATE_EPOCH=<unix-epoch> lemtel-ha-do-writer-l7-ready-package.sh <output-directory>

Creates only local files in <output-directory>:
  lemtel-l7-ready-deployment.tar.gz
  lemtel-l7-ready-deployment.tar.gz.sha256
  lemtel_deploy_l7_ready_json_mac.sh

The generated macOS launcher is deliberately review-gated and requires its SSH target
at execution time. This generator does not contact a host or perform a deployment.
USAGE
  exit 64
}

[ "$#" -eq 1 ] || usage
case "${SOURCE_DATE_EPOCH:-}" in ''|*[!0-9]*) fail source_date_epoch_required ;; esac
[ "${SOURCE_DATE_EPOCH}" -ge 1 ] || fail source_date_epoch_invalid

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
output_dir="$1"
archive_name='lemtel-l7-ready-deployment.tar.gz'
archive="$output_dir/$archive_name"
digest_file="$archive.sha256"
launcher="$output_dir/lemtel_deploy_l7_ready_json_mac.sh"
source_files=(
  lemtel-ha-do-writer-lb-ready-refresh.sh
  lemtel-ha-do-writer-lb-ready-route-deploy.sh
  lemtel-ha-do-writer-lb-ready-timer-enable.sh
)

[ ! -e "$output_dir" ] || [ -d "$output_dir" ] || fail output_directory_invalid
install -d -m 0700 "$output_dir"
staging="$(mktemp -d "${TMPDIR:-/tmp}/lemtel-l7-ready-package.XXXXXX")"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT INT TERM

for file in "${source_files[@]}"; do
  [ -f "$script_dir/$file" ] || fail source_file_missing
  install -m 0750 "$script_dir/$file" "$staging/$file"
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

cat > "$launcher" <<'LAUNCHER'
#!/usr/bin/env bash
# Review-gated Lemtel L7-only launcher. It has no endpoint or credential inline.
set -euo pipefail

fail() { printf 'lemtel_l7_ready_launcher_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "${LEMTEL_PARENT_REVIEW_APPROVED:-}" = 'lemtel_l7_ready_json_v1' ] || fail parent_review_required
: "${LEMTEL_L7_DEPLOY_SSH_TARGET:?LEMTEL_L7_DEPLOY_SSH_TARGET is required}"

launcher_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
archive_name='lemtel-l7-ready-deployment.tar.gz'
archive="$launcher_dir/$archive_name"
digest_file="$launcher_dir/$archive_name.sha256"
[ -f "$archive" ] && [ ! -L "$archive" ] || fail archive_missing
[ -f "$digest_file" ] && [ ! -L "$digest_file" ] || fail archive_digest_missing
[ "$(wc -l < "$digest_file" | tr -d '[:space:]')" = 1 ] || fail archive_digest_ambiguous
expected_digest="$(awk -v name="$archive_name" 'NF == 2 && $2 == name && $1 ~ /^[0-9a-f]{64}$/ { print $1 }' "$digest_file")"
[ "${#expected_digest}" -eq 64 ] || fail archive_digest_invalid
actual_digest="$(shasum -a 256 "$archive" | awk '{print $1}')"
[ "$actual_digest" = "$expected_digest" ] || fail archive_digest_mismatch
case "${LEMTEL_L7_DEPLOY_SSH_TARGET}" in -*) fail ssh_target_invalid ;; esac

remote_command=$(cat <<REMOTE
set -eu
umask 077
archive_name='$archive_name'
expected_digest='$expected_digest'
staging=\$(mktemp -d /var/tmp/lemtel-l7-ready.XXXXXX)
cleanup() { rm -rf -- "\$staging"; }
trap cleanup EXIT INT TERM
archive="\$staging/\$archive_name"
digest_file="\$staging/\$archive_name.sha256"
cat > "\$archive"
printf '%s  %s\\n' "\$expected_digest" "\$archive_name" > "\$digest_file"
actual_digest=\$(sha256sum "\$archive" | awk '{print \$1}')
[ "\$actual_digest" = "\$expected_digest" ]
mkdir -m 0700 "\$staging/bundle"
tar -xzf "\$archive" -C "\$staging/bundle"
exec sudo -n env \\
  LEMTEL_HA_EXECUTE=deploy_digitalocean_writer_l7_ready_route \\
  LEMTEL_HA_ROLE=digitalocean_promoted_writer \\
  LEMTEL_L7_READY_ARCHIVE="\$archive" \\
  LEMTEL_L7_READY_ARCHIVE_DIGESTS="\$digest_file" \\
  LEMTEL_L7_READY_BUNDLE="\$staging/bundle" \\
  bash "\$staging/bundle/lemtel-ha-do-writer-lb-ready-route-deploy.sh"
REMOTE
)

# The host is supplied only at invocation time; no target, endpoint, or credential is persisted here.
cat "$archive" | ssh -q -o BatchMode=yes -o ClearAllForwardings=yes -o ForwardAgent=no -o RequestTTY=no -- \
  "$LEMTEL_L7_DEPLOY_SSH_TARGET" "$remote_command"
printf 'lemtel_l7_ready_launcher_status=complete\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'credential_values_emitted=false\n'
LAUNCHER
chmod 0750 "$launcher"

printf 'do_writer_l7_ready_package_format=lemtel_do_writer_l7_ready_package_v1\n'
printf 'archive_created=true\n'
printf 'archive_digests_created=true\n'
printf 'macos_launcher_created=true\n'
printf 'transfer_executed=false\n'
printf 'deployment_executed=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_l7_ready_package_status=complete\n'
