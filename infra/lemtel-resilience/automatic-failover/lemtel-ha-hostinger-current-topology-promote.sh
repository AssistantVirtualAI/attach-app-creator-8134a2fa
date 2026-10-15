#!/usr/bin/env bash
# Root-only, one-way promotion for the CURRENT Lemtel topology:
# DigitalOcean writer -> Hostinger private hot standby. This is not installed by
# this repository and refuses execution unless all independent fencing evidence
# exists locally. It never changes Cloudflare/DNS or starts application runtime.
set -euo pipefail
umask 077
fail() { printf 'hostinger_current_topology_promotion_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
secure_root_file() { [ -f "$1" ] && [ -O "$1" ] && [ "$(stat -c '%a' "$1")" = 600 ]; }
resolve_standby_postgres() {
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = promote_current_topology_hostinger_after_verified_fence ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = hostinger_private_hot_standby ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_CURRENT_TOPOLOGY_PROMOTION:-}" = I_UNDERSTAND_HOSTINGER_BECOMES_THE_ONLY_WRITER ] || fail promotion_acknowledgement_required
incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
[[ "$incident_id" =~ ^[a-z0-9-]{8,80}$ ]] || fail invalid_incident_id
for command in docker flock gpgv grep stat ss date; do command -v "$command" >/dev/null 2>&1 || fail "${command}_missing"; done
systemctl is-active --quiet docker || fail docker_inactive
state_dir=/var/lib/lemtel-ha/current-topology-evidence
fence="$state_dir/do-writer-provider-fence.attestation"
fence_signature="$state_dir/do-writer-provider-fence.attestation.asc"
fence_keyring="$state_dir/provider-fence-attestation.gpg"
stage_state="$state_dir/hostinger-runtime-stage.state"
promotion_state="$state_dir/hostinger-promotion.state"
lock_file=/var/lock/lemtel-ha-hostinger-current-topology-promotion.lock
for file in "$fence" "$fence_signature" "$fence_keyring" "$stage_state"; do secure_root_file "$file" || fail required_evidence_missing_or_insecure; done
[ ! -e "$promotion_state" ] || fail promotion_state_already_exists
gpgv --keyring "$fence_keyring" "$fence_signature" "$fence" >/dev/null 2>&1 || fail do_writer_fence_signature_invalid
grep -Fxq 'format=lemtel_do_writer_provider_fence_attestation_v1' "$fence" || fail do_writer_fence_format_invalid
grep -Fxq "incident_id=$incident_id" "$fence" || fail do_writer_fence_incident_mismatch
grep -Fxq 'writer_role=do_writer' "$fence" || fail do_writer_fence_role_invalid
grep -Fxq 'writer_fenced=true' "$fence" || fail do_writer_not_fenced
grep -Fxq 'format=lemtel_hostinger_runtime_stage_v1' "$stage_state" || fail runtime_stage_format_invalid
grep -Fxq "incident_id=$incident_id" "$stage_state" || fail runtime_stage_incident_mismatch
grep -Fxq 'runtime_staged=true' "$stage_state" || fail runtime_not_staged
grep -Fxq 'runtime_running=false' "$stage_state" || fail runtime_already_running
grep -Fxq 'public_database_listener_enabled=false' "$stage_state" || fail runtime_stage_public_database_listener_detected
container="$(resolve_standby_postgres || true)"
[ -n "$container" ] || fail standby_postgres_unresolved
docker inspect "$container" >/dev/null 2>&1 || fail standby_postgres_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail standby_postgres_not_running
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail standby_postgres_port_published
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
exec 9>"$lock_file"; flock -n 9 || fail concurrent_promotion
[ "$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()')" = t ] || fail standby_not_in_recovery
receiver="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1' || true)"
if [ "$receiver" != streaming ]; then
  docker exec -u postgres "$container" test -f /var/lib/postgresql/data/standby.signal || fail standby_signal_missing
  [ "$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_last_wal_receive_lsn() IS NOT NULL AND pg_last_wal_replay_lsn() IS NOT NULL')" = t ] || fail standby_wal_position_missing
fi
printf 'format=lemtel_hostinger_current_topology_promotion_v1\nincident_id=%s\nwriter_role=hostinger_promoted_writer\ncontainer=%s\npromotion_started_at_utc=%s\n' "$incident_id" "$container" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$promotion_state"
chmod 0600 "$promotion_state"
docker exec -u postgres "$container" pg_ctl promote -D /var/lib/postgresql/data >/dev/null
for _ in $(seq 1 36); do
  recovery="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null || true)"
  [ "$recovery" = f ] && break
  sleep 5
done
[ "${recovery:-}" = f ] || fail standby_promotion_not_confirmed
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail standby_published_port_detected
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
printf 'promotion_executed=true\nstandby_in_recovery=false\ndo_writer_fenced=true\npublic_database_listener_enabled=false\n' >> "$promotion_state"
printf 'hostinger_current_topology_promotion_format=lemtel_hostinger_current_topology_promotion_v1\n'
printf 'writer=hostinger_promoted_writer\nincident_id_matched=true\ndo_writer_fence_attestation_signature_verified=true\nstandby_promoted=true\nstandby_in_recovery=false\npublic_database_listener_enabled=false\nruntime_started=false\ndns_change_executed=false\nautomatic_traffic_routing_enabled=false\ntelephony_contacted=false\ncredential_values_emitted=false\nhostinger_current_topology_promotion_status=complete\n'
