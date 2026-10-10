#!/usr/bin/env bash
# Root-only state-transition email alerts for Lemtel active-passive primary health.
# Uses the existing edge-runtime Resend secret without copying or printing it.
set -euo pipefail

fail() {
  printf 'primary_health_alert_dispatch_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'dispatch_private_active_passive_health_alert' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

health_file='/var/lib/lemtel-ha/health/primary-health.status'
alert_dir='/var/lib/lemtel-ha/alerts'
recipients_file='/etc/lemtel-ha/primary-health-alert-recipients'
notified_file="$alert_dir/primary-health.last-notified"
edge_container='supabase-edge-functions'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v python3 >/dev/null 2>&1 || fail python3_missing
command -v curl >/dev/null 2>&1 || fail curl_missing
[ -s "$health_file" ] || fail health_status_missing
[ -s "$recipients_file" ] || fail recipients_missing

docker inspect "$edge_container" >/dev/null 2>&1 || fail edge_runtime_missing
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running

checked_at="$(sed -n 's/^checked_at_utc=//p' "$health_file" | sed -n '1p')"
health_status="$(sed -n 's/^status=//p' "$health_file" | sed -n '1p')"
health_reason="$(sed -n 's/^reason=//p' "$health_file" | sed -n '1p')"
case "$health_status" in
  healthy|degraded) ;;
  *) fail health_status_invalid ;;
esac
[[ "$checked_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail health_timestamp_invalid
[[ "$health_reason" =~ ^[a-z0-9_]+$ ]] || fail health_reason_invalid

mapfile -t recipients < <(sed '/^[[:space:]]*$/d' "$recipients_file")
[ "${#recipients[@]}" -ge 1 ] && [ "${#recipients[@]}" -le 50 ] || fail recipient_count_invalid
for recipient in "${recipients[@]}"; do
  [[ "$recipient" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail recipient_invalid
done

previous_status='none'
if [ -f "$notified_file" ]; then
  previous_status="$(sed -n 's/^status=//p' "$notified_file" | sed -n '1p')"
fi
case "$previous_status" in none|healthy|degraded) ;; *) fail notification_state_invalid ;; esac

# Avoid duplicate notifications when the scheduled dispatch checks the same health state.
if [ "$previous_status" = "$health_status" ]; then
  printf 'primary_health_alert_dispatch_format=lemtel_primary_health_alert_dispatch_v1\n'
  printf 'declared_role=hostinger_primary\n'
  printf 'notification_sent=false\n'
  printf 'notification_reason=state_unchanged\n'
  printf 'dns_failover_enabled=false\n'
  printf 'automatic_promotion_enabled=false\n'
  printf 'fusionpbx_or_sip_contacted=false\n'
  printf 'primary_health_alert_dispatch_status=complete\n'
  exit 0
fi

case "$health_status:$previous_status" in
  healthy:none)
    subject='[Lemtel HA] Monitoring actif — primaire sain'
    transition='monitoring_initialized'
    ;;
  healthy:degraded)
    subject='[Lemtel HA][RÉTABLI] Primaire sain'
    transition='health_recovered'
    ;;
  degraded:*)
    subject='[Lemtel HA][CRITIQUE] Santé primaire dégradée'
    transition='health_degraded'
    ;;
  *) fail transition_invalid ;;
esac

sender="$(docker exec "$edge_container" sh -eu -c 'value="$(printenv LEMTEL_WELCOME_FROM 2>/dev/null || true)"; case "$value" in *@ava-telecom.ca) printf "%s" "$value" ;; *) exit 1 ;; esac')" || fail sender_not_verified

payload="$(python3 - "$sender" "$subject" "$health_status" "$health_reason" "$checked_at" "$transition" "${recipients[@]}" <<'PY'
import json
import sys
sender, subject, status, reason, checked_at, transition, *recipients = sys.argv[1:]
text = (
    "Lemtel active-passive health notification\n\n"
    f"Status: {status}\n"
    f"Reason: {reason}\n"
    f"Checked (UTC): {checked_at}\n"
    f"Transition: {transition}\n\n"
    "This is an automated resilience signal. No DNS failover, standby promotion, "
    "public listener, Storage runtime, or telephony action has been executed.\n\n"
    "Notification automatisée de résilience Lemtel. Aucune bascule DNS, promotion "
    "du standby, exposition publique, activation Storage ou action de téléphonie n’a été exécutée."
)
print(json.dumps({
    "from": sender,
    "to": recipients,
    "subject": subject,
    "text": text,
    "tags": [{"name": "service", "value": "lemtel-ha"}, {"name": "transition", "value": transition}],
}, separators=(",", ":")))
PY
)"

api_key="$(docker exec "$edge_container" sh -eu -c 'printenv RESEND_API_KEY 2>/dev/null')" || fail resend_secret_missing
[ -n "$api_key" ] || fail resend_secret_missing
printf '%s' "$payload" | curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
  -o /dev/null \
  -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $api_key" \
  -H "Content-Type: application/json" \
  --data-binary @- || fail resend_delivery_failed
unset api_key

install -d -m 0700 "$alert_dir"
tmp="$(mktemp "$alert_dir/.primary-health-notified.XXXXXX")"
{
  printf 'status=%s\n' "$health_status"
  printf 'checked_at_utc=%s\n' "$checked_at"
  printf 'transition=%s\n' "$transition"
} > "$tmp"
chmod 0600 "$tmp"
mv -f "$tmp" "$notified_file"

printf 'primary_health_alert_dispatch_format=lemtel_primary_health_alert_dispatch_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'notification_sent=true\n'
printf 'notification_transition=%s\n' "$transition"
printf 'recipient_count=%s\n' "${#recipients[@]}"
printf 'resend_sender_verified=true\n'
printf 'dns_failover_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'primary_health_alert_dispatch_status=complete\n'
