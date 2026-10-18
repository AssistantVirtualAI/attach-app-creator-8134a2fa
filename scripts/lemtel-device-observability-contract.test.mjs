import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const connectionsMigration = read('infra/lemtel-self-hosted/migrations/0010_lemtel_client_connections.sql');
const sessionControlsMigration = read('infra/lemtel-self-hosted/migrations/0014_lemtel_client_session_controls.sql');
const historyMigration = read('infra/lemtel-self-hosted/migrations/0011_lemtel_operational_status_history.sql');
const bootstrap = read('infra/lemtel-self-hosted/functions/lemtel-session-bootstrap/index.ts');
const admin = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
const portalApi = read('src/pages/lemtel/onboarding/lemtelHostedApi.ts');
const portal = read('src/pages/lemtel/onboarding/LemtelPortalApp.tsx');
const operations = read('src/pages/lemtel/onboarding/LemtelOperationalStatus.tsx');
const publisher = read('infra/lemtel-resilience/active-passive/lemtel-ha-promoted-writer-status-publish.sh');

const forbidden = /(?:planipret|pbx_|pg_promote|nsupdate|docker\s+(?:run|compose\s+up))/imu;

test('client presence is minimal, server-written and unavailable to browser roles', () => {
  assert.match(connectionsMigration, /lemtel_client_connection_presence/);
  assert.match(connectionsMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(connectionsMigration, /REVOKE ALL ON TABLE public\.lemtel_client_connection_presence FROM PUBLIC, anon, authenticated/);
  assert.match(connectionsMigration, /GRANT EXECUTE ON FUNCTION public\.lemtel_record_client_connection\(uuid, text\)\s+TO service_role/);
  assert.match(connectionsMigration, /No device fingerprint, IP address, token, password/);
  assert.doesNotMatch(connectionsMigration, forbidden);
});

test('session bootstrap records a bounded presence marker but never uses it for authorization', () => {
  assert.match(bootstrap, /X-Lemtel-Client/);
  assert.match(sessionControlsMigration, /lemtel_record_authorized_client_connection/);
  assert.match(sessionControlsMigration, /FROM public\.lemtel_session_bootstrap_context_for_client\(p_user_id, v_client_kind\)/);
  assert.match(sessionControlsMigration, /GRANT EXECUTE ON FUNCTION public\.lemtel_record_authorized_client_connection\(uuid, text\)\s+TO service_role/);
  assert.match(bootstrap, /lemtel_record_authorized_client_connection/);
  assert.match(bootstrap, /try \{\s+await admin\.rpc\("lemtel_record_authorized_client_connection"/);
  assert.match(bootstrap, /Presence remains best-effort and can never deny an otherwise valid session/);
  assert.match(bootstrap, /lemtel_session_bootstrap_context/);
  assert.doesNotMatch(bootstrap, forbidden);
});

test('portal device inventory and operational trend remain behind authenticated Lemtel actions', () => {
  assert.match(admin, /list_client_connections/);
  assert.match(admin, /lemtel_client_connection_presence/);
  assert.match(admin, /get_operational_trend/);
  assert.match(admin, /lemtel_operational_status_history/);
  assert.match(admin, /platformAdmin\(admin, actor\)/);
  assert.match(admin, /portalOrganizationAdmin\(admin, actor, request\.organizationId\)/);
  assert.match(admin, /platformOverviewClientPresence/);
  assert.match(admin, /observation: "no_observation"/);
  assert.match(portalApi, /clientPresence/);
  assert.match(portalApi, /getOperationalTrend/);
  assert.match(portalApi, /listClientConnections/);
  assert.match(portal, /Application connections/);
  assert.match(operations, /Availability trend/);
  assert.doesNotMatch(admin, forbidden);
});

test('operational history is redacted and the writer publisher persists verified snapshots only', () => {
  assert.match(historyMigration, /lemtel_operational_status_history/);
  assert.match(historyMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(historyMigration, /REVOKE ALL ON TABLE public\.lemtel_operational_status_history FROM PUBLIC, anon, authenticated/);
  assert.match(historyMigration, /Raw traffic telemetry and sensitive server details are intentionally excluded/);
  assert.match(publisher, /INSERT INTO public\.lemtel_operational_status_history/);
  assert.match(publisher, /datetime\.strptime/);
  assert.match(publisher, /automatic_promotion_enabled=false/);
  assert.match(publisher, /dns_failover_enabled=false/);
  assert.doesNotMatch(historyMigration, forbidden);
});
