import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-standby-postgres-promote.sh'), 'utf8');

test('standby promotion is root-only, manually gated, evidence-bound, and irreversible', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash/mu);
  assert.match(source, /promote_standby_after_verified_primary_fence/u);
  assert.match(source, /LEMTEL_HA_ROLE:-\}" = 'digitalocean_standby'/u);
  assert.match(source, /I_UNDERSTAND_STANDBY_BECOMES_THE_ONLY_WRITER/u);
  assert.match(source, /LEMTEL_HA_INCIDENT_ID/u);
  assert.match(source, /primary-fence\.state/u);
  assert.match(source, /primary_fence_evidence_incident_mismatch/u);
  assert.match(source, /fenced_database_running=false/u);
  assert.match(source, /fenced_restart_policy=no/u);
  assert.match(source, /primary_writer_still_reachable/u);
  assert.match(source, /standby_signal_missing/u);
  assert.match(source, /standby_wal_position_missing/u);
  assert.match(source, /detached_after_primary_fence/u);
  assert.match(source, /wal_receiver_evidence=%s/u);
  assert.match(source, /container='lemtel-postgres-standby'/u);
  assert.match(source, /SELECT pg_is_in_recovery\(\)/u);
  assert.match(source, /pg_ctl promote -D \/var\/lib\/postgresql\/data/u);
  assert.match(source, /standby_promoted=true/u);
  assert.match(source, /primary_writer_reachable=false/u);
  assert.match(source, /host_postgres_listener_enabled=false/u);
  assert.match(source, /public_database_listener_enabled=false/u);
  assert.match(source, /runtime_started=false/u);
  assert.match(source, /storage_runtime_started=false/u);
  assert.match(source, /dns_change_executed=false/u);
  assert.match(source, /automatic_promotion_enabled=false/u);
  assert.match(source, /former_primary_restart_attempted=false/u);
  assert.match(source, /fusionpbx_or_sip_contacted=false/u);
  assert.match(source, /credential_values_emitted=false/u);
  assert.doesNotMatch(source, /(?:docker\s+compose\s+up|\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate)\b|cloudflare|\bturn\b|\bwss\b)/imu);
});
