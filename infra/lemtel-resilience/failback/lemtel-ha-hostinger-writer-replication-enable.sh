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
# Supabase images: the role "postgres" is NOT a superuser (no CHECKPOINT, pg_promote, ALTER SYSTEM, pg_hba_file_rules).
# The cluster superuser is supabase_admin, trusted on the container loopback. The session is chosen and PROVEN superuser
# before any change; a plain socket session is kept only when that role really is superuser.
su_args=()
pick_superuser() {
  if [ "$(docker exec -u postgres -e PGCONNECT_TIMEOUT=5 "$container" psql -X -At -d postgres -h 127.0.0.1 -U supabase_admin -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null)" = t ]; then
    su_args=(-h 127.0.0.1 -U supabase_admin); return 0
  fi
  [ "$(docker exec -u postgres -e PGCONNECT_TIMEOUT=5 "$container" psql -X -At -d postgres -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null)" = t ] && { su_args=(); return 0; }
  return 1
}
psql() { docker exec -u postgres "$container" psql -X -At -d postgres ${su_args[@]+"${su_args[@]}"} -v ON_ERROR_STOP=1 -c "$1"; }

relay_listening() { ss -H -ltn "sport = :5432" 2>/dev/null | awk '{print $4}' | grep -Fqx "${hostinger_tunnel}:5432"; }

if [ "$mode" = status ]; then
  pick_superuser || true
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
  if command -v ufw >/dev/null 2>&1; then
    ufw delete allow in on lemtel-ha0 from "$do_tunnel" to "$hostinger_tunnel" port 5432 proto tcp >/dev/null 2>&1 || true
  fi
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
pick_superuser || fail superuser_session_unavailable
# Only a promoted writer may serve replication to DigitalOcean.
[ "$(psql 'SELECT pg_is_in_recovery()')" = f ] || fail hostinger_not_promoted_writer
[ "$(psql "SELECT count(*) FROM pg_roles WHERE rolname = 'lemtel_ha_replication' AND rolreplication AND rolcanlogin")" = 1 ] \
  || fail replication_role_missing

# 1. Replication rule (inside the container's hba file, exactly like the DigitalOcean writer), then reload.
hba="$(psql "SELECT current_setting('hba_file')")"
[[ "$hba" =~ ^/[A-Za-z0-9/._-]+$ ]] || fail hba_path_invalid
# The relay reaches the database through ONE Docker network, chosen here and pinned in the relay; PostgreSQL then sees
# that network's gateway (the host side of the bridge). The default bridge is preferred when the container is on it.
private='^(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}$'
relay_net=''; relay_ip=''; gateway=''
while read -r net ip; do
  [ -n "$net" ] && [[ "$ip" =~ $private ]] || continue
  gw="$(docker network inspect --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' "$net" 2>/dev/null | grep -E "$private" | head -1 || true)"
  if [ -z "$gw" ]; then
    ifname="$(docker network inspect --format '{{index .Options "com.docker.network.bridge.name"}}' "$net" 2>/dev/null || true)"
    [ -n "$ifname" ] && [ "$ifname" != '<no value>' ] || ifname="br-$(docker network inspect --format '{{.Id}}' "$net" 2>/dev/null | cut -c1-12)"
    [ "$net" = bridge ] && ifname=docker0
    gw="$(ip -4 -o address show "$ifname" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  fi
  [[ "$gw" =~ $private ]] || continue
  if [ -z "$relay_net" ] || [ "$net" = bridge ]; then relay_net="$net"; relay_ip="$ip"; gateway="$gw"; fi
done < <(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{$v.IPAddress}}{{println}}{{end}}' "$container")
if ! [[ "$relay_net" =~ ^[A-Za-z0-9_.-]+$ ]] || [ -z "$gateway" ]; then
  # Diagnostic only: network names and private addresses (no secret).
  printf 'container_networks=%s\n' "$(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}:{{$v.IPAddress}};{{end}}' "$container" | tr -cd 'A-Za-z0-9_.:;-')" >&2
  fail database_network_unresolved
fi
# Two rules for the relay source only: the replication stream, and the plain 'postgres' database login DigitalOcean
# uses to prove Hostinger is the writer and that the slot exists before it replaces anything.
hba_added=false
for rule in "host replication lemtel_ha_replication ${gateway}/32 scram-sha-256" "host postgres lemtel_ha_replication ${gateway}/32 scram-sha-256"; do
  if ! docker exec -u postgres "$container" grep -Fqx "$rule" "$hba"; then
    docker exec -u 0 "$container" sh -eu -c "printf '%s\n' '$rule' >> '$hba'"
    hba_added=true
  fi
done
[ "$(psql 'SELECT pg_reload_conf()')" = t ] || fail hba_reload_failed
for db_name in replication postgres; do
  active_rules="$(psql "SELECT count(*) FROM pg_hba_file_rules WHERE '$db_name' = ANY(database) AND 'lemtel_ha_replication' = ANY(user_name) AND address = '$gateway' AND error IS NULL" || true)"
  [[ "$active_rules" =~ ^[0-9]+$ ]] && [ "$active_rules" -ge 1 ] || fail "hba_rule_not_active_$db_name"
done

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
ip="\$(docker inspect --format '{{with index .NetworkSettings.Networks "$relay_net"}}{{.IPAddress}}{{end}}' $container)"
[ -n "\$ip" ] || exit 1
# IPv4 listener with an explicit family: socat refuses a CIDR range of "unspecified address family" and
# accepts <addr>:<mask> everywhere. Only the DigitalOcean tunnel peer may connect.
exec /usr/bin/socat "TCP4-LISTEN:5432,bind=${hostinger_tunnel},reuseaddr,fork,range=${do_tunnel}:255.255.255.255" "TCP4:\${ip}:5432"
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
if [ "$ok" != true ]; then
  # Diagnostic only (private addresses, unit state, socat errors; no secret): the cause is printed, not guessed.
  printf 'relay_unit_state=%s\n' "$(systemctl is-active "$relay_unit_name" 2>/dev/null || true)" >&2
  journalctl -u "$relay_unit_name" -n 12 --no-pager -o cat 2>/dev/null | sed 's/^/relay_log: /' | tail -12 >&2 || true
  printf 'port_5432_listeners=%s\n' "$(ss -H -ltn "sport = :5432" 2>/dev/null | awk '{print $4}' | paste -sd, -)" >&2
  fail relay_not_listening
fi
# 4. Host firewall: the relay is reachable ONLY from the DigitalOcean tunnel peer, on the tunnel interface (same narrow
# rule the DigitalOcean relay uses). Without it an active ufw silently drops DigitalOcean's packets.
ufw_rule_present() { ufw status numbered 2>/dev/null | grep -F '5432/tcp' | grep -F 'lemtel-ha0' | grep -F "$do_tunnel" | grep -Fq 'ALLOW IN'; }
firewall=none
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 | grep -qx 'Status: active'; then
  ufw_rule_present || ufw allow in on lemtel-ha0 from "$do_tunnel" to "$hostinger_tunnel" port 5432 proto tcp \
    comment 'Lemtel failback relay (DigitalOcean standby only)' >/dev/null || fail firewall_rule_not_added
  ufw_rule_present || fail firewall_rule_not_active
  firewall=ufw_rule_present
fi
# Nothing else may listen on :5432 (in particular no public address).
if ss -H -ltn "sport = :5432" | awk '{print $4}' | grep -Fvx "${hostinger_tunnel}:5432" | grep -q .; then fail unexpected_postgres_listener; fi

printf 'hostinger_writer_replication_format=lemtel_hostinger_writer_replication_v1\n'
printf 'hba_rule=%s\n' "$([ "$hba_added" = true ] && echo added || echo already_present)"
printf 'replication_slot=%s\nrelay=%s:5432_from_%s_only\nrelay_network=%s\nrelay_source=%s\n' "$slot" "$hostinger_tunnel" "$do_tunnel" "$relay_net" "$gateway"
printf 'firewall=%s\n' "$firewall"
printf 'public_database_listener_enabled=false\ndns_change_executed=false\nhostinger_writer_replication_status=complete\n'
