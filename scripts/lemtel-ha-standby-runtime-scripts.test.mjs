import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const script = (name) => readFileSync(resolve(root, `infra/lemtel-resilience/active-passive/${name}`), 'utf8');
const primaryEnvelope = script('lemtel-ha-primary-standby-runtime-envelope-create.sh');
const standbyStage = script('lemtel-ha-standby-runtime-envelope-stage.sh');
const standbyActivation = script('lemtel-ha-standby-runtime-activate-after-promotion.sh');
const unsafe = /(?:\bpg_promote\b|\bnsupdate\b|docker\s+(?:run|compose\s+up)|\brsync\b|\bssh\b|\bscp\b|\bturn\b|\bwss\b)/imu;

test('primary runtime envelope is root-only, encrypted, and excludes independent data volumes', () => {
  assert.match(primaryEnvelope, /create_private_standby_runtime_envelope/u);
  assert.match(primaryEnvelope, /LEMTEL_HA_ROLE:-\}" = 'hostinger_primary'/u);
  assert.match(primaryEnvelope, /LEMTEL_HA_STANDBY_AGE_RECIPIENT/u);
  assert.match(primaryEnvelope, /age -r "\$age_recipient"/u);
  assert.match(primaryEnvelope, /docker-compose\.lemtel-private\.yml/u);
  assert.match(primaryEnvelope, /volumes\/functions/u);
  assert.match(primaryEnvelope, /volumes\/proxy\/caddy/u);
  assert.match(primaryEnvelope, /database_data_included=false/u);
  assert.match(primaryEnvelope, /storage_data_included=false/u);
  assert.match(primaryEnvelope, /credential_values_emitted=false/u);
  assert.doesNotMatch(primaryEnvelope, unsafe);
});

test('standby runtime stage is root-only, allow-listed, config-only, and never starts a runtime', () => {
  assert.match(standbyStage, /stage_private_standby_runtime_envelope/u);
  assert.match(standbyStage, /LEMTEL_HA_ROLE:-\}" = 'digitalocean_standby'/u);
  assert.match(standbyStage, /age -d -i "\$age_identity"/u);
  assert.match(standbyStage, /envelope_content_unapproved/u);
  assert.match(standbyStage, /docker compose[\s\\]+/u);
  assert.match(standbyStage, /config >\/dev\/null/u);
  assert.match(standbyStage, /containers_started=false/u);
  assert.match(standbyStage, /public_listener_enabled=false/u);
  assert.match(standbyStage, /storage_runtime_started=false/u);
  assert.match(standbyStage, /postgres_listener_5432_started=false/u);
  assert.match(standbyStage, /automatic_promotion_enabled=false/u);
  assert.match(standbyStage, /credential_values_emitted=false/u);
  assert.doesNotMatch(standbyStage, unsafe);
});

test('promoted standby runtime activation requires fencing evidence and preserves the private database boundary', () => {
  assert.match(standbyActivation, /activate_promoted_standby_runtime/u);
  assert.match(standbyActivation, /LEMTEL_HA_ROLE:-\}" = 'digitalocean_standby'/u);
  assert.match(standbyActivation, /I_UNDERSTAND_PROMOTED_STANDBY_RUNTIME_WILL_START/u);
  assert.match(standbyActivation, /standby-promotion\.state/u);
  assert.match(standbyActivation, /primary_fence_not_confirmed/u);
  assert.match(standbyActivation, /SELECT pg_is_in_recovery\(\)/u);
  assert.match(standbyActivation, /docker network connect --alias db/u);
  assert.match(standbyActivation, /docker compose --project-name lemtel-ha-standby/u);
  assert.match(standbyActivation, /up --detach --no-build --no-deps/u);
  assert.match(standbyActivation, /standby_runtime_started=true/u);
  assert.match(standbyActivation, /storage_runtime_started=true/u);
  assert.match(standbyActivation, /public_runtime_listener_enabled=true/u);
  assert.match(standbyActivation, /host_postgres_listener_enabled=false/u);
  assert.match(standbyActivation, /public_database_listener_enabled=false/u);
  assert.match(standbyActivation, /dns_change_executed=false/u);
  assert.match(standbyActivation, /automatic_promotion_enabled=false/u);
  assert.match(standbyActivation, /former_primary_restart_attempted=false/u);
  assert.match(standbyActivation, /fusionpbx_or_sip_contacted=false/u);
  assert.match(standbyActivation, /credential_values_emitted=false/u);
  assert.doesNotMatch(standbyActivation, /(?:\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate)\b|cloudflare|\bturn\b|\bwss\b)/imu);
});
