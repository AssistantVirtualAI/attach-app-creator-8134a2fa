#!/usr/bin/env bash
# FAILBACK step 1 — on the PROMOTED Hostinger writer (after an automatic or drilled failover).
# Lets the fenced DigitalOcean server rebuild itself as a physical standby of Hostinger:
#   - replication rule for lemtel_ha_replication from the Docker bridge gateway (the relay source),
#   - physical replication slot lemtel_do_standby,
#   - private relay 10.253.47.1:5432 -> database container, accepting ONLY 10.253.47.2 (the DO tunnel peer).
# Never publishes a Docker port, never listens on a public address, never touches DNS or the runtime.
# Idempotent. Must NOT run before promotion: the standby attestation refuses any host :5432 listener.
#   usage: install | remove | status    (root; install also needs LEMTEL_HA_EXECUTE=enable_hostinger_writer_replication_for_failback)
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only (fixtures and fake tools on PATH)
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'hostinger_writer_replication_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"
case "$mode" in install|remove|status) ;; *) fail usage_install_remove_or_status ;; esac
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required

container='lemtel-postgres-hostinger-standby'
hostinger_tunnel='10.253.47.1'
do_tunnel='10.253.47.2'
slot='lemtel_do_standby'
relay_unit_name='lemtel-ha-hostinger-postgres-wireguard-relay.service'
relay_unit="$T/etc/systemd/system/$relay_unit_name"
relay_script="$T/usr/local/libexec/lemtel-ha-hostinger-postgres-wireguard-relay"
psql() { docker exec -u postgres "$container" psql -X -At -d postgres -v ON_ERROR_STOP=1 -c "$1"; }

relay_listening() { ss -H -ltn "sport = :5432" 2>/dev/null | awk '{print $4}' | grep -Fqx "${hostinger_tunnel}:5432"; }

if [ "$mode" = status ]; then
  printf 'hostinger_writer_replication_format=lemtel_hostinger_writer_replication_v1\n'
  printf 'database_in_recovery=%s\n' "$(psql 'SELECT pg_is_in_recovery()' 2>/dev/null || echo unknown)"
  printf 'replication_slot=%s\n' "$(psql "SELECT CASE WHEN count(*) = 1 THEN 'present' ELSE 'absent' END FROM pg_replication_slots WHERE slot_name = '$slot'" 2>/dev/null || echo unknown)"
  printf 'do_standby_streaming=%s\n' "$(psql "SELECT count(*) FROM pg_stat_replication WHERE application_name = 'lemtel_do_standby' AND state = 'streaming'" 2>/dev/null || echo unknown)"
  printf 'relay_listening=%s\n' "$(relay_listening && echo true || echo false)"
  printf 'hostinger_writer_replication_status=complete\n'
  exit 0
fi

if [ "$mode" = remove ]; then
  # Used when Hostinger becomes a standby again: no host :5432 listener may remain.
  systemctl disable --now "$relay_unit_name" >/dev/null 2>&1 || true
  rm -f -- "$relay_unit" "$relay_script"
  systemctl daemon-reload >/dev/null 2>&1 || true
  relay_listening && fail relay_still_listening
  printf 'relay_removed=true\nhostinger_writer_replication_status=complete\n'
  exit 0
fi

[ "${LEMTEL_HA_EXECUTE:-}" = enable_hostinger_writer_replication_for_failback ] || fail execution_token_required
command -v docker >/dev/null 2>&1 || fail docker_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
ip -brief address show lemtel-ha0 | grep -Fq "$hostinger_tunnel" || fail hostinger_tunnel_address_missing
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail database_not_running
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail database_port_published
# Only a promoted writer may serve replication to DigitalOcean.
[ "$(psql 'SELECT pg_is_in_recovery()')" = f ] || fail hostinger_not_promoted_writer
[ "$(psql "SELECT count(*) FROM pg_roles WHERE rolname = 'lemtel_ha_replication' AND rolreplication AND rolcanlogin")" = 1 ] \
  || fail replication_role_missing

# 1. Replication rule (inside the container's hba file, exactly like the DigitalOcean writer), then reload.
hba="$(psql "SELECT current_setting('hba_file')")"
[[ "$hba" =~ ^/[A-Za-z0-9/._-]+$ ]] || fail hba_path_invalid
# The relay always reaches the database on Docker's DEFAULT bridge network, so PostgreSQL sees the docker0 address.
# (After promotion the container is also on the runtime network; its gateway must not be used: first drill, 2026-10-19.)
bridge_ip="$(docker inspect --format '{{with index .NetworkSettings.Networks "bridge"}}{{.IPAddress}}{{end}}' "$container")"
[[ "$bridge_ip" =~ ^(172\.(1[6-9]|2[0-9]|3[0-1])|10|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || fail database_not_on_default_bridge
gateway="$(ip -4 -o address show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
[[ "$gateway" =~ ^(172\.(1[6-9]|2[0-9]|3[0-1])|10|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || fail bridge_gateway_unresolved
rule="host replication lemtel_ha_replication ${gateway}/32 scram-sha-256"
hba_added=false
if ! docker exec -u postgres "$container" grep -Fqx "$rule" "$hba"; then
  docker exec -u 0 "$container" sh -eu -c "printf '%s\n' '$rule' >> '$hba'"
  hba_added=true
fi
[ "$(psql 'SELECT pg_reload_conf()')" = t ] || fail hba_reload_failed
[ "$(psql "SELECT count(*) FROM pg_hba_file_rules WHERE 'replication' = ANY(database) AND 'lemtel_ha_replication' = ANY(user_name) AND address = '$gateway' AND error IS NULL")" -ge 1 ] \
  || fail hba_rule_not_active

# 2. Physical slot so the DigitalOcean rebuild never misses WAL.
if [ "$(psql "SELECT count(*) FROM pg_replication_slots WHERE slot_name = '$slot'")" = 0 ]; then
  psql "SELECT pg_create_physical_replication_slot('$slot', true)" >/dev/null
fi
[ "$(psql "SELECT slot_type FROM pg_replication_slots WHERE slot_name = '$slot'")" = physical ] || fail replication_slot_invalid

# 3. Private relay: tunnel address only, DigitalOcean peer only. Resolves the container address at each start.
if ! command -v socat >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends socat >/dev/null 2>&1 \
    || { apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends socat >/dev/null; }
fi
command -v socat >/dev/null 2>&1 || fail socat_missing
install -d -m 0755 "$(dirname "$relay_script")" "$(dirname "$relay_unit")"
cat > "$relay_script.tmp" <<RELAY
#!/usr/bin/env bash
set -euo pipefail
ip="\$(docker inspect --format '{{with index .NetworkSettings.Networks "bridge"}}{{.IPAddress}}{{end}}' $container)"
[ -n "\$ip" ] || exit 1
exec /usr/bin/socat "TCP-LISTEN:5432,bind=${hostinger_tunnel},reuseaddr,fork,range=${do_tunnel}/32" "TCP:\${ip}:5432"
RELAY
chmod 0755 "$relay_script.tmp"; mv -f "$relay_script.tmp" "$relay_script"
cat > "$relay_unit.tmp" <<UNIT
[Unit]
Description=Lemtel failback: private PostgreSQL relay for the DigitalOcean standby (WireGuard only)
After=docker.service wg-quick@lemtel-ha0.service
Requires=wg-quick@lemtel-ha0.service

[Service]
ExecStart=/usr/local/libexec/lemtel-ha-hostinger-postgres-wireguard-relay
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$relay_unit.tmp"; mv -f "$relay_unit.tmp" "$relay_unit"
systemctl daemon-reload
systemctl enable "$relay_unit_name" >/dev/null 2>&1
systemctl restart "$relay_unit_name"
ok=false
for _ in 1 2 3 4 5 6 7 8 9 10; do relay_listening && { ok=true; break; }; sleep 1; done
[ "$ok" = true ] || fail relay_not_listening
# Nothing else may listen on :5432 (in particular no public address).
if ss -H -ltn "sport = :5432" | awk '{print $4}' | grep -Fvx "${hostinger_tunnel}:5432" | grep -q .; then fail unexpected_postgres_listener; fi

printf 'hostinger_writer_replication_format=lemtel_hostinger_writer_replication_v1\n'
printf 'hba_rule=%s\n' "$([ "$hba_added" = true ] && echo added || echo already_present)"
printf 'replication_slot=%s\nrelay=%s:5432_from_%s_only\n' "$slot" "$hostinger_tunnel" "$do_tunnel"
printf 'public_database_listener_enabled=false\ndns_change_executed=false\nhostinger_writer_replication_status=complete\n'
