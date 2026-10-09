#!/usr/bin/env bash
# Root-only, one-time Docker/image preparation for the Lemtel DigitalOcean warm standby.
# It does not create a database, restore data, publish ports, or start Supabase.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'standby_docker_bootstrap_status=root_required\n' >&2
    exit 1
  fi
}

require_value() {
  local label="$1" value="$2"
  if [ -z "$value" ] || [[ "$value" == *$'\n'* ]] || [[ "$value" == *$'\r'* ]]; then
    printf 'standby_docker_bootstrap_status=invalid_%s\n' "$label" >&2
    exit 1
  fi
}

require_root
role="${LEMTEL_HA_ROLE:-}"
image="${LEMTEL_POSTGRES_IMAGE:-supabase/postgres:17.6.1.136}"
base_dir="${LEMTEL_HA_STANDBY_BASE_DIR:-/opt/lemtel-ha}"
secret_dir='/etc/lemtel-ha/age'
age_identity="${secret_dir}/identity.txt"

if [ "$role" != 'digitalocean_standby' ]; then
  printf 'standby_docker_bootstrap_status=invalid_role\n' >&2
  exit 1
fi
require_value postgres_image "$image"
case "$image" in
  supabase/postgres:17.6.1.136) ;;
  *)
    printf 'standby_docker_bootstrap_status=unapproved_postgres_image\n' >&2
    exit 1
    ;;
esac
case "$base_dir" in
  /opt/lemtel-ha) ;;
  *)
    printf 'standby_docker_bootstrap_status=unexpected_base_directory\n' >&2
    exit 1
    ;;
esac

if command -v docker >/dev/null 2>&1 && docker ps -aq | grep -q .; then
  printf 'standby_docker_bootstrap_status=existing_containers_refused\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends docker.io docker-compose-v2 age
fi
if ! command -v age-keygen >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends age
fi

systemctl enable --now docker
if ! docker info >/dev/null 2>&1; then
  printf 'standby_docker_bootstrap_status=docker_daemon_unavailable\n' >&2
  exit 1
fi
if docker ps -aq | grep -q .; then
  printf 'standby_docker_bootstrap_status=existing_containers_refused\n' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'standby_docker_bootstrap_status=docker_compose_plugin_missing\n' >&2
  exit 1
fi

install -d -m 0700 \
  "$base_dir" \
  "$base_dir/postgres" \
  "$base_dir/postgres/data" \
  "$base_dir/storage" \
  "$base_dir/artifacts" \
  "$base_dir/logs"
install -d -m 0700 "$secret_dir"
if [ ! -f "$age_identity" ]; then
  umask 077
  age-keygen -o "$age_identity" >/dev/null
fi
chmod 0600 "$age_identity"
if ! grep -q '^AGE-SECRET-KEY-' "$age_identity"; then
  printf 'standby_docker_bootstrap_status=invalid_age_identity\n' >&2
  exit 1
fi
age_recipient="$(awk '/^# public key: age1/ { print $4; exit }' "$age_identity")"
if [ -z "$age_recipient" ]; then
  printf 'standby_docker_bootstrap_status=age_recipient_missing\n' >&2
  exit 1
fi

docker pull "$image"
postgres_version="$(docker run --rm --entrypoint postgres "$image" --version)"
case "$postgres_version" in
  *'PostgreSQL 17.'*) ;;
  *)
    printf 'standby_docker_bootstrap_status=unexpected_postgres_major\n' >&2
    exit 1
    ;;
esac

printf 'standby_docker_bootstrap_format=lemtel_standby_docker_bootstrap_v1\n'
printf 'declared_role=%s\n' "$role"
printf 'docker_service_active=%s\n' "$(systemctl is-active docker)"
printf 'docker_compose_available=true\n'
printf 'postgres_image=%s\n' "$image"
printf 'postgres_image_major=17\n'
printf 'standby_base_directory=%s\n' "$base_dir"
printf 'standby_directories_prepared=true\n'
printf 'standby_age_recipient=%s\n' "$age_recipient"
printf 'standby_age_identity_root_readable_only=true\n'
printf 'containers_started=false\n'
printf 'postgres_listener_5432_started=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'storage_replication_started=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'standby_docker_bootstrap_status=complete\n'
