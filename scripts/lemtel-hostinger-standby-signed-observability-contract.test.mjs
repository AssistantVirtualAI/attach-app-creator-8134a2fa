// Contract for option B: Hostinger standby observations are a role-bound signed publication, never a secure enrollment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sha = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const N = 'infra/lemtel-resilience/hostinger-standby-signed-observability';
const manifest = JSON.parse(read(`${N}/deployment-manifest.json`));

test('manifest pins every source and authorizes nothing', () => {
  assert.equal(manifest.trust_model, 'signed_publication_not_enrolled');
  for (const key of ['deployment_authorized', 'schema_apply_authorized', 'publisher_install_authorized', 'publisher_timer_enable_authorized', 'secure_enrollment_claimed', 'hostinger_runtime_started', 'postgres_promotion_executed', 'cloudflare_or_dns_changed', 'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted']) assert.equal(manifest[key], false, key);
  for (const entry of [...manifest.sources, ...manifest.validation_sources]) assert.equal(sha(entry.path), entry.sha256, entry.path);
});

test('migration 0023 is a private singleton writable only through its bounded RPC', () => {
  const sql = read('infra/lemtel-self-hosted/migrations/0023_lemtel_hostinger_standby_resource_current.sql');
  assert.match(sql, /REVOKE ALL ON TABLE public\.lemtel_hostinger_standby_resource_current FROM PUBLIC, anon, authenticated, service_role;/u);
  assert.match(sql, /GRANT SELECT ON TABLE public\.lemtel_hostinger_standby_resource_current TO service_role;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lemtel_record_hostinger_standby_resource_status\(timestamptz, smallint, smallint, smallint, integer, integer, integer\) TO service_role;/u);
  assert.doesNotMatch(sql, /do_writer|GRANT (INSERT|UPDATE|DELETE)/u);
});

test('secrets are role-bound: Hostinger never reuses the DO secrets and DO never accepts the Hostinger secret', () => {
  const ingest = read('infra/lemtel-self-hosted/functions/lemtel-hostinger-standby-resource-ingest/index.ts');
  assert.match(ingest, /LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET/u);
  assert.doesNotMatch(ingest, /LEMTEL_DO_WRITER_RESOURCE_SECRET|LEMTEL_TRAFFIC_COLLECTOR_SECRET/u);
  const traffic = read('infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/index.ts');
  assert.match(traffic, /envelope\.nodeRole === "do_writer" \? secret : dependencies\.env\(HOSTINGER_STANDBY_TRAFFIC_SECRET_ENV\)/u);
  assert.match(traffic, /envelope\.nodeRole === "hostinger_standby" && roleSecret === secret\)\) return empty\(503\)/u);
  const doIngest = read('infra/lemtel-self-hosted/functions/lemtel-do-writer-resource-ingest/index.ts');
  assert.doesNotMatch(doIngest, /HOSTINGER/u);
});

test('Hostinger publisher targets only its own ingress and stays observation-only', () => {
  const publisher = read(`${N}/lemtel-hostinger-standby-resource-publish.sh`);
  assert.match(publisher, /\/etc\/lemtel-ha\/hostinger-standby-resource-publisher\.env/u);
  assert.match(publisher, /endpoint\.path != '\/functions\/v1\/lemtel-hostinger-standby-resource-ingest'/u);
  assert.match(publisher, /X-Lemtel-Hostinger-Standby-Resource-Signature/u);
  assert.doesNotMatch(publisher, /DO_WRITER|do-writer|pg_promote|systemctl|docker|nsupdate|fence/u);
  const timer = read(`${N}/systemd/lemtel-hostinger-standby-resource-publisher.timer`);
  assert.match(timer, /^OnActiveSec=30s$/mu); assert.match(timer, /^OnUnitActiveSec=60s$/mu); assert.match(timer, /^Persistent=false$/mu);
  const service = read(`${N}/systemd/lemtel-hostinger-standby-resource-publisher.service`);
  assert.match(service, /^ProtectSystem=strict$/mu); assert.doesNotMatch(service, /Environment|SECRET|TOKEN|KEY/iu);
});

test('portal labels Hostinger data as signed and not enrolled, and requires the trust label', () => {
  const panel = read('src/pages/lemtel/onboarding/LemtelNodeResourcePanel.tsx');
  assert.match(panel, /hostingerResources\?\.trust === "signed_publication_not_enrolled"/u);
  const i18n = read('src/pages/lemtel/onboarding/lemtelI18n.ts');
  assert.match(i18n, /Publication signée — non enrôlée/u); assert.match(i18n, /Signed publication — not enrolled/u);
  const admin = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
  assert.match(admin, /trust: "signed_publication_not_enrolled" as const/u);
});
