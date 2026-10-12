#!/usr/bin/env bash
# Root-only, one-way filesystem Storage replication from the DigitalOcean writer
# to the restricted Hostinger standby receiver. Deletions never propagate.
set -euo pipefail

fail() {
  printf 'do_writer_storage_sync_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'sync_do_writer_private_storage_once' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role
[ "${LEMTEL_HA_STORAGE_BACKEND:-}" = local_filesystem ] || fail unexpected_storage_backend

writer_tunnel_address='10.253.47.2'
standby_tunnel_address='10.253.47.1'
storage_container='supabase-storage'
storage_destination='/var/lib/storage'
key_dir='/etc/lemtel-ha/storage-sync'
key_file="$key_dir/id_ed25519"
known_hosts="$key_dir/known_hosts"
manifest_dir='/var/lib/lemtel-ha/storage-sync-manifests'
lock_file='/run/lemtel-ha-do-writer-storage-sync.lock'
receiver='lemtelstorage'
receiver_dir='/home/lemtelstorage/storage-current/'
target="$receiver@$standby_tunnel_address:$receiver_dir"

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v rsync >/dev/null 2>&1 || fail rsync_missing
command -v ssh >/dev/null 2>&1 || fail ssh_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
docker inspect "$storage_container" >/dev/null 2>&1 || fail storage_container_missing
docker inspect --format '{{.State.Running}}' "$storage_container" | grep -qx true || fail storage_container_not_running
source_dir="$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$storage_destination\"}}{{.Source}}{{end}}{{end}}" "$storage_container" | tr -d '[[:space:]]')"
case "$source_dir" in /var/lib/docker/volumes/*/_data|/opt/*|/srv/*) ;; *) fail invalid_storage_source_mount ;; esac
[ -d "$source_dir" ] || fail storage_source_missing
[ -f "$key_file" ] && [ -f "$key_file.pub" ] && [ -f "$known_hosts" ] || fail storage_sync_key_material_missing
[ "$(stat -c '%a' "$key_file")" = 600 ] || fail storage_sync_key_permissions_invalid
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -Fq "$writer_tunnel_address" || fail writer_tunnel_address_missing

exec 9>"$lock_file"
flock -n 9 || fail sync_already_running
install -d -m 0700 "$manifest_dir"
ssh_command="ssh -i $key_file -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts -o GlobalKnownHostsFile=/dev/null -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o RequestTTY=no -b $writer_tunnel_address"
log_file="$manifest_dir/last-rsync.log"

# Retain source removals on Hostinger until a reviewed recovery procedure.
rsync -rltp --checksum --delay-updates --partial-dir=.lemtel-ha-partial \
  --exclude='.lemtel-ha-partial/' \
  --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= \
  --no-owner --no-group \
  -e "$ssh_command" \
  "$source_dir/" "$target" >"$log_file" 2>&1

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
manifest="$manifest_dir/storage-$stamp.sha256"
attestation="$manifest_dir/last-success"
(
  cd "$source_dir"
  LC_ALL=C find . -type f -print0 | sort -z | xargs -0r sha256sum
) > "$manifest"
manifest_hash="$(sha256sum "$manifest" | awk '{ print $1 }')"
rsync -rltp --checksum --delay-updates --no-owner --no-group \
  -e "$ssh_command" \
  "$manifest" "$target.lemtel-ha-manifest.current.sha256" >>"$log_file" 2>&1

file_count="$(find "$source_dir" -type f -printf . | wc -c)"
byte_count="$(du -sb "$source_dir" | awk '{ print $1 }')"
attestation_tmp="$(mktemp "$manifest_dir/.last-success.XXXXXX")"
{
  printf 'sync_timestamp_utc=%s\n' "$stamp"
  printf 'manifest_name=%s\n' "$(basename "$manifest")"
  printf 'manifest_sha256=%s\n' "$manifest_hash"
  printf 'source_file_count=%s\n' "$file_count"
  printf 'source_bytes=%s\n' "$byte_count"
} > "$attestation_tmp"
chmod 0600 "$attestation_tmp"
mv -f "$attestation_tmp" "$attestation"

printf 'do_writer_storage_sync_format=lemtel_do_writer_storage_sync_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'storage_backend=local_filesystem\n'
printf 'wireguard_handshake_verified=true\n'
printf 'sync_direction=digitalocean_to_hostinger_only\n'
printf 'rsync_checksum_verification=true\n'
printf 'storage_integrity_attestation_written=true\n'
printf 'storage_manifest_sha256=%s\n' "$manifest_hash"
printf 'source_file_count=%s\n' "$file_count"
printf 'source_bytes=%s\n' "$byte_count"
printf 'storage_delete_propagation_enabled=false\n'
printf 'standby_storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'do_writer_storage_sync_status=complete\n'
