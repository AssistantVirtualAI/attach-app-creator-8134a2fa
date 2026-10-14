import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-device-observability-deploy.sh", import.meta.url),
  "utf8",
);

test("the Lemtel observability deployer is fail-closed and writer-only", () => {
  for (const required of [
    "LEMTEL_DEVICE_OBSERVABILITY_EXECUTE",
    "deploy_verified_writer_observability",
    "LEMTEL_HA_ROLE",
    "digitalocean_writer",
    "FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED",
    "manifest.sha256",
    "pg_is_in_recovery()::text",
    "lemtel-onboarding-admin.index.ts",
    "lemtelTelephonyReadiness.ts",
    "lemtel-session-bootstrap.index.ts",
    "lemtel_organization_domains",
    "lemtel_client_connection_presence",
    "lemtel_operational_status_history",
    "lemtel-ha-promoted-writer-status-timer-enable.sh",
    "automatic_traffic_failover_enabled=false",
    "fencing_executed=false",
    "telephony_contacted=false",
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.doesNotMatch(source, /\b(?:curl|ssh|scp|rsync)\b/);
  assert.doesNotMatch(source, /docker\s+(?:run|compose|stop|rm|kill)\b/);
  assert.doesNotMatch(source, /systemctl\s+(?:stop|disable)\b/);
  assert.doesNotMatch(source, /(?:cloudflare.*?(?:api|request|load_balancer)|load_balancer_changed=true|automatic_promotion_enabled=true)/i);
});
