#!/usr/bin/env bash
# Root-only inert bootstrap for a clean Hostinger Lemtel PostgreSQL standby.
# It prepares local tools, encrypted key material and image cache only. It never
# starts a WireGuard interface, PostgreSQL, Storage, Caddy, a public listener,
# DNS routing, promotion or telephony.
set -euo pipefail

fail() {
  printf 'hostinger_standby_bootstrap_status=%s\n' "$1" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail root_required
}

require_root
[ "${LEMTEL_HA_EXECUTE:-}" = 'bootstrap_clean_hostinger_private_standby' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

postgres_image="${LEMTEL_POSTGRES_IMAGE:-supabase/postgres:17.6.1.136}"
base_dir="${LEMTEL_HA_STANDBY_BASE_DIR:-/opt/lemtel-ha}"
age_dir='/etc/lemtel-ha/age'
age_identity="$age_dir/identity.txt"
wireguard_dir='/etc/lemtel-ha/wireguard'
wireguard_private="$wireguard_dir/private.key"
wireguard_public="$wireguard_dir/public.key"

[ "$postgres_image" = 'supabase/postgres:17.6.1.136' ] || fail unapproved_postgres_image
[ "$base_dir" = '/opt/lemtel-ha' ] || fail unexpected_base_directory

# A dedicated standby starts clean. Existing Docker data must be handled by a
# separately approved cleanup and never by this bootstrap.
if docker ps -aq 2>/dev/null | grep -q .; then
  fail existing_containers_refused
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends age rsync wireguard-tools >/dev/null
command -v docker >/dev/null 2>&1 || fail docker_missing
systemctl enable --now docker
systemctl is-active --quiet docker || fail docker_inactive
if ! docker compose version >/dev/null 2>&1; then
  fail docker_compose_plugin_missing
fi
if docker ps -aq | grep -q .; then
  fail existing_containers_refused
fi

install -d -m 0700 \
  "$base_dir" \
  "$base_dir/postgres" \
  "$base_dir/postgres/data" \
  "$base_dir/storage" \
  "$base_dir/artifacts" \
  "$base_dir/logs" \
  "$age_dir" \
  "$wireguard_dir"

if [ ! -e "$age_identity" ]; then
  umask 077
  age-keygen -o "$age_identity" >/dev/null 2>&1
fi
chmod 0600 "$age_identity"
grep -q '^AGE-SECRET-KEY-' "$age_identity" || fail invalid_age_identity
age_recipient="$(awk '/^# public key: age1/ { print $4; exit }' "$age_identity")"
[ -n "$age_recipient" ] || fail age_recipient_missing

if [ -e "$wireguard_private" ] && [ ! -s "$wireguard_private" ]; then
  fail existing_wireguard_private_key_empty
fi
if [ ! -e "$wireguard_private" ] && [ -e "$wireguard_public" ]; then
  fail wireguard_public_key_without_private_key
fi
if [ ! -e "$wireguard_private" ]; then
  umask 077
  wg genkey > "$wireguard_private"
fi
chmod 0600 "$wireguard_private"
expected_wireguard_public="$(wg pubkey < "$wireguard_private")"
if [ -e "$wireguard_public" ] && [ "$(tr -d '\r\n' < "$wireguard_public")" != "$expected_wireguard_public" ]; then
  fail existing_wireguard_public_key_mismatch
fi
printf '%s\n' "$expected_wireguard_public" > "$wireguard_public"
chmod 0600 "$wireguard_public"

# Cache the exact major-compatible standby image; no database container is started.
docker pull "$postgres_image" >/dev/null
postgres_version="$(docker run --rm --entrypoint postgres "$postgres_image" --version)"
[[ "$postgres_version" =~ ^postgres\ \(PostgreSQL\)\ 17\.[0-9]+$ ]] || fail unexpected_postgres_major

printf 'hostinger_standby_bootstrap_format=lemtel_hostinger_standby_bootstrap_v1\n'
printf 'declared_role=hostinger_standby\n'
printf 'docker_service_active=%s\n' "$(systemctl is-active docker)"
printf 'docker_compose_available=true\n'
printf 'postgres_image=%s\n' "$postgres_image"
printf 'postgres_image_major=17\n'
printf 'standby_directories_prepared=true\n'
printf 'standby_age_recipient=%s\n' "$age_recipient"
printf 'standby_wireguard_public_key=%s\n' "$expected_wireguard_public"
printf 'standby_age_identity_root_readable_only=true\n'
printf 'wireguard_interface_started=false\n'
printf 'postgres_listener_5432_started=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'storage_replication_started=false\n'
printf 'runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'dns_failover_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_standby_bootstrap_status=complete\n'
