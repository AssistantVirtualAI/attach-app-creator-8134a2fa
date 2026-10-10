#!/usr/bin/env bash
# Root-only initialization of the DigitalOcean physical PostgreSQL standby from Hostinger over WireGuard.
# Requires an encrypted envelope created for this host's local age identity.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'standby_basebackup_status=root_required\n' >&2
    exit 1
  fi
}

fail() {
  printf 'standby_basebackup_status=%s\n' "$1" >&2
  exit 1
}

require_root
[ "${LEMTEL_HA_EXECUTE:-}" = 'initialize_private_postgres_standby' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

primary_tunnel_address='10.253.47.1'
image='supabase/postgres:17.6.1.136'
base_dir="${LEMTEL_HA_STANDBY_BASE_DIR:-/opt/lemtel-ha}"
data_dir="$base_dir/postgres/data"
identity='/etc/lemtel-ha/age/identity.txt'
envelope='/home/lemtelops/.lemtel-ha/replication-password.age'
root_envelope='/etc/lemtel-ha/secrets/replication-password.age'
pgpass='/etc/lemtel-ha/secrets/replication.pgpass'
container='lemtel-postgres-standby'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 {print $2}')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
docker image inspect "$image" >/dev/null 2>&1 || fail expected_postgres_image_missing
[ -f "$identity" ] || fail age_identity_missing
[ -f "$envelope" ] || fail encrypted_replication_envelope_missing
if docker inspect "$container" >/dev/null 2>&1; then fail standby_container_already_exists; fi
install -d -m 0700 /etc/lemtel-ha/secrets "$data_dir"
if find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then fail standby_data_directory_not_empty; fi

install -m 0600 "$envelope" "$root_envelope"
rm -f "$envelope"
password="$(age -d -i "$identity" "$root_envelope")"
case "$password" in
  ''|*[!0-9A-Fa-f]*) fail invalid_decrypted_replication_password ;;
esac
printf '%s\n' "${primary_tunnel_address}:5432:*:lemtel_ha_replication:${password}" > "$pgpass"
chmod 0600 "$pgpass"
standby_started=false
cleanup() {
  status=$?
  rm -f "$pgpass"
  if [ "$status" -ne 0 ] && [ "$standby_started" = true ]; then
    docker stop --time 15 "$container" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT

# The one-shot client has no listener. It reaches the primary only through the host WireGuard interface.
docker run --rm --network host \
  -v "$data_dir:/var/lib/postgresql/data" \
  -v "$pgpass:/run/lemtel-ha/pgpass:ro" \
  -e PGPASSFILE=/run/lemtel-ha/pgpass \
  --entrypoint pg_basebackup "$image" \
  -h "$primary_tunnel_address" -p 5432 -U lemtel_ha_replication \
  -D /var/lib/postgresql/data -Fp -Xs -P -R -S lemtel_do_standby

uid="$(docker run --rm --entrypoint id "$image" -u postgres)"
gid="$(docker run --rm --entrypoint id "$image" -g postgres)"
case "$uid:$gid" in
  *[!0-9:]*|:) fail invalid_postgres_image_identity ;;
esac
# The password remains local to the standby data directory. The primary_conninfo holds only its private path.
install -m 0600 "$pgpass" "$data_dir/lemtel-ha-replication.pgpass"
sed -i "s|^primary_conninfo = .*|primary_conninfo = 'host=${primary_tunnel_address} port=5432 user=lemtel_ha_replication application_name=lemtel_do_standby passfile=/var/lib/postgresql/data/lemtel-ha-replication.pgpass'|" "$data_dir/postgresql.auto.conf"
grep -Fqx "primary_conninfo = 'host=${primary_tunnel_address} port=5432 user=lemtel_ha_replication application_name=lemtel_do_standby passfile=/var/lib/postgresql/data/lemtel-ha-replication.pgpass'" "$data_dir/postgresql.auto.conf" || fail primary_conninfo_write_failed
# pg_basebackup copies the primary configuration. The primary may intentionally keep
# hot_standby off, but this read-only replica must enable it to accept recovery checks.
sed -i '/^[[:space:]]*hot_standby[[:space:]]*=/d' "$data_dir/postgresql.auto.conf"
printf '%s\n' 'hot_standby = on' >> "$data_dir/postgresql.auto.conf"
grep -Fqx 'hot_standby = on' "$data_dir/postgresql.auto.conf" || fail hot_standby_enable_failed
unset password
chown -R "$uid:$gid" "$data_dir"

# No host port is published: the standby only receives WAL through its outbound WireGuard connection.
docker run -d --name "$container" --restart unless-stopped \
  --security-opt no-new-privileges:true \
  -v "$data_dir:/var/lib/postgresql/data" \
  "$image" >/dev/null
standby_started=true
for _ in $(seq 1 45); do
  if docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true \
    && docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null | grep -qx true; then
    break
  fi
  sleep 2
done
docker inspect --format '{{.State.Running}}' "$container" | grep -qx true || fail standby_container_not_running
docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx true || fail standby_not_in_recovery
ports="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$container")"
[ "$ports" = 'null' ] || fail standby_published_port_detected
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
receiver="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')"
[ "$receiver" = streaming ] || fail wal_receiver_not_streaming

printf 'standby_basebackup_format=lemtel_standby_basebackup_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'standby_database_container=%s\n' "$container"
printf 'standby_in_recovery=true\n'
printf 'wal_receiver_status=streaming\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'plaintext_secret_replication=false\n'
printf 'storage_replication_started=false\n'
printf 'dns_failover_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'standby_basebackup_status=complete\n'
