import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const guardPath = (name) => resolve(root, 'infra/lemtel-resilience/automatic-failover', name);
const source = (name) => readFileSync(guardPath(name), 'utf8');
const forbiddenAction = /(?:\bpg_ctl\s+promote\b|docker\s+compose\s+up|\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate)\b|\b(?:systemctl|service)\s+(?:start|restart)\b|\b(?:terraform|doctl|hcloud|cloudflared)\b)/iu;
const forbiddenWrite = /(?:\b(?:install|mkdir|touch|truncate|tee|chmod|chown)\b|>>?\s*['"]?\/var\/lib)/u;

test('DO writer provider-fence evidence contract is root-only, token-gated, and non-fencing', () => {
  const value = source('lemtel-ha-do-writer-provider-fence-evidence.sh');
  assert.match(value, /^#!\/usr\/bin\/env bash/mu);
  assert.match(value, /\[ "\$\(id -u\)" -eq 0 \] \|\| fail root_required/u);
  assert.match(value, /record_out_of_band_do_writer_fence_attestation/u);
  assert.match(value, /LEMTEL_HA_PROVIDER_FENCE_RECEIPT_ACK/u);
  assert.match(value, /LEMTEL_HA_ROLE:-\}" = 'do_writer'/u);
  assert.match(value, /LEMTEL_HA_INCIDENT_ID/u);
  assert.match(value, /authorized_out_of_band_attestation_repository/u);
  assert.match(value, /provider_api_contacted=false/u);
  assert.match(value, /provider_fencing_executed=false/u);
  assert.match(value, /automatic_provider_fencing_enabled=false/u);
  assert.match(value, /automatic_promotion_enabled=false/u);
  assert.doesNotMatch(value, forbiddenAction);
  assert.doesNotMatch(value, forbiddenWrite);
});

test('Hostinger promotion guard proves only local private standby readiness and never promotes', () => {
  const value = source('lemtel-ha-hostinger-auto-promotion-guard.sh');
  assert.match(value, /^#!\/usr\/bin\/env bash/mu);
  assert.match(value, /\[ "\$\(id -u\)" -eq 0 \] \|\| fail root_required/u);
  assert.match(value, /verify_hostinger_promotion_readiness_only/u);
  assert.match(value, /LEMTEL_HA_ROLE:-\}" = 'hostinger_private_hot_standby'/u);
  assert.match(value, /LEMTEL_HA_INCIDENT_ID/u);
  assert.match(value, /gpgv --keyring/u);
  assert.match(value, /writer_role=do_writer/u);
  assert.match(value, /writer_fenced=true/u);
  assert.match(value, /SELECT pg_is_in_recovery\(\)/u);
  assert.match(value, /SELECT status FROM pg_stat_wal_receiver LIMIT 1/u);
  assert.match(value, /runtime_staged=true/u);
  assert.match(value, /runtime_running=false/u);
  assert.match(value, /public_database_listener_enabled=false/u);
  assert.match(value, /promotion_executed=false/u);
  assert.match(value, /automatic_promotion_enabled=false/u);
  assert.match(value, /hostinger_auto_promotion_guard_status=readiness_only/u);
  assert.doesNotMatch(value, forbiddenAction);
  assert.doesNotMatch(value, forbiddenWrite);
});

test('Hostinger post-promotion guard requires existing signed single-writer evidence and never starts runtime', () => {
  const value = source('lemtel-ha-hostinger-post-promotion-runtime-guard.sh');
  assert.match(value, /^#!\/usr\/bin\/env bash/mu);
  assert.match(value, /\[ "\$\(id -u\)" -eq 0 \] \|\| fail root_required/u);
  assert.match(value, /verify_hostinger_post_promotion_runtime_readiness_only/u);
  assert.match(value, /LEMTEL_HA_ROLE:-\}" = 'hostinger_promoted_writer'/u);
  assert.match(value, /hostinger-promotion\.state/u);
  assert.match(value, /promotion_executed=true/u);
  assert.match(value, /single-writer\.evidence/u);
  assert.match(value, /gpgv --keyring/u);
  assert.match(value, /do_writer_fenced=true/u);
  assert.match(value, /single_writer_confirmed=true/u);
  assert.match(value, /runtime_start_executed=false/u);
  assert.match(value, /automatic_runtime_start_enabled=false/u);
  assert.match(value, /automatic_traffic_routing_enabled=false/u);
  assert.match(value, /hostinger_post_promotion_runtime_guard_status=readiness_only/u);
  assert.doesNotMatch(value, forbiddenAction);
  assert.doesNotMatch(value, forbiddenWrite);
});
