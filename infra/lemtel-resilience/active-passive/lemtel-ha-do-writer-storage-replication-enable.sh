#!/usr/bin/env bash
# Root-only composite activation of safe Storage replication from the DO writer
# to the Hostinger standby. Both components remain one-way and private.
set -euo pipefail

fail() {
  printf 'do_writer_storage_replication_enable_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_do_writer_private_storage_replication' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

key_init='/home/lemtelops/lemtel-ha-do-writer-storage-key-init.sh'
timer_enable='/home/lemtelops/lemtel-ha-do-writer-storage-timer-enable.sh'
[ -x "$key_init" ] || fail storage_key_init_script_missing
[ -x "$timer_enable" ] || fail storage_timer_enable_script_missing

LEMTEL_HA_EXECUTE=initialize_do_writer_private_storage_sync_key \
  LEMTEL_HA_ROLE=digitalocean_writer \
  LEMTEL_HA_STORAGE_BACKEND=local_filesystem \
  "$key_init"
LEMTEL_HA_EXECUTE=enable_do_writer_private_storage_sync_timer \
  LEMTEL_HA_ROLE=digitalocean_writer \
  "$timer_enable"

printf 'do_writer_storage_replication_enable_format=lemtel_do_writer_storage_replication_enable_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'storage_key_initialized=true\n'
printf 'storage_timer_enabled=true\n'
printf 'initial_storage_sync_complete=true\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'standby_storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'do_writer_storage_replication_enable_status=complete\n'
