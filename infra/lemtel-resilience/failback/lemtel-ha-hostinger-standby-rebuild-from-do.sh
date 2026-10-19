#!/usr/bin/env bash
# FAILBACK step 5 — on Hostinger, after DigitalOcean was promoted back (step 4).
# Turns Hostinger back into the private hot standby the automatic failover expects:
#   - refuses unless Hostinger was fenced by step 3, its promoted runtime is stopped, DigitalOcean answers as the
#     writer and a replication login to DigitalOcean succeeds BEFORE anything is changed;
#   - removes the promoted runtime (containers and network), its storage link and readiness-marker units, and the
#     failback relay (the standby attestation refuses any host :5432 listener);
#   - keeps the old database directory (data.retired-<UTC>), rebuilds
#     lemtel-postgres-hostinger-standby with pg_basebackup from DigitalOcean (slot lemtel_hostinger_standby);
#   - archives the incident evidence so the next failover starts clean.
# Never promotes, never starts the runtime, never publishes PostgreSQL, never touches DNS.
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'hostinger_standby_rebuild_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = rebuild_hostinger_standby_from_digitalocean ] || fail execution_token_required

container='lemtel-postgres-hostinger-standby'
image='supabase/postgres:17.6.1.136'
project='lemtel-ha-hostinger-promoted'
do_tunnel='10.253.47.2'
hostinger_tunnel='10.253.47.1'
slot='lemtel_hostinger_standby'
base="$T/opt/lemtel-ha/postgres"
data="$base/data"
stage="$T/opt/lemtel-ha/runtime-stage"
identity="$T/etc/lemtel-ha/age/identity.txt"
envelope="$T/etc/lemtel-ha/secrets/replication-password-hostinger.age"
failback_state="$T/var/lib/lemtel-ha/failback"
evidence="$T/var/lib/lemtel-ha/current-topology-evidence"
work="$T/run/lemtel-ha/hostinger-standby-rebuild"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
retired_container="lemtel-postgres-retired-$stamp"
retired_data="$base/data.retired-$stamp"

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
ip -brief address show lemtel-ha0 | grep -Fq "$hostinger_tunnel" || fail hostinger_tunnel_address_missing
docker image inspect "$image" >/dev/null 2>&1 || fail postgres_image_missing
[ -f "$failback_state/fenced" ] || fail hostinger_not_fenced_by_handback
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail database_still_running
[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$project")" ] || fail promoted_runtime_still_running

# Read-only checks against DigitalOcean first.
[ -f "$identity" ] && [ -f "$envelope" ] || fail replication_secret_missing
password="$(age -d -i "$identity" "$envelope")"
case "$password" in ''|*[!0-9A-Za-z]*) fail replication_password_invalid ;; esac
install -d -m 0700 "$work"
pgpass="$work/pgpass"
printf '%s\n' "${do_tunnel}:5432:*:lemtel_ha_replication:${password}" > "$pgpass"; chmod 0600 "$pgpass"
unset password
client() { docker run --rm --network host -v "${pgpass#$T}:/run/lemtel-ha/pgpass:ro" -e PGPASSFILE=/run/lemtel-ha/pgpass "$@"; }
q() { client --entrypoint psql "$image" -X -At -h "$do_tunnel" -U lemtel_ha_replication -d postgres -c "$1" 2>/dev/null || true; }
[ "$(q 'SELECT pg_is_in_recovery()')" = f ] || { rm -f "$pgpass"; fail digitalocean_not_reachable_as_writer; }
slot_state="$(q "SELECT CASE WHEN active THEN 'active' ELSE 'inactive' END FROM pg_replication_slots WHERE slot_name = '$slot'")"
[ "$slot_state" != active ] || { rm -f "$pgpass"; fail slot_already_in_use; }
client --entrypoint psql "$image" -X -At "host=$do_tunnel user=lemtel_ha_replication replication=true dbname=postgres" -c 'IDENTIFY_SYSTEM' >/dev/null 2>&1 \
  || { rm -f "$pgpass"; fail digitalocean_replication_login_refused; }

# Remove everything the promoted writer added (runtime, network, storage link, marker units, relay).
relay_tool="$(dirname "$0")/lemtel-ha-hostinger-writer-replication-enable.sh"
[ -f "$relay_tool" ] && { bash "$relay_tool" remove >/dev/null || fail relay_removal_failed; }
mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$project")
[ "${#ids[@]}" -eq 0 ] || docker rm -f "${ids[@]}" >/dev/null
for net in $(docker network ls -q --filter "label=com.docker.compose.project=$project"); do
  docker network disconnect -f "$net" "$container" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null || fail promoted_network_removal_failed
done
[ -L "$stage/volumes/storage" ] && rm -f -- "$stage/volumes/storage"
rm -f -- "$stage/volumes/proxy/caddy/lemtel-lb-ready.json" "$stage/volumes/proxy/caddy/lemtel-lb-ready"
systemctl disable --now lemtel-ha-hostinger-lb-ready.timer >/dev/null 2>&1 || true
rm -f -- "$T/etc/systemd/system/lemtel-ha-hostinger-lb-ready.timer" "$T/etc/systemd/system/lemtel-ha-hostinger-lb-ready.service"
systemctl daemon-reload >/dev/null 2>&1 || true

# Retire the old database (kept for review), rebuild from DigitalOcean.
created=false; moved=false; renamed=false; done_ok=false
rollback() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$done_ok" != true ]; then
    [ "$created" = true ] && docker rm -f "$container" >/dev/null 2>&1
    if [ "$moved" = true ]; then rm -rf -- "$data"; mv -- "$retired_data" "$data"; fi
    [ "$renamed" = true ] && docker rename "$retired_container" "$container" >/dev/null 2>&1
    printf 'rollback=previous_database_restored_stopped\n' >&2
  fi
  rm -f -- "$pgpass"
  exit "$status"
}
trap rollback EXIT
docker rename "$container" "$retired_container"; renamed=true
mv -- "$data" "$retired_data"; moved=true
install -d -m 0700 "$data"
create_slot=(); [ -n "$slot_state" ] || create_slot=(-C)
client -v "${data#$T}:/var/lib/postgresql/data" --entrypoint pg_basebackup "$image" \
  -h "$do_tunnel" -p 5432 -U lemtel_ha_replication -D /var/lib/postgresql/data -Fp -Xs -R "${create_slot[@]}" -S "$slot" >/dev/null 2>&1 \
  || fail basebackup_failed
[ -f "$data/standby.signal" ] || fail standby_signal_missing
install -m 0600 "$pgpass" "$data/lemtel-ha-replication.pgpass"
auto="$data/postgresql.auto.conf"
sed -i -E '/^[[:space:]]*(primary_conninfo|primary_slot_name|hot_standby|synchronous_standby_names)[[:space:]]*=/d' "$auto"
{
  printf "primary_conninfo = 'host=%s port=5432 user=lemtel_ha_replication application_name=lemtel_hostinger_standby passfile=/var/lib/postgresql/data/lemtel-ha-replication.pgpass'\n" "$do_tunnel"
  printf "primary_slot_name = '%s'\n" "$slot"
  printf 'hot_standby = on\n'
} >> "$auto"
uid="$(docker run --rm --entrypoint id "$image" -u postgres)"; gid="$(docker run --rm --entrypoint id "$image" -g postgres)"
case "$uid:$gid" in *[!0-9:]*|:) fail invalid_postgres_image_identity ;; esac
chown -R "$uid:$gid" "$data"
docker run -d --name "$container" --restart unless-stopped --security-opt no-new-privileges:true \
  -v "${data#$T}:/var/lib/postgresql/data" "$image" >/dev/null; created=true
streaming=false
for _ in $(seq 1 90); do
  if [ "$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null)" = t ] \
     && [ "$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1' 2>/dev/null)" = streaming ]; then
    streaming=true; break
  fi
  sleep 2
done
[ "$streaming" = true ] || fail new_standby_not_streaming
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail published_port_detected
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
done_ok=true
# Only the data directory is kept: a second postgres container would break the standby checks (exactly one).
docker rm "$retired_container" >/dev/null 2>&1 || true

# Archive the incident and failback evidence: the next failover must start from a clean slate.
archive="$T/var/lib/lemtel-ha/failback-archive/$stamp"
install -d -m 0700 "$archive"
for f in "$evidence"/* "$failback_state"/*; do [ -e "$f" ] && mv -- "$f" "$archive/"; done

printf 'hostinger_standby_rebuild_format=lemtel_hostinger_standby_rebuild_v1\n'
printf 'source=digitalocean_writer\nstandby_in_recovery=true\nwal_receiver_status=streaming\nreplication_slot=%s\n' "$slot"
printf 'promoted_runtime_removed=true\nrelay_removed=true\nevidence_archived=%s\n' "${archive#$T}"
printf 'retired_container=removed\nretired_data_directory=%s\n' "${retired_data#$T}"
printf 'public_database_listener_enabled=false\nhostinger_standby_rebuild_status=complete\n'
