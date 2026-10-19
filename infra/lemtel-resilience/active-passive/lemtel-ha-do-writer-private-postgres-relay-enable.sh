#!/usr/bin/env bash
# Root-only private TCP relay for the promoted DigitalOcean PostgreSQL writer.
# It exposes PostgreSQL only on the existing WireGuard address, accepts traffic
# only from the Hostinger standby tunnel peer, and never publishes a Docker port.
set -euo pipefail

fail() {
  printf 'do_writer_private_postgres_relay_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_private_postgres_relay_for_hostinger_standby' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

writer_tunnel_address='10.253.47.2'
standby_tunnel_address='10.253.47.1'
db_container='lemtel-postgres-standby'
relay_script='/usr/local/libexec/lemtel-ha-do-postgres-wireguard-relay'
relay_unit='/etc/systemd/system/lemtel-ha-do-postgres-wireguard-relay.service'
ufw_rule="allow in on lemtel-ha0 from ${standby_tunnel_address} to ${writer_tunnel_address} port 5432 proto tcp"
created_rule=false
created_unit=false
created_script=false
relay_started=false
completed=false

resolve_database_backend_target() {
  local mode container_ips container_ip sockets
  mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$db_container")"
  case "$mode" in
    host)
      sockets="$(ss -H -ltn 'sport = :5432' || true)"
      printf '%s\n' "$sockets" | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\*|\[::\]|\[::\]:):5432$' && return 1
      printf '%s\n' "$sockets" | awk '{print $4}' | grep -Fqx '127.0.0.1:5432' || return 1
      printf '%s\n' '127.0.0.1:5432'
      ;;
    *)
      container_ips="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' "$db_container")"
      container_ip="$(printf '%s\n' "$container_ips" | awk '/^(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}$/ { print; exit }')"
      [[ "$container_ip" =~ ^(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
      printf '%s:5432\n' "$container_ip"
      ;;
  esac
}

ufw_rule_present() {
  ufw status numbered \
    | grep -F '5432/tcp' \
    | grep -F 'lemtel-ha0' \
    | grep -F "$standby_tunnel_address" \
    | grep -Fq 'ALLOW IN'
}

rollback() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ] && [ "$completed" = false ]; then
    [ "$relay_started" = true ] && systemctl stop lemtel-ha-do-postgres-wireguard-relay.service >/dev/null 2>&1 || true
    [ "$created_unit" = true ] && rm -f "$relay_unit"
    [ "$created_script" = true ] && rm -f "$relay_script"
    [ "$created_unit" = true ] && systemctl daemon-reload >/dev/null 2>&1 || true
    [ "$created_rule" = true ] && ufw delete "$ufw_rule" >/dev/null 2>&1 || true
    printf 'do_writer_private_postgres_relay_rollback_attempted=true\n' >&2
  fi
  exit "$status"
}
trap rollback EXIT

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v ufw >/dev/null 2>&1 || fail ufw_missing
if ! command -v socat >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends socat >/dev/null
fi
command -v socat >/dev/null 2>&1 || fail socat_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -Fq "$writer_tunnel_address" || fail writer_tunnel_address_missing
ufw status | grep -q '^Status: active$' || fail ufw_inactive
docker inspect "$db_container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.Config.Image}}' "$db_container")" = 'supabase/postgres:17.6.1.136' ] || fail unexpected_database_image
docker inspect --format '{{.State.Running}}' "$db_container" | grep -qx true || fail database_not_running
if docker port "$db_container" | grep -q .; then fail database_port_already_published; fi
database_backend_target="$(resolve_database_backend_target)" || fail database_backend_private_target_missing

render_relay_script() {
  cat <<'RELAY'
#!/usr/bin/env bash
set -euo pipefail
container='lemtel-postgres-standby'
writer_tunnel_address='10.253.47.2'
mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")"
case "$mode" in
  host)
    sockets="$(ss -H -ltn 'sport = :5432' || true)"
    printf '%s\n' "$sockets" | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\*|\[::\]|\[::\]:):5432$' && exit 1
    printf '%s\n' "$sockets" | awk '{print $4}' | grep -Fqx '127.0.0.1:5432' || exit 1
    database_backend_target='127.0.0.1:5432'
    ;;
  *)
    container_ips="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' "$container")"
    container_ip="$(printf '%s\n' "$container_ips" | awk '/^(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}$/ { print; exit }')"
    case "$container_ip" in
      172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|10.*|192.168.*) database_backend_target="${container_ip}:5432" ;;
      *) exit 1 ;;
    esac
    ;;
esac
exec /usr/bin/socat "TCP-LISTEN:5432,bind=${writer_tunnel_address},reuseaddr,fork" "TCP:${database_backend_target}"
RELAY
}

# The relay resolves the Docker bridge address anew whenever the systemd service starts.
if [ -e "$relay_script" ]; then
  cmp -s "$relay_script" <(render_relay_script) || fail existing_relay_script_mismatch
else
  install -d -m 0755 /usr/local/libexec
  render_relay_script > "$relay_script"
  chmod 0755 "$relay_script"
  chown root:root "$relay_script"
  created_script=true
fi

if [ -e "$relay_unit" ]; then
  grep -Fqx "ExecStart=${relay_script}" "$relay_unit" || fail existing_relay_unit_mismatch
else
  cat > "$relay_unit" <<EOF
[Unit]
Description=Lemtel private PostgreSQL relay to the promoted writer
After=docker.service wg-quick@lemtel-ha0.service
Requires=docker.service wg-quick@lemtel-ha0.service

[Service]
Type=simple
ExecStart=${relay_script}
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$relay_unit"
  created_unit=true
  systemctl daemon-reload
fi

if ! ufw_rule_present; then
  ufw allow in on lemtel-ha0 from "$standby_tunnel_address" to "$writer_tunnel_address" port 5432 proto tcp >/dev/null
  created_rule=true
fi

systemctl enable --now lemtel-ha-do-postgres-wireguard-relay.service
relay_started=true
for _ in $(seq 1 20); do
  if systemctl is-active --quiet lemtel-ha-do-postgres-wireguard-relay.service \
    && ss -H -ltn "sport = :5432" | awk '{print $4}' | grep -Fq "${writer_tunnel_address}:5432"; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet lemtel-ha-do-postgres-wireguard-relay.service || fail relay_not_running
ss -H -ltn "sport = :5432" | awk '{print $4}' | grep -Fqx "${writer_tunnel_address}:5432" || fail relay_listener_not_private
ufw_rule_present || fail private_ufw_rule_missing

printf 'do_writer_private_postgres_relay_format=lemtel_do_writer_private_postgres_relay_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'wireguard_handshake_verified=true\n'
printf 'database_container_private=true\n'
printf 'private_relay_listener_verified=true\n'
printf 'private_relay_source_limited=true\n'
printf 'database_changed=false\n'
printf 'runtime_changed=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'storage_changed=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'do_writer_private_postgres_relay_status=complete\n'
completed=true
