#!/usr/bin/env bash
# Root-only installer of the Lemtel-hosted TURN relay (decision D2) on the DO WRITER.
#   check  : read-only preflight. Changes nothing.
#   deploy : shared secret (generated here once, or the one already in the functions .env) -> rendered coturn config
#            (root:nogroup 0640) -> coturn container -> firewall (only when ufw is active) -> functions .env values
#            LEMTEL_TURN_URLS / LEMTEL_STUN_URLS / LEMTEL_TURN_SHARED_SECRET (added only when absent).
#            The functions are NOT restarted here: lemtel-ha-do-writer-telephony-connection-deploy.sh wires the names
#            and recreates the container right after. Nothing is printed except names and states.
set -euo pipefail
umask 077
fail() { printf 'turn_install_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"; case "$mode" in check|deploy) ;; *) fail usage_check_or_deploy ;; esac
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
template="${LEMTEL_TURN_TEMPLATE:-}"; compose_src="${LEMTEL_TURN_COMPOSE:-}"
[ -s "$template" ] && [ -s "$compose_src" ] || fail template_missing
grep -q '@SHARED_SECRET@' "$template" && grep -q '@PUBLIC_IP@' "$template" || fail template_invalid
PUBLIC_IP=192.241.137.143
ip -4 -o addr show | awk '{print $4}' | cut -d/ -f1 | grep -qx "$PUBLIC_IP" || fail public_ip_not_on_this_host
case "$(/usr/local/sbin/lemtel-ha-do-writer-boot-fence status 2>/dev/null || true)" in *boot_fence=fenced*) fail do_is_fenced_not_the_writer ;; esac
command -v docker >/dev/null || fail docker_missing
edge=supabase-edge-functions
dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$edge" 2>/dev/null)" || fail functions_container_missing
[ -f "$dir/.env" ] && [ ! -L "$dir/.env" ] || fail functions_env_missing
# Port 3478 must be free or already ours.
if ss -Hlnu "sport = :3478" | grep -q . || ss -Hlnt "sport = :3478" | grep -q .; then
  [ "$(docker inspect --format '{{.State.Running}}' lemtel-turn 2>/dev/null)" = true ] || fail port_3478_in_use_by_another_service
fi
ufw_state="$(ufw status 2>/dev/null | head -1 | awk '{print $2}' || true)"
echo "turn_check public_ip=ok functions_env=ok ufw=${ufw_state:-absent} container=$(docker inspect --format '{{.State.Status}}' lemtel-turn 2>/dev/null || echo none) secret_present=$(grep -c '^LEMTEL_TURN_SHARED_SECRET=.' "$dir/.env" || true)"
[ "$mode" = deploy ] || { echo turn_install_status=checked; exit 0; }

backup="/var/lib/lemtel-ha/turn-deploy/$(date -u +%Y%m%dT%H%M%SZ)"; install -d -m 0700 "$backup"
cp -p "$dir/.env" "$backup/env"
[ -f /etc/lemtel-turn/turnserver.conf ] && cp -p /etc/lemtel-turn/turnserver.conf "$backup/turnserver.conf"
done_ok=false
rollback() {
  [ "$done_ok" = true ] && return 0
  cp -p "$backup/env" "$dir/.env"
  if [ -f "$backup/turnserver.conf" ]; then cp -p "$backup/turnserver.conf" /etc/lemtel-turn/turnserver.conf; docker restart lemtel-turn >/dev/null 2>&1 || true
  else docker compose -p lemtel-turn -f /opt/lemtel-turn/docker-compose.yml down >/dev/null 2>&1 || true; fi
  echo "turn_install_rollback=done" >&2
}
trap rollback EXIT INT TERM

# 1. Shared secret: one value, kept identical in coturn and the functions .env.
secret="$(sed -n 's/^LEMTEL_TURN_SHARED_SECRET=//p' "$dir/.env" | tail -1)"
if ! printf '%s' "$secret" | grep -Eq '^[!-~]{32,256}$'; then
  secret="$(openssl rand -hex 32)"; [ "${#secret}" = 64 ] || fail secret_generation_failed
  sed -i '/^LEMTEL_TURN_SHARED_SECRET=/d' "$dir/.env"; printf 'LEMTEL_TURN_SHARED_SECRET=%s\n' "$secret" >> "$dir/.env"
fi
grep -q '^LEMTEL_TURN_URLS=.' "$dir/.env" || { sed -i '/^LEMTEL_TURN_URLS=/d' "$dir/.env"; printf 'LEMTEL_TURN_URLS=turn:%s:3478?transport=udp,turn:%s:3478?transport=tcp\n' "$PUBLIC_IP" "$PUBLIC_IP" >> "$dir/.env"; }
grep -q '^LEMTEL_STUN_URLS=.' "$dir/.env" || { sed -i '/^LEMTEL_STUN_URLS=/d' "$dir/.env"; printf 'LEMTEL_STUN_URLS=stun:%s:3478\n' "$PUBLIC_IP" >> "$dir/.env"; }

# 2. Rendered config, readable by the container user (nobody:nogroup) only.
install -d -m 0750 -o root -g 65534 /etc/lemtel-turn
tmp="$(mktemp /etc/lemtel-turn/.conf.XXXXXX)"
SECRET="$secret" IP="$PUBLIC_IP" python3 - "$template" "$tmp" <<'PY'
import os, sys
s = open(sys.argv[1]).read().replace("@SHARED_SECRET@", os.environ["SECRET"]).replace("@PUBLIC_IP@", os.environ["IP"])
open(sys.argv[2], "w").write(s)
PY
unset secret
grep -q '@' "$tmp" && { rm -f "$tmp"; fail template_not_fully_rendered; }
chown root:65534 "$tmp"; chmod 0640 "$tmp"; mv -f "$tmp" /etc/lemtel-turn/turnserver.conf

# 3. Container.
install -d -m 0755 /opt/lemtel-turn
install -m 0644 "$compose_src" /opt/lemtel-turn/docker-compose.yml
docker compose -p lemtel-turn -f /opt/lemtel-turn/docker-compose.yml up -d --force-recreate >/dev/null
ok=false; for _ in $(seq 1 20); do
  if [ "$(docker inspect --format '{{.State.Running}}' lemtel-turn 2>/dev/null)" = true ] && ss -Hlnu "sport = :3478" | grep -q .; then ok=true; break; fi; sleep 2; done
[ "$ok" = true ] || fail turn_not_listening

# 4. Host firewall (only when ufw is active; the DigitalOcean cloud firewall is checked from outside by the launcher).
if [ "$ufw_state" = active ]; then
  ufw allow 3478/udp comment 'lemtel-turn' >/dev/null; ufw allow 3478/tcp comment 'lemtel-turn' >/dev/null
  ufw allow 49160:49200/udp comment 'lemtel-turn relay' >/dev/null
fi
done_ok=true
echo "turn_install_status=deployed listening=3478/udp,3478/tcp relay=49160-49200/udp backup=$backup"
