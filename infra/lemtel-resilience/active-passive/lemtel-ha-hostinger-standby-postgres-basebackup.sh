#!/usr/bin/env bash
# Root-only initialization of the clean Hostinger physical PostgreSQL standby
# from the promoted DigitalOcean writer over the private WireGuard tunnel.
# It never publishes PostgreSQL, starts the public runtime, promotes, routes
# traffic, or contacts telephony.
set -euo pipefail

fail() {
  printf 'hostinger_standby_basebackup_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'initialize_hostinger_private_postgres_standby' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

writer_tunnel_address='10.253.47.2'
image='supabase/postgres:17.6.1.136'
base_dir='/opt/lemtel-ha'
data_dir="$base_dir/postgres/data"
identity='/etc/lemtel-ha/age/identity.txt'
envelope='/home/lemtelops/.lemtel-ha/replication-password-hostinger.age'
root_envelope='/etc/lemtel-ha/secrets/replication-password-hostinger.age'
pgpass='/etc/lemtel-ha/secrets/replication-hostinger.pgpass'
container='lemtel-postgres-hostinger-standby'
replication_slot='lemtel_hostinger_standby'
standby_started=false

cleanup() {
  local status=$?
  rm -f "$pgpass"
  if [ "$status" -ne 0 ] && [ "$standby_started" = true ]; then
    docker stop --time 15 "$container" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -Fq '10.253.47.1' || fail standby_tunnel_address_missing
docker image inspect "$image" >/dev/null 2>&1 || fail expected_postgres_image_missing
[ -f "$identity" ] || fail age_identity_missing
[ -f "$envelope" ] || fail encrypted_replication_envelope_missing
if docker inspect "$container" >/dev/null 2>&1; then fail standby_container_already_exists; fi
install -d -m 0700 /etc/lemtel-ha/secrets "$data_dir"
if find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then fail standby_data_directory_not_empty; fi

install -m 0600 "$envelope" "$root_envelope"
rm -f "$envelope"
password="$(age -d -i "$identity" "$root_envelope")"
case "$password" in ''|*[!0-9A-Fa-f]*) fail invalid_decrypted_replication_password ;; esac
printf '%s\n' "${writer_tunnel_address}:5432:*:lemtel_ha_replication:${password}" > "$pgpass"
chmod 0600 "$pgpass"

# This one-shot client has no listener. It connects only to the writer tunnel
# address through WireGuard and creates recovery metadata in the local volume.
docker run --rm --network host \
  -v "$data_dir:/var/lib/postgresql/data" \
  -v "$pgpass:/run/lemtel-ha/pgpass:ro" \
  -e PGPASSFILE=/run/lemtel-ha/pgpass \
  --entrypoint pg_basebackup "$image" \
  -h "$writer_tunnel_address" -p 5432 -U lemtel_ha_replication \
  -D /var/lib/postgresql/data -Fp -Xs -P -R -S "$replication_slot"

uid="$(docker run --rm --entrypoint id "$image" -u postgres)"
gid="$(docker run --rm --entrypoint id "$image" -g postgres)"
case "$uid:$gid" in *[!0-9:]*|:) fail invalid_postgres_image_identity ;; esac
install -m 0600 "$pgpass" "$data_dir/lemtel-ha-replication.pgpass"
sed -i "s|^primary_conninfo = .*|primary_conninfo = 'host=${writer_tunnel_address} port=5432 user=lemtel_ha_replication application_name=lemtel_hostinger_standby passfile=/var/lib/postgresql/data/lemtel-ha-replication.pgpass'|" "$data_dir/postgresql.auto.conf"
grep -Fqx "primary_conninfo = 'host=${writer_tunnel_address} port=5432 user=lemtel_ha_replication application_name=lemtel_hostinger_standby passfile=/var/lib/postgresql/data/lemtel-ha-replication.pgpass'" "$data_dir/postgresql.auto.conf" || fail primary_conninfo_write_failed
sed -i '/^[[:space:]]*hot_standby[[:space:]]*=/d' "$data_dir/postgresql.auto.conf"
printf '%s\n' 'hot_standby = on' >> "$data_dir/postgresql.auto.conf"
grep -Fqx 'hot_standby = on' "$data_dir/postgresql.auto.conf" || fail hot_standby_enable_failed
unset password
chown -R "$uid:$gid" "$data_dir"

# No host port is published. This instance only receives WAL from the writer.
docker run -d --name "$container" --restart unless-stopped \
  --security-opt no-new-privileges:true \
  -v "$data_dir:/var/lib/postgresql/data" \
  "$image" >/dev/null
standby_started=true
for _ in $(seq 1 60); do
  if docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true \
    && docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null | grep -qx t \
    && docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1' 2>/dev/null | grep -qx streaming; then
    break
  fi
  sleep 2
done
docker inspect --format '{{.State.Running}}' "$container" | grep -qx true || fail standby_container_not_running
docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx t || fail standby_not_in_recovery
docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1' | grep -qx streaming || fail wal_receiver_not_streaming
if docker port "$container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

printf 'hostinger_standby_basebackup_format=lemtel_hostinger_standby_basebackup_v1\n'
printf 'declared_role=hostinger_standby\n'
printf 'wireguard_handshake_verified=true\n'
printf 'standby_database_container=prepared\n'
printf 'standby_in_recovery=true\n'
printf 'wal_receiver_status=streaming\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'plaintext_secret_replication=false\n'
printf 'runtime_started=false\n'
printf 'storage_replication_started=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'hostinger_standby_basebackup_status=complete\n'
