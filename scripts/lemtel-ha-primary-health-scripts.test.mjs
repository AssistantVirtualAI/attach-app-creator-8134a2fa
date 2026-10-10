import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const script = (name) => readFileSync(resolve(root, `infra/lemtel-resilience/active-passive/${name}`), 'utf8');
const healthCheck = script('lemtel-ha-primary-health-check.sh');
const healthTimer = script('lemtel-ha-primary-health-timer-enable.sh');
const alertDispatch = script('lemtel-ha-primary-alert-dispatch.sh');
const alertsEnable = script('lemtel-ha-primary-alerts-enable.sh');
const prohibited = /(?:\bpg_promote\b|\bnsupdate\b|docker\s+(?:run|compose\s+up)|\bturn\b|\bwss\b)/imu;

test('primary health check is root-only and covers Auth, replication and Storage freshness', () => {
  assert.match(healthCheck, /check_private_active_passive_health/u);
  assert.match(healthCheck, /LEMTEL_HA_ROLE:-\}" = 'hostinger_primary'/u);
  assert.match(healthCheck, /supabase-db/u);
  assert.match(healthCheck, /supabase-auth/u);
  assert.match(healthCheck, /supabase-caddy/u);
  assert.match(healthCheck, /API_EXTERNAL_URL/u);
  assert.match(healthCheck, /auth\/v1\/health/u);
  assert.match(healthCheck, /pg_stat_replication/u);
  assert.match(healthCheck, /pg_wal_lsn_diff/u);
  assert.match(healthCheck, /lemtel-ha-storage-sync\.timer/u);
  assert.match(healthCheck, /max_storage_freshness_seconds=900/u);
  assert.match(healthCheck, /\[ -f "\$storage_log" \] \|\| fail storage_sync_log_missing/u);
  assert.doesNotMatch(healthCheck, /\[ -s "\$storage_log" \]/u);
  assert.match(healthCheck, /storage_integrity_attestation_missing/u);
  assert.match(healthCheck, /storage_manifest_integrity_invalid/u);
  assert.match(healthCheck, /storage_manifest_integrity_verified=true/u);
  assert.match(healthCheck, /primary_health_status=healthy/u);
  assert.match(healthCheck, /dns_failover_enabled=false/u);
  assert.match(healthCheck, /automatic_promotion_enabled=false/u);
  assert.doesNotMatch(healthCheck, prohibited);
});

test('primary health timer records local status without configuring notifications or failover', () => {
  assert.match(healthTimer, /enable_private_active_passive_health_timer/u);
  assert.match(healthTimer, /OnUnitActiveSec=2min/u);
  assert.match(healthTimer, /RandomizedDelaySec=15s/u);
  assert.match(healthTimer, /ExecStart=\/usr\/local\/sbin\/lemtel-ha-primary-health-check/u);
  assert.match(healthTimer, /notification_delivery_configured=false/u);
  assert.match(healthTimer, /systemd-analyze verify/u);
  assert.match(healthTimer, /systemctl enable --now lemtel-ha-primary-health\.timer/u);
  assert.match(healthTimer, /dns_failover_enabled=false/u);
  assert.match(healthTimer, /automatic_promotion_enabled=false/u);
  assert.doesNotMatch(healthTimer, prohibited);
});

test('primary alert dispatcher reuses the runtime Resend secret and sends only state transitions', () => {
  assert.match(alertDispatch, /dispatch_private_active_passive_health_alert/u);
  assert.match(alertDispatch, /LEMTEL_HA_ROLE:-\}" = 'hostinger_primary'/u);
  assert.match(alertDispatch, /RESEND_API_KEY/u);
  assert.match(alertDispatch, /LEMTEL_WELCOME_FROM/u);
  assert.match(alertDispatch, /primary-health\.last-notified/u);
  assert.match(alertDispatch, /notification_reason=state_unchanged/u);
  assert.match(alertDispatch, /Authorization: Bearer \$api_key/u);
  assert.match(alertDispatch, /credential_values_emitted=false/u);
  assert.match(alertDispatch, /dns_failover_enabled=false/u);
  assert.match(alertDispatch, /automatic_promotion_enabled=false/u);
  assert.doesNotMatch(alertDispatch, /(?:\bpg_promote\b|\bnsupdate\b|docker\s+(?:run|compose\s+up)|\brsync\b|\bssh\b|\bturn\b|\bwss\b)/imu);
});

test('primary alerts enablement stores recipients root-only and starts a bounded dispatcher timer', () => {
  assert.match(alertsEnable, /enable_private_active_passive_email_alerts/u);
  assert.match(alertsEnable, /LEMTEL_HA_ALERT_RECIPIENTS/u);
  assert.match(alertsEnable, /primary-health-alert-recipients/u);
  assert.match(alertsEnable, /install -o root -g root -m 0600/u);
  assert.match(alertsEnable, /awk 'END \{ print NR \}'/u);
  assert.match(alertsEnable, /OnUnitActiveSec=2min/u);
  assert.match(alertsEnable, /systemctl start lemtel-ha-primary-alert-dispatch\.service/u);
  assert.match(alertsEnable, /resend_existing_runtime_secret_reused=true/u);
  assert.match(alertsEnable, /dns_failover_enabled=false/u);
  assert.match(alertsEnable, /automatic_promotion_enabled=false/u);
  assert.doesNotMatch(alertsEnable, /(?:\bpg_promote\b|\bnsupdate\b|\bcurl\b|docker\s+(?:run|compose\s+up)|\brsync\b|\bssh\b|\bturn\b|\bwss\b)/imu);
});
