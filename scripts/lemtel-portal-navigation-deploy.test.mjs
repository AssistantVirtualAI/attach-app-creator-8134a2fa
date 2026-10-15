import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-portal-navigation-deploy.sh", import.meta.url), "utf8");

test("portal navigation deploy is root-gated, digest-verified, writer-only and transactional", () => {
  for (const required of [
    'LEMTEL_PORTAL_NAVIGATION_EXECUTE:-}" = deploy_verified_portal_navigation',
    'LEMTEL_HA_ROLE:-}" = digitalocean_writer',
    'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED',
    'manifest.sha256',
    'verify_digest',
    'SELECT pg_is_in_recovery()::text',
    'portal_route_missing_or_ambiguous',
    'portal_navigation_deploy_status=complete',
  ]) assert.ok(source.includes(required), `missing ${required}`);
  assert.match(source, /trap rollback ERR INT TERM/);
  assert.match(source, /mv "\$portal_dir" "\$backup_dir\/lemtel-portal"/);
});

test("portal navigation deploy is static-only and cannot alter infrastructure or telephony", () => {
  for (const forbidden of [/ALTER SYSTEM/i, /CREATE TABLE/i, /docker restart/i, /fusionpbx/i, /sip:|wss:|turn:/i]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /database_mutation=false/);
  assert.match(source, /edge_function_changed=false/);
  assert.match(source, /automatic_traffic_failover_enabled=false/);
  assert.match(source, /telephony_provider_contacted=false/);
});
