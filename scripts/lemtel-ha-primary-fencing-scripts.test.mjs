import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fence = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-fence.sh'), 'utf8');
const abort = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-fence-abort-before-promotion.sh'), 'utf8');

test('primary fencing requires root, explicit tokens, an acknowledgement, and serializes the writer stop', () => {
  assert.match(fence, /^#!\/usr\/bin\/env bash/mu);
  assert.match(fence, /fence_primary_for_controlled_failover/u);
  assert.match(fence, /LEMTEL_HA_ROLE:-\}" = 'hostinger_primary'/u);
  assert.match(fence, /I_UNDERSTAND_PRIMARY_WRITES_WILL_STOP/u);
  assert.match(fence, /container='supabase-db'/u);
  assert.match(fence, /flock -n 9 \|\| fail concurrent_fencing_operation/u);
  assert.match(fence, /docker update --restart no "\$container"/u);
  assert.match(fence, /docker stop --time 30 "\$container"/u);
  assert.match(fence, /primary_writer_fenced=true/u);
  assert.match(fence, /host_postgres_listener_enabled=false/u);
  assert.match(fence, /fencing_state_recorded=true/u);
  assert.match(fence, /rollback\(\)/u);
  assert.match(fence, /docker start "\$container"/u);
  assert.match(fence, /automatic_promotion_enabled=false/u);
  assert.match(fence, /dns_change_executed=false/u);
  assert.match(fence, /standby_promotion_executed=false/u);
  assert.match(fence, /fusionpbx_or_sip_contacted=false/u);
  assert.match(fence, /credential_values_emitted=false/u);
  assert.doesNotMatch(fence, /(?:pg_promote|cloudflare|\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate)\b|docker\s+compose\s+up|\bturn\b|\bwss\b)/imu);
});

test('aborting a fence may restore the primary only before promotion or DNS cutover', () => {
  assert.match(abort, /abort_primary_fence_before_standby_promotion/u);
  assert.match(abort, /I_CONFIRM_NO_STANDBY_PROMOTION_OR_DNS_CUTOVER_OCCURRED/u);
  assert.match(abort, /primary-fence\.state/u);
  assert.match(abort, /docker update --restart "\$original_restart_policy" "\$container"/u);
  assert.match(abort, /docker start "\$container"/u);
  assert.match(abort, /abort_before_standby_promotion=true/u);
  assert.match(abort, /standby_promotion_executed=false/u);
  assert.match(abort, /dns_change_executed=false/u);
  assert.match(abort, /automatic_promotion_enabled=false/u);
  assert.match(abort, /fusionpbx_or_sip_contacted=false/u);
  assert.match(abort, /credential_values_emitted=false/u);
  assert.doesNotMatch(abort, /(?:pg_promote|cloudflare|\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate)\b|docker\s+compose\s+up|\bturn\b|\bwss\b)/imu);
});
