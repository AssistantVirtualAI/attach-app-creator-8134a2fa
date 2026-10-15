import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-portal-governance-reconcile.sh", import.meta.url), "utf8");

test("governance reconciliation is writer-only, catalog-gated and transactional", () => {
  for (const required of [
    'LEMTEL_PORTAL_GOVERNANCE_RECONCILE_EXECUTE:-}" = reconcile_verified_portal_governance',
    'LEMTEL_HA_ROLE:-}" = digitalocean_writer',
    'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED',
    'present|present|present|present|present',
    'governance_schema_not_ready',
    'lemtel-onboarding-admin.index.ts',
    'lemtel-session-bootstrap.index.ts',
    'trap rollback ERR INT TERM',
    'portal_governance_reconcile_status=complete',
  ]) assert.ok(source.includes(required), `missing ${required}`);
  assert.match(source, /SELECT pg_is_in_recovery\(\)::text/);
  assert.match(source, /docker restart --time 30 "\$edge_container"/);
});

test("governance reconciliation never applies a migration or controls infrastructure", () => {
  for (const forbidden of [/CREATE TABLE/i, /ALTER SYSTEM/i, /cloudflare.*(create|pool|monitor)/i, /fusionpbx/i, /sip:|wss:|turn:/i]) {
    assert.doesNotMatch(source, forbidden);
  }
  for (const boundary of ['database_mutation=false', 'automatic_traffic_failover_enabled=false', 'telephony_provider_contacted=false']) {
    assert.ok(source.includes(boundary), `missing ${boundary}`);
  }
});
