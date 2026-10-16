#!/usr/bin/env bash
# Root-only Lemtel transactional-email runtime configuration for the existing DigitalOcean writer.
# It configures only the non-secret sender identity. It neither reads nor replaces the Resend key.
set -euo pipefail
exec 3>&1 4>&2

fail() {
  printf 'transactional_email_runtime_config_status=failed\n' >&4
  printf 'failure_stage=%s\n' "$1" >&4
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
printf 'This configures only the non-secret Lemtel sender identity on the existing DigitalOcean writer.\n' >&4
printf 'It does not display or replace the Resend key, send e-mail, register a webhook, touch Hostinger, Cloudflare, failover, database data, or telephony.\n' >&4
printf 'Type yes only after reviewing this writer-only, reversible runtime change: ' >&4
IFS= read -r operator_review || fail operator_review_required
[ "$operator_review" = yes ] || fail operator_review_required
printf 'Type yes only after verifying the current encrypted writer snapshot: ' >&4
IFS= read -r snapshot_review || fail snapshot_attestation_required
[ "$snapshot_review" = yes ] || fail snapshot_attestation_required
exec >/dev/null 2>&1

command -v docker >/dev/null 2>&1 || fail docker_missing
edge_container='supabase-edge-functions'
docker inspect "$edge_container" >/dev/null 2>&1 || fail edge_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_container_not_running

working_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$edge_container")"
service_name="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$edge_container")"
config_files_raw="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$edge_container")"
for value in "$working_dir" "$service_name" "$config_files_raw"; do
  case "$value" in ''|'<no value>') fail compose_metadata_unresolved ;; esac
done
[ -d "$working_dir" ] || fail compose_workdir_missing

compose=()
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
  compose=(docker-compose)
else
  fail compose_command_unavailable
fi

mapfile -t config_files < <(printf '%s' "$config_files_raw" | tr ',' '\n' | sed '/^$/d')
[ "${#config_files[@]}" -gt 0 ] || fail compose_config_files_unresolved
compose_files=()
for config_file in "${config_files[@]}"; do
  [ -f "$config_file" ] || fail compose_config_file_missing
  compose_files+=(-f "$config_file")
done

mapfile -t current_environment_names < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge_container" | sed 's/=.*//' | sort -u)
has_current_environment_name() { printf '%s\n' "${current_environment_names[@]}" | grep -Fxq "$1"; }
has_current_environment_name RESEND_API_KEY || fail resend_api_key_not_present
has_current_environment_name LEMTEL_WELCOME_FROM && fail sender_already_configured

# The base Compose project must itself reproduce the existing key-bearing environment. This check
# never prints rendered configuration or any values and fails before any write if the key declaration is absent.
"${compose[@]}" --project-directory "$working_dir" "${compose_files[@]}" config --no-interpolate 2>/dev/null | grep -Eq '(^|[[:space:]])RESEND_API_KEY([:=]|[[:space:]]|$)' || fail compose_resend_key_declaration_missing
"${compose[@]}" --project-directory "$working_dir" "${compose_files[@]}" config --no-interpolate --services 2>/dev/null | grep -Fxq "$service_name" || fail compose_service_unresolved

runtime_root='/var/lib/lemtel-ha/transactional-email/runtime-config'
backup_root='/var/lib/lemtel-ha/transactional-email/backups/runtime-config'
environment_file="$runtime_root/lemtel-transactional-email.env"
override_file="$runtime_root/compose.lemtel-transactional-email.yml"
install -d -o root -g root -m 0700 "$runtime_root" "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"

had_environment_file=false
had_override_file=false
configuration_written=false
runtime_recreated=false
failure_stage='prepare'

restore_configuration() {
  if [ "$had_environment_file" = true ]; then
    cp --preserve=mode,ownership,timestamps -- "$backup_dir/lemtel-transactional-email.env" "$environment_file"
  else
    rm -f -- "$environment_file"
  fi
  if [ "$had_override_file" = true ]; then
    cp --preserve=mode,ownership,timestamps -- "$backup_dir/compose.lemtel-transactional-email.yml" "$override_file"
  else
    rm -f -- "$override_file"
  fi
}

rollback() {
  local code=$?
  [ "$code" -gt 0 ] || code=1
  trap - ERR INT TERM
  set +e
  if [ "$configuration_written" = true ]; then restore_configuration; fi
  if [ "$runtime_recreated" = true ]; then
    "${compose[@]}" --project-directory "$working_dir" "${compose_files[@]}" up -d --no-deps --force-recreate "$service_name" >/dev/null 2>&1 || true
  fi
  exec 1>&3 2>&4
  printf 'transactional_email_runtime_config_status=failed\n' >&2
  printf 'failure_stage=%s\n' "$failure_stage" >&2
  printf 'rollback_attempted=%s\n' "$configuration_written" >&2
  printf 'credential_values_emitted=false\n' >&2
  exit "$code"
}
trap rollback ERR INT TERM
fail_stage() { failure_stage="$1"; return 1; }

if [ -f "$environment_file" ]; then cp --preserve=mode,ownership,timestamps -- "$environment_file" "$backup_dir/lemtel-transactional-email.env"; had_environment_file=true; fi
if [ -f "$override_file" ]; then cp --preserve=mode,ownership,timestamps -- "$override_file" "$backup_dir/compose.lemtel-transactional-email.yml"; had_override_file=true; fi

failure_stage='write_sender_configuration'
temporary_environment="$(mktemp "$runtime_root/.lemtel-email-env.XXXXXX")"
temporary_override="$(mktemp "$runtime_root/.lemtel-email-override.XXXXXX")"
chmod 0600 "$temporary_environment" "$temporary_override"
printf '%s\n' 'LEMTEL_WELCOME_FROM=Lemtel <notifications@ava-telecom.ca>' > "$temporary_environment"
printf 'services:\n  %s:\n    env_file:\n      - %s\n' "$service_name" "$environment_file" > "$temporary_override"
mv -f -- "$temporary_environment" "$environment_file"
mv -f -- "$temporary_override" "$override_file"
chown root:root "$environment_file" "$override_file"
chmod 0600 "$environment_file" "$override_file"
configuration_written=true

failure_stage='validate_override'
"${compose[@]}" --project-directory "$working_dir" "${compose_files[@]}" -f "$override_file" config --no-interpolate --services 2>/dev/null | grep -Fxq "$service_name" || fail_stage compose_override_invalid

failure_stage='recreate_edge_runtime'
"${compose[@]}" --project-directory "$working_dir" "${compose_files[@]}" -f "$override_file" up -d --no-deps --force-recreate "$service_name" >/dev/null 2>&1 || fail_stage edge_recreate_failed
runtime_recreated=true

docker inspect "$edge_container" >/dev/null 2>&1 || fail_stage edge_missing_after_recreate
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail_stage edge_not_running_after_recreate
mapfile -t configured_environment_names < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge_container" | sed 's/=.*//' | sort -u)
has_configured_environment_name() { printf '%s\n' "${configured_environment_names[@]}" | grep -Fxq "$1"; }
has_configured_environment_name RESEND_API_KEY || fail_stage resend_api_key_not_preserved
has_configured_environment_name LEMTEL_WELCOME_FROM || fail_stage sender_not_present_after_recreate

trap - ERR INT TERM
exec 1>&3 2>&4
printf 'transactional_email_runtime_config_format=lemtel_transactional_email_runtime_config_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'runtime_sender_identity_configured=true\n'
printf 'inline_lemtel_wordmark_fallback=true\n'
printf 'resend_api_key_preserved=true\n'
printf 'edge_runtime_recreated=true\n'
printf 'database_rows_read=false\n'
printf 'database_mutation=false\n'
printf 'email_sent=false\n'
printf 'welcome_triggered=false\n'
printf 'password_reset_triggered=false\n'
printf 'resend_webhook_registered=false\n'
printf 'hostinger_touched=false\n'
printf 'cloudflare_touched=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_touched=false\n'
printf 'configuration_values_emitted=false\n'
printf 'secret_values_emitted=false\n'
printf 'credential_values_emitted=false\n'
printf 'transactional_email_runtime_config_status=complete\n'
