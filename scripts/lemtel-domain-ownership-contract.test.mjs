import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read('infra/lemtel-self-hosted/migrations/0013_lemtel_organization_ownership_transfer.sql');
const edge = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
const api = read('src/pages/lemtel/onboarding/lemtelHostedApi.ts');
const controls = read('src/pages/lemtel/onboarding/LemtelMembershipControls.tsx');
const lifecycle = read('docs/lemtel-portal/DOMAIN_AND_OWNERSHIP_LIFECYCLE.md');
const edgeExecutable = edge.replace(/^\s*\/\/.*$/gmu, '');

const prohibited = /(?:planipret|fusionpbx|pbx_|\bsip:\/\/|\bwss:\/\/|\bturn:\/\/|pg_promote|nsupdate)/imu;

test('ownership transfer is atomic, service-role-only and audit-bound', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.lemtel_transfer_organization_ownership/);
  assert.match(migration, /FOR UPDATE;/);
  assert.match(migration, /v_actor_role IS DISTINCT FROM 'owner'/);
  assert.match(migration, /v_recipient_status IS DISTINCT FROM 'active'/);
  assert.match(migration, /SET role = 'admin'/);
  assert.match(migration, /SET role = 'owner'/);
  assert.match(migration, /organization_ownership_transferred/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, prohibited);
});

test('edge routes validate tenant-scoped lifecycle actions before executing them', () => {
  assert.match(edge, /action: "transfer_organization_ownership"/);
  assert.match(edge, /action: "reactivate_domain"/);
  assert.match(edge, /organizationOwner\(admin, actor, request\.organizationId\)/);
  assert.match(edge, /lemtel_transfer_organization_ownership/);
  assert.match(edge, /eq\("status", "suspended"\)/);
  assert.match(edge, /domain_reactivated/);
  assert.doesNotMatch(edgeExecutable, prohibited);
});

test('portal exposes only confirmed and explicitly-confirmed lifecycle actions', () => {
  assert.match(api, /buildTransferOrganizationOwnershipBody/);
  assert.match(api, /buildReactivateDomainBody/);
  assert.match(api, /transferOrganizationOwnership/);
  assert.match(api, /reactivateDomain/);
  assert.match(controls, /window\.confirm\(t\.membership\.confirmOwnershipTransfer\)/);
  assert.match(lifecycle, /Aucune vérification DNS n’est forcée/);
  assert.match(lifecycle, /L’accès d’une personne découle de son membership actif/);
});
