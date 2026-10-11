#!/usr/bin/env bash
# Root-only manual promotion of the private PostgreSQL warm standby after primary fencing.
# This action is intentionally irreversible: it never starts runtime services or changes DNS.
set -euo pipefail

fail() {
  printf 'standby_promotion_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'promote_standby_after_verified_primary_fence' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_STANDBY_PROMOTION:-}" = 'I_UNDERSTAND_STANDBY_BECOMES_THE_ONLY_WRITER' ] || fail promotion_acknowledgement_required

incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
case "$incident_id" in ''|*[!a-z0-9-]*) fail invalid_incident_id ;; esac
[ "${#incident_id}" -ge 8 ] || fail invalid_incident_id

container='lemtel-postgres-standby'
primary_tunnel_address='10.253.47.1'
evidence_file='/home/lemtelops/.lemtel-ha/primary-fence.state'
state_dir='/var/lib/lemtel-ha/fencing'
state_file="$state_dir/standby-promotion.state"
lock_file='/var/lock/lemtel-ha-standby-promotion.lock'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
command -v timeout >/dev/null 2>&1 || fail timeout_missing
command -v ss >/dev/null 2>&1 || fail ss_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
[ -s "$evidence_file" ] || fail primary_fence_evidence_missing
[ ! -e "$state_file" ] || fail standby_promotion_state_exists

grep -Fxq 'format=lemtel_primary_fence_v1' "$evidence_file" || fail primary_fence_evidence_invalid
grep -Fxq "incident_id=$incident_id" "$evidence_file" || fail primary_fence_evidence_incident_mismatch
grep -Fxq 'container=supabase-db' "$evidence_file" || fail primary_fence_evidence_container_invalid
grep -Fxq 'fenced_database_running=false' "$evidence_file" || fail primary_fence_evidence_not_complete
grep -Fxq 'fenced_restart_policy=no' "$evidence_file" || fail primary_fence_evidence_not_complete

docker inspect "$container" >/dev/null 2>&1 || fail standby_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail standby_container_not_running
if docker port "$container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

exec 9>"$lock_file"
flock -n 9 || fail concurrent_standby_promotion

pre_promotion_recovery="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()')"
[ "$pre_promotion_recovery" = t ] || fail standby_not_in_recovery

# This independently confirms that the fenced private writer is no longer reachable.
if timeout 3 bash -c "</dev/tcp/${primary_tunnel_address}/5432" 2>/dev/null; then
  fail primary_writer_still_reachable
fi

# Once fencing has stopped the writer, PostgreSQL correctly tears down the WAL
# receiver. Require either a still-streaming receiver (race-free early fence) or
# a genuine physical standby with a last received/replayed WAL position. This is
# not a bypass: the primary is already unreachable and `standby.signal` remains.
receiver="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1' || true)"
if [ "$receiver" = streaming ]; then
  wal_receiver_evidence='streaming'
else
  docker exec -u postgres "$container" test -f /var/lib/postgresql/data/standby.signal || fail standby_signal_missing
  wal_position_available="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_last_wal_receive_lsn() IS NOT NULL AND pg_last_wal_replay_lsn() IS NOT NULL')"
  [ "$wal_position_available" = t ] || fail standby_wal_position_missing
  wal_receiver_evidence='detached_after_primary_fence'
fi

install -d -o root -g root -m 0700 "$state_dir"
umask 077
printf 'format=lemtel_standby_promotion_v1\nincident_id=%s\ncontainer=%s\npromoted_at_utc=%s\n' \
  "$incident_id" "$container" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$state_file"
chmod 0600 "$state_file"

# pg_ctl promote is one-way. No rollback starts the former primary.
docker exec -u postgres "$container" pg_ctl promote -D /var/lib/postgresql/data >/dev/null
for _ in $(seq 1 36); do
  recovery="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null || true)"
  [ "$recovery" = f ] && break
  sleep 5
done
[ "${recovery:-}" = f ] || fail standby_promotion_not_confirmed

if docker port "$container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
printf 'standby_in_recovery=false\nprimary_writer_reachable=false\n' >> "$state_file"

printf 'standby_promotion_format=lemtel_standby_promotion_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'incident_id_matched=true\n'
printf 'primary_fence_evidence_verified=true\n'
printf 'primary_writer_reachable=false\n'
printf 'wal_receiver_evidence=%s\n' "$wal_receiver_evidence"
printf 'standby_database_container=lemtel-postgres-standby\n'
printf 'standby_promoted=true\n'
printf 'standby_in_recovery=false\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'runtime_started=false\n'
printf 'storage_runtime_started=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'former_primary_restart_attempted=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'standby_promotion_status=complete\n'
