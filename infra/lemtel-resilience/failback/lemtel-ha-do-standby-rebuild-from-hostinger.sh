#!/usr/bin/env bash
# FAILBACK step 2 — on the FENCED DigitalOcean server, while Hostinger is the promoted writer.
# Rebuilds the DigitalOcean database as a physical standby of Hostinger (pg_basebackup over WireGuard):
#   - refuses unless DO is fenced (boot fence) with its Lemtel runtime stopped, Hostinger answers as the writer,
#     and a replication login to Hostinger succeeds BEFORE anything is changed;
#   - keeps the old database: the container is renamed (removed once the new standby streams) and the
#     data directory moved to /opt/lemtel-ha/postgres/data.retired-<UTC> (same filesystem, instant);
#   - recreates lemtel-postgres-standby with the same image, environment, networks/aliases and hba file;
#   - any failure before the new standby streams restores the previous container and data directory (stopped).
# Never promotes, never starts the runtime, never publishes PostgreSQL, never touches DNS.
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'do_standby_rebuild_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = rebuild_do_standby_from_promoted_hostinger ] || fail execution_token_required
[ "${LEMTEL_HA_ACK:-}" = I_UNDERSTAND_DO_DATABASE_IS_REPLACED_BY_A_COPY_OF_HOSTINGER ] || fail acknowledgement_required

container='lemtel-postgres-standby'
image='supabase/postgres:17.6.1.136'
project='lemtel-ha-standby'
hostinger_tunnel='10.253.47.1'
do_tunnel='10.253.47.2'
slot='lemtel_do_standby'
base="$T/opt/lemtel-ha/postgres"
data="$base/data"
password_file="$T/etc/lemtel-ha/secrets/postgres-replication-hostinger.password"
fence_state="$T/var/lib/lemtel-ha/boot-fence/fenced"
work="$T/run/lemtel-ha/do-standby-rebuild"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
retired_container="lemtel-postgres-retired-$stamp"
retired_data="$base/data.retired-$stamp"
relay_unit='lemtel-ha-do-postgres-wireguard-relay.service'

command -v docker >/dev/null 2>&1 || fail docker_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
ip -brief address show lemtel-ha0 | grep -Fq "$do_tunnel" || fail do_tunnel_address_missing
docker image inspect "$image" >/dev/null 2>&1 || fail postgres_image_missing

# A. DigitalOcean is fenced and serves nothing.
[ -f "$fence_state" ] || fail do_not_fenced_run_only_after_failover
running="$(docker ps -q --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
[ "$running" = 0 ] || fail do_runtime_still_running
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.Config.Image}}' "$container")" = "$image" ] || fail unexpected_database_image
[ "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' "$container")" = "${data#$T}" ] \
  || fail unexpected_data_directory
[ -d "$data" ] || fail data_directory_missing

# B. Hostinger is the writer and accepts our replication login (read-only checks, nothing changed yet).
[ -f "$password_file" ] && [ "$(stat -c '%a' "$password_file")" = 600 ] || fail replication_password_missing
password="$(tr -d '[:space:]' < "$password_file")"
case "$password" in ''|*[!0-9A-Za-z]*) fail replication_password_invalid ;; esac
install -d -m 0700 "$work"
pgpass="$work/pgpass"
printf '%s\n' "${hostinger_tunnel}:5432:*:lemtel_ha_replication:${password}" > "$pgpass"; chmod 0600 "$pgpass"
unset password
cleanup_secret() { rm -f -- "$pgpass" "$work/env"; }
client() { docker run --rm --network host -v "${pgpass#$T}:/run/lemtel-ha/pgpass:ro" -e PGPASSFILE=/run/lemtel-ha/pgpass -e PGCONNECT_TIMEOUT=10 "$@"; }
probe_err="$work/probe.err"
remote_recovery="$(client --entrypoint psql "$image" -X -At -h "$hostinger_tunnel" -U lemtel_ha_replication -d postgres -c 'SELECT pg_is_in_recovery()' 2>"$probe_err" || true)"
if [ "$remote_recovery" != f ]; then
  # Name the cause from libpq's message class (never the message itself, never a secret).
  cause=hostinger_not_reachable_as_writer
  if grep -qi 'timeout expired\|timed out' "$probe_err"; then cause=hostinger_relay_unreachable_check_firewall_or_tunnel
  elif grep -qi 'connection refused' "$probe_err"; then cause=hostinger_relay_not_listening_run_step_1
  elif grep -qi 'no pg_hba.conf entry' "$probe_err"; then cause=hostinger_hba_refuses_do_run_step_1
  elif grep -qi 'password authentication failed' "$probe_err"; then cause=replication_password_mismatch
  elif [ "$remote_recovery" = t ]; then cause=hostinger_is_still_a_standby; fi
  rm -f -- "$probe_err"; cleanup_secret; fail "$cause"
fi
rm -f -- "$probe_err"
remote_slot="$(client --entrypoint psql "$image" -X -At -h "$hostinger_tunnel" -U lemtel_ha_replication -d postgres -c "SELECT count(*) FROM pg_replication_slots WHERE slot_name = '$slot' AND NOT active" 2>/dev/null || true)"
[ "$remote_slot" = 1 ] || { cleanup_secret; fail hostinger_slot_missing_run_step_1; }
client --entrypoint psql "$image" -X -At "host=$hostinger_tunnel user=lemtel_ha_replication replication=true dbname=postgres" -c 'IDENTIFY_SYSTEM' >/dev/null 2>&1 \
  || { cleanup_secret; fail hostinger_replication_login_refused; }

# C. Capture what the new container must keep: environment, extra networks/aliases, hba file.
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | grep -v '^$' > "$work/env" || true
chmod 0600 "$work/env"
networks="$(docker inspect --format '{{range $n, $v := .NetworkSettings.Networks}}{{$n}}={{join $v.Aliases ","}}{{println}}{{end}}' "$container" | grep -v '^$' || true)"
hba_path="$(docker exec -u postgres "$container" psql -X -At -d postgres -c "SELECT current_setting('hba_file')" 2>/dev/null || echo /etc/postgresql/pg_hba.conf)"
[[ "$hba_path" =~ ^/[A-Za-z0-9/._-]+$ ]] || fail hba_path_invalid
docker cp "$container:$hba_path" "$work/pg_hba.conf" >/dev/null || fail hba_copy_failed

# D. Retire (reversible until the new standby streams).
restored=false; created=false; moved=false; renamed=false; done_ok=false
rollback() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$done_ok" != true ]; then
    [ "$created" = true ] && docker rm -f "$container" >/dev/null 2>&1
    if [ "$moved" = true ]; then rm -rf -- "$data"; mv -- "$retired_data" "$data"; fi
    [ "$renamed" = true ] && docker rename "$retired_container" "$container" >/dev/null 2>&1
    restored=true
    printf 'rollback=previous_database_restored_stopped\n' >&2
  fi
  cleanup_secret
  exit "$status"
}
trap rollback EXIT
docker update --restart=no "$container" >/dev/null
docker stop --time 60 "$container" >/dev/null
docker rename "$container" "$retired_container"; renamed=true
mv -- "$data" "$retired_data"; moved=true
install -d -m 0700 "$data"

# E. Base backup from Hostinger through the tunnel (client has no listener), then standby settings.
client -v "${data#$T}:/var/lib/postgresql/data" --entrypoint pg_basebackup "$image" \
  -h "$hostinger_tunnel" -p 5432 -U lemtel_ha_replication -D /var/lib/postgresql/data -Fp -Xs -R -S "$slot" >/dev/null 2>&1 \
  || fail basebackup_failed
[ -f "$data/standby.signal" ] || fail standby_signal_missing
install -m 0600 "$pgpass" "$data/lemtel-ha-replication.pgpass"
auto="$data/postgresql.auto.conf"
sed -i -E '/^[[:space:]]*(primary_conninfo|primary_slot_name|hot_standby|synchronous_standby_names)[[:space:]]*=/d' "$auto"
{
  printf "primary_conninfo = 'host=%s port=5432 user=lemtel_ha_replication application_name=lemtel_do_standby passfile=/var/lib/postgresql/data/lemtel-ha-replication.pgpass'\n" "$hostinger_tunnel"
  printf "primary_slot_name = '%s'\n" "$slot"
  printf 'hot_standby = on\n'
} >> "$auto"
uid="$(docker run --rm --entrypoint id "$image" -u postgres)"; gid="$(docker run --rm --entrypoint id "$image" -g postgres)"
case "$uid:$gid" in *[!0-9:]*|:) fail invalid_postgres_image_identity ;; esac
chown -R "$uid:$gid" "$data"

# F. Same container identity as before; no published port.
docker create --name "$container" --restart unless-stopped --security-opt no-new-privileges:true \
  --env-file "${work#$T}/env" -v "${data#$T}:/var/lib/postgresql/data" "$image" >/dev/null; created=true
docker cp "$work/pg_hba.conf" "$container:$hba_path" >/dev/null || fail hba_restore_failed
while IFS='=' read -r net aliases; do
  [ -n "$net" ] && [ "$net" != bridge ] || continue
  args=(); IFS=',' read -r -a list <<< "$aliases"
  for alias in "${list[@]}"; do [[ "$alias" =~ ^[a-z][a-z0-9_.-]*$ ]] && ! [[ "$alias" =~ ^[0-9a-f]{12}$ ]] && [ "$alias" != "$container" ] && args+=(--alias "$alias"); done
  docker network connect "${args[@]}" "$net" "$container" >/dev/null || fail network_reconnect_failed
done <<< "$networks"
docker start "$container" >/dev/null
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
done_ok=true
# Only the data directory is kept: a second postgres container would break the standby checks (exactly one).
docker rm "$retired_container" >/dev/null 2>&1 || true
# The DigitalOcean relay resolves the container address at start: point it at the new container.
systemctl restart "$relay_unit" >/dev/null 2>&1 || true

printf 'do_standby_rebuild_format=lemtel_do_standby_rebuild_v1\n'
printf 'source=hostinger_promoted_writer\nstandby_in_recovery=true\nwal_receiver_status=streaming\n'
printf 'retired_container=removed\nretired_data_directory=%s\n' "${retired_data#$T}"
printf 'do_promoted=false\nruntime_started=false\npublic_database_listener_enabled=false\ndo_standby_rebuild_status=complete\n'
